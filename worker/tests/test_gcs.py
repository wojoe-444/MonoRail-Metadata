"""The GCS backend against a fake google-cloud-storage client (no real GCS on this machine)."""

from __future__ import annotations

import datetime as dt
import threading
from typing import Any

import pytest
from google.api_core import exceptions as gexc

from monorail_worker import protocol as P
from monorail_worker.lease import Lease
from monorail_worker.storage import ABSENT, read_json, write_json
from monorail_worker.storage.gcs import GcsStorage


class FakeBlob:
    def __init__(self, bucket: "FakeBucket", name: str):
        self._bucket = bucket
        self.name = name
        self.generation: int | None = None
        self.updated: dt.datetime | None = None
        self.size: int | None = None
        self.cache_control: str | None = None
        self.content_type: str | None = None

    def upload_from_string(self, data: bytes, content_type: str = "application/octet-stream", if_generation_match: int | None = None) -> None:
        with self._bucket.lock:
            cur = self._bucket.objects.get(self.name)
            cur_gen = cur["generation"] if cur else 0
            if if_generation_match is not None and if_generation_match != cur_gen:
                raise gexc.PreconditionFailed("generation mismatch")
            self._bucket.counter += 1
            gen = self._bucket.counter
            self._bucket.objects[self.name] = {
                "data": bytes(data),
                "generation": gen,
                "updated": dt.datetime.now(dt.timezone.utc),
                "cache_control": self.cache_control,
                "content_type": content_type,
            }
            self.generation = gen

    def download_as_bytes(self, if_generation_match: int | None = None) -> bytes:
        with self._bucket.lock:
            cur = self._bucket.objects.get(self.name)
            if cur is None:
                raise gexc.NotFound("no such object")
            if if_generation_match is not None and cur["generation"] != if_generation_match:
                raise gexc.PreconditionFailed("changed")
            return cur["data"]

    def delete(self) -> None:
        with self._bucket.lock:
            if self.name not in self._bucket.objects:
                raise gexc.NotFound("no such object")
            del self._bucket.objects[self.name]


class FakeBucket:
    def __init__(self, name: str):
        self.name = name
        self.objects: dict[str, dict[str, Any]] = {}
        self.counter = 1000
        self.lock = threading.Lock()

    def blob(self, name: str) -> FakeBlob:
        return FakeBlob(self, name)

    def get_blob(self, name: str) -> FakeBlob | None:
        with self.lock:
            cur = self.objects.get(name)
            if cur is None:
                return None
            b = FakeBlob(self, name)
            b.generation, b.updated, b.size = cur["generation"], cur["updated"], len(cur["data"])
            return b


class FakeClient:
    def __init__(self) -> None:
        self.buckets: dict[str, FakeBucket] = {}
        self.list_calls: list[dict[str, Any]] = []

    def bucket(self, name: str) -> FakeBucket:
        return self.buckets.setdefault(name, FakeBucket(name))

    def list_blobs(self, bucket: str, prefix: str = "", start_offset: str | None = None):
        self.list_calls.append({"bucket": bucket, "prefix": prefix, "start_offset": start_offset})
        b = self.bucket(bucket)
        with b.lock:
            names = sorted(n for n in b.objects if n.startswith(prefix) and (start_offset is None or n >= start_offset))
            out = []
            for n in names:
                fb = FakeBlob(b, n)
                fb.generation, fb.updated, fb.size = b.objects[n]["generation"], b.objects[n]["updated"], len(b.objects[n]["data"])
                out.append(fb)
        return iter(out)


@pytest.fixture
def client() -> FakeClient:
    return FakeClient()


@pytest.fixture
def gcs(client) -> GcsStorage:
    return GcsStorage.from_url("gs://team-bucket/monorail/prod", client=client)


def test_url_parsing(client):
    s = GcsStorage.from_url("gs://b", client=client)
    assert s.prefix == "" and s.label == "gs://b"
    with pytest.raises(ValueError):
        GcsStorage.from_url("gs://", client=client)


def test_read_write_with_prefix(gcs, client):
    assert gcs.read("feed/head.json") is None
    gen = gcs.write("feed/head.json", b'{"seq":1}')
    data, g = gcs.read("feed/head.json")
    assert data == b'{"seq":1}' and g == gen
    obj = client.buckets["team-bucket"].objects["monorail/prod/feed/head.json"]
    assert obj["cache_control"] == "no-store" and obj["content_type"] == "application/json"


def test_create_if_absent_uses_generation_zero(gcs):
    assert gcs.create("inbox/A.json", b"1")
    assert not gcs.create("inbox/A.json", b"2")
    assert gcs.read("inbox/A.json")[0] == b"1"


def test_cas(gcs):
    g1 = gcs.cas("system/lease.json", b"a", ABSENT)
    assert g1
    assert gcs.cas("system/lease.json", b"b", ABSENT) is None
    g2 = gcs.cas("system/lease.json", b"b", g1)
    assert g2 and g2 != g1
    assert gcs.cas("system/lease.json", b"c", g1) is None
    assert gcs.read("system/lease.json")[0] == b"b"


def test_list_with_start_offset(gcs, client):
    for k in ["inbox/A.json", "inbox/B.json", "inbox/C.json", "outbox/A.json"]:
        gcs.write(k, b"{}")
    assert [o.key for o in gcs.list("inbox/")] == ["inbox/A.json", "inbox/B.json", "inbox/C.json"]
    assert [o.key for o in gcs.list("inbox/", "inbox/B")] == ["inbox/B.json", "inbox/C.json"]
    assert client.list_calls[-1] == {"bucket": "team-bucket", "prefix": "monorail/prod/inbox/", "start_offset": "monorail/prod/inbox/B"}
    o = next(gcs.list("outbox/"))
    assert o.generation and o.updated_ms > 0 and o.size == 2


def test_delete(gcs):
    gcs.write("x.json", b"1")
    gcs.delete("x.json")
    gcs.delete("x.json")
    assert gcs.read("x.json") is None


def test_json_helpers(gcs):
    write_json(gcs, "state/catalog/t.json.gz", [{"id": 1}])
    assert read_json(gcs, "state/catalog/t.json.gz") == [{"id": 1}]


def test_concurrent_create(gcs):
    wins = []
    barrier = threading.Barrier(10)

    def go(i):
        barrier.wait()
        if gcs.create("inbox/race.json", str(i).encode()):
            wins.append(i)

    ts = [threading.Thread(target=go, args=(i,)) for i in range(10)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert len(wins) == 1


def test_lease_on_gcs(gcs):
    t = [1_000_000]
    clock = lambda: t[0]  # noqa: E731
    a, b = Lease(gcs, "a", clock), Lease(gcs, "b", clock)
    assert a.try_acquire() and not b.try_acquire()
    t[0] += 31_000
    assert b.try_acquire() and not a.try_acquire()
    assert read_json(gcs, P.LEASE)["holder"] == "b"


def test_worker_runs_on_gcs(client, om, catalog, settings, clock):
    from conftest import make_worker, reply_of, send

    gcs = GcsStorage.from_url("gs://team-bucket/p", client=client)
    w = make_worker(settings, gcs, om, clock)
    w.run_once()
    rid = send(gcs, clock, method="PATCH", path=f"/tables/{catalog['a']['id']}", body=[{"op": "replace", "path": "/description", "value": "via gcs"}])
    w.run_once()
    r = reply_of(gcs, rid)
    assert r["ok"] and r["feedSeq"] == 1
    assert read_json(gcs, P.HEAD)["seq"] == 1
