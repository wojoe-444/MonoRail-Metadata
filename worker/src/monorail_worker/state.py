"""What the worker believes apps' replicas hold: a fingerprint of every entity and every lineage edge,
and each table's latest profile record.

Updated with every feed event the worker appends and with every snapshot. It lets the worker
- skip publishing a change apps already have (e.g. OpenMetadata's change event for the worker's own write),
- emit `lineage.delete` for the edges of a deleted entity,
- diff a fresh export against the last one, to publish changes that had no change event.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .lineage import Edge, edge_key


def fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:24]


class ReplicaState:
    def __init__(self) -> None:
        self.entities: dict[str, tuple[str, str]] = {}  # id -> (entityType, fingerprint)
        self.versions: dict[str, float] = {}  # id -> version
        self.edges: dict[tuple[str, str], tuple[Edge, str]] = {}  # (fromId, toId) -> (edge, fingerprint)
        self.profiles: dict[str, tuple[dict[str, Any], str]] = {}  # table id -> (profile record, fingerprint)

    def load(self, entities: dict[str, list[dict[str, Any]]], edges: list[Edge], profiles: list[dict[str, Any]] | None = None) -> None:
        self.entities.clear()
        self.versions.clear()
        self.edges.clear()
        self.profiles.clear()
        for etype, items in entities.items():
            for e in items:
                self._put(etype, e)
        for edge in edges:
            self.edges[edge_key(edge)] = (edge, fingerprint(edge))
        for r in profiles or []:
            self.profiles[r["id"]] = (r, fingerprint(r))

    def _put(self, etype: str, e: dict[str, Any]) -> None:
        if e.get("id"):
            self.entities[e["id"]] = (etype, fingerprint(e))
            if isinstance(e.get("version"), (int, float)):
                self.versions[e["id"]] = float(e["version"])

    def same_entity(self, e: dict[str, Any]) -> bool:
        cur = self.entities.get(e.get("id", ""))
        return cur is not None and cur[1] == fingerprint(e)

    def same_edge(self, edge: Edge) -> bool:
        cur = self.edges.get(edge_key(edge))
        return cur is not None and cur[1] == fingerprint(edge)

    def same_profile(self, record: dict[str, Any]) -> bool:
        cur = self.profiles.get(record.get("id", ""))
        return cur is not None and cur[1] == fingerprint(record)

    def profile(self, table_id: str) -> dict[str, Any] | None:
        cur = self.profiles.get(table_id)
        return cur[0] if cur else None

    def table_of_column(self, column_fqn: str) -> dict[str, Any] | None:
        """The profile record of the table a column FQN belongs to (longest matching table FQN)."""
        best = None
        for r, _ in self.profiles.values():
            fqn = r.get("fullyQualifiedName") or ""
            if column_fqn.startswith(fqn + ".") and (best is None or len(fqn) > len(best.get("fullyQualifiedName") or "")):
                best = r
        return best

    def has_entity(self, eid: str) -> bool:
        return eid in self.entities

    def has_edge(self, from_id: str, to_id: str) -> bool:
        return (from_id, to_id) in self.edges

    def edges_touching(self, eid: str) -> list[tuple[str, str]]:
        return [k for k in self.edges if eid in k]

    def apply(self, changes: list[dict[str, Any]]) -> None:
        for c in changes:
            op = c.get("op")
            if op == "upsert":
                self._put(c["entityType"], c["entity"])
            elif op == "delete":
                self.entities.pop(c["id"], None)
                self.versions.pop(c["id"], None)
                self.profiles.pop(c["id"], None)
            elif op == "lineage.upsert":
                self.edges[edge_key(c["edge"])] = (c["edge"], fingerprint(c["edge"]))
            elif op == "lineage.delete":
                self.edges.pop((c["fromId"], c["toId"]), None)
            elif op == "profile.upsert":
                r = c["profile"]
                self.profiles[r["id"]] = (r, fingerprint(r))
            elif op == "profile.delete":
                self.profiles.pop(c["tableId"], None)
