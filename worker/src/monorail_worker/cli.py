"""Command line: `monorail-worker [run]`, `monorail-worker echo`, `monorail-worker resync`."""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import threading
import time

from . import __version__
from . import protocol as P
from .config import Settings
from .storage import dumps, open_storage, read_json
from .ulid import new_ulid, now_ms


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)


def cmd_run(settings: Settings) -> int:
    from .audit import BigQueryAudit, NoAudit
    from .om import OmClient
    from .worker import Worker

    storage = open_storage(settings.team_bucket)
    om = OmClient(settings.om_url, settings.om_token, settings.om_email, settings.om_password)
    audit = BigQueryAudit(settings.bq_dataset, project=settings.bq_project) if settings.bq_dataset else NoAudit()
    worker = Worker(settings, storage, om, audit=audit)
    stop = threading.Event()

    def on_signal(*_: object) -> None:
        logging.getLogger(__name__).info("stopping")
        stop.set()

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)
    worker.run_forever(stop)
    return 0


def _send(settings: Settings, op: str, body: object, user: str, id_token: str, timeout: float) -> int:
    storage = open_storage(settings.team_bucket)
    rid = new_ulid()
    auth = {"kind": "google", "idToken": id_token} if id_token else {"kind": "local", "user": user}
    req = {"v": 1, "id": rid, "ts": now_ms(), "auth": auth, "op": op, "body": body, "client": {"app": "monorail-worker-cli", "version": __version__}}
    t0 = time.perf_counter()
    if not storage.create(P.inbox_key(rid), dumps(req)):
        print(f"request id collision: {rid}", file=sys.stderr)
        return 1
    hb = read_json(storage, P.HEARTBEAT)
    if not hb or now_ms() - int(hb.get("ts", 0)) > 60_000:
        print("warning: no fresh worker heartbeat in the bucket; is the worker running?", file=sys.stderr)
    deadline = t0 + timeout
    wait = 0.02
    while time.perf_counter() < deadline:
        reply = read_json(storage, P.outbox_key(rid))
        if reply:
            ms = (time.perf_counter() - t0) * 1000
            print(f"{op} {rid}: {ms:.0f} ms round trip (status {reply['status']}, by {reply.get('by')})")
            print(json.dumps(reply, indent=2)[:2000])
            return 0 if reply.get("ok") else 2
        time.sleep(wait)
        wait = min(0.25, wait * 1.5)
    print(f"{op} {rid}: no reply after {timeout:.0f} s (still queued in {storage.label})", file=sys.stderr)
    return 3


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="monorail-worker", description="MonoRail Metadata team-backend worker (docs/team-backend.md).")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("run", help="run the worker (the default)")
    for name, helptext in (("echo", "send one echo request through the bucket and print the round trip"), ("resync", "ask the worker to rebuild the snapshot")):
        p = sub.add_parser(name, help=helptext)
        p.add_argument("--user", default="", help="local identity (TEAM_AUTH=local); default TEAM_USER or admin")
        p.add_argument("--id-token", default="", help="a Google ID token (TEAM_AUTH=google)")
        p.add_argument("--timeout", type=float, default=30)
        if name == "echo":
            p.add_argument("--message", default="ping")
    args = ap.parse_args(argv)
    _setup_logging(args.verbose)
    settings = Settings.load()
    cmd = args.cmd or "run"
    if cmd == "run":
        return cmd_run(settings)
    user = args.user or settings.team_user
    body = {"message": args.message, "sentAt": now_ms()} if cmd == "echo" else None
    return _send(settings, cmd, body, user, args.id_token, args.timeout)


if __name__ == "__main__":
    sys.exit(main())
