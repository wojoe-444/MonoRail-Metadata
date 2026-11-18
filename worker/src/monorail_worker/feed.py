"""The change feed: `feed/{seq}.json` (create-only), then `feed/head.json`.

Sequence numbers are contiguous; apps treat a gap as "reload the snapshot". Only the lease holder
appends.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from . import protocol as P
from .storage import Storage, dumps, read_json, write_json
from .ulid import now_ms

log = logging.getLogger(__name__)


class Feed:
    def __init__(self, storage: Storage, clock: Callable[[], int] = now_ms):
        self.storage = storage
        self.clock = clock
        self.seq = 0

    def recover(self) -> int:
        """Read head.json, then move it past any events written after it (a crash between the
        event and the head)."""
        head = read_json(self.storage, P.HEAD) or {}
        seq = int(head.get("seq", 0))
        nxt = seq + 1
        while self.storage.read(P.feed_key(nxt)) is not None:
            nxt += 1
        if nxt - 1 != seq:
            log.warning("feed head was %s but events exist up to %s; fixing head", seq, nxt - 1)
            seq = nxt - 1
            write_json(self.storage, P.HEAD, P.head(seq, self.clock()))
        self.seq = seq
        return seq

    def find_request(self, request_id: str, lookback: int = 50) -> dict[str, Any] | None:
        """The feed event a request already produced, if it's among the last `lookback` events."""
        for s in range(self.seq, max(0, self.seq - lookback), -1):
            ev = read_json(self.storage, P.feed_key(s))
            if ev and ev.get("requestId") == request_id:
                return ev
        return None

    def append(
        self,
        changes: list[dict[str, Any]],
        *,
        by: str | None,
        source: P.Source,
        request_id: str | None = None,
        seq: int | None = None,
    ) -> dict[str, Any]:
        """Write the next event and move the head. Returns the event.

        `seq` reserves a specific number (used by resync, which writes the snapshot first)."""
        nxt = seq if seq is not None else self.seq + 1
        while True:
            ev = P.feed_event(nxt, self.clock(), by=by, request_id=request_id, source=source, changes=changes)
            if self.storage.create(P.feed_key(nxt), dumps(ev)):
                break
            existing = read_json(self.storage, P.feed_key(nxt)) or {}
            if request_id and existing.get("requestId") == request_id:
                ev = existing  # written before a crash; reuse it
                break
            log.warning("feed/%012d already exists (another writer?); trying the next seq", nxt)
            nxt += 1
        self.seq = max(self.seq, nxt)
        write_json(self.storage, P.HEAD, P.head(self.seq, self.clock()))
        return ev
