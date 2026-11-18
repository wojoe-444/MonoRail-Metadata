"""Against the real OpenMetadata in .env (OM_URL, OM_TOKEN or OM_EMAIL/OM_PASSWORD). Skipped when unreachable.

Queues a description PATCH on a table through a temporary local bucket, checks the reply, the feed
event (the whole updated entity) and head.json, then puts the description back.
"""

from __future__ import annotations

import json

import httpx
import pytest
from conftest import Clock, feed_events, reply_of, send

from monorail_worker import protocol as P
from monorail_worker.config import Settings
from monorail_worker.om import OmClient, get_json
from monorail_worker.storage import read_json
from monorail_worker.storage.local import LocalStorage
from monorail_worker.ulid import new_ulid
from monorail_worker.worker import Worker

pytestmark = pytest.mark.integration


def _env() -> Settings:
    s = Settings.load()
    return s


def _reachable(url: str) -> bool:
    if not url:
        return False
    try:
        return httpx.get(f"{url}/api/v1/system/version", timeout=3).status_code < 500
    except httpx.HTTPError:
        return False


@pytest.fixture(scope="module")
def real() -> tuple[Settings, OmClient]:
    s = _env()
    if not _reachable(s.om_url):
        pytest.skip(f"OpenMetadata isn't reachable at {s.om_url or '(OM_URL unset)'}")
    om = OmClient(s.om_url, s.om_token, s.om_email, s.om_password)
    try:
        get_json(om, "/system/version")
    except Exception as e:
        pytest.skip(f"can't sign in to OpenMetadata: {e}")
    return s, om


def test_description_patch_round_trip(real, tmp_path):
    base, om = real
    settings = Settings(team_bucket=str(tmp_path / "bucket"), om_url=base.om_url, team_auth="local", om_events_seconds=3600, snapshot_minutes=600)
    storage = LocalStorage(settings.team_bucket)
    clock = Clock()
    worker = Worker(settings, storage, om, clock=clock, worker_id="integration:1")
    assert worker.lease.try_acquire()
    worker.run_once()  # leader: snapshot of the real catalog

    man = read_json(storage, P.MANIFEST)
    assert man["omVersion"].startswith("2.")
    tables_file = next(f for f in man["files"]["entities"] if f["path"] == "tables")
    assert tables_file["count"] > 0
    edges = read_json(storage, P.CATALOG + man["files"]["lineage"]["file"])
    assert all("sqlQueryKey" not in e for e in edges)
    if edges:
        assert any(e.get("sqlQuery") for e in edges), "lineage SQL wasn't resolved from sqlQueryKey"
    services = read_json(storage, P.CATALOG + next(f["file"] for f in man["files"]["entities"] if f["path"] == "services/databaseServices"))
    for svc in services:
        blob = json.dumps(svc.get("connection", {}))
        for word in ("privateKey", "password", "clientSecret", "jwtToken"):
            assert word not in blob

    table = get_json(om, "/tables", {"limit": 1})["data"][0]
    original = get_json(om, f"/tables/{table['id']}", {"fields": "*"}).get("description")
    marker = f"Integration test {new_ulid()}"
    op = "replace" if original is not None else "add"
    try:
        rid = send(
            storage,
            clock,
            user="integration-test",
            method="PATCH",
            path=f"/tables/{table['id']}",
            headers={"Content-Type": "application/json-patch+json"},
            body=[{"op": op, "path": "/description", "value": marker}],
        )
        worker.run_once()

        r = reply_of(storage, rid)
        assert r is not None, "no reply"
        assert r["ok"] and r["status"] == 200, r
        assert r["by"] == "integration-test" and r["body"]["description"] == marker
        assert isinstance(r["feedSeq"], int)

        ev = read_json(storage, P.feed_key(r["feedSeq"]))
        assert ev["requestId"] == rid and ev["source"] == "request" and ev["by"] == "integration-test"
        [c] = [c for c in ev["changes"] if c["op"] == "upsert" and c["entity"]["id"] == table["id"]]
        e = c["entity"]
        assert c["entityType"] == "table"
        assert e["description"] == marker
        # The whole entity, as fields=* returns it: not just the patched field.
        for k in ("fullyQualifiedName", "columns", "databaseSchema", "service", "version", "updatedAt", "owners", "tags"):
            assert k in e, k

        head = read_json(storage, P.HEAD)
        assert head["seq"] == r["feedSeq"] and head["ts"] > 0

        # OpenMetadata's change event for this write is recognized as the worker's own.
        worker.poll_om_events()
        for later in feed_events(storage):
            if later["source"] == "om-events":
                assert not any(ch.get("entity", {}).get("id") == table["id"] and ch["entity"].get("description") == marker for ch in later["changes"])
    finally:
        revert = [{"op": "replace", "path": "/description", "value": original}] if original is not None else [{"op": "remove", "path": "/description"}]
        res = om.request("PATCH", f"/tables/{table['id']}", None, {"Content-Type": "application/json-patch+json"}, revert)
        assert res.status < 400, res.body
    assert get_json(om, f"/tables/{table['id']}").get("description") == original
