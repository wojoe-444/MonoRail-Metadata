"""Latest table profiles in the snapshot and the feed (docs/team-backend.md, "Snapshot")."""

from __future__ import annotations

import pytest
from conftest import feed_events, make_worker, reply_of, send

from monorail_worker import profiles
from monorail_worker import protocol as P
from monorail_worker import snapshot
from monorail_worker.state import ReplicaState
from monorail_worker.storage import read_json


@pytest.fixture
def worker(settings, storage, om, catalog, clock):
    om.set_profile(catalog["a"], 100, columns={"order_id": 0, "city": 3})
    w = make_worker(settings, storage, om, clock)
    w.run_once()
    return w


def next_cycle(worker, clock, settings):
    clock.advance(int(settings.snapshot_minutes * 60_000) + 1)
    assert worker.lease.try_acquire()  # no liveness thread in tests
    worker.run_once()


def snapshot_profiles(storage):
    man = read_json(storage, P.MANIFEST)
    return man, read_json(storage, P.CATALOG + man["files"]["profiles"]["file"])


def test_record_flattens_nested_columns_and_skips_unprofiled():
    latest = {
        "id": "t",
        "fullyQualifiedName": "s.d.t",
        "version": 0.3,
        "profile": {"rowCount": 5},
        "columns": [
            {"name": "a", "fullyQualifiedName": "s.d.t.a", "profile": {"nullCount": 0}},
            {"name": "b", "fullyQualifiedName": "s.d.t.b", "children": [{"name": "c", "fullyQualifiedName": "s.d.t.b.c", "profile": {"nullCount": 1}}]},
        ],
    }
    assert profiles.record(latest) == {
        "id": "t",
        "fullyQualifiedName": "s.d.t",
        "profile": {"rowCount": 5},
        "columns": [{"fullyQualifiedName": "s.d.t.a", "profile": {"nullCount": 0}}, {"fullyQualifiedName": "s.d.t.b.c", "profile": {"nullCount": 1}}],
    }
    assert profiles.record({"id": "t", "columns": [{"name": "a"}]}) is None
    assert profiles.record(None) is None


def test_snapshot_carries_latest_profiles(worker, storage, catalog):
    man, recs = snapshot_profiles(storage)
    assert man["files"]["profiles"]["count"] == 1
    [r] = recs
    assert r["id"] == catalog["a"]["id"] and r["profile"]["rowCount"] == 100
    assert [c["fullyQualifiedName"] for c in r["columns"]] == ["bigquery.acme.marts.orders.order_id", "bigquery.acme.marts.orders.address.city"]
    # Only the profile parts: apps already hold the table.
    assert set(r) == {"id", "fullyQualifiedName", "profile", "columns"}


def test_snapshot_cycle_publishes_profiler_changes(worker, storage, om, catalog, clock, settings):
    """2.0.8 has no change event for profile writes; the periodic snapshot diff picks them up."""
    om.set_profile(catalog["a"], 250)
    om.set_profile(catalog["b"], 7)
    next_cycle(worker, clock, settings)
    [ev] = feed_events(storage)
    assert ev["source"] == "om-events"
    ups = {c["profile"]["id"]: c["profile"]["profile"]["rowCount"] for c in ev["changes"] if c["op"] == "profile.upsert"}
    assert ups == {catalog["a"]["id"]: 250, catalog["b"]["id"]: 7}
    man, recs = snapshot_profiles(storage)
    assert man["seq"] == ev["seq"] and len(recs) == 2

    # The profile goes away (deleted in OpenMetadata): profile.delete.
    om.profiles.pop(catalog["b"]["id"])
    next_cycle(worker, clock, settings)
    last = feed_events(storage)[-1]
    assert [c for c in last["changes"] if c["op"].startswith("profile")] == [P.profile_delete(catalog["b"]["id"])]


def test_unchanged_profiles_publish_nothing(worker, storage, clock, settings):
    next_cycle(worker, clock, settings)
    assert feed_events(storage) == []


def test_failed_profile_read_keeps_what_apps_hold(worker, storage, om, catalog, clock, settings):
    om.profile_fail.add(catalog["a"]["fullyQualifiedName"])
    om.set_profile(catalog["b"], 7)  # something else changes, so a new snapshot is written
    next_cycle(worker, clock, settings)
    ev = feed_events(storage)[-1]
    assert P.profile_delete(catalog["a"]["id"]) not in ev["changes"]
    _, recs = snapshot_profiles(storage)
    assert {r["id"]: r["profile"]["rowCount"] for r in recs} == {catalog["a"]["id"]: 100, catalog["b"]["id"]: 7}


def test_queued_profile_write_publishes_the_new_latest(worker, storage, om, catalog, clock):
    b = catalog["b"]
    rid = send(storage, clock, method="PUT", path=f"/tables/{b['id']}/tableProfile", body={"tableProfile": {"timestamp": 5, "rowCount": 42}, "columnProfile": []})
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["ok"] and r["feedSeq"] == 1
    [ev] = feed_events(storage)
    ops = [c["op"] for c in ev["changes"]]
    assert ops == ["upsert", "profile.upsert"]
    assert ev["changes"][1]["profile"]["profile"]["rowCount"] == 42


def test_queued_profile_delete(worker, storage, om, catalog, clock):
    a = catalog["a"]
    rid = send(storage, clock, method="DELETE", path=f"/tables/{a['fullyQualifiedName']}/table/1794873600000/profile")
    worker.run_once()
    assert reply_of(storage, rid)["ok"]
    [ev] = feed_events(storage)
    assert ev["changes"] == [P.profile_delete(a["id"])]
    assert worker.state.profile(a["id"]) is None


def test_deleting_a_table_drops_its_profile_from_state(worker, storage, catalog, clock):
    a = catalog["a"]
    send(storage, clock, method="DELETE", path=f"/tables/{a['id']}", query={"hardDelete": "true"})
    worker.run_once()
    assert worker.state.profile(a["id"]) is None


def test_old_snapshot_without_profiles_triggers_a_resync(settings, storage, om, catalog, clock):
    om.set_profile(catalog["a"], 100)
    w = make_worker(settings, storage, om, clock)
    w.run_once()
    # Rewrite the manifest the way an older worker wrote it: no profiles.
    man = read_json(storage, P.MANIFEST)
    del man["files"]["profiles"]
    from monorail_worker.storage import write_json

    write_json(storage, P.MANIFEST, man)
    w.lease.release()
    w2 = make_worker(settings, storage, om, clock, wid="test:2")
    w2.run_once()
    ev = feed_events(storage)[-1]
    assert ev["changes"] == [P.RESYNC]
    man = read_json(storage, P.MANIFEST)
    assert man["seq"] == ev["seq"] and man["files"]["profiles"]["count"] == 1


def test_state_and_diff_unit():
    st = ReplicaState()
    rec = {"id": "t", "fullyQualifiedName": "a.b.c.t", "profile": {"rowCount": 1}, "columns": []}
    st.load({}, [], [rec])
    assert st.same_profile(rec) and not st.same_profile({**rec, "profile": {"rowCount": 2}})
    assert st.table_of_column("a.b.c.t.col") == rec and st.table_of_column("a.b.c.tx.col") is None
    st.apply([P.delete("table", "t")])
    assert st.profile("t") is None


def test_referenced_files_include_profiles():
    man = P.manifest(1, 2, "2.0.8", [], "lineage.2.json.gz", 0, "tableProfile.2.json.gz", 0)
    assert P.CATALOG + "tableProfile.2.json.gz" in snapshot.referenced_files(man)
