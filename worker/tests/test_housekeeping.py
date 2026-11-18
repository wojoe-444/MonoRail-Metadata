import os
import time

from monorail_worker import housekeeping
from monorail_worker import protocol as P
from monorail_worker.storage import dumps
from monorail_worker.ulid import new_ulid, now_ms

DAY = 86_400_000


def _age(storage, key, days):
    p = storage.root / key
    t = time.time() - days * 86400
    os.utime(p, (t, t))


def test_retention(storage):
    now = now_ms()
    old_done = new_ulid(now - 8 * DAY)
    old_pending = new_ulid(now - 8 * DAY + 1000)
    fresh = new_ulid(now)
    for rid in (old_done, old_pending, fresh):
        storage.write(P.inbox_key(rid), b"{}")
        storage.write(P.outbox_key(rid), b"{}")
        _age(storage, P.inbox_key(rid), 8 if rid != fresh else 0)
        _age(storage, P.outbox_key(rid), 8 if rid != fresh else 0)
    for seq in (1, 2, 3):
        storage.write(P.feed_key(seq), b"{}")
        _age(storage, P.feed_key(seq), 8)
    storage.write(P.feed_key(4), b"{}")
    storage.write(P.MANIFEST, dumps(P.manifest(3, now, "2.0.8", [{"entityType": "table", "path": "tables", "file": "table.2.json.gz", "count": 0}], "lineage.2.json.gz", 0)))
    for f in ("table.1.json.gz", "lineage.1.json.gz", "table.2.json.gz", "lineage.2.json.gz", "table.3.json.gz"):
        storage.write(P.CATALOG + f, b"[]")
    for f in ("table.1.json.gz", "lineage.1.json.gz", "table.2.json.gz"):
        _age(storage, P.CATALOG + f, 1)

    housekeeping.run(storage, cursor_last=old_done)

    inbox = {o.key for o in storage.list(P.INBOX)}
    assert inbox == {P.inbox_key(old_pending), P.inbox_key(fresh)}  # unprocessed requests stay
    assert {o.key for o in storage.list(P.OUTBOX)} == {P.outbox_key(fresh)}
    # Events below the snapshot's seq (3) and older than 7 days go; 3 and 4 stay.
    assert {o.key for o in storage.list(P.FEED)} == {P.feed_key(3), P.feed_key(4)}
    # Unreferenced snapshot files older than an hour go; referenced and recent ones stay.
    assert {o.key for o in storage.list(P.CATALOG)} == {P.MANIFEST, P.CATALOG + "table.2.json.gz", P.CATALOG + "lineage.2.json.gz", P.CATALOG + "table.3.json.gz"}
