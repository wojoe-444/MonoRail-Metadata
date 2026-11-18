import threading
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pytest

from monorail_worker.storage import ABSENT, read_json, write_json
from monorail_worker.storage.local import LocalStorage


def test_read_write_delete(storage: LocalStorage):
    assert storage.read("a/b.json") is None
    g1 = storage.write("a/b.json", b"one")
    data, g = storage.read("a/b.json")
    assert data == b"one" and g == g1
    storage.write("a/b.json", b"two")
    assert storage.read("a/b.json")[0] == b"two"
    storage.delete("a/b.json")
    storage.delete("a/b.json")  # no error when gone
    assert storage.read("a/b.json") is None


def test_json_and_gzip(storage: LocalStorage):
    write_json(storage, "x.json", {"a": [1, 2]})
    write_json(storage, "y.json.gz", [{"id": 1}])
    assert read_json(storage, "x.json") == {"a": [1, 2]}
    assert read_json(storage, "y.json.gz") == [{"id": 1}]
    assert storage.read("y.json.gz")[0][:2] == b"\x1f\x8b"


def test_create_if_absent(storage: LocalStorage):
    assert storage.create("inbox/1.json", b"first")
    assert not storage.create("inbox/1.json", b"second")
    assert storage.read("inbox/1.json")[0] == b"first"


def test_cas(storage: LocalStorage):
    g = storage.cas("system/lease.json", b"a", ABSENT)
    assert g
    assert storage.cas("system/lease.json", b"b", ABSENT) is None  # exists now
    assert storage.cas("system/lease.json", b"b", "stale") is None
    g2 = storage.cas("system/lease.json", b"b", g)
    assert g2 and storage.read("system/lease.json")[0] == b"b"
    assert storage.cas("system/lease.json", b"c", g) is None  # g is no longer current


def test_list_prefix_and_offset(storage: LocalStorage):
    for k in ["inbox/A.json", "inbox/B.json", "inbox/C.json", "outbox/A.json", "feed/000000000001.json", "feed/head.json"]:
        storage.write(k, b"{}")
    # temp and lock files never show up
    Path(storage.root, "inbox", ".C.json.123.tmp").write_bytes(b"")
    Path(storage.root, "inbox", "B.json.lock").write_bytes(b"")
    assert [o.key for o in storage.list("inbox/")] == ["inbox/A.json", "inbox/B.json", "inbox/C.json"]
    assert [o.key for o in storage.list("inbox/", "inbox/B")] == ["inbox/B.json", "inbox/C.json"]
    assert [o.key for o in storage.list("feed/0")] == ["feed/000000000001.json"]
    assert list(storage.list("nothing/")) == []


def test_keys_cannot_escape(storage: LocalStorage):
    for bad in ["../x", "/etc/passwd", "a\\b", "", "a/../../x", "C:/x", "a//b"]:
        with pytest.raises(ValueError):
            storage.read(bad)


def test_concurrent_create_threads(storage: LocalStorage):
    winners = []
    barrier = threading.Barrier(16)

    def go(i: int) -> None:
        barrier.wait()
        if storage.create("inbox/race.json", f"writer {i}".encode()):
            winners.append(i)

    ts = [threading.Thread(target=go, args=(i,)) for i in range(16)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert len(winners) == 1
    assert storage.read("inbox/race.json")[0] == f"writer {winners[0]}".encode()


def _create_in_process(args: tuple[str, int]) -> bool:
    root, i = args
    return LocalStorage(root).create("inbox/race.json", f"proc {i}".encode())


def test_concurrent_create_processes(tmp_path: Path):
    root = str(tmp_path / "b")
    LocalStorage(root)
    with ProcessPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(_create_in_process, [(root, i) for i in range(12)]))
    assert sum(results) == 1


def test_concurrent_cas_threads(storage: LocalStorage):
    storage.write("system/lease.json", b"v0")
    _, gen = storage.read("system/lease.json")
    wins = []
    barrier = threading.Barrier(8)

    def go(i: int) -> None:
        barrier.wait()
        if storage.cas("system/lease.json", f"v{i}".encode(), gen):
            wins.append(i)

    ts = [threading.Thread(target=go, args=(i,)) for i in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert len(wins) == 1
