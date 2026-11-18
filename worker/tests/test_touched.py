import pytest

from monorail_worker import protocol as P
from monorail_worker.lineage import edges_from_response
from monorail_worker.state import ReplicaState
from monorail_worker.touched import (
    Deleted,
    EdgeDelete,
    EdgeDeleteByName,
    EdgeRead,
    EdgesOf,
    EntityById,
    EntityByName,
    FieldsPolicy,
    NeedResync,
    Resync,
    materialize,
    resolve,
)

A = "0a51e62b-5121-48a5-8aa6-86888b01be67"
B = "7f517ae8-6d8e-446d-83fc-05f88a445bd4"
U = "11111111-2222-3333-4444-555555555555"
HREF = f"http://localhost:8585/api/v1/tables/{A}"


@pytest.mark.parametrize(
    "method,path,query,body,status,resp,expected",
    [
        # entity writes: the response's href / id
        ("PATCH", f"/tables/{A}", None, [{"op": "replace", "path": "/description", "value": "x"}], 200, {"id": A, "href": HREF}, [EntityById("tables", A)]),
        ("PUT", "/tables", None, {"name": "t"}, 200, {"id": A, "href": HREF}, [EntityById("tables", A)]),
        ("PUT", "/glossaryTerms", None, {"name": "t"}, 200, {"id": A}, [EntityById("glossaryTerms", A)]),
        ("PUT", "/dataQuality/testCases", None, {}, 200, {"id": A, "href": f"http://x/api/v1/dataQuality/testCases/{A}"}, [EntityById("dataQuality/testCases", A)]),
        ("PATCH", "/tables/name/a.b.c", None, [], 200, {"id": A}, [EntityById("tables", A)]),
        ("PATCH", "/tables/name/a.b.c", None, [], 200, None, [EntityByName("tables", "a.b.c")]),
        # create (201) also re-reads parents whose derived fields change
        (
            "PUT",
            "/glossaryTerms",
            None,
            {},
            201,
            {"id": A, "glossary": {"id": B, "type": "glossary"}, "parent": {"id": U, "type": "glossaryTerm"}},
            [EntityById("glossaryTerms", A), EntityById("glossaries", B), EntityById("glossaryTerms", U)],
        ),
        # sub-resources of a table: the table
        ("PUT", f"/tables/{A}/sampleData", None, {}, 200, {"id": A, "href": HREF}, [EntityById("tables", A)]),
        ("PUT", f"/tables/{A}/tableProfile", None, {}, 201, None, [EntityById("tables", A)]),
        # followers and votes: the parent entity
        ("PUT", f"/tables/{A}/followers", None, B, 200, {"changeDescription": {}}, [EntityById("tables", A)]),
        ("DELETE", f"/tables/{A}/followers/{B}", None, None, 200, {}, [EntityById("tables", A)]),
        ("PUT", f"/glossaryTerms/{A}/votes", None, {"updatedVoteType": "votedUp"}, 200, {}, [EntityById("glossaryTerms", A)]),
        # lineage
        ("PUT", "/lineage", None, {"edge": {"fromEntity": {"id": A, "type": "table"}, "toEntity": {"id": B, "type": "metric"}}}, 200, None, [EdgeRead("table", A, B)]),
        ("PUT", "/lineage", None, {"edge": {"fromEntity": {"fqn": "x"}, "toEntity": {"fqn": "y"}}}, 200, None, [Resync()]),
        ("DELETE", f"/lineage/table/{A}/table/{B}", None, None, 200, None, [EdgeDelete(A, B)]),
        ("PATCH", f"/lineage/table/{A}/table/{B}", None, [], 200, None, [EdgeRead("table", A, B)]),
        ("DELETE", "/lineage/table/name/a.b.c/table/name/a.b.d", None, None, 200, None, [EdgeDeleteByName("table", "a.b.c", "table", "a.b.d")]),
        ("DELETE", f"/lineage/table/{A}/type/ViewLineage", None, None, 200, None, [Resync()]),
        # data product assets: the product and each asset (types the replica doesn't hold are skipped)
        (
            "PUT",
            "/dataProducts/revenue/assets/add",
            None,
            {"assets": [{"id": A, "type": "table"}, {"id": B, "type": "dashboard"}]},
            200,
            {"status": "success"},
            [EntityByName("dataProducts", "revenue"), EntityById("tables", A)],
        ),
        ("PUT", f"/domains/{U}/assets/remove", None, {"assets": [{"id": A, "type": "table"}]}, 200, {}, [EntityById("domains", U), EntityById("tables", A)]),
        # test case results: the test case (and its suites)
        ("POST", "/dataQuality/testCases/testCaseResults/a.b.c.t", None, {"timestamp": 1}, 200, {}, [EntityByName("dataQuality/testCases", "a.b.c.t", related=True)]),
        ("DELETE", "/dataQuality/testCases/testCaseResults/a.b.c.t/1700", None, None, 200, {}, [EntityByName("dataQuality/testCases", "a.b.c.t", related=True)]),
        # activity feed: nothing for the replica
        ("POST", "/feed", None, {"message": "hi"}, 201, {"id": A}, []),
        ("POST", f"/feed/{A}/posts", None, {"message": "hi"}, 201, {"id": A}, []),
        ("PATCH", f"/feed/{A}", None, [], 200, {"id": A}, []),
        # usage
        ("POST", f"/usage/table/{A}", None, {"date": "2026-11-17", "count": 3}, 201, {}, [EntityById("tables", A)]),
        ("POST", "/usage/table/name/a.b.c", None, {}, 201, {}, [EntityByName("tables", "a.b.c")]),
        ("POST", "/usage/compute.percentile/table/2026-11-17", None, {}, 201, {}, [Resync()]),
        # deletes
        ("DELETE", f"/tables/{A}", {"hardDelete": "true"}, None, 200, {"id": A, "databaseSchema": {"id": B, "type": "databaseSchema"}}, [Deleted("table", A), EntityById("databaseSchemas", B)]),
        ("DELETE", "/glossaryTerms/name/Business.Revenue", None, None, 200, {"id": A}, [Deleted("glossaryTerm", A)]),
        ("DELETE", f"/databaseSchemas/{A}", {"recursive": "true"}, None, 200, {"id": A}, [Resync()]),
        ("DELETE", "/glossaryTerms/name/x", None, None, 200, None, [Resync()]),
        # restore
        ("PUT", "/tables/restore", None, {"id": A}, 200, {"id": A}, [EntityById("tables", A), EdgesOf("table", A)]),
        # renames change FQNs elsewhere
        ("PATCH", f"/glossaryTerms/{A}", None, [{"op": "replace", "path": "/name", "value": "New"}], 200, {"id": A}, [Resync()]),
        # bulk and imports
        ("PUT", "/glossaries/name/Business/import", {"dryRun": "false"}, "csv", 200, {}, [Resync()]),
        # ingestion pipeline actions keyed by id
        ("POST", f"/services/ingestionPipelines/deploy/{A}", None, None, 200, {"code": 200}, [EntityById("services/ingestionPipelines", A)]),
        # unknown shapes: resync rather than guess
        ("PUT", "/tables/whatever", None, {}, 200, {"status": "ok"}, [Resync()]),
        ("PUT", "/dataQuality/testCases/testCaseIncidentStatus", None, {}, 200, {"stateId": "x"}, [Resync()]),
    ],
)
def test_resolve(method, path, query, body, status, resp, expected):
    assert resolve(method, path, query, body, status, resp) == expected


