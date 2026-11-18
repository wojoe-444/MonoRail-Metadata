"""The inbox loop end to end, on a local bucket and the fake OpenMetadata."""

from __future__ import annotations

import json

import pytest
from conftest import feed_events, make_worker, reply_of, send
from fakes import Crash

from monorail_worker import protocol as P
from monorail_worker.storage import dumps, read_json
from monorail_worker.ulid import new_ulid

PATCH_HDR = {"Content-Type": "application/json-patch+json"}


def desc_patch(text: str) -> list[dict]:
    return [{"op": "replace", "path": "/description", "value": text}]


@pytest.fixture
def worker(settings, storage, om, catalog, clock):
    w = make_worker(settings, storage, om, clock)
    w.run_once()  # becomes leader: snapshot
    return w


def test_startup_writes_snapshot_and_heartbeat_info(worker, storage):
    man = read_json(storage, P.MANIFEST)
    assert man["seq"] == 0 and man["omVersion"] == "2.0.8"
    assert {f["path"] for f in man["files"]["entities"]} >= {"tables", "users", "services/databaseServices"}
    assert man["files"]["lineage"]["count"] == 1
    assert worker.info()["omVersion"] == "2.0.8"


def test_patch_round_trip(worker, storage, om, catalog, clock):
    t = catalog["a"]
    rid = send(storage, clock, method="PATCH", path=f"/tables/{t['id']}", headers=PATCH_HDR, body=desc_patch("New."))
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["ok"] and r["status"] == 200 and r["by"] == "ada.park" and r["feedSeq"] == 1
    assert r["body"]["description"] == "New."
    [ev] = feed_events(storage)
    assert ev["seq"] == 1 and ev["requestId"] == rid and ev["source"] == "request" and ev["by"] == "ada.park"
    [c] = ev["changes"]
    assert c["op"] == "upsert" and c["entityType"] == "table" and c["entity"]["description"] == "New."
    assert c["entity"]["fullyQualifiedName"] == t["fullyQualifiedName"]  # the whole entity
    assert read_json(storage, P.HEAD)["seq"] == 1
    cur = read_json(storage, P.CURSOR)
    assert cur["last"] == rid and cur["inflight"] is None


def test_requests_in_id_order_one_at_a_time(worker, storage, catalog, clock):
    t = catalog["a"]
    ids = []
    for i in range(3):
        ids.append(send(storage, clock, method="PATCH", path=f"/tables/{t['id']}", body=desc_patch(f"v{i}")))
        clock.advance(1)
    worker.run_once()
    seqs = [reply_of(storage, i)["feedSeq"] for i in ids]
    assert seqs == [1, 2, 3]
    assert [e["changes"][0]["entity"]["description"] for e in feed_events(storage)] == ["v0", "v1", "v2"]


def test_read_has_no_feed_event(worker, storage, catalog, clock):
    rid = send(storage, clock, method="GET", path=f"/tables/{catalog['a']['id']}", query={"fields": "*"})
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["ok"] and r["feedSeq"] is None and r["body"]["id"] == catalog["a"]["id"]
    assert feed_events(storage) == []


def test_read_reply_strips_service_secrets(worker, storage, catalog, clock):
    rid = send(storage, clock, method="GET", path=f"/services/databaseServices/{catalog['service']['id']}")
    worker.run_once()
    assert "PRIVATE KEY" not in json.dumps(reply_of(storage, rid))


def test_failed_write_passes_status_through(worker, storage, clock):
    rid = send(storage, clock, method="PATCH", path="/tables/00000000-0000-0000-0000-000000000000", body=desc_patch("x"))
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["status"] == 404 and not r["ok"] and r["error"] is None and r["feedSeq"] is None


def test_echo(worker, storage, clock):
    rid = send(storage, clock, op="echo", body={"message": "ping"})
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["ok"] and r["body"] == {"message": "ping"} and r["by"] == "ada.park" and r["feedSeq"] is None


def test_forbidden(worker, storage, om, clock):
    rid = send(storage, clock, method="PUT", path="/services/databaseServices", body={"name": "x"})
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["status"] == 403 and r["error"]["code"] == "forbidden" and not r["ok"]
    assert ("PUT", "/services/databaseServices") not in om.calls


