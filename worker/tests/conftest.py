from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from fakes import FakeOm, seed  # noqa: E402

from monorail_worker import protocol as P  # noqa: E402
from monorail_worker.config import Settings  # noqa: E402
from monorail_worker.storage import dumps, read_json  # noqa: E402
from monorail_worker.storage.local import LocalStorage  # noqa: E402
from monorail_worker.ulid import new_ulid, now_ms  # noqa: E402
from monorail_worker.worker import Worker  # noqa: E402


class Clock:
    """A controllable clock that starts at the real time (housekeeping compares with file mtimes)."""

    def __init__(self, t: int | None = None):
        self.t = now_ms() if t is None else t

    def __call__(self) -> int:
        return self.t

    def advance(self, ms: int) -> None:
        self.t += ms


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def storage(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path / "bucket")


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(team_bucket=str(tmp_path / "bucket"), om_url="http://fake-om:8585", team_auth="local")


@pytest.fixture
def om() -> FakeOm:
    return FakeOm()


@pytest.fixture
def catalog(om: FakeOm) -> dict[str, dict[str, Any]]:
    return seed(om)


def make_worker(settings: Settings, storage: LocalStorage, om: Any, clock: Clock, wid: str = "test:1", **kw: Any) -> Worker:
    w = Worker(settings, storage, om, clock=clock, worker_id=wid, **kw)
    assert w.lease.try_acquire()
    return w


def send(storage: LocalStorage, clock: Clock, *, op: str = "om", user: str = "ada.park", **fields: Any) -> str:
    rid = new_ulid(clock())
    req = {"v": 1, "id": rid, "ts": clock(), "auth": {"kind": "local", "user": user}, "op": op, **fields}
    assert storage.create(P.inbox_key(rid), dumps(req))
    return rid


def reply_of(storage: LocalStorage, rid: str) -> dict[str, Any] | None:
    return read_json(storage, P.outbox_key(rid))


def feed_events(storage: LocalStorage) -> list[dict[str, Any]]:
    return [read_json(storage, o.key) for o in storage.list(P.FEED) if P.parse_feed_key(o.key) is not None]


def dump(x: Any) -> str:
    return json.dumps(x, indent=1)
