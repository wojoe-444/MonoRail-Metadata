"""The worker loop (docs/team-backend.md, "Processing rules").

One main thread handles requests (one at a time, in id order), OpenMetadata change events, the
periodic snapshot and housekeeping. A background thread renews the lease and writes the heartbeat.
Only the lease holder does anything but heartbeat.

Crash safety: before calling OpenMetadata the worker records the request as in flight in
`system/cursor.json`, and moves it through stages (calling → called → fed → audited) as it goes.
On restart it resumes from the recorded stage:

- `calling`: OpenMetadata may or may not have applied it. GET, PUT and DELETE are idempotent and
  are sent again. PATCH and POST are not: the worker re-reads what the request targeted, publishes
  that, and replies with `error.code = "internal"` saying the change may have been applied.
- `called`: OpenMetadata's answer is stored; the worker continues with the re-read and the feed
  event (reusing the event if it was already written).
- `fed` / `audited`: continues with the audit row / the reply.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import threading
import time
from typing import Any, Callable

from pydantic import ValidationError

from . import __version__
from . import allowlist, housekeeping, sanitize, snapshot
from . import protocol as P
from .audit import AuditSink, NoAudit
from .config import Settings
from .events import EventCursor, SelfWrites, by_of, fetch, to_targets
from .feed import Feed
from .identity import AuthError, Identity
from .lease import Lease, Liveness
from .om import Om, OmError, OmResponse
from .state import ReplicaState
from .storage import Storage, dumps, read_json, write_json
from .touched import FieldsPolicy, NeedResync, materialize, resolve
from .ulid import floor_ulid, is_ulid, now_ms, ulid_time

log = logging.getLogger(__name__)

IDEMPOTENT = {"GET", "PUT", "DELETE"}
PASS_HEADERS = {"content-type"}
HOUSEKEEPING_MS = 3_600_000


class Worker:
    def __init__(
        self,
        settings: Settings,
        storage: Storage,
        om: Om,
        *,
        identity: Identity | None = None,
        audit: AuditSink | None = None,
        clock: Callable[[], int] = now_ms,
        worker_id: str | None = None,
    ):
        self.settings = settings
        self.storage = storage
        self.om = om
        self.identity = identity or Identity(settings)
        self.audit = audit or NoAudit()
        self.clock = clock
        self.worker_id = worker_id or settings.worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self.lease = Lease(storage, self.worker_id, clock)
        self.feed = Feed(storage, clock)
        self.state = ReplicaState()
        self.fields = FieldsPolicy()
        self.self_writes = SelfWrites()
        self.cursor: dict[str, Any] = {}
        self.events: EventCursor | None = None
        self.om_version = ""
        self.backlog = 0
        self.leading = False
        self.done: set[str] = set()
        self.snapshot_seq = -1
        self._next_events = 0
        self._next_snapshot = 0
        self._next_housekeeping = 0
        self._snapshot_ok = False
        self._snapshot_retry_at = 0

    # ---------- heartbeat info ----------
    def info(self) -> dict[str, Any]:
        return {
            "seq": self.feed.seq,
            "omUrl": getattr(self.om, "url", ""),
            "omVersion": self.om_version,
            "version": __version__,
            "inboxBacklog": self.backlog,
        }

    # ---------- cursor ----------
    def _save_cursor(self) -> None:
        self.cursor["updatedAt"] = self.clock()
        self.cursor["worker"] = self.worker_id
        if self.events is not None:
            self.cursor["omEvents"] = self.events.to_json()
        write_json(self.storage, P.CURSOR, self.cursor)

    def _set_inflight(self, value: dict[str, Any] | None) -> None:
        self.cursor["inflight"] = value
        self._save_cursor()

    # ---------- leadership ----------
    def become_leader(self) -> None:
        """Run when this worker takes the lease: catch up on what's in the bucket, then snapshot."""
        log.info("%s is the leader", self.worker_id)
        self.cursor = read_json(self.storage, P.CURSOR) or {}
        self.feed.recover()
        self.events = EventCursor.from_json(self.cursor.get("omEvents"), self.clock() - 60_000)
        try:
            ver = self.om.request("GET", "/system/version")
            self.om_version = (ver.body or {}).get("version", "") if isinstance(ver.body, dict) else ""
        except Exception:
            log.exception("couldn't read OpenMetadata's version")
        try:
            self._startup_snapshot()
            self._snapshot_ok = True
        except Exception:
            # Keep answering requests (echo, refusals); retry the snapshot on the next tick.
            log.exception("startup snapshot failed; will retry")
            self._snapshot_ok = False
            self._snapshot_retry_at = self.clock() + 30_000
        self.leading = True
        now = self.clock()
        self._next_events = now + int(self.settings.om_events_seconds * 1000)
        self._next_snapshot = now + int(self.settings.snapshot_minutes * 60_000)

    def _replay_feed_into_state(self, from_seq: int) -> None:
        for s in range(from_seq + 1, self.feed.seq + 1):
            ev = read_json(self.storage, P.feed_key(s))
            if ev:
                self.state.apply(ev.get("changes") or [])

    def _startup_snapshot(self) -> None:
        prev = snapshot.load(self.storage)
        if prev:
            man, ex = prev
            # A snapshot written for a resync whose event never landed (crash): fill the hole.
            if int(man.get("seq", 0)) > self.feed.seq:
                self.feed.append([P.RESYNC], by=None, source="resync", seq=int(man["seq"]))
            self.state.load(ex.by_type(), ex.edges)
            self._replay_feed_into_state(int(man.get("seq", 0)))
        self._snapshot(publish_diff=prev is not None, force=True)

    # ---------- snapshot ----------
    def _snapshot(self, *, publish_diff: bool, force: bool) -> dict[str, Any] | None:
        ex = snapshot.export(self.om, self.fields)
        if ex.om_version:
            self.om_version = ex.om_version
        changed = False
        if publish_diff:
            changes = snapshot.diff(self.state, ex)
            if changes:
                log.info("snapshot diff found %d changes made outside the queue", len(changes))
                self._publish(changes, by=None, source="om-events")
                changed = True
        else:
            self.state.load(ex.by_type(), ex.edges)
        if not (force or changed or self.feed.seq != self.snapshot_seq):
            return None
        man = snapshot.write(self.storage, ex, self.feed.seq, self.clock())
        self.snapshot_seq = self.feed.seq
        log.info("snapshot written at seq %s (%s)", man["seq"], ", ".join(f"{f['entityType']}={f['count']}" for f in man["files"]["entities"]))
        return man

    def resync(self, *, by: str | None, request_id: str | None, source: P.Source = "resync") -> int:
        """Rebuild the snapshot and announce it: the manifest gets the event's seq, written first."""
        seq = self.feed.seq + 1
        ex = snapshot.export(self.om, self.fields)
        snapshot.write(self.storage, ex, seq, self.clock())
        ev = self.feed.append([P.RESYNC], by=by, source=source, request_id=request_id, seq=seq)
        self.state.load(ex.by_type(), ex.edges)
        self.snapshot_seq = ev["seq"]
        self._audit(ev)
        return int(ev["seq"])

    # ---------- feed ----------
    def _publish(self, changes: list[dict[str, Any]], *, by: str | None, source: P.Source, request_id: str | None = None) -> dict[str, Any]:
        ev = self.feed.append(changes, by=by, source=source, request_id=request_id)
        self.state.apply(changes)
        for c in changes:
            if c["op"] == "upsert":
                self.self_writes.add(c["entity"]["id"], c["entity"].get("version"))
        return ev

    def _audit(self, ev: dict[str, Any]) -> None:
        try:
            self.audit.record(ev)
        except Exception:
            log.exception("audit row for feed event %s failed", ev.get("seq"))

    # ---------- inbox ----------
    def pending(self) -> list[str]:
        last = self.cursor.get("last")
        start = None
        if last and is_ulid(last):
            start = P.INBOX + floor_ulid(ulid_time(last) - int(self.settings.inbox_lookback_seconds * 1000))
        ids = []
        for o in self.storage.list(P.INBOX, start):
            name = o.key.removeprefix(P.INBOX)
            if name.endswith(".json") and is_ulid(name[:-5]):
                ids.append(name[:-5])
        ids.sort()
        # Forget processed ids that fell out of the lookback window.
        if start:
            floor = start.removeprefix(P.INBOX)
            self.done = {d for d in self.done if d >= floor}
        out = [i for i in ids if i not in self.done]
        self.backlog = sum(1 for i in out if not last or i > last)
        return out

    def process_inbox(self) -> int:
        n = 0
        for rid in self.pending():
            if not self.lease.held:
                break
            if self.process(rid):
                n += 1
            self.backlog = max(0, self.backlog - 1)
        return n

    def _finish(self, rid: str) -> None:
        self.done.add(rid)
        last = self.cursor.get("last")
        if not last or rid > last:
            self.cursor["last"] = rid
        self.cursor["inflight"] = None
        self._save_cursor()

    def _reply(self, rid: str, **kw: Any) -> dict[str, Any]:
        r = P.reply(rid, self.clock(), **kw)
        self.storage.write(P.outbox_key(rid), dumps(r))
        return r

    def process(self, rid: str) -> bool:
        """Handle one request. True if it produced a new reply."""
        if self.storage.read(P.outbox_key(rid)) is not None:
            self._finish(rid)  # already done (possibly by a previous run)
            return False
        got = self.storage.read(P.inbox_key(rid))
        if got is None:
            return False
        inflight = self.cursor.get("inflight")
        inflight = inflight if isinstance(inflight, dict) and inflight.get("id") == rid else None
        try:
            r = self._handle(rid, got[0], inflight)
        except Exception as e:  # never leave a request without an answer
            log.exception("request %s failed", rid)
            r = self._reply(rid, status=500, error=("internal", f"The worker failed: {e}"))
        self._finish(rid)
        log.info("%s %s %s -> %s%s", rid, r.get("by"), self._describe(got[0]), r["status"], f" seq {r['feedSeq']}" if r.get("feedSeq") else "")
        return True

    @staticmethod
    def _describe(raw: bytes) -> str:
        try:
            d = json.loads(raw)
            return f"{d.get('op')} {d.get('method') or ''} {d.get('path') or ''}".strip()
        except Exception:
            return "?"

    def _handle(self, rid: str, raw: bytes, inflight: dict[str, Any] | None) -> dict[str, Any]:
        try:
            req = P.Request.model_validate_json(raw)
        except ValidationError as e:
            return self._reply(rid, status=400, error=("invalid", f"Not a valid request: {e.errors()[0].get('msg', e)}"))
        if req.id != rid:
            return self._reply(rid, status=400, error=("invalid", "The request's id doesn't match its file name."))
        try:
            by = self.identity.verify(req.auth)
        except AuthError as e:
            return self._reply(rid, status=401 if e.code == "unauthenticated" else 403, error=(e.code, str(e)))  # type: ignore[arg-type]

        ttl_ms = int(self.settings.request_ttl_minutes * 60_000)
        if inflight is None and self.clock() - req.ts > ttl_ms:
            return self._reply(
                rid, status=410, by=by, error=("expired", f"The request waited more than {self.settings.request_ttl_minutes:g} minutes and was not applied.")
            )

        if req.op == "echo":
            return self._reply(rid, status=200, body=req.body, by=by)
        if req.op == "resync":
            seq = self.resync(by=by, request_id=rid)
            return self._reply(rid, status=200, body={"seq": seq}, by=by, feed_seq=seq)

        ok, why = allowlist.check(req.method, req.path)
        if not ok:
            return self._reply(rid, status=403, by=by, error=("forbidden", why))
        return self._om(rid, req, by, inflight)

    def _om(self, rid: str, req: P.Request, by: str, inflight: dict[str, Any] | None) -> dict[str, Any]:
        method = req.method or "GET"
        path = allowlist.normalize(req.path or "") or ""
        query = req.query or {}
        headers = {k: v for k, v in (req.headers or {}).items() if k.lower() in PASS_HEADERS}
        body = req.body
        has_body = method in ("PUT", "POST", "PATCH") or (method == "DELETE" and body is not None)
        stage = (inflight or {}).get("stage")

        uncertain = False
        if stage in ("called", "fed", "audited"):
            res = OmResponse(int(inflight["status"]), inflight.get("body"))  # type: ignore[index]
        elif stage == "calling" and method not in IDEMPOTENT:
            uncertain = True
            res = OmResponse(200, None)
        else:
            self._set_inflight({"id": rid, "stage": "calling", "ts": self.clock()})
            from .om import NO_BODY

            res = self.om.request(method, path, query, headers, body if has_body else NO_BODY)
            self._set_inflight({"id": rid, "stage": "called", "status": res.status, "body": res.body})

        feed_seq: int | None = (inflight or {}).get("feedSeq") if stage in ("fed", "audited") else None
        if method != "GET" and res.status < 400 and stage not in ("fed", "audited"):
            ev = self.feed.find_request(rid) if stage == "called" else None
            if ev is None:
                ev = self._apply_effects(rid, by, method, path, query, body, res)
            if ev is not None:
                feed_seq = int(ev["seq"])
                self._set_inflight({"id": rid, "stage": "fed", "status": res.status, "body": res.body, "feedSeq": feed_seq})
                if ev.get("changes") != [P.RESYNC]:  # resync() audits its own event
                    self._audit(ev)
                self._set_inflight({"id": rid, "stage": "audited", "status": res.status, "body": res.body, "feedSeq": feed_seq})

        if uncertain:
            return self._reply(
                rid,
                status=500,
                by=by,
                feed_seq=feed_seq,
                error=("internal", "The worker restarted while applying this change, so it may or may not have been applied. Check before retrying."),
            )
        return self._reply(rid, status=res.status, body=sanitize.scrub(res.body), by=by, feed_seq=feed_seq)

    def _apply_effects(
        self, rid: str, by: str, method: str, path: str, query: dict[str, Any], body: Any, res: OmResponse
    ) -> dict[str, Any] | None:
        """Re-read what the write touched and append the feed event. None if nothing changed for the replica."""
        targets = resolve(method, path, query, body, res.status, res.body)
        if not targets:
            return None
        try:
            changes = materialize(targets, self.om, self.state, self.fields)
        except NeedResync:
            changes = None
        except OmError as e:
            log.warning("re-reading after %s %s failed (%s); falling back to a resync", method, path, e)
            changes = None
        if changes is None:
            seq = self.resync(by=by, request_id=rid, source="request")
            return read_json(self.storage, P.feed_key(seq))
        if not changes:
            return None
        return self._publish(changes, by=by, source="request", request_id=rid)

    # ---------- OpenMetadata change events ----------
    def poll_om_events(self) -> int:
        assert self.events is not None
        events = fetch(self.om, self.events)
        if not events:
            self._save_cursor()
            return 0
        targets = to_targets(events, self.events, self.state, self.self_writes)
        n = 0
        if targets:
            try:
                changes = materialize(targets, self.om, self.state, self.fields, skip_unchanged=True)
            except NeedResync:
                changes = []
            if changes:
                ev = self._publish(changes, by=by_of(events), source="om-events")
                self._audit(ev)
                n = len(changes)
        self._save_cursor()
        return n

    # ---------- loop ----------
    def run_once(self) -> None:
        if not self.lease.held:
            if self.leading:
                log.warning("%s lost the lease", self.worker_id)
            self.leading = False
            return
        if not self.leading:
            self.become_leader()
        self.process_inbox()
        now = self.clock()
        if now >= self._next_events:
            try:
                self.poll_om_events()
            except Exception:
                log.exception("polling OpenMetadata change events failed")
            self._next_events = self.clock() + int(self.settings.om_events_seconds * 1000)
        if not self._snapshot_ok:
            if now >= self._snapshot_retry_at:
                try:
                    self._startup_snapshot()
                    self._snapshot_ok = True
                    self._next_snapshot = self.clock() + int(self.settings.snapshot_minutes * 60_000)
                except Exception:
                    log.exception("startup snapshot failed again")
                    self._snapshot_retry_at = self.clock() + 30_000
        elif now >= self._next_snapshot:
            try:
                self._snapshot(publish_diff=True, force=False)
            except Exception:
                log.exception("periodic snapshot failed")
            self._next_snapshot = self.clock() + int(self.settings.snapshot_minutes * 60_000)
        if now >= self._next_housekeeping:
            try:
                housekeeping.run(self.storage, cursor_last=self.cursor.get("last"), retention_days=self.settings.retention_days, clock=self.clock)
            except Exception:
                log.exception("housekeeping failed")
            self._next_housekeeping = self.clock() + HOUSEKEEPING_MS

    def run_forever(self, stop: threading.Event | None = None) -> None:
        stop = stop or threading.Event()
        live = Liveness(self.storage, self.lease, self.info, self.clock)
        live.start()
        log.info("worker %s on bucket %s, OpenMetadata %s", self.worker_id, self.storage.label, getattr(self.om, "url", ""))
        try:
            while not stop.is_set():
                try:
                    self.run_once()
                except Exception:
                    log.exception("worker loop error")
                    time.sleep(2)
                stop.wait(self.settings.poll_seconds)
        finally:
            live.stop()
            self.lease.release()