def test_invalid_request(worker, storage, clock):
    rid = new_ulid(clock())
    storage.create(P.inbox_key(rid), b"{not json")
    rid2 = new_ulid(clock() + 1)
    storage.create(P.inbox_key(rid2), dumps({"v": 1, "id": "SOMEOTHERID", "ts": clock(), "auth": {"kind": "local", "user": "a"}, "op": "echo"}))
    worker.run_once()
    assert reply_of(storage, rid)["error"]["code"] == "invalid"
    assert reply_of(storage, rid2)["error"]["code"] == "invalid"


def test_google_token_refused_in_local_mode_without_client(worker, storage, clock):
    rid = new_ulid(clock())
    storage.create(P.inbox_key(rid), dumps({"v": 1, "id": rid, "ts": clock(), "auth": {"kind": "google", "idToken": "x.y.z"}, "op": "echo"}))
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["status"] == 401 and r["error"]["code"] == "unauthenticated"


def test_ttl_expiry(worker, storage, om, catalog, clock):
    t = catalog["a"]
    rid = send(storage, clock, method="PATCH", path=f"/tables/{t['id']}", body=desc_patch("Too late."))
    clock.advance(61 * 60_000)  # the worker was down for an hour
    worker.lease.try_acquire()
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["status"] == 410 and r["error"]["code"] == "expired" and not r["ok"]
    assert om.entities["tables"][t["id"]]["description"] == "Orders."  # not applied
    assert ("PATCH", f"/tables/{t['id']}") not in om.calls


def test_ttl_not_expired_just_under(worker, storage, catalog, clock):
    rid = send(storage, clock, method="PATCH", path=f"/tables/{catalog['a']['id']}", body=desc_patch("In time."))
    clock.advance(59 * 60_000)
    worker.lease.try_acquire()
    worker.run_once()
    assert reply_of(storage, rid)["ok"]


def test_skips_when_reply_exists(worker, storage, om, catalog, clock):
    rid = send(storage, clock, method="PATCH", path=f"/tables/{catalog['a']['id']}", body=desc_patch("x"))
    storage.write(P.outbox_key(rid), dumps(P.reply(rid, 1, status=200)))
    worker.run_once()
    assert not any(m == "PATCH" for m, _ in om.calls)
    assert read_json(storage, P.CURSOR)["last"] == rid


def test_late_request_inside_lookback_is_processed(worker, storage, catalog, clock):
    """An app whose clock is a minute behind writes an id below the cursor."""
    first = send(storage, clock, op="echo", body=1)
    worker.run_once()
    late = new_ulid(clock() - 60_000)
    storage.create(P.inbox_key(late), dumps({"v": 1, "id": late, "ts": clock() - 60_000, "auth": {"kind": "local", "user": "a"}, "op": "echo", "body": 2}))
    worker.run_once()
    assert reply_of(storage, late)["body"] == 2
    assert read_json(storage, P.CURSOR)["last"] == first  # the cursor never moves backwards


def test_lineage_put_and_delete(worker, storage, om, catalog, clock):
    a, b = catalog["a"]["id"], catalog["b"]["id"]
    rid = send(storage, clock, method="PUT", path="/lineage", body={"edge": {"fromEntity": {"id": b, "type": "table"}, "toEntity": {"id": a, "type": "table"}, "lineageDetails": {"sqlQuery": "select 2", "source": "Manual"}}})
    worker.run_once()
    ev = feed_events(storage)[-1]
    [c] = ev["changes"]
    assert c["op"] == "lineage.upsert" and c["edge"]["fromEntity"]["id"] == b and c["edge"]["sqlQuery"] == "select 2"
    assert reply_of(storage, rid)["feedSeq"] == ev["seq"]
    clock.advance(1)
    rid = send(storage, clock, method="DELETE", path=f"/lineage/table/{b}/table/{a}")
    worker.run_once()
    assert feed_events(storage)[-1]["changes"] == [P.lineage_delete(b, a)]


def test_delete_table_drops_its_edges(worker, storage, om, catalog, clock):
    a, b = catalog["a"]["id"], catalog["b"]["id"]
    send(storage, clock, method="DELETE", path=f"/tables/{a}", query={"hardDelete": "true"})
    worker.run_once()
    changes = feed_events(storage)[-1]["changes"]
    assert P.delete("table", a) in changes
    assert P.lineage_delete(a, b) in changes


