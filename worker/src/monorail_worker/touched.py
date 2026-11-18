"""Which replica entities a write touched, and the feed changes that bring apps up to date.

`resolve()` is pure: from the request and OpenMetadata's answer it lists *targets* (what to re-read
or delete). `materialize()` re-reads them from OpenMetadata and builds the changes. When a write
can't be expressed as targets, `resolve()` returns `[Resync()]` rather than guess.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import unquote

from . import protocol as P
from . import sanitize
from .entities import COLLECTIONS, TYPE_TO_COLLECTION, collection_from_href, is_uuid, split_collection
from .lineage import read_edge, lineage_of
from .om import Om, OmError
from .state import ReplicaState

log = logging.getLogger(__name__)


# ---------- targets ----------
@dataclass(frozen=True)
class EntityById:
    collection: str
    id: str
    related: bool = False  # also re-read its parents (RELATED_REFS) after reading it


@dataclass(frozen=True)
class EntityByName:
    collection: str
    fqn: str
    related: bool = False


@dataclass(frozen=True)
class Deleted:
    entity_type: str
    id: str


@dataclass(frozen=True)
class EdgeRead:
    from_type: str
    from_id: str
    to_id: str


@dataclass(frozen=True)
class EdgeDelete:
    from_id: str
    to_id: str


@dataclass(frozen=True)
class EdgeDeleteByName:
    from_type: str
    from_fqn: str
    to_type: str
    to_fqn: str


@dataclass(frozen=True)
class EdgesOf:
    """Re-read every edge one hop from an entity (after a restore)."""

    entity_type: str
    id: str


@dataclass(frozen=True)
class Resync:
    pass


Target = EntityById | EntityByName | Deleted | EdgeRead | EdgeDelete | EdgeDeleteByName | EdgesOf | Resync

# On create and delete, these parents' derived fields (children, counts, lists) change too.
RELATED_REFS: dict[str, tuple[str, ...]] = {
    "glossaryTerm": ("glossary", "parent"),
    "tag": ("classification", "parent"),
    "testCase": ("testSuite", "testSuites"),
    "database": ("service",),
    "databaseSchema": ("database",),
    "table": ("databaseSchema",),
    "domain": ("parent",),
    "dataProduct": ("domains",),
}

# A JSON patch touching these paths renames the entity, which changes FQNs elsewhere.
RENAME_PATHS = ("/name", "/fullyQualifiedName")


def _ref_targets(entity: Mapping[str, Any], fields: tuple[str, ...]) -> list[Target]:
    out: list[Target] = []
    for f in fields:
        v = entity.get(f)
        for r in v if isinstance(v, list) else [v]:
            if isinstance(r, dict) and r.get("id") and r.get("type") in TYPE_TO_COLLECTION:
                out.append(EntityById(TYPE_TO_COLLECTION[r["type"]], r["id"]))
    return out


def _truthy(q: Mapping[str, Any] | None, name: str) -> bool:
    return str((q or {}).get(name, "")).lower() == "true"


def _entity_target(coll: str, resp: Any) -> Target | None:
    if isinstance(resp, dict):
        if resp.get("href"):
            got = collection_from_href(str(resp["href"]))
            if got:
                return EntityById(*got)
        if resp.get("id") and is_uuid(str(resp["id"])):
            return EntityById(coll, str(resp["id"]))
    return None


def resolve(
    method: str, path: str, query: Mapping[str, Any] | None, body: Any, status: int, resp: Any
) -> list[Target]:
    """Targets for a successful write. [] means nothing for the replica (activity feed)."""
    if method == "GET" or status >= 400:
        return []
    segs = [unquote(s) for s in path.split("/") if s]
    if not segs:
        return [Resync()]
    head = segs[0]

    if head == "feed":
        return []

    if head == "lineage":
        if method == "PUT" and len(segs) == 1:
            edge = (body or {}).get("edge") if isinstance(body, dict) else None
            f, t = (edge or {}).get("fromEntity") or {}, (edge or {}).get("toEntity") or {}
            if f.get("id") and t.get("id"):
                return [EdgeRead(f.get("type", "table"), f["id"], t["id"])]
            return [Resync()]
        if len(segs) == 5 and is_uuid(segs[2]) and is_uuid(segs[4]):
            if method == "DELETE":
                return [EdgeDelete(segs[2], segs[4])]
            return [EdgeRead(segs[1], segs[2], segs[4])]
        if method == "DELETE" and len(segs) == 7 and segs[2] == "name" and segs[5] == "name":
            return [EdgeDeleteByName(segs[1], segs[3], segs[4], segs[6])]
        return [Resync()]

    if head == "usage":
        if len(segs) == 3 and segs[1] in TYPE_TO_COLLECTION and is_uuid(segs[2]):
            return [EntityById(TYPE_TO_COLLECTION[segs[1]], segs[2])]
        if len(segs) == 4 and segs[1] in TYPE_TO_COLLECTION and segs[2] == "name":
            return [EntityByName(TYPE_TO_COLLECTION[segs[1]], segs[3])]
        return [Resync()]

    coll, rest = split_collection(path)
    rest = [unquote(s) for s in rest]
    if coll is None:
        t = _entity_target("", resp)
        return [t] if t and isinstance(t, EntityById) and t.collection else [Resync()]
    etype = COLLECTIONS[coll]

    # Test case results: /dataQuality/testCases/testCaseResults/{fqn}[/{timestamp}]
    if coll == "dataQuality/testCases" and rest and rest[0] == "testCaseResults":
        # The result also changes the test suites' summaries.
        return [EntityByName(coll, rest[1], related=True)] if len(rest) >= 2 else [Resync()]

    # Bulk asset changes: /{coll}/{idOrName}/assets/add|remove
    if len(rest) == 3 and rest[1] == "assets" and rest[2] in ("add", "remove"):
        parent: Target = EntityById(coll, rest[0]) if is_uuid(rest[0]) else EntityByName(coll, rest[0])
        targets: list[Target] = [parent]
        for a in (body or {}).get("assets", []) if isinstance(body, dict) else []:
            if isinstance(a, dict) and a.get("type") in TYPE_TO_COLLECTION and a.get("id"):
                targets.append(EntityById(TYPE_TO_COLLECTION[a["type"]], a["id"]))
        return targets

    # Followers and votes: the parent entity.
    if len(rest) >= 2 and is_uuid(rest[0]) and rest[1] in ("followers", "votes"):
        return [EntityById(coll, rest[0])]

    if rest and rest[0] == "restore":
        rid = (body or {}).get("id") if isinstance(body, dict) else None
        if not rid and isinstance(resp, dict):
            rid = resp.get("id")
        if rid:
            return [EntityById(coll, rid), EdgesOf(etype, rid)]
        return [Resync()]

    # Actions keyed by id, e.g. /services/ingestionPipelines/deploy/{id}, /trigger/{id}.
    if len(rest) == 2 and not is_uuid(rest[0]) and rest[0] != "name" and is_uuid(rest[1]):
        return [EntityById(coll, rest[1])]

    if rest and (rest[0] in ("bulk", "async") or "import" in rest or "importAsync" in rest or rest[-1] == "async"):
        return [Resync()]

    if method == "DELETE":
        if _truthy(query, "recursive"):
            return [Resync()]  # children went too; we can't list them
        if len(rest) == 1 and is_uuid(rest[0]):
            eid = rest[0]
        elif len(rest) == 2 and rest[0] == "name" and isinstance(resp, dict) and resp.get("id"):
            eid = str(resp["id"])
        elif len(rest) >= 2 and is_uuid(rest[0]):
            return [EntityById(coll, rest[0])]  # a sub-resource of the entity
        else:
            return [Resync()]
        out: list[Target] = [Deleted(etype, eid)]
        if isinstance(resp, dict):
            out += _ref_targets(resp, RELATED_REFS.get(etype, ()))
        return out

    # PUT / POST / PATCH
    if method == "PATCH" and isinstance(body, list):
        if any(isinstance(op, dict) and str(op.get("path", "")) in RENAME_PATHS for op in body):
            return [Resync()]

    targets = []
    t = _entity_target(coll, resp)
    if t:
        targets.append(t)
    if rest and is_uuid(rest[0]) and not any(isinstance(x, EntityById) and x.id == rest[0] for x in targets):
        targets.append(EntityById(coll, rest[0]))
    elif len(rest) >= 2 and rest[0] == "name" and not targets:
        targets.append(EntityByName(coll, rest[1]))
    if not targets:
        return [Resync()]
    if status == 201 and isinstance(resp, dict):
        targets += _ref_targets(resp, RELATED_REFS.get(etype, ()))
    return targets


# ---------- materialize ----------
class FieldsPolicy:
    """`fields=*` unless a collection rejected it in the snapshot, then its fallback list."""

    def __init__(self) -> None:
        self.by_collection: dict[str, str] = {}

    def get(self, coll: str) -> str:
        return self.by_collection.get(coll, "*")


def read_entity(om: Om, coll: str, ident: str, by_name: bool, fields: FieldsPolicy) -> tuple[str, Any]:
    """('upsert', entity) | ('delete', id) | ('missing', None)."""
    from urllib.parse import quote

    path = f"/{coll}/name/{quote(ident, safe='')}" if by_name else f"/{coll}/{ident}"
    res = om.request("GET", path, {"fields": fields.get(coll), "include": "all"})
    if res.status == 400 and fields.get(coll) == "*":
        from .entities import FALLBACK_FIELDS

        res = om.request("GET", path, {"fields": FALLBACK_FIELDS.get(coll, ""), "include": "all"})
    if res.status == 404:
        return ("delete", ident) if not by_name else ("missing", None)
    if res.status >= 400:
        raise OmError(res.status, res.body, f"GET {path}")
    e = res.body
    if not isinstance(e, dict) or not e.get("id"):
        return ("missing", None)
    if e.get("deleted"):
        return ("delete", e["id"])
    return ("upsert", sanitize.entity(e))


class NeedResync(Exception):
    pass


def materialize(
    targets: list[Target], om: Om, state: ReplicaState, fields: FieldsPolicy, *, skip_unchanged: bool = False
) -> list[dict[str, Any]]:
    """Changes for a list of targets. Raises NeedResync when one of them is Resync or can't be resolved.

    skip_unchanged drops upserts apps already hold (used for OpenMetadata change events)."""
    entity_changes: dict[str, dict[str, Any]] = {}
    edge_changes: dict[tuple[str, str], dict[str, Any]] = {}

    def entity_change(c: dict[str, Any]) -> None:
        eid = c["entity"]["id"] if c["op"] == "upsert" else c["id"]
        entity_changes[eid] = c

    def edge_gone(f: str, t: str) -> None:
        edge_changes[(f, t)] = P.lineage_delete(f, t)

    queue = list(targets)
    seen: set[Target] = set()
    while queue:
        tg = queue.pop(0)
        if tg in seen:
            continue
        seen.add(tg)
        if isinstance(tg, Resync):
            raise NeedResync()
        if isinstance(tg, (EntityById, EntityByName)):
            by_name = isinstance(tg, EntityByName)
            kind, val = read_entity(om, tg.collection, tg.fqn if by_name else tg.id, by_name, fields)
            etype = COLLECTIONS[tg.collection]
            if kind == "upsert":
                if not (skip_unchanged and state.same_entity(val)):
                    entity_change(P.upsert(etype, val))
                if tg.related:
                    queue += _ref_targets(val, RELATED_REFS.get(etype, ()))
            elif kind == "delete":
                entity_change(P.delete(etype, val))
                for f, t in state.edges_touching(val):
                    edge_gone(f, t)
            elif by_name:
                raise NeedResync()
        elif isinstance(tg, Deleted):
            entity_change(P.delete(tg.entity_type, tg.id))
            for f, t in state.edges_touching(tg.id):
                edge_gone(f, t)
        elif isinstance(tg, EdgeRead):
            edge = read_edge(om, tg.from_type, tg.from_id, tg.to_id)
            if edge is None:
                edge_gone(tg.from_id, tg.to_id)
            elif not (skip_unchanged and state.same_edge(edge)):
                edge_changes[(tg.from_id, tg.to_id)] = P.lineage_upsert(edge)
        elif isinstance(tg, EdgeDelete):
            edge_gone(tg.from_id, tg.to_id)
        elif isinstance(tg, EdgeDeleteByName):
            ids = []
            for typ, fqn in ((tg.from_type, tg.from_fqn), (tg.to_type, tg.to_fqn)):
                coll = TYPE_TO_COLLECTION.get(typ)
                if not coll:
                    raise NeedResync()
                kind, val = read_entity(om, coll, fqn, True, fields)
                if kind != "upsert":
                    raise NeedResync()
                ids.append(val["id"])
            edge_gone(ids[0], ids[1])
        elif isinstance(tg, EdgesOf):
            coll = TYPE_TO_COLLECTION.get(tg.entity_type)
            kind, val = read_entity(om, coll, tg.id, False, fields) if coll else ("missing", None)
            if kind == "upsert" and val.get("fullyQualifiedName"):
                for edge in lineage_of(om, tg.entity_type, val["fullyQualifiedName"]):
                    edge_changes[(edge["fromEntity"]["id"], edge["toEntity"]["id"])] = P.lineage_upsert(edge)

    # Deleting an edge that apps never had is harmless, but don't announce it twice.
    return list(entity_changes.values()) + list(edge_changes.values())
