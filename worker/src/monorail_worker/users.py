"""Map a verified identity (`by`) to an OpenMetadata user (docs/team-backend.md, "Identity").

An email matches a user's `email` (case-insensitive); anything else matches a user's `name`. The
directory is filled from the snapshot's users and kept current from the feed. On a miss the worker
asks OpenMetadata once: `GET /users/name/{name}`, or for an email `GET /users/name/{local part}`,
accepted only if that user's email matches. Misses are remembered for a few minutes so a teammate
without an OpenMetadata account doesn't cost a lookup per request.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Iterable
from urllib.parse import quote

from .om import Om

log = logging.getLogger(__name__)

MISS_TTL_S = 300


class Directory:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._by_id: dict[str, dict[str, Any]] = {}
        self._by_email: dict[str, str] = {}
        self._by_name: dict[str, str] = {}
        self._misses: dict[str, float] = {}

    def load(self, users: Iterable[dict[str, Any]]) -> None:
        self._by_id.clear()
        self._by_email.clear()
        self._by_name.clear()
        self._misses.clear()
        for u in users:
            self.put(u)

    def put(self, user: dict[str, Any]) -> None:
        if not user.get("id") or not user.get("name"):
            return
        self.remove(user["id"])
        if user.get("deleted") or user.get("isBot"):
            return
        u = {"id": user["id"], "name": user["name"], "email": (user.get("email") or "").lower()}
        self._by_id[u["id"]] = u
        self._by_name[u["name"]] = u["id"]
        if u["email"]:
            self._by_email[u["email"]] = u["id"]
        self._misses.clear()

    def remove(self, uid: str) -> None:
        old = self._by_id.pop(uid, None)
        if not old:
            return
        if self._by_name.get(old["name"]) == uid:
            del self._by_name[old["name"]]
        if old["email"] and self._by_email.get(old["email"]) == uid:
            del self._by_email[old["email"]]

    def apply(self, changes: Iterable[dict[str, Any]]) -> None:
        """Follow user upserts and deletes in a feed event."""
        for c in changes:
            if c.get("entityType") != "user":
                continue
            if c.get("op") == "upsert":
                self.put(c["entity"])
            elif c.get("op") == "delete":
                self.remove(c["id"])

    def _local(self, who: str) -> dict[str, Any] | None:
        key = who.strip()
        uid = self._by_email.get(key.lower()) if "@" in key else self._by_name.get(key)
        return self._by_id.get(uid) if uid else None

    def find(self, who: str | None, om: Om | None = None) -> dict[str, Any] | None:
        """`{"id", "name"}` of the user `who` maps to, or None."""
        if not who:
            return None
        u = self._local(who)
        if u is None and om is not None:
            u = self._lookup(who.strip(), om)
        return {"id": u["id"], "name": u["name"]} if u else None

    def _lookup(self, who: str, om: Om) -> dict[str, Any] | None:
        missed = self._misses.get(who)
        if missed is not None and self.clock() - missed < MISS_TTL_S:
            return None
        email = who.lower() if "@" in who else None
        name = who.split("@", 1)[0] if email else who
        try:
            res = om.request("GET", f"/users/name/{quote(name, safe='')}")
        except Exception:
            log.exception("looking up OpenMetadata user %s failed", name)
            return None
        user = res.body if res.status == 200 and isinstance(res.body, dict) else None
        if user and email and (user.get("email") or "").lower() != email:
            user = None
        if user and not user.get("isBot") and not user.get("deleted"):
            self.put(user)
            return self._by_id.get(user["id"])
        self._misses[who] = self.clock()
        return None
