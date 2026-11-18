"""Changes made in OpenMetadata outside the queue (ingestion, its own UI, scripts), from its change events.

Endpoint (OpenMetadata 2.0.8, EventResource.listChangeEvents; admin or bot only):

    GET /api/v1/events?entityCreated=*&entityUpdated=*&entityRestored=*&entityDeleted=*
                      &timestamp=<ms>&limit=1000[&after=<cursor>]

Events come in `offset` order (OpenMetadata's change_event row number). `paging.after` is the
base64 offset of the last event on a page, and it is null on the final page. To keep a resumable
cursor, the worker re-asks for the final page with `limit = k - 1`, which yields the cursor of the
second-to-last event; the last one is seen again next time and skipped by its event id.
`timestamp` filters on the event time, which some events backdate (test case results carry the
result's time), so it's only used before the worker has a cursor.

Lineage edits produce no change events in 2.0.8; the periodic snapshot diff covers them.
"""

from __future__ import annotations

import logging
from collections import OrderedDict, deque
from typing import Any

from .entities import TYPE_TO_COLLECTION
from .om import Om, OmError
from .state import ReplicaState
from .touched import Deleted, EntityById, Target

log = logging.getLogger(__name__)

ALL = {"entityCreated": "*", "entityUpdated": "*", "entityRestored": "*", "entityDeleted": "*"}
DELETES = {"entityDeleted", "entitySoftDeleted"}
SEEN_MAX = 5000
PAGE = 1000


class EventCursor:
    def __init__(self, after: str | None = None, since: int = 0, seen: list[str] | None = None):
        self.after = after
        self.since = since
        self.seen: OrderedDict[str, None] = OrderedDict((s, None) for s in (seen or []))

    def to_json(self) -> dict[str, Any]:
        return {"after": self.after, "since": self.since, "seen": list(self.seen.keys())[-SEEN_MAX:]}

    @staticmethod
    def from_json(d: dict[str, Any] | None, default_since: int) -> "EventCursor":
        d = d or {}
        return EventCursor(d.get("after"), int(d.get("since") or default_since), d.get("seen") or [])

    def mark(self, event_id: str) -> None:
        self.seen[event_id] = None
        while len(self.seen) > SEEN_MAX:
            self.seen.popitem(last=False)


def fetch(om: Om, cur: EventCursor, page: int = PAGE) -> list[dict[str, Any]]:
    """New change events since the cursor (not yet marked seen). Advances `cur.after`."""

    def get(after: str | None, limit: int) -> dict[str, Any]:
        q: dict[str, Any] = {**ALL, "timestamp": 0 if cur.after else cur.since, "limit": limit}
        if after:
            q["after"] = after
        res = om.request("GET", "/events", q)
        if res.status >= 400:
            raise OmError(res.status, res.body, "GET /events")
        return res.body or {}

    out: list[dict[str, Any]] = []
    after = cur.after
    while True:
        body = get(after, page)
        data = [e for e in body.get("data", []) if isinstance(e, dict)]
        out.extend(data)
        nxt = (body.get("paging") or {}).get("after")
        if nxt:
            after = nxt
            continue
        if len(data) >= 2:
            nxt = (get(after, len(data) - 1).get("paging") or {}).get("after")
            if nxt:
                after = nxt
        break
    cur.after = after
    return [e for e in out if e.get("id") not in cur.seen]


class SelfWrites:
    """(entityId, version) pairs the worker itself just published, so their change events are skipped."""

    def __init__(self, maxlen: int = 2000):
        self._q: deque[tuple[str, float]] = deque(maxlen=maxlen)
        self._s: set[tuple[str, float]] = set()

    def add(self, eid: str, version: Any) -> None:
        if not isinstance(version, (int, float)):
            return
        k = (eid, float(version))
        if k in self._s:
            return
        if len(self._q) == self._q.maxlen:
            self._s.discard(self._q[0])
        self._q.append(k)
        self._s.add(k)

    def __contains__(self, k: tuple[str, float]) -> bool:
        return k in self._s


def to_targets(events: list[dict[str, Any]], cur: EventCursor, state: ReplicaState, self_writes: SelfWrites) -> list[Target]:
    """One target per entity: re-read it, or delete it if its last event was a delete."""
    last: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for ev in events:
        cur.mark(ev["id"])
        etype, eid = ev.get("entityType"), ev.get("entityId")
        if etype not in TYPE_TO_COLLECTION or not eid:
            continue
        # No skipping by (id, version) for the worker's own writes: OpenMetadata folds consecutive edits by the
        # same account into one version, so a later outside edit can carry the version the worker just wrote.
        # Re-reading is cheap, and materialize(skip_unchanged=True) drops entities whose content apps already hold.
        last.pop(eid, None)
        last[eid] = ev
    out: list[Target] = []
    for eid, ev in last.items():
        etype = ev["entityType"]
        if ev.get("eventType") in DELETES:
            if state.has_entity(eid):
                out.append(Deleted(etype, eid))
        else:
            out.append(EntityById(TYPE_TO_COLLECTION[etype], eid, related=etype == "testCase"))
    return out


def by_of(events: list[dict[str, Any]]) -> str | None:
    """The OpenMetadata user behind a batch of events, when it's one user."""
    users = {e.get("userName") for e in events if e.get("userName") and e.get("entityType") in TYPE_TO_COLLECTION}
    return users.pop() if len(users) == 1 else None
