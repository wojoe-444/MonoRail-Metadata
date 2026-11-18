"""`by` → OpenMetadata user (byUser), impersonation, and the heartbeat's omVersion."""

from __future__ import annotations

import threading

import pytest
from conftest import feed_events, make_worker, reply_of, send

from monorail_worker import protocol as P
from monorail_worker.om import OmResponse
from monorail_worker.storage import read_json
from monorail_worker.users import Directory
from monorail_worker.worker import Worker

PATCH = [{"op": "replace", "path": "/description", "value": "New."}]


class Ticker:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def test_directory_matches_email_then_name():
    d = Directory()
    d.load(
        [
            {"id": "u1", "name": "ada.park", "email": "Ada.Park@Acme.com"},
            {"id": "u2", "name": "june", "email": "june@acme.com"},
            {"id": "b1", "name": "ingestion-bot", "email": "ingestion-bot@om.org", "isBot": True},
            {"id": "u3", "name": "gone", "email": "gone@acme.com", "deleted": True},
        ]
    )
    assert d.find("ada.park@acme.com") == {"id": "u1", "name": "ada.park"}
    assert d.find("ada.park") == {"id": "u1", "name": "ada.park"}
    assert d.find("june") == {"id": "u2", "name": "june"}
    assert d.find("ingestion-bot") is None  # bots are never "the person"
    assert d.find("gone") is None
    assert d.find("nobody@acme.com") is None and d.find(None) is None
    # An email never matches by name, and a name never matches an email's local part on its own.
    assert d.find("june@other.com") is None


def test_directory_follows_feed_changes():
    d = Directory()
    d.load([{"id": "u1", "name": "ada", "email": "ada@acme.com"}])
    d.apply([P.upsert("user", {"id": "u1", "name": "ada", "email": "ada.park@acme.com"}), P.upsert("table", {"id": "t", "name": "x"})])
    assert d.find("ada@acme.com") is None and d.find("ada.park@acme.com")["id"] == "u1"
    d.apply([P.delete("user", "u1")])
    assert d.find("ada") is None


def test_directory_lookup_on_miss_checks_email_and_remembers_misses(om):
    om.add("users", "ravi", email="ravi@acme.com")
    om.add("users", "sam", email="sam@elsewhere.com")
    t = Ticker()
    d = Directory(clock=t)
    assert d.find("ravi@acme.com", om) == {"id": om.by_fqn("users", "ravi")["id"], "name": "ravi"}
    assert d.find("ravi") is not None  # cached now
    assert d.find("sam@acme.com", om) is None  # same local part, different email: not the same person
    calls = len(om.calls)
    assert d.find("sam@acme.com", om) is None
    assert len(om.calls) == calls  # the miss is remembered
    t.t += 301
    d.find("sam@acme.com", om)
    assert len(om.calls) == calls + 1


@pytest.fixture
def worker(settings, storage, om, catalog, clock):
    w = make_worker(settings, storage, om, clock)
    w.run_once()
    return w


def test_reply_and_feed_carry_by_user(worker, storage, catalog, clock):
    rid = send(storage, clock, user="ada.park", method="PATCH", path=f"/tables/{catalog['a']['id']}", body=PATCH)
    worker.run_once()
    user = {"id": catalog["user"]["id"], "name": "ada.park"}
    r = reply_of(storage, rid)
    assert r["by"] == "ada.park" and r["byUser"] == user
    [ev] = feed_events(storage)
    assert ev["by"] == "ada.park" and ev["byUser"] == user


def test_email_identity_maps_by_email(worker, storage, catalog, clock):
    rid = send(storage, clock, user="ADA@example.com", op="echo", body={})
    worker.run_once()
    r = reply_of(storage, rid)
    assert r["by"] == "ADA@example.com" and r["byUser"]["name"] == "ada.park"


def test_unknown_identity_has_null_by_user(worker, storage, catalog, clock):
    rid = send(storage, clock, user="visitor", method="PATCH", path=f"/tables/{catalog['a']['id']}", body=PATCH)
    worker.run_once()
    assert reply_of(storage, rid)["byUser"] is None
    assert feed_events(storage)[0]["byUser"] is None


