"""Test doubles: an in-memory OpenMetadata (the endpoints the worker uses, in 2.0.8's shapes)."""

from __future__ import annotations

import base64
import copy
import uuid
from typing import Any, Mapping
from urllib.parse import unquote

from monorail_worker.entities import COLLECTIONS, split_collection
from monorail_worker.om import NO_BODY, OmResponse


class Crash(BaseException):
    """Simulates the process dying: not an Exception, so the worker's error handling doesn't catch it."""


def b64(n: int) -> str:
    return base64.b64encode(str(n).encode()).decode()


class FakeOm:
    url = "http://fake-om:8585"

    def __init__(self) -> None:
        self.entities: dict[str, dict[str, dict[str, Any]]] = {c: {} for c in COLLECTIONS}
        self.edges: dict[tuple[str, str], dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []  # each has "_offset"
        self.calls: list[tuple[str, str]] = []
        self.crash_after: tuple[str, str] | None = None  # (method, path prefix): apply, then Crash
        self.reject_star: set[str] = set()  # collections that answer 400 to fields=*

    # ---------- setup ----------
    def add(self, coll: str, name: str, **fields: Any) -> dict[str, Any]:
        eid = fields.pop("id", None) or str(uuid.uuid4())
        parent = fields.pop("parent_fqn", None)
        fqn = f"{parent}.{name}" if parent else name
        e = {
            "id": eid,
            "name": name,
            "fullyQualifiedName": fqn,
            "version": 0.1,
            "updatedAt": 1,
            "href": f"{self.url}/api/v1/{coll}/{eid}",
            "deleted": False,
            **fields,
        }
        self.entities[coll][eid] = e
        return e

    def emit(self, event_type: str, entity_type: str, entity_id: str, version: float = 0.1, user: str = "ingestion-bot") -> dict[str, Any]:
        ev = {
            "id": str(uuid.uuid4()),
            "eventType": event_type,
            "entityType": entity_type,
            "entityId": entity_id,
            "currentVersion": version,
            "userName": user,
            "timestamp": 2_000_000_000_000 + len(self.events),
            "_offset": len(self.events) + 1,
        }
        self.events.append(ev)
        return ev

    def find(self, eid: str) -> tuple[str, dict[str, Any]] | None:
        for c, items in self.entities.items():
            if eid in items:
                return c, items[eid]
        return None

    def by_fqn(self, coll: str, fqn: str) -> dict[str, Any] | None:
        return next((e for e in self.entities[coll].values() if e["fullyQualifiedName"] == fqn), None)

    def _bump(self, e: dict[str, Any]) -> None:
        e["version"] = round(e["version"] + 0.1, 1)
        e["updatedAt"] = e["updatedAt"] + 1

    # ---------- the API ----------
    def request(
        self, method: str, path: str, query: Mapping[str, Any] | None = None, headers: Mapping[str, str] | None = None, body: Any = NO_BODY
    ) -> OmResponse:
        self.calls.append((method, path))
        res = self._route(method, path, dict(query or {}), body)
        if self.crash_after and method == self.crash_after[0] and path.startswith(self.crash_after[1]):
            self.crash_after = None
            raise Crash(f"crash after {method} {path}")
        return res

    def _route(self, method: str, path: str, q: dict[str, Any], body: Any) -> OmResponse:
        segs = [unquote(s) for s in path.split("/") if s]
        if path == "/system/version":
            return OmResponse(200, {"version": "2.0.8"})
        if path == "/events":
            return self._events(q)
        if segs and segs[0] == "lineage":
            return self._lineage(method, segs, q, body)
        coll, rest = split_collection(path)
        if coll is None:
            return OmResponse(404, {"message": "no route"})
        items = self.entities[coll]
        if method == "GET":
            if q.get("fields") == "*" and coll in self.reject_star:
                return OmResponse(400, {"message": "Invalid field name *"})
            if not rest:
                data = sorted(items.values(), key=lambda e: e["name"])
                limit = int(q.get("limit", 10))
                start = int(q["after"]) if q.get("after") else 0
                page = data[start : start + limit]
                nxt = str(start + limit) if start + limit < len(data) else None
                return OmResponse(200, {"data": copy.deepcopy(page), "paging": {"after": nxt, "total": len(data)} if nxt else {"total": len(data)}})
            e = self.by_fqn(coll, rest[1]) if rest[0] == "name" and len(rest) == 2 else items.get(rest[0])
            if e is None:
                return OmResponse(404, {"message": "not found"})
            if e.get("deleted") and q.get("include") != "all":
                return OmResponse(404, {"message": "not found"})
            return OmResponse(200, copy.deepcopy(e))
        if method == "PATCH" and len(rest) == 1:
            e = items.get(rest[0])
            if e is None:
                return OmResponse(404, {"message": "not found"})
            for op in body:
                key = op["path"].lstrip("/")
                if op["op"] in ("replace", "add"):
                    e[key] = op["value"]
                elif op["op"] == "remove":
                    e.pop(key, None)
            self._bump(e)
            return OmResponse(200, copy.deepcopy(e))
        if method == "PUT" and not rest:
            existing = next((x for x in items.values() if x["name"] == body["name"]), None)
            if existing:
                existing.update(body)
                self._bump(existing)
                return OmResponse(200, copy.deepcopy(existing))
            e = self.add(coll, **body)
            return OmResponse(201, copy.deepcopy(e))
        if method == "PUT" and len(rest) == 2 and rest[1] == "followers":
            e = items.get(rest[0])
            if e is None:
                return OmResponse(404, {"message": "not found"})
            e.setdefault("followers", []).append({"id": body, "type": "user"})
            return OmResponse(200, {"changeDescription": {"fieldsAdded": [{"name": "followers"}]}})
        if method == "PUT" and len(rest) == 3 and rest[1] == "assets":
            e = self.by_fqn(coll, rest[0])
            if e is None:
                return OmResponse(404, {"message": "not found"})
            for a in body["assets"]:
                if rest[2] == "add":
                    e.setdefault("assets", []).append(a)
                else:
                    e["assets"] = [x for x in e.get("assets", []) if x["id"] != a["id"]]
            return OmResponse(200, {"status": "success", "numberOfRowsProcessed": len(body["assets"])})
        if method == "DELETE" and len(rest) == 1:
            e = items.get(rest[0])
            if e is None:
                return OmResponse(404, {"message": "not found"})
            if q.get("hardDelete") == "true" or q.get("hardDelete") is True:
                del items[rest[0]]
            else:
                e["deleted"] = True
                self._bump(e)
            return OmResponse(200, copy.deepcopy(e))
        return OmResponse(404, {"message": f"no fake route for {method} {path}"})

    # ---------- lineage ----------
    def _node(self, eid: str) -> dict[str, Any]:
        found = self.find(eid)
        assert found, eid
        coll, e = found
        return {"id": eid, "type": COLLECTIONS[coll], "fullyQualifiedName": e["fullyQualifiedName"], "name": e["name"]}

    def _lineage(self, method: str, segs: list[str], q: dict[str, Any], body: Any) -> OmResponse:
        if method == "PUT" and len(segs) == 1:
            edge = body["edge"]
            f, t = edge["fromEntity"]["id"], edge["toEntity"]["id"]
            self.edges[(f, t)] = dict(edge.get("lineageDetails") or {})
            return OmResponse(200, None)
        if method == "DELETE" and len(segs) == 5:
            if self.edges.pop((segs[2], segs[4]), None) is None:
                return OmResponse(404, {"message": "no edge"})
            return OmResponse(200, None)
        if method == "GET" and len(segs) == 2 and segs[1] == "getLineage":
            root = self.by_fqn(_coll_of(q["type"]), q["fqn"])
            if root is None:
                return OmResponse(404, {"message": "not found"})
            nodes: dict[str, Any] = {}
            up: dict[str, Any] = {}
            down: dict[str, Any] = {}
            sql_keys: dict[str, dict[str, str]] = {}
            for (f, t), d in self.edges.items():
                if root["id"] not in (f, t):
                    continue
                fn, tn = self._node(f), self._node(t)
                e: dict[str, Any] = {"fromEntity": fn, "toEntity": tn, "source": d.get("source"), "columns": d.get("columnsLineage", [])}
                if d.get("sqlQuery"):
                    # Like 2.0.8: the SQL lives in the target node's lineageSqlQueries, the edge has a key.
                    keys = sql_keys.setdefault(t, {})
                    k = str(len(keys) + 1)
                    keys[k] = d["sqlQuery"]
                    e["sqlQueryKey"] = k
                key = f'{fn["fullyQualifiedName"]}--->{tn["fullyQualifiedName"]}'
                (down if f == root["id"] else up)[key] = e
                for n in (fn, tn):
                    nodes[n["fullyQualifiedName"]] = {"entity": {**n, "entityType": n["type"]}}
            for t, keys in sql_keys.items():
                n = self._node(t)
                nodes[n["fullyQualifiedName"]]["entity"]["lineageSqlQueries"] = keys
            return OmResponse(200, {"nodes": nodes, "upstreamEdges": up, "downstreamEdges": down})
        if method == "GET" and len(segs) == 3:
            eid = segs[2]
            if self.find(eid) is None:
                return OmResponse(404, {"message": "not found"})
            down_edges = [
                {"fromEntity": f, "toEntity": t, "lineageDetails": dict(d)} for (f, t), d in self.edges.items() if f == eid
            ]
            nodes = [self._node(t) for (f, t) in self.edges if f == eid]
            return OmResponse(200, {"entity": self._node(eid), "nodes": nodes, "upstreamEdges": [], "downstreamEdges": down_edges})
        return OmResponse(404, {"message": "no lineage route"})

    # ---------- change events ----------
    def _events(self, q: dict[str, Any]) -> OmResponse:
        after = int(base64.b64decode(q["after"]).decode()) if q.get("after") else 0
        ts = int(q.get("timestamp", 0))
        limit = int(q.get("limit", 100))
        matching = [e for e in self.events if e["_offset"] > after and e["timestamp"] >= ts]
        page = matching[:limit]
        has_more = len(matching) > limit
        data = [{k: v for k, v in e.items() if k != "_offset"} for e in page]
        paging: dict[str, Any] = {"total": len(data)}
        if has_more and page:
            paging["after"] = b64(page[-1]["_offset"])
        return OmResponse(200, {"data": data, "paging": paging})


def _coll_of(entity_type: str) -> str:
    from monorail_worker.entities import TYPE_TO_COLLECTION

    return TYPE_TO_COLLECTION[entity_type]


def seed(om: FakeOm) -> dict[str, dict[str, Any]]:
    """A tiny BigQuery-shaped catalog."""
    svc = om.add(
        "services/databaseServices",
        "bigquery",
        serviceType="BigQuery",
        connection={
            "config": {
                "type": "BigQuery",
                "hostPort": "bigquery.googleapis.com",
                "credentials": {"gcpConfig": {"type": "service_account", "projectId": "acme", "privateKey": "-----BEGIN PRIVATE KEY-----x", "clientEmail": "sa@acme.iam"}},
                "usageLocation": "us",
                "connectionArguments": {"password": "hunter2"},
                "supportsUsageExtraction": True,
            }
        },
    )
    db = om.add("databases", "acme", parent_fqn="bigquery", service={"id": svc["id"], "type": "databaseService"})
    sch = om.add("databaseSchemas", "marts", parent_fqn="bigquery.acme", database={"id": db["id"], "type": "database"})
    a = om.add("tables", "orders", parent_fqn="bigquery.acme.marts", description="Orders.", databaseSchema={"id": sch["id"], "type": "databaseSchema"})
    b = om.add("tables", "daily", parent_fqn="bigquery.acme.marts", description="Daily.", databaseSchema={"id": sch["id"], "type": "databaseSchema"})
    om.edges[(a["id"], b["id"])] = {"sqlQuery": "select * from orders", "source": "QueryLineage", "columnsLineage": [{"fromColumns": ["x.a"], "toColumn": "y.a"}]}
    user = om.add("users", "ada.park", email="ada@example.com", authenticationMechanism={"authType": "JWT", "config": {"JWTToken": "eyJ.secret"}})
    pipe = om.add(
        "services/ingestionPipelines",
        "bigquery_metadata",
        parent_fqn="bigquery",
        openMetadataServerConnection={"hostPort": "http://om", "securityConfig": {"jwtToken": "eyJ.bot"}},
        sourceConfig={"config": {"type": "DatabaseMetadata"}},
    )
    dp = om.add("dataProducts", "revenue", assets=[])
    return {"service": svc, "db": db, "schema": sch, "a": a, "b": b, "user": user, "pipeline": pipe, "dp": dp}
