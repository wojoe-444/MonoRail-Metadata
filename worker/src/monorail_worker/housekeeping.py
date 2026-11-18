"""Retention (docs/team-backend.md, "Bucket layout"): what the local backend's worker deletes.

- inbox/ and outbox/ objects older than 7 days (inbox only once processed: id <= cursor).
- feed events below the current snapshot's `seq`, once they're older than 7 days.
- snapshot files no manifest refers to, once they're an hour old (readers on the old manifest are done by then).

On GCS a lifecycle rule can do the first two; running this as well is harmless.
"""

from __future__ import annotations

import logging
from typing import Callable

from . import protocol as P
from .snapshot import referenced_files
from .storage import Storage, read_json
from .ulid import is_ulid, now_ms, ulid_time

log = logging.getLogger(__name__)

DAY_MS = 86_400_000
SNAPSHOT_GRACE_MS = 3_600_000


def run(storage: Storage, *, cursor_last: str | None, retention_days: float = 7, clock: Callable[[], int] = now_ms) -> int:
    now = clock()
    cutoff = now - int(retention_days * DAY_MS)
    deleted = 0

    for prefix in (P.INBOX, P.OUTBOX):
        for o in storage.list(prefix):
            rid = o.key.removeprefix(prefix).removesuffix(".json")
            t = ulid_time(rid) if is_ulid(rid) else o.updated_ms
            if t >= cutoff or o.updated_ms >= cutoff:
                continue
            if prefix == P.INBOX and (cursor_last is None or rid > cursor_last):
                continue
            storage.delete(o.key)
            deleted += 1

    man = read_json(storage, P.MANIFEST)
    snap_seq = int((man or {}).get("seq", 0))
    for o in storage.list(P.FEED):
        seq = P.parse_feed_key(o.key)
        if seq is None or seq >= snap_seq or o.updated_ms >= cutoff:
            continue
        storage.delete(o.key)
        deleted += 1

    keep = referenced_files(man) | {P.MANIFEST}
    for o in storage.list(P.CATALOG):
        if o.key not in keep and o.updated_ms < now - SNAPSHOT_GRACE_MS:
            storage.delete(o.key)
            deleted += 1
    if deleted:
        log.info("housekeeping deleted %d objects", deleted)
    return deleted