def test_followers_reread_parent(worker, storage, om, catalog, clock):
    a = catalog["a"]["id"]
    send(storage, clock, method="PUT", path=f"/tables/{a}/followers", body=catalog["user"]["id"])
    worker.run_once()
    [c] = feed_events(storage)[-1]["changes"]
    assert c["op"] == "upsert" and c["entity"]["id"] == a and c["entity"]["followers"][0]["id"] == catalog["user"]["id"]


def test_data_product_assets(worker, storage, om, catalog, clock):
    a = catalog["a"]
    send(storage, clock, method="PUT", path="/dataProducts/revenue/assets/add", body={"assets": [{"id": a["id"], "type": "table"}]})
    worker.run_once()
    changes = feed_events(storage)[-1]["changes"]
    assert [(c["entityType"], c["entity"]["id"]) for c in changes] == [("dataProduct", catalog["dp"]["id"]), ("table", a["id"])]


def test_feed_thread_has_reply_but_no_event(worker, storage, om, catalog, clock):
    # The fake has no /feed route, so OpenMetadata "answers" 404; with a real one it's 201. Either way no event.
    rid = send(storage, clock, method="POST", path="/feed", body={"message": "hi", "about": "<#E::table::x>"})
    worker.run_once()
    assert reply_of(storage, rid)["feedSeq"] is None and feed_events(storage) == []


def test_unknown_write_falls_back_to_resync(worker, storage, om, catalog, clock):
    # A rename changes FQNs elsewhere (children, tag labels, lineage), so the worker rebuilds and says resync.
    rid = send(storage, clock, method="PATCH", path=f"/tables/{catalog['b']['id']}", body=[{"op": "replace", "path": "/name", "value": "daily2"}])
    worker.run_once()
    r = reply_of(storage, rid)
    ev = read_json(storage, P.feed_key(r["feedSeq"]))
    assert ev["changes"] == [P.RESYNC] and ev["requestId"] == rid and ev["source"] == "request"
    man = read_json(storage, P.MANIFEST)
    assert man["seq"] == r["feedSeq"]  # the snapshot includes the resync event
    names = [t["name"] for t in read_json(storage, P.CATALOG + next(f["file"] for f in man["files"]["entities"] if f["path"] == "tables"))]
    assert "daily2" in names


def test_resync_request(worker, storage, clock):
    rid = send(storage, clock, op="resync")
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["ok"] and r["feedSeq"] == 1 and r["body"] == {"seq": 1}
    assert read_json(storage, P.MANIFEST)["seq"] == 1
    assert feed_events(storage)[0]["changes"] == [P.RESYNC]


def test_audit_row_per_event(settings, storage, om, catalog, clock):
    rows = []

    class Sink:
        def record(self, ev):
            rows.append(ev["seq"])

    w = make_worker(settings, storage, om, clock, audit=Sink())
    w.run_once()
    send(storage, clock, method="PATCH", path=f"/tables/{catalog['a']['id']}", body=desc_patch("x"))
    w.run_once()
    assert rows == [1]


def test_standby_does_nothing(settings, storage, om, catalog, clock):
    leader = make_worker(settings, storage, om, clock, wid="a:1")
    leader.run_once()
    standby = type(leader)(settings, storage, om, clock=clock, worker_id="b:2")
    assert not standby.lease.try_acquire()
    rid = send(storage, clock, op="echo", body=1)
    standby.run_once()
    assert reply_of(storage, rid) is None
    leader.run_once()
    assert reply_of(storage, rid)["ok"]


# ---------- crash recovery ----------
def _restart(settings, storage, om, clock, wid="test:2"):
    clock.advance(31_000)  # the old lease runs out
    w = make_worker(settings, storage, om, clock, wid=wid)
    return w


