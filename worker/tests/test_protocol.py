import json

import pytest
from pydantic import ValidationError

from monorail_worker import protocol as P
from monorail_worker.ulid import encode_time, floor_ulid, is_ulid, new_ulid, ulid_time

REQ = {
    "v": 1,
    "id": "01JD3X8Q4M2N7T6R5V9W0YZABC",
    "ts": 1794956000000,
    "auth": {"kind": "local", "user": "ada.park"},
    "op": "om",
    "method": "patch",
    "path": "/tables/0a51e62b-5121-48a5-8aa6-86888b01be67",
    "query": {"fields": "owners"},
    "headers": {"Content-Type": "application/json-patch+json"},
    "body": [{"op": "replace", "path": "/description", "value": "One row per order item."}],
    "client": {"app": "monorail-metadata", "version": "0.1.0"},
}


def test_request_parses_contract_example():
    r = P.Request.model_validate_json(json.dumps(REQ))
    assert r.method == "PATCH"
    assert isinstance(r.auth, P.LocalAuth) and r.auth.user == "ada.park"
    assert r.body[0]["value"] == "One row per order item."


def test_request_google_auth():
    r = P.Request.model_validate({**REQ, "auth": {"kind": "google", "idToken": "a.b.c"}})
    assert isinstance(r.auth, P.GoogleAuth)


@pytest.mark.parametrize(
    "patch",
    [
        {"v": 2},
        {"op": "drop"},
        {"auth": {"kind": "magic", "user": "x"}},
        {"auth": {"kind": "local", "user": ""}},
        {"auth": {"kind": "google"}},
        {"ts": "yesterday"},
    ],
)
def test_request_rejects_bad_shapes(patch):
    with pytest.raises(ValidationError):
        P.Request.model_validate({**REQ, **patch})


def test_echo_needs_no_method():
    r = P.Request.model_validate({k: v for k, v in REQ.items() if k not in ("method", "path")} | {"op": "echo", "body": {"x": 1}})
    assert r.op == "echo" and r.method is None


def test_reply_shape():
    r = P.reply("ID", 5, status=200, body={"a": 1}, by="ada", feed_seq=124)
    assert r == {"v": 1, "id": "ID", "ts": 5, "ok": True, "status": 200, "body": {"a": 1}, "error": None, "by": "ada", "byUser": None, "feedSeq": 124}
    e = P.reply("ID", 5, status=403, error=("forbidden", "no"))
    assert e["ok"] is False and e["error"] == {"code": "forbidden", "message": "no"} and e["feedSeq"] is None


def test_feed_event_and_changes():
    ev = P.feed_event(
        124,
        9,
        by="ada",
        request_id="R",
        source="request",
        changes=[P.upsert("table", {"id": "t"}), P.delete("table", "t"), P.lineage_delete("a", "b"), P.RESYNC],
    )
    assert ev["seq"] == 124 and ev["requestId"] == "R" and ev["source"] == "request"
    assert [c["op"] for c in ev["changes"]] == ["upsert", "delete", "lineage.delete", "resync"]
    assert ev["changes"][2] == {"op": "lineage.delete", "fromId": "a", "toId": "b"}


def test_keys():
    assert P.feed_key(124) == "feed/000000000124.json"
    assert P.parse_feed_key("feed/000000000124.json") == 124
    assert P.parse_feed_key("feed/head.json") is None
    assert P.inbox_key("X") == "inbox/X.json" and P.outbox_key("X") == "outbox/X.json"


def test_manifest_and_heartbeat_shapes():
    m = P.manifest(120, 1, "2.0.8", [{"entityType": "table", "path": "tables", "file": "table.1.json.gz", "count": 20}], "lineage.1.json.gz", 18)
    assert m["files"]["lineage"] == {"file": "lineage.1.json.gz", "count": 18} and m["v"] == 1 and m["seq"] == 120
    hb = P.heartbeat(worker="h:1", ts=2, started_at=1, seq=3, om_url="u", om_version="2.0.8", version="0.1.0", inbox_backlog=0, role="leader")
    assert set(hb) == {"worker", "ts", "startedAt", "seq", "omUrl", "omVersion", "version", "inboxBacklog", "role"}
    assert P.lease("h:1", 9) == {"holder": "h:1", "expires": 9}


def test_ulid_roundtrip_and_order():
    a = new_ulid(1_000)
    b = new_ulid(2_000)
    assert is_ulid(a) and len(a) == 26 and a < b
    assert ulid_time(a) == 1_000
    assert floor_ulid(2_000) <= b and floor_ulid(2_000)[:10] == encode_time(2_000)
    # The app's ULIDs (server/team/queue.ts) use the same alphabet and layout.
    assert is_ulid("01JD3X8Q4M2N7T6R5V9W0YZABC")
