"""Each table's latest profile, in the snapshot and the feed (docs/team-backend.md, "Snapshot").

OpenMetadata 2.0.8 answers `GET /tables/{fqn}/tableProfile/latest?includeColumnProfile=true` with
the table (a slim copy) carrying `profile` and each column's `profile`. Apps already hold the table
itself, so the worker keeps only the profile parts, as a record:

    {"id", "fullyQualifiedName", "profile", "columns": [{"fullyQualifiedName", "profile"}]}

Nested columns are flattened. A table with no table or column profile has no record.

Profile writes produce no change events in 2.0.8 (the profiler's `PUT /tables/{id}/tableProfile`
writes the time-series table directly), so the periodic snapshot diff is how the profiler's output
reaches apps. Queued profile writes re-read the record straight away (touched.ProfileOf).
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

from .om import Om, OmError

log = logging.getLogger(__name__)

Record = dict[str, Any]


def _columns(cols: Any, out: list[dict[str, Any]]) -> None:
    for c in cols if isinstance(cols, list) else []:
        if not isinstance(c, dict):
            continue
        if isinstance(c.get("profile"), dict) and c.get("fullyQualifiedName"):
            out.append({"fullyQualifiedName": c["fullyQualifiedName"], "profile": c["profile"]})
        _columns(c.get("children"), out)


def record(latest: Any) -> Record | None:
    """The record for one `tableProfile/latest` answer, or None if nothing in it is profiled."""
    if not isinstance(latest, dict) or not latest.get("id"):
        return None
    cols: list[dict[str, Any]] = []
    _columns(latest.get("columns"), cols)
    profile = latest.get("profile") if isinstance(latest.get("profile"), dict) else None
    if profile is None and not cols:
        return None
    return {"id": latest["id"], "fullyQualifiedName": latest.get("fullyQualifiedName"), "profile": profile, "columns": cols}


def read(om: Om, fqn: str) -> Record | None:
    """The table's current record; None if it has no profile (or the table is gone)."""
    res = om.request("GET", f"/tables/{quote(fqn, safe='')}/tableProfile/latest", {"includeColumnProfile": True})
    if res.status == 404:
        return None
    if res.status >= 400:
        raise OmError(res.status, res.body, f"GET /tables/{fqn}/tableProfile/latest")
    return record(res.body)


def export(om: Om, tables: list[dict[str, Any]]) -> tuple[list[Record], set[str]]:
    """Records for every table that has a profile, and the ids of tables whose profile couldn't be
    read (so a diff keeps what apps hold for them instead of deleting it)."""
    out: list[Record] = []
    failed: set[str] = set()
    for t in tables:
        fqn = t.get("fullyQualifiedName")
        if not fqn:
            continue
        try:
            r = read(om, fqn)
        except OmError as e:
            log.warning("latest profile of %s failed: %s", fqn, e)
            if t.get("id"):
                failed.add(t["id"])
            continue
        if r:
            out.append(r)
    return out, failed