def test_crash_after_openmetadata_call_resumes_without_reapplying(worker, settings, storage, om, catalog, clock):
    t = catalog["a"]
    rid = send(storage, clock, method="PATCH", path=f"/tables/{t['id']}", body=desc_patch("Once."))

    def crash_on_called(value):
        type(worker)._set_inflight(worker, value)
        if value and value.get("stage") == "called":
            raise Crash()

    worker._set_inflight = crash_on_called
    with pytest.raises(Crash):
        worker.run_once()
    assert reply_of(storage, rid) is None
    assert read_json(storage, P.CURSOR)["inflight"]["stage"] == "called"

    w2 = _restart(settings, storage, om, clock)
    w2.run_once()
    r = reply_of(storage, rid)
    assert r["ok"] and r["body"]["description"] == "Once."
    assert [c for c in om.calls if c[0] == "PATCH"] == [("PATCH", f"/tables/{t['id']}")]  # applied exactly once
    evs = [e for e in feed_events(storage) if e["requestId"] == rid]
    assert len(evs) == 1 and r["feedSeq"] == evs[0]["seq"]
    assert read_json(storage, P.CURSOR)["inflight"] is None


def test_crash_between_event_and_head(worker, settings, storage, om, catalog, clock):
    t = catalog["a"]
    rid = send(storage, clock, method="PATCH", path=f"/tables/{t['id']}", body=desc_patch("Once."))
    real_write = storage.write

    def crash_on_head(key, data, content_type="application/json"):
        if key == P.HEAD:
            storage.write = real_write
            raise Crash()
        return real_write(key, data, content_type)

    storage.write = crash_on_head
    with pytest.raises(Crash):
        worker.run_once()
    assert read_json(storage, P.HEAD) is None and storage.read(P.feed_key(1)) is not None

    w2 = _restart(settings, storage, om, clock)
    w2.run_once()
    r = reply_of(storage, rid)
    assert r["ok"] and r["feedSeq"] == 1
    assert read_json(storage, P.HEAD)["seq"] >= 1
    assert len([e for e in feed_events(storage) if e["requestId"] == rid]) == 1
    assert len([c for c in om.calls if c[0] == "PATCH"]) == 1


def test_crash_after_head_before_stage_saved(worker, settings, storage, om, catalog, clock):
    """The event and head are written but the cursor still says `called`: reuse the event."""
    t = catalog["a"]
    rid = send(storage, clock, method="PATCH", path=f"/tables/{t['id']}", body=desc_patch("Once."))

    def crash_on_fed(value):
        if value and value.get("stage") == "fed":
            raise Crash()
        type(worker)._set_inflight(worker, value)

    worker._set_inflight = crash_on_fed
    with pytest.raises(Crash):
        worker.run_once()
    assert read_json(storage, P.HEAD)["seq"] == 1

    w2 = _restart(settings, storage, om, clock)
    w2.run_once()
    assert reply_of(storage, rid)["feedSeq"] == 1
    assert [e["seq"] for e in feed_events(storage) if e["requestId"] == rid] == [1]
    assert read_json(storage, P.HEAD)["seq"] == 1


def test_crash_during_patch_call_is_not_reapplied(worker, settings, storage, om, catalog, clock):
    t = catalog["a"]
    rid = send(storage, clock, method="PATCH", path=f"/tables/{t['id']}", body=desc_patch("Maybe."))
    om.crash_after = ("PATCH", "/tables/")  # OpenMetadata applied it, then the worker died
    with pytest.raises(Crash):
        worker.run_once()
    assert read_json(storage, P.CURSOR)["inflight"]["stage"] == "calling"

    w2 = _restart(settings, storage, om, clock)
    w2.run_once()
    r = reply_of(storage, rid)
    assert r["status"] == 500 and r["error"]["code"] == "internal" and "may or may not" in r["error"]["message"]
    assert len([c for c in om.calls if c[0] == "PATCH"]) == 1  # not sent again
    # ...but apps still get the entity as it is now.
    ev = read_json(storage, P.feed_key(r["feedSeq"]))
    assert ev["changes"][0]["entity"]["description"] == "Maybe."


def test_crash_during_put_call_is_resent(worker, settings, storage, om, catalog, clock):
    rid = send(storage, clock, method="PUT", path="/tables", body={"name": "fresh", "description": "d"})
    om.crash_after = ("PUT", "/tables")
    with pytest.raises(Crash):
        worker.run_once()
    w2 = _restart(settings, storage, om, clock)
    w2.run_once()
    r = reply_of(storage, rid)
    assert r["ok"] and r["status"] == 200  # the second PUT updated what the first created
    assert len([c for c in om.calls if c == ("PUT", "/tables")]) == 2
    assert sum(1 for e in om.entities["tables"].values() if e["name"] == "fresh") == 1


