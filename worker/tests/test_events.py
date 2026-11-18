from monorail_worker.events import EventCursor, SelfWrites, fetch, to_targets
from monorail_worker.state import ReplicaState
from monorail_worker.touched import Deleted, EntityById


def test_fetch_pages_and_keeps_a_resumable_cursor(om):
    for i in range(7):
        om.emit("entityUpdated", "table", f"t{i}")
    cur = EventCursor(since=0)
    got = fetch(om, cur, page=3)
    assert [e["entityId"] for e in got] == [f"t{i}" for i in range(7)]
    # The cursor sits on the second-to-last event (the final page has no `after`).
    assert cur.after is not None
    for e in got:
        cur.mark(e["id"])
    assert fetch(om, cur, page=3) == []
    om.emit("entityUpdated", "table", "t7")
    om.emit("entityDeleted", "table", "t8")
    assert [e["entityId"] for e in fetch(om, cur, page=3)] == ["t7", "t8"]


def test_fetch_single_event_never_advances_but_dedupes(om):
    om.emit("entityUpdated", "table", "only")
    cur = EventCursor(since=0)
    [e] = fetch(om, cur)
    cur.mark(e["id"])
    assert cur.after is None
    assert fetch(om, cur) == []


def test_fetch_uses_timestamp_only_without_cursor(om):
    om.emit("entityUpdated", "table", "old")
    cur = EventCursor(since=10**15)  # after everything
    assert fetch(om, cur) == []
    calls = []
    real = om.request

    def spy(method, path, query=None, headers=None, body=None):
        calls.append(dict(query or {}))
        return real(method, path, query)

    om.request = spy
    cur2 = EventCursor(after="MQ==", since=10**15)
    fetch(om, cur2)
    assert calls[0]["timestamp"] == 0 and calls[0]["after"] == "MQ=="
    assert calls[0]["entityCreated"] == calls[0]["entityDeleted"] == "*"


def test_cursor_roundtrip():
    c = EventCursor("abc", 5, ["x", "y"])
    d = EventCursor.from_json(c.to_json(), 0)
    assert d.after == "abc" and d.since == 5 and list(d.seen) == ["x", "y"]
    assert EventCursor.from_json(None, 99).since == 99


def test_to_targets_coalesces_and_skips(om):
    state = ReplicaState()
    state.entities["gone"] = ("table", "fp")
    sw = SelfWrites()
    sw.add("mine", 0.3)
    evs = [
        om.emit("entityCreated", "table", "a"),
        om.emit("entityUpdated", "table", "a", 0.2),
        om.emit("entityUpdated", "table", "mine", 0.3),  # the worker's own write (still re-read)
        om.emit("entityUpdated", "THREAD", "t"),  # not in the replica
        om.emit("entityDeleted", "table", "gone"),
        om.emit("entityDeleted", "table", "never-seen"),  # apps never had it
        om.emit("entityUpdated", "testCase", "tc"),
        om.emit("entitySoftDeleted", "glossaryTerm", "g"),
    ]
    cur = EventCursor()
    targets = to_targets(evs, cur, state, sw)
    assert targets == [
        EntityById("tables", "a"),
        # Re-read even though the worker just wrote it: OpenMetadata can fold a later outside edit by the same
        # account into that version, so (id, version) can't tell them apart. Unchanged content is dropped later.
        EntityById("tables", "mine"),
        Deleted("table", "gone"),
        EntityById("dataQuality/testCases", "tc", related=True),
    ]
    assert len(cur.seen) == len(evs)
