import json

from monorail_worker import sanitize, snapshot
from monorail_worker.touched import FieldsPolicy


SECRETS = ["PRIVATE KEY", "hunter2", "eyJ.secret", "eyJ.bot", "sa@acme.iam"]


def test_service_connection_keeps_only_safe_fields(catalog):
    svc = sanitize.entity(catalog["service"])
    cfg = svc["connection"]["config"]
    assert cfg == {
        "type": "BigQuery",
        "hostPort": "bigquery.googleapis.com",
        "usageLocation": "us",
        "supportsUsageExtraction": True,
        "credentials": {"gcpConfig": {"type": "service_account", "projectId": "acme"}},
    }


def test_nested_secret_keys_dropped():
    e = {
        "name": "x",
        "authenticationMechanism": {"config": {"JWTToken": "t"}},
        "openMetadataServerConnection": {"securityConfig": {"jwtToken": "t"}},
        "sourceConfig": {"config": {"dbtConfigSource": {"dbtSecurityConfig": {"gcpConfig": {"privateKey": "k"}}, "dbtCatalogFilePath": "gs://x"}}},
        "columns": [{"name": "password", "dataType": "STRING"}],  # a column *named* password is fine
        "tokenUri": "https://oauth2.googleapis.com/token",
        "apiKey": "k",
        "clientSecret": "s",
    }
    out = sanitize.scrub(e)
    assert "authenticationMechanism" not in out and "openMetadataServerConnection" not in out
    assert out["sourceConfig"]["config"]["dbtConfigSource"] == {"dbtCatalogFilePath": "gs://x"}
    assert out["columns"][0]["name"] == "password"
    assert "apiKey" not in out and "clientSecret" not in out
    assert e["apiKey"] == "k"  # input untouched


def test_snapshot_export_has_no_secrets(om, catalog):
    ex = snapshot.export(om, FieldsPolicy())
    blob = json.dumps(ex.entities)
    for s in SECRETS:
        assert s not in blob, s
    users = ex.entities["users"]
    assert users and "authenticationMechanism" not in users[0]
    pipes = ex.entities["services/ingestionPipelines"]
    assert pipes and "openMetadataServerConnection" not in pipes[0]


def test_snapshot_lineage_resolves_sql_query_key(om, catalog):
    ex = snapshot.export(om, FieldsPolicy())
    assert len(ex.edges) == 1  # seen from both tables, de-duplicated
    e = ex.edges[0]
    assert e["fromEntity"]["id"] == catalog["a"]["id"] and e["toEntity"]["id"] == catalog["b"]["id"]
    assert e["fromEntity"]["fullyQualifiedName"] == "bigquery.acme.marts.orders"
    assert e["sqlQuery"] == "select * from orders" and "sqlQueryKey" not in e
    assert e["columns"] == [{"fromColumns": ["x.a"], "toColumn": "y.a"}]
    assert e["source"] == "QueryLineage"


def test_snapshot_fields_fallback(om, catalog):
    om.reject_star.add("tables")
    fields = FieldsPolicy()
    ex = snapshot.export(om, fields)
    assert len(ex.entities["tables"]) == 2
    assert fields.get("tables") != "*"
    assert fields.get("databases") == "*"


def test_snapshot_pages(om, catalog, monkeypatch):
    for i in range(7):
        om.add("tags", f"t{i}", parent_fqn="PII")
    monkeypatch.setattr(snapshot, "PAGE", 3)
    ex = snapshot.export(om, FieldsPolicy())
    assert len(ex.entities["tags"]) == 7


def test_snapshot_write_then_manifest(storage, om, catalog):
    ex = snapshot.export(om, FieldsPolicy())
    order = []
    real_write = storage.write

    def spy(key, data, content_type="application/json"):
        order.append(key)
        return real_write(key, data, content_type)

    storage.write = spy
    man = snapshot.write(storage, ex, 12, 1000)
    assert order[-1] == "state/catalog/manifest.json"
    assert all(k.startswith("state/catalog/") for k in order)
    assert man["seq"] == 12 and man["omVersion"] == "2.0.8"
    tables = next(f for f in man["files"]["entities"] if f["path"] == "tables")
    assert tables == {"entityType": "table", "path": "tables", "file": "table.1000.json.gz", "count": 2}
    loaded = snapshot.load(storage)
    assert loaded and loaded[1].entities["tables"] == ex.entities["tables"] and loaded[1].edges == ex.edges