def test_resolve_ignores_reads_and_failures():
    assert resolve("GET", f"/tables/{A}", None, None, 200, {"id": A}) == []
    assert resolve("PATCH", f"/tables/{A}", None, [], 400, {"message": "bad"}) == []


def test_lineage_response_with_sql_query_key():
    resp = {
        "nodes": {
            "p.d.s.orders": {"entity": {"id": A, "fullyQualifiedName": "p.d.s.orders", "entityType": "table"}},
            "p.d.s.daily": {"entity": {"id": B, "fullyQualifiedName": "p.d.s.daily", "entityType": "table", "lineageSqlQueries": {"1": "select 1"}}},
        },
        "upstreamEdges": {},
        "downstreamEdges": {
            "p.d.s.orders--->p.d.s.daily": {
                "fromEntity": {"id": A, "fullyQualifiedName": "p.d.s.orders", "type": "table", "fqnHash": "h"},
                "toEntity": {"id": B, "fullyQualifiedName": "p.d.s.daily", "type": "table", "fqnHash": "h"},
                "sqlQueryKey": "1",
                "columns": [{"fromColumns": ["a"], "toColumn": "b"}],
                "source": "ViewLineage",
                "docId": "x",
            }
        },
    }
    [e] = edges_from_response(resp)
    assert e == {
        "fromEntity": {"id": A, "type": "table", "fullyQualifiedName": "p.d.s.orders"},
        "toEntity": {"id": B, "type": "table", "fullyQualifiedName": "p.d.s.daily"},
        "sqlQuery": "select 1",
        "source": "ViewLineage",
        "columns": [{"fromColumns": ["a"], "toColumn": "b"}],
    }


