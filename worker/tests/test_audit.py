"""The BigQuery audit sink against a fake client (no BigQuery on this machine)."""

import json

from google.cloud import bigquery

from monorail_worker import protocol as P
from monorail_worker.audit import INSERT_SQL, BigQueryAudit, rows_for


class FakeJob:
    def result(self):
        return []


class FakeBq:
    project = "acme-analytics"

    def __init__(self, existing_schema=None):
        self.tables = []
        self.queries = []
        self.updates = []
        self.existing_schema = existing_schema  # the schema of a table that already exists

    def create_table(self, table, exists_ok=False):
        self.tables.append((table, exists_ok))
        if self.existing_schema is None:
            self.existing_schema = list(table.schema)
        return table

    def get_table(self, table_id):
        t = bigquery.Table(table_id, schema=self.existing_schema)
        return t

    def update_table(self, table, fields):
        self.updates.append((table, fields))
        self.existing_schema = list(table.schema)
        return table

    def query(self, sql, job_config=None):
        self.queries.append((sql, job_config))
        return FakeJob()


EVENT = P.feed_event(
    7,
    1794956001300,
    by="ada'; DROP TABLE x; --",
    request_id="01JD3X8Q4M2N7T6R5V9W0YZABC",
    source="request",
    changes=[
        P.upsert("table", {"id": "t1", "description": "It's \"quoted\""}),
        P.delete("glossaryTerm", "g1"),
        P.lineage_upsert({"fromEntity": {"id": "a"}, "toEntity": {"id": "b"}}),
    ],
)


def test_rows_one_per_change():
    rows = rows_for(EVENT)
    assert [(r["op"], r["entity_type"], r["entity_id"]) for r in rows] == [
        ("upsert", "table", "t1"),
        ("delete", "glossaryTerm", "g1"),
        ("lineage.upsert", "lineageEdge", "a->b"),
    ]
    assert json.loads(rows[0]["entity"])["description"] == 'It\'s "quoted"'
    assert rows[1]["entity"] is None
    assert all(r["seq"] == 7 and r["request_id"] == EVENT["requestId"] for r in rows)


def test_table_created_partitioned_and_clustered():
    fake = FakeBq()
    sink = BigQueryAudit("team_metadata", client=fake)
    sink.ensure_table()
    sink.ensure_table()  # only once
    assert len(fake.tables) == 1
    table, exists_ok = fake.tables[0]
    assert exists_ok and table.table_id == "metadata_events" and table.dataset_id == "team_metadata" and table.project == "acme-analytics"
    assert table.time_partitioning.type_ == "DAY" and table.time_partitioning.field == "ts"
    assert table.clustering_fields == ["entity_type", "entity_id"]
    assert {f.name: f.field_type for f in table.schema}["entity"] == "JSON"


def test_insert_is_parameterized():
    fake = FakeBq()
    BigQueryAudit("other-project.team_metadata", client=fake).record(EVENT)
    [(sql, config)] = fake.queries
    assert sql == INSERT_SQL.format(table="other-project.team_metadata.metadata_events")
    # No values in the SQL text, only parameters.
    for leak in ("ada'", "DROP", "t1", "quoted", "01JD3X"):
        assert leak not in sql
    [param] = config.query_parameters
    assert isinstance(param, bigquery.ArrayQueryParameter) and param.name == "rows"
    api = param.to_api_repr()
    first = api["parameterValue"]["arrayValues"][0]["structValues"]
    assert first["by"]["value"] == "ada'; DROP TABLE x; --"
    assert first["seq"]["value"] == "7" and first["entity_type"]["value"] == "table"


def test_rows_carry_by_user_and_profiles():
    ev = P.feed_event(
        8,
        1,
        by="ada@acme.com",
        by_user={"id": "u1", "name": "ada.park"},
        request_id=None,
        source="request",
        changes=[P.profile_upsert({"id": "t1", "fullyQualifiedName": "a.b.c.t", "profile": {"rowCount": 3}, "columns": []}), P.profile_delete("t2")],
    )
    rows = rows_for(ev)
    assert [(r["op"], r["entity_type"], r["entity_id"]) for r in rows] == [("profile.upsert", "tableProfile", "t1"), ("profile.delete", "tableProfile", "t2")]
    assert all(r["by"] == "ada@acme.com" and r["by_user_id"] == "u1" and r["by_user_name"] == "ada.park" for r in rows)
    assert all(r["by_user_id"] is None for r in rows_for(EVENT))


def test_new_columns_added_to_an_existing_table():
    old = [
        bigquery.SchemaField(n, t)
        for n, t in [("seq", "INT64"), ("ts", "TIMESTAMP"), ("by", "STRING"), ("request_id", "STRING"), ("source", "STRING"), ("entity_type", "STRING"), ("entity_id", "STRING"), ("op", "STRING"), ("entity", "JSON")]
    ]
    fake = FakeBq(existing_schema=old)
    BigQueryAudit("team_metadata", client=fake).ensure_table()
    [(table, fields)] = fake.updates
    assert fields == ["schema"]
    assert [f.name for f in table.schema][-2:] == ["by_user_id", "by_user_name"]
    # A current table is left alone.
    fresh = FakeBq()
    BigQueryAudit("team_metadata", client=fresh).ensure_table()
    assert fresh.updates == []


def test_insert_sends_by_user():
    fake = FakeBq()
    ev = {**EVENT, "byUser": {"id": "u1", "name": "ada.park"}}
    BigQueryAudit("team_metadata", client=fake).record(ev)
    [(sql, config)] = fake.queries
    assert "by_user_id" in sql and "u1" not in sql
    first = config.query_parameters[0].to_api_repr()["parameterValue"]["arrayValues"][0]["structValues"]
    assert first["by_user_id"]["value"] == "u1" and first["by_user_name"]["value"] == "ada.park"
