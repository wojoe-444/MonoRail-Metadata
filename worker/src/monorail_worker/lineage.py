"""Lineage edges in the feed's `lineage.upsert` shape, from either OpenMetadata lineage response.

- `GET /lineage/getLineage?fqn=…&type=…` (what OpenMetadata's UI uses): `nodes` keyed by FQN,
  `upstreamEdges`/`downstreamEdges` keyed by "from--->to", each edge with `fromEntity`/`toEntity`
  objects and either `sqlQuery` or `sqlQueryKey`. With a key, the SQL is in the *target* node's
  `entity.lineageSqlQueries[key]`.
- `GET /lineage/{type}/{id}`: `nodes` as a list, edges with bare ids and a `lineageDetails` object.
"""

from __future__ import annotations

from typing import Any, Iterable

from .om import Om, get_json, try_get

Edge = dict[str, Any]


def _ref(x: Any, nodes_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if isinstance(x, str):
        n = nodes_by_id.get(x, {})
        return {"id": x, "type": n.get("type") or n.get("entityType") or "table", "fullyQualifiedName": n.get("fullyQualifiedName")}
    return {"id": x.get("id"), "type": x.get("type") or "table", "fullyQualifiedName": x.get("fullyQualifiedName")}


def _columns(cols: Any) -> list[dict[str, Any]]:
    out = []
    for c in cols or []:
        if isinstance(c, dict) and "toColumn" in c:
            out.append({"fromColumns": list(c.get("fromColumns") or []), "toColumn": c["toColumn"]})
    return out


def normalize_edge(raw: dict[str, Any], nodes_by_id: dict[str, dict[str, Any]], sql_by_node: dict[str, dict[str, str]]) -> Edge:
    details = raw.get("lineageDetails") or {}
    src = {**details, **{k: v for k, v in raw.items() if k != "lineageDetails"}}
    edge: Edge = {"fromEntity": _ref(raw["fromEntity"], nodes_by_id), "toEntity": _ref(raw["toEntity"], nodes_by_id)}
    sql = src.get("sqlQuery")
    if not sql and src.get("sqlQueryKey") is not None:
        key = str(src["sqlQueryKey"])
        sql = sql_by_node.get(edge["toEntity"]["id"], {}).get(key) or sql_by_node.get(edge["fromEntity"]["id"], {}).get(key)
    if sql:
        edge["sqlQuery"] = sql
    if src.get("source"):
        edge["source"] = src["source"]
    if src.get("description"):
        edge["description"] = src["description"]
    if src.get("pipeline"):
        edge["pipeline"] = src["pipeline"]
    edge["columns"] = _columns(src.get("columns") if src.get("columns") is not None else src.get("columnsLineage"))
    return edge


def edges_from_response(resp: dict[str, Any]) -> list[Edge]:
    nodes = resp.get("nodes") or {}
    entities: list[dict[str, Any]] = []
    if isinstance(nodes, dict):
        entities = [n.get("entity", n) for n in nodes.values() if isinstance(n, dict)]
    elif isinstance(nodes, list):
        entities = [n for n in nodes if isinstance(n, dict)]
    if isinstance(resp.get("entity"), dict):
        entities.append(resp["entity"])
    nodes_by_id = {e["id"]: e for e in entities if e.get("id")}
    sql_by_node = {
        e["id"]: {str(k): v for k, v in (e.get("lineageSqlQueries") or {}).items()}
        for e in entities
        if e.get("id") and isinstance(e.get("lineageSqlQueries"), dict)
    }
    out = []
    for key in ("upstreamEdges", "downstreamEdges"):
        raw = resp.get(key) or []
        for e in raw.values() if isinstance(raw, dict) else raw:
            if isinstance(e, dict) and e.get("fromEntity") and e.get("toEntity"):
                out.append(normalize_edge(e, nodes_by_id, sql_by_node))
    return out


def edge_key(edge: Edge) -> tuple[str, str]:
    return edge["fromEntity"]["id"], edge["toEntity"]["id"]


def dedupe(edges: Iterable[Edge]) -> list[Edge]:
    seen: dict[tuple[str, str], Edge] = {}
    for e in edges:
        k = edge_key(e)
        # Prefer the copy that has the SQL.
        if k not in seen or ("sqlQuery" in e and "sqlQuery" not in seen[k]):
            seen[k] = e
    return list(seen.values())


def lineage_of(om: Om, entity_type: str, fqn: str) -> list[Edge]:
    """Edges one hop up and down from an entity."""
    resp = get_json(
        om,
        "/lineage/getLineage",
        {"fqn": fqn, "type": entity_type, "upstreamDepth": 1, "downstreamDepth": 1},
    )
    return edges_from_response(resp or {})


def read_edge(om: Om, from_type: str, from_id: str, to_id: str) -> Edge | None:
    """The current edge from -> to, or None if there is none."""
    resp = try_get(om, f"/lineage/{from_type}/{from_id}", {"upstreamDepth": 0, "downstreamDepth": 1})
    if not resp:
        return None
    for e in edges_from_response(resp):
        if edge_key(e) == (from_id, to_id):
            if "sqlQuery" not in e and e["fromEntity"].get("fullyQualifiedName"):
                # The by-id endpoint had no SQL: look again through getLineage, which may carry a key.
                for g in lineage_of(om, from_type, e["fromEntity"]["fullyQualifiedName"]):
                    if edge_key(g) == (from_id, to_id):
                        return g
            return e
    return None