def test_snapshot_written_for_resync_whose_event_was_lost(worker, settings, storage, om, clock):
    rid = send(storage, clock, op="resync")
    real_create = storage.create

    def crash_on_feed(key, data, content_type="application/json"):
        if key.startswith("feed/"):
            raise Crash()
        return real_create(key, data, content_type)

    storage.create = crash_on_feed
    with pytest.raises(Crash):
        worker.run_once()
    storage.create = real_create
    assert read_json(storage, P.MANIFEST)["seq"] == 1 and read_json(storage, P.HEAD) is None

    w2 = _restart(settings, storage, om, clock)
    w2.run_once()
    # The hole at seq 1 is filled with a resync event, so apps never skip a number.
    assert read_json(storage, P.feed_key(1))["changes"] == [P.RESYNC]
    assert reply_of(storage, rid)["ok"]


# ---------- changes made outside the queue ----------
def test_om_events_published(worker, storage, om, catalog, clock):
    t = catalog["b"]
    om.entities["tables"][t["id"]]["description"] = "Changed in OpenMetadata's UI."
    om.entities["tables"][t["id"]]["version"] = 0.2
    om.emit("entityUpdated", "table", t["id"], 0.2, user="admin")
    om.emit("entityUpdated", "table", t["id"], 0.2, user="admin")  # coalesced
    om.emit("entityCreated", "THREAD", t["id"])  # not in the replica: ignored
    n = worker.poll_om_events()
    assert n == 1
    [ev] = feed_events(storage)
    assert ev["source"] == "om-events" and ev["by"] == "admin" and ev["requestId"] is None
    assert ev["changes"][0]["entity"]["description"] == "Changed in OpenMetadata's UI."
    # Polling again finds nothing new.
    assert worker.poll_om_events() == 0
    assert len(feed_events(storage)) == 1


def test_om_events_skip_the_workers_own_writes(worker, storage, om, catalog, clock):
    t = catalog["a"]
    send(storage, clock, method="PATCH", path=f"/tables/{t['id']}", body=desc_patch("Mine."))
    worker.run_once()
    om.emit("entityUpdated", "table", t["id"], om.entities["tables"][t["id"]]["version"], user="ingestion-bot")
    assert worker.poll_om_events() == 0
    assert len(feed_events(storage)) == 1


def test_om_events_delete(worker, storage, om, catalog, clock):
    t = catalog["a"]
    del om.entities["tables"][t["id"]]
    om.emit("entityDeleted", "table", t["id"], 0.2)
    worker.poll_om_events()
    changes = feed_events(storage)[-1]["changes"]
    assert P.delete("table", t["id"]) in changes and P.lineage_delete(t["id"], catalog["b"]["id"]) in changes


def test_periodic_snapshot_diff_publishes_lineage_changes(worker, storage, om, catalog, clock):
    a, b = catalog["a"]["id"], catalog["b"]["id"]
    om.edges[(b, a)] = {"sqlQuery": "select 3", "source": "Manual"}  # lineage has no change events
    del om.edges[(a, b)]
    worker._snapshot(publish_diff=True, force=False)
    ev = feed_events(storage)[-1]
    assert ev["source"] == "om-events"
    ops = {(c["op"], c.get("fromId") or c["edge"]["fromEntity"]["id"]) for c in ev["changes"]}
    assert ops == {("lineage.upsert", b), ("lineage.delete", a)}
    assert read_json(storage, P.MANIFEST)["seq"] == ev["seq"]


def test_periodic_snapshot_skipped_when_nothing_changed(worker, storage):
    before = read_json(storage, P.MANIFEST)["ts"]
    assert worker._snapshot(publish_diff=True, force=False) is None
    assert read_json(storage, P.MANIFEST)["ts"] == before


def test_restart_publishes_changes_made_while_down(worker, settings, storage, om, catalog, clock):
    om.entities["tables"][catalog["b"]["id"]]["description"] = "Edited while the worker was off."
    w2 = _restart(settings, storage, om, clock)
    w2.run_once()
    ev = feed_events(storage)[-1]
    assert ev["source"] == "om-events"
    assert ev["changes"][0]["entity"]["description"] == "Edited while the worker was off."
