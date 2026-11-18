"""Leader lease and heartbeat (docs/team-backend.md, "Liveness and the lease").

- `system/lease.json` `{holder, expires}`, taken and renewed with compare-and-swap: every 10 s for 30 s.
- `system/heartbeat.json` every 15 s. The leader always writes it; a standby writes it only when
  the current one is stale, so apps never see two workers flapping.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any, Callable

from . import protocol as P
from .storage import ABSENT, Storage, dumps, read_json
from .ulid import now_ms

log = logging.getLogger(__name__)

LEASE_MS = 30_000
RENEW_MS = 10_000
HEARTBEAT_MS = 15_000
STALE_HEARTBEAT_MS = 45_000
TICK_MS = 5_000


class Lease:
    def __init__(self, storage: Storage, holder: str, clock: Callable[[], int] = now_ms, duration_ms: int = LEASE_MS):
        self.storage = storage
        self.holder = holder
        self.clock = clock
        self.duration_ms = duration_ms
        self._held_until = 0

    @property
    def held(self) -> bool:
        # Stop acting a little before the lease runs out, in case the clock or the bucket is slow.
        return self.clock() < self._held_until - 2_000

    def try_acquire(self) -> bool:
        """Take or renew the lease. True if this worker holds it afterwards."""
        now = self.clock()
        got = self.storage.read(P.LEASE)
        gen = ABSENT
        if got is not None:
            data, gen = got
            try:
                cur = json.loads(data)
            except ValueError:
                cur = {}
            if cur.get("holder") != self.holder and int(cur.get("expires", 0)) > now:
                self._held_until = 0
                return False
        expires = now + self.duration_ms
        if self.storage.cas(P.LEASE, dumps(P.lease(self.holder, expires)), gen) is None:
            self._held_until = 0
            return False
        self._held_until = expires
        return True

    def release(self) -> None:
        got = self.storage.read(P.LEASE)
        if got is None:
            return
        data, gen = got
        try:
            cur = json.loads(data)
        except ValueError:
            return
        if cur.get("holder") == self.holder:
            self.storage.cas(P.LEASE, dumps(P.lease(self.holder, 0)), gen)
        self._held_until = 0


class Liveness:
    """Background thread: renews the lease and writes the heartbeat."""

    def __init__(
        self,
        storage: Storage,
        lease: Lease,
        info: Callable[[], dict[str, Any]],
        clock: Callable[[], int] = now_ms,
    ):
        self.storage = storage
        self.lease = lease
        self.info = info  # seq, omUrl, omVersion, inboxBacklog, …
        self.clock = clock
        self.started_at = clock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_beat = 0
        self._last_renew = 0

    def tick(self) -> None:
        now = self.clock()
        if self._last_renew == 0 or now - self._last_renew >= RENEW_MS:
            try:
                self.lease.try_acquire()
                self._last_renew = now
            except Exception:
                log.exception("lease renewal failed")
        now = self.clock()
        if now - self._last_beat >= HEARTBEAT_MS or self._last_beat == 0:
            try:
                self.beat()
            except Exception:
                log.exception("heartbeat failed")

    def beat(self) -> None:
        now = self.clock()
        leader = self.lease.held
        if not leader:
            cur = read_json(self.storage, P.HEARTBEAT) or {}
            if cur.get("worker") not in (None, self.lease.holder) and now - int(cur.get("ts", 0)) < STALE_HEARTBEAT_MS:
                self._last_beat = now
                return
        i = self.info()
        hb = P.heartbeat(
            worker=self.lease.holder,
            ts=now,
            started_at=self.started_at,
            seq=int(i.get("seq", 0)),
            om_url=str(i.get("omUrl", "")),
            om_version=str(i.get("omVersion", "")),
            version=str(i.get("version", "")),
            inbox_backlog=int(i.get("inboxBacklog", 0)),
            role="leader" if leader else "standby",
        )
        self.storage.write(P.HEARTBEAT, dumps(hb))
        self._last_beat = now

    def start(self) -> None:
        self.tick()

        def run() -> None:
            while not self._stop.wait(TICK_MS / 1000):
                self.tick()

        self._thread = threading.Thread(target=run, name="liveness", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
