"""Optional BigQuery audit trail (docs/team-backend.md, "BigQuery").

One row per change in each feed event, in `{dataset}.metadata_events`, partitioned by day on `ts`
and clustered by `entity_type, entity_id`. Rows go in with a parameterized DML insert: values are
query parameters, never SQL text (other teams in the project can read query history).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol

log = logging.getLogger(__name__)

TABLE = "metadata_events"

INSERT_SQL = (
    "INSERT INTO `{table}` (seq, ts, `by`, request_id, source, entity_type, entity_id, op, entity)\n"
    "SELECT r.seq, TIMESTAMP_MILLIS(r.ts), r.`by`, r.request_id, r.source, r.entity_type, r.entity_id, r.op,\n"
    "  SAFE.PARSE_JSON(r.entity)\n"
    "FROM UNNEST(@rows) AS r"
)


class AuditSink(Protocol):
    def record(self, event: dict[str, Any]) -> None: ...


class NoAudit:
    def record(self, event: dict[str, Any]) -> None:
        pass


def rows_for(event: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for c in event.get("changes") or [{"op": "none"}]:
        op = c.get("op")
        etype = eid = None
        entity: Any = None
        if op == "upsert":
            etype, eid, entity = c.get("entityType"), (c.get("entity") or {}).get("id"), c.get("entity")
        elif op == "delete":
            etype, eid = c.get("entityType"), c.get("id")
        elif op == "lineage.upsert":
            edge = c.get("edge") or {}
            etype, eid, entity = "lineageEdge", f'{edge.get("fromEntity", {}).get("id")}->{edge.get("toEntity", {}).get("id")}', edge
        elif op == "lineage.delete":
            etype, eid = "lineageEdge", f'{c.get("fromId")}->{c.get("toId")}'
        rows.append(
            {
                "seq": int(event["seq"]),
                "ts": int(event["ts"]),
                "by": event.get("by"),
                "request_id": event.get("requestId"),
                "source": event.get("source"),
                "entity_type": etype,
                "entity_id": eid,
                "op": op,
                "entity": json.dumps(entity) if entity is not None else None,
            }
        )
    return rows


class BigQueryAudit:
    """`client` is a google.cloud.bigquery.Client (or a fake with the same methods, in tests)."""

    def __init__(self, dataset: str, client: Any = None, project: str = "", location: str | None = None):
        from google.cloud import bigquery

        self.bq = bigquery
        self.client = client or bigquery.Client(project=project or None, location=location)
        ds = dataset if "." in dataset else f"{self.client.project}.{dataset}"
        self.table_id = f"{ds}.{TABLE}"
        self._ensured = False

    def ensure_table(self) -> None:
        if self._ensured:
            return
        bq = self.bq
        schema = [
            bq.SchemaField("seq", "INT64", mode="REQUIRED"),
            bq.SchemaField("ts", "TIMESTAMP", mode="REQUIRED"),
            bq.SchemaField("by", "STRING"),
            bq.SchemaField("request_id", "STRING"),
            bq.SchemaField("source", "STRING"),
            bq.SchemaField("entity_type", "STRING"),
            bq.SchemaField("entity_id", "STRING"),
            bq.SchemaField("op", "STRING"),
            bq.SchemaField("entity", "JSON"),
        ]
        table = bq.Table(self.table_id, schema=schema)
        table.time_partitioning = bq.TimePartitioning(type_=bq.TimePartitioningType.DAY, field="ts")
        table.clustering_fields = ["entity_type", "entity_id"]
        self.client.create_table(table, exists_ok=True)
        self._ensured = True

    def record(self, event: dict[str, Any]) -> None:
        self.ensure_table()
        bq = self.bq
        structs = [
            bq.StructQueryParameter(
                None,
                bq.ScalarQueryParameter("seq", "INT64", r["seq"]),
                bq.ScalarQueryParameter("ts", "INT64", r["ts"]),
                bq.ScalarQueryParameter("by", "STRING", r["by"]),
                bq.ScalarQueryParameter("request_id", "STRING", r["request_id"]),
                bq.ScalarQueryParameter("source", "STRING", r["source"]),
                bq.ScalarQueryParameter("entity_type", "STRING", r["entity_type"]),
                bq.ScalarQueryParameter("entity_id", "STRING", r["entity_id"]),
                bq.ScalarQueryParameter("op", "STRING", r["op"]),
                bq.ScalarQueryParameter("entity", "STRING", r["entity"]),
            )
            for r in rows_for(event)
        ]
        config = bq.QueryJobConfig(query_parameters=[bq.ArrayQueryParameter("rows", "STRUCT", structs)])
        self.client.query(INSERT_SQL.format(table=self.table_id), job_config=config).result()
