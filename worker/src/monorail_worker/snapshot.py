"""The catalog snapshot (docs/team-backend.md, "Snapshot").

Export pages through every collection with `fields=*` (falling back to a per-collection field list
if OpenMetadata rejects `*`), strips secrets, walks each table's (and metric's) lineage one hop up
and down, and de-duplicates the edges. Files are written first, the manifest last.

File names carry the snapshot's timestamp (`table.1794955000000.json.gz`), so a reader holding an
older manifest never reads a newer file under the same name. Old files are removed by housekeeping.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

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
    man = P.manifest(seq, ts, ex.om_version, files, lineage_name, len(ex.edges))
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
        return man, ex
    except Exception:
        log.exception("couldn't read the current snapshot")
        return None


def referenced_files(man: dict[str, Any] | None) -> set[str]:
    if not man:
        return set()
    out = {P.CATALOG + f["file"] for f in man.get("files", {}).get("entities", [])}
    lin = man.get("files", {}).get("lineage", {}).get("file")
    if lin:
        out.add(P.CATALOG + lin)
    return out


def diff(state: ReplicaState, new: Export) -> list[dict[str, Any]]:
    """Changes that bring what apps hold (`state`) to `new`: upserts for new or changed entities,
    deletes for vanished ones, and the same for lineage edges."""
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
    return changes