def test_om_events_map_the_om_user(worker, storage, om, catalog, clock, settings):
    a = catalog["a"]
    a["description"] = "Changed in OpenMetadata."
    a["version"] = 0.2
    om.emit("entityUpdated", "table", a["id"], 0.2, user="ada.park")
    clock.advance(int(settings.om_events_seconds * 1000) + 1)
    assert worker.lease.try_acquire()
    worker.run_once()
    [ev] = feed_events(storage)
    assert ev["source"] == "om-events" and ev["byUser"] == {"id": catalog["user"]["id"], "name": "ada.park"}


# ---------- impersonation ----------
def impersonated(om):
    return [(m, p, h.get("X-Impersonate-User")) for m, p, h in om.headers if h.get("X-Impersonate-User")]


def test_no_impersonation_by_default(worker, storage, om, catalog, clock):
    send(storage, clock, method="PATCH", path=f"/tables/{catalog['a']['id']}", body=PATCH)
    worker.run_once()
    assert impersonated(om) == []


def test_impersonation_sends_the_person_on_om_calls_only(settings, storage, om, catalog, clock):
    settings.impersonate = True
    om.logged_in = {"name": "monorail-bot", "isBot": True, "allowImpersonation": True}
    w = make_worker(settings, storage, om, clock)
    w.run_once()
    a = catalog["a"]
    send(storage, clock, user="ada.park", method="PATCH", path=f"/tables/{a['id']}", body=PATCH)
    send(storage, clock, user="visitor", method="GET", path=f"/tables/{a['id']}")
    w.run_once()
    # The PATCH goes as ada.park; the re-read after it, the unmapped visitor's read and the snapshot go as the bot.
    assert impersonated(om) == [("PATCH", f"/tables/{a['id']}", "ada.park")]


def test_impersonation_warns_without_a_bot(settings, storage, om, catalog, clock, caplog):
    settings.impersonate = True
    w = make_worker(settings, storage, om, clock)
    w.run_once()
    assert "not a bot" in caplog.text


def test_om_client_passes_the_impersonation_header(monkeypatch):
    import httpx

    from monorail_worker.om import OmClient

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(200, json={})

    c = OmClient("http://om:8585", token="t")
    c.http = httpx.Client(transport=httpx.MockTransport(handler))
    c.request("PATCH", "/tables/x", headers={"Content-Type": "application/json-patch+json", "X-Impersonate-User": "ada.park", "X-Other": "no"}, body=[])
    assert seen["x-impersonate-user"] == "ada.park" and "x-other" not in seen
    assert seen["content-type"] == "application/json-patch+json"


# ---------- omVersion ----------
def test_first_heartbeat_has_om_version(settings, storage, om, catalog, clock):
    w = Worker(settings, storage, om, clock=clock, worker_id="test:hb")
    stop = threading.Event()
    stop.set()
    w.run_forever(stop)  # beats once, then stops
    hb = read_json(storage, P.HEARTBEAT)
    assert hb["omVersion"] == "2.0.8"


class FlakyVersion:
    """Fails /system/version until told otherwise; everything else goes to the fake."""

    def __init__(self, om):
        self.om = om
        self.url = om.url
        self.up = False
        self.version_calls = 0

    def request(self, method, path, query=None, headers=None, body=None):
        if path == "/system/version":
            self.version_calls += 1
            if not self.up:
                return OmResponse(503, "starting")
        return self.om.request(method, path, query, headers) if body is None else self.om.request(method, path, query, headers, body)


def test_om_version_retried_once_a_minute_until_known(settings, storage, om, catalog, clock):
    flaky = FlakyVersion(om)
    w = Worker(settings, storage, flaky, clock=clock, worker_id="test:v")
    assert w.refresh_om_version(force=True) == "" and flaky.version_calls == 1
    w.refresh_om_version()
    assert flaky.version_calls == 1  # throttled
    flaky.up = True
    clock.advance(60_001)
    assert w.refresh_om_version() == "2.0.8" and w.info()["omVersion"] == "2.0.8"
    clock.advance(60_001)
    w.refresh_om_version()
    assert flaky.version_calls == 2  # known: not asked again


def test_standby_heartbeat_has_om_version(settings, storage, om, catalog, clock):
    leader = make_worker(settings, storage, om, clock, wid="test:leader")
    standby = Worker(settings, storage, om, clock=clock, worker_id="test:standby")
    assert not standby.lease.try_acquire()
    standby.run_once()  # not the leader, but still reads the version
    assert standby.info()["omVersion"] == "2.0.8"
    assert leader.lease.held
