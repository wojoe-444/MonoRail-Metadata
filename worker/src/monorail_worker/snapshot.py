"""The catalog snapshot (docs/team-backend.md, "Snapshot").

Export pages through every collection with `fields=*` (falling back to a per-collection field list
if OpenMetadata rejects `*`), strips secrets, walks each table's (and metric's) lineage one hop up
and down, de-duplicates the edges, and reads each table's latest profile (profiles.py). Files are
written first, the manifest last.

File names carry the snapshot's timestamp (`table.1794955000000.json.gz`), so a reader holding an
older manifest never reads a newer file under the same name. Old files are removed by housekeeping.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from . import profiles as profiles_mod
from . import protocol as P
from . import sanitize
from .entities import COLLECTIONS, FALLBACK_FIELDS
from .lineage import Edge, dedupe, edge_key, lineage_of
from .om import Om, OmError
from .storage import Storage, read_json, write_json
from .state import ReplicaState
from .touched import FieldsPolicy

log = logging.getLogger(__name__)

PAGE = 1000
LINEAGE_TYPES = ("tables", "metrics")


@dataclass
class Export:
    entities: dict[str, list[dict[str, Any]]] = field(default_factory=dict)  # collection -> entities
    edges: list[Edge] = field(default_factory=list)
    profiles: list[dict[str, Any]] = field(default_factory=list)  # profiles.record per profiled table
    # Tables whose profile couldn't be read: a diff keeps what apps hold for them.
    profile_failed: set[str] = field(default_factory=set)
    has_profiles: bool = True  # False for a snapshot written before profiles were exported
    om_version: str = ""

    def by_type(self) -> dict[str, list[dict[str, Any]]]:
        return {COLLECTIONS[c]: items for c, items in self.entities.items()}


def _page_all(om: Om, coll: str, fields: FieldsPolicy) -> list[dict[str, Any]]:
    candidates = [fields.get(coll)] + ([FALLBACK_FIELDS.get(coll, "")] if fields.get(coll) == "*" else []) + [""]
    last_err: OmError | None = None
    for f in candidates:
        out: list[dict[str, Any]] = []
        after: str | None = None
        try:
            while True:
                q: dict[str, Any] = {"limit": PAGE}
                if f:
                    q["fields"] = f
                if after:
                    q["after"] = after
                res = om.request("GET", f"/{coll}", q)
                if res.status >= 400:
                    raise OmError(res.status, res.body, f"GET /{coll}")
                body = res.body or {}
                out.extend(x for x in body.get("data", []) if isinstance(x, dict))
                after = (body.get("paging") or {}).get("after")
                if not after:
                    break
        except OmError as e:
            if e.status != 400:
                raise
            log.warning("%s rejected fields=%r (%s); trying a narrower list", coll, f, e)
            last_err = e
            continue
        if f != "*":
            fields.by_collection[coll] = f
        return out
    raise last_err or OmError(400, "", f"GET /{coll}")


def export(om: Om, fields: FieldsPolicy) -> Export:
    ex = Export()
    ver = om.request("GET", "/system/version")
    ex.om_version = (ver.body or {}).get("version", "") if isinstance(ver.body, dict) else ""
    for coll in COLLECTIONS:
        ex.entities[coll] = [sanitize.entity(e) for e in _page_all(om, coll, fields)]
    edges: list[Edge] = []
    for coll in LINEAGE_TYPES:
        etype = COLLECTIONS[coll]
        for e in ex.entities.get(coll, []):
            fqn = e.get("fullyQualifiedName")
            if not fqn:
                continue
            try:
                edges.extend(lineage_of(om, etype, fqn))
            except OmError as err:
                log.warning("lineage of %s %s failed: %s", etype, fqn, err)
    ex.edges = dedupe(edges)
    ex.profiles, ex.profile_failed = profiles_mod.export(om, ex.entities.get("tables", []))
    return ex


def write(storage: Storage, ex: Export, seq: int, ts: int) -> dict[str, Any]:
    files = []
    for coll, items in ex.entities.items():
        etype = COLLECTIONS[coll]
        name = f"{etype}.{ts}.json.gz"
        write_json(storage, P.CATALOG + name, items)
        files.append({"entityType": etype, "path": coll, "file": name, "count": len(items)})
    lineage_name = f"lineage.{ts}.json.gz"
    write_json(storage, P.CATALOG + lineage_name, ex.edges)
    profiles_name = f"tableProfile.{ts}.json.gz"
    write_json(storage, P.CATALOG + profiles_name, ex.profiles)
    man = P.manifest(seq, ts, ex.om_version, files, lineage_name, len(ex.edges), profiles_name, len(ex.profiles))
    write_json(storage, P.MANIFEST, man)  # last
    return man


def load(storage: Storage) -> tuple[dict[str, Any], Export] | None:
    """The current snapshot, or None if there isn't one (or it's unreadable)."""
    man = read_json(storage, P.MANIFEST)
    if not man:
        return None
    try:
        ex = Export(om_version=man.get("omVersion", ""))
        for f in man["files"]["entities"]:
            ex.entities[f["path"]] = read_json(storage, P.CATALOG + f["file"]) or []
        ex.edges = read_json(storage, P.CATALOG + man["files"]["lineage"]["file"]) or []
        prof = man["files"].get("profiles")
        ex.has_profiles = bool(prof)
        ex.profiles = (read_json(storage, P.CATALOG + prof["file"]) or []) if prof else []
        return man, ex
    except Exception:
        log.exception("couldn't read the current snapshot")
        return None


def referenced_files(man: dict[str, Any] | None) -> set[str]:
    if not man:
        return set()
    out = {P.CATALOG + f["file"] for f in man.get("files", {}).get("entities", [])}
    for part in ("lineage", "profiles"):
        name = (man.get("files", {}).get(part) or {}).get("file")
        if name:
            out.add(P.CATALOG + name)
    return out


def diff(state: ReplicaState, new: Export) -> list[dict[str, Any]]:
    """Changes that bring what apps hold (`state`) to `new`: upserts for new or changed entities,
    deletes for vanished ones, and the same for lineage edges and latest profiles.

    Profiles that couldn't be read this time (`new.profile_failed`) are carried over from `state`
    into `new`, so neither the diff nor the snapshot written next drops them."""
    changes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for coll, items in new.entities.items():
        etype = COLLECTIONS[coll]
        for e in items:
            if not e.get("id"):
                continue
            seen.add(e["id"])
            if not state.same_entity(e):
                changes.append(P.upsert(etype, e))
    for eid, (etype, _) in list(state.entities.items()):
        if eid not in seen:
            changes.append(P.delete(etype, eid))
    new_keys = set()
    for edge in new.edges:
        new_keys.add(edge_key(edge))
        if not state.same_edge(edge):
            changes.append(P.lineage_upsert(edge))
    for k in list(state.edges):
        if k not in new_keys:
            changes.append(P.lineage_delete(*k))
    carry_profiles(state, new)
    new_ids = set()
    for r in new.profiles:
        new_ids.add(r["id"])
        if not state.same_profile(r):
            changes.append(P.profile_upsert(r))
    for tid in list(state.profiles):
        # A deleted table's profile goes with the entity delete above.
        if tid not in new_ids and tid in seen:
            changes.append(P.profile_delete(tid))
    return changes


def carry_profiles(state: ReplicaState, new: Export) -> None:
    """Keep the last known record for tables whose profile read failed in this export."""
    have = {r["id"] for r in new.profiles}
    for tid in new.profile_failed:
        old = state.profile(tid)
        if old and tid not in have:
            new.profiles.append(old)
    new.profile_failed = set()