def test_lineage_response_v1_shape():
    resp = {
        "entity": {"id": A, "type": "table", "fullyQualifiedName": "x.a"},
        "nodes": [{"id": B, "type": "metric", "fullyQualifiedName": "m"}],
        "upstreamEdges": [],
        "downstreamEdges": [{"fromEntity": A, "toEntity": B, "lineageDetails": {"sqlQuery": "q", "source": "Manual", "columnsLineage": []}}],
    }
    [e] = edges_from_response(resp)
    assert e["toEntity"] == {"id": B, "type": "metric", "fullyQualifiedName": "m"} and e["sqlQuery"] == "q"


# ---------- materialize against the fake OpenMetadata ----------
def test_materialize_upsert_carries_whole_entity(om, catalog):
    t = catalog["a"]
    [c] = materialize([EntityById("tables", t["id"])], om, ReplicaState(), FieldsPolicy())
    assert c["op"] == "upsert" and c["entityType"] == "table"
    assert c["entity"]["id"] == t["id"] and c["entity"]["description"] == "Orders." and c["entity"]["fullyQualifiedName"] == t["fullyQualifiedName"]


def test_materialize_soft_deleted_becomes_delete_with_its_edges(om, catalog):
    state = ReplicaState()
    state.apply([P.lineage_upsert({"fromEntity": {"id": catalog["a"]["id"]}, "toEntity": {"id": catalog["b"]["id"]}})])
    om.entities["tables"][catalog["a"]["id"]]["deleted"] = True
    changes = materialize([EntityById("tables", catalog["a"]["id"])], om, state, FieldsPolicy())
    assert changes == [P.delete("table", catalog["a"]["id"]), P.lineage_delete(catalog["a"]["id"], catalog["b"]["id"])]


def test_materialize_edge_read_and_delete(om, catalog):
    a, b = catalog["a"]["id"], catalog["b"]["id"]
    [c] = materialize([EdgeRead("table", a, b)], om, ReplicaState(), FieldsPolicy())
    assert c["op"] == "lineage.upsert" and c["edge"]["sqlQuery"] == "select * from orders"
    del om.edges[(a, b)]
    assert materialize([EdgeRead("table", a, b)], om, ReplicaState(), FieldsPolicy()) == [P.lineage_delete(a, b)]


def test_materialize_edge_delete_by_name(om, catalog):
    a, b = catalog["a"], catalog["b"]
    out = materialize([EdgeDeleteByName("table", a["fullyQualifiedName"], "table", b["fullyQualifiedName"])], om, ReplicaState(), FieldsPolicy())
    assert out == [P.lineage_delete(a["id"], b["id"])]


def test_materialize_resync_raises(om):
    with pytest.raises(NeedResync):
        materialize([Resync()], om, ReplicaState(), FieldsPolicy())


def test_materialize_skip_unchanged(om, catalog):
    state = ReplicaState()
    [c] = materialize([EntityById("tables", catalog["a"]["id"])], om, state, FieldsPolicy())
    state.apply([c])
    assert materialize([EntityById("tables", catalog["a"]["id"])], om, state, FieldsPolicy(), skip_unchanged=True) == []


def test_materialize_related_test_suites(om):
    suite = om.add("dataQuality/testSuites", "t.testSuite")
    tc = om.add("dataQuality/testCases", "tc", parent_fqn="a.b.c", testSuites=[{"id": suite["id"], "type": "testSuite"}])
    out = materialize([EntityByName("dataQuality/testCases", tc["fullyQualifiedName"], related=True)], om, ReplicaState(), FieldsPolicy())
    assert [(c["entityType"], c["entity"]["id"]) for c in out] == [("testCase", tc["id"]), ("testSuite", suite["id"])]
