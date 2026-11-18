"""What the worker believes apps' replicas hold: a fingerprint of every entity and every lineage edge.

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

    def load(self, entities: dict[str, list[dict[str, Any]]], edges: list[Edge]) -> None:
        self.entities.clear()
        self.versions.clear()
        self.edges.clear()
        for etype, items in entities.items():
            for e in items:
                self._put(etype, e)
        for edge in edges:
            self.edges[edge_key(edge)] = (edge, fingerprint(edge))

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
            elif op == "lineage.upsert":
                self.edges[edge_key(c["edge"])] = (c["edge"], fingerprint(c["edge"]))
            elif op == "lineage.delete":
                self.edges.pop((c["fromId"], c["toId"]), None)
