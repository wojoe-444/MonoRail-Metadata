"""The shapes in docs/team-backend.md: requests, replies, feed events, snapshot manifest, heartbeat, lease.

Requests are validated (they come from apps); everything the worker writes is built here so the
JSON matches the contract exactly.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

V = 1

# ---------- bucket keys ----------
INBOX = "inbox/"
OUTBOX = "outbox/"
FEED = "feed/"
HEAD = "feed/head.json"
CATALOG = "state/catalog/"
MANIFEST = "state/catalog/manifest.json"
HEARTBEAT = "system/heartbeat.json"
LEASE = "system/lease.json"
CURSOR = "system/cursor.json"


def inbox_key(rid: str) -> str:
    return f"{INBOX}{rid}.json"


def outbox_key(rid: str) -> str:
    return f"{OUTBOX}{rid}.json"


def feed_key(seq: int) -> str:
    return f"{FEED}{seq:012d}.json"


def parse_feed_key(key: str) -> int | None:
    name = key.removeprefix(FEED).removesuffix(".json")
    return int(name) if name.isdigit() and len(name) == 12 else None


# ---------- request ----------
class GoogleAuth(BaseModel):
    kind: Literal["google"]
    idToken: str = Field(min_length=1)


class LocalAuth(BaseModel):
    kind: Literal["local"]
    user: str = Field(min_length=1, max_length=320)


class Request(BaseModel):
    model_config = ConfigDict(extra="ignore")

    v: Literal[1]
    id: str
    ts: int
    auth: GoogleAuth | LocalAuth = Field(discriminator="kind")
    op: Literal["om", "echo", "resync"]
    method: str | None = None
    path: str | None = None
    query: dict[str, str | int | float | bool | list[str]] | None = None
    headers: dict[str, str] | None = None
    body: Any = None
    client: dict[str, Any] | None = None

    @field_validator("method")
    @classmethod
    def _upper(cls, v: str | None) -> str | None:
        return v.upper() if v else v


# ---------- reply ----------
ErrorCode = Literal["forbidden", "unauthenticated", "invalid", "internal", "expired"]


def reply(
    rid: str,
    ts: int,
    *,
    status: int,
    body: Any = None,
    by: str | None = None,
    feed_seq: int | None = None,
    error: tuple[ErrorCode, str] | None = None,
) -> dict[str, Any]:
    return {
        "v": V,
        "id": rid,
        "ts": ts,
        "ok": status < 400,
        "status": status,
        "body": body,
        "error": {"code": error[0], "message": error[1]} if error else None,
        "by": by,
        "feedSeq": feed_seq,
    }


# ---------- feed ----------
Source = Literal["request", "om-events", "resync"]


def upsert(entity_type: str, entity: dict[str, Any]) -> dict[str, Any]:
    return {"op": "upsert", "entityType": entity_type, "entity": entity}


def delete(entity_type: str, eid: str) -> dict[str, Any]:
    return {"op": "delete", "entityType": entity_type, "id": eid}


def lineage_upsert(edge: dict[str, Any]) -> dict[str, Any]:
    return {"op": "lineage.upsert", "edge": edge}


def lineage_delete(from_id: str, to_id: str) -> dict[str, Any]:
    return {"op": "lineage.delete", "fromId": from_id, "toId": to_id}


RESYNC = {"op": "resync"}


def feed_event(
    seq: int, ts: int, *, by: str | None, request_id: str | None, source: Source, changes: list[dict[str, Any]]
) -> dict[str, Any]:
    return {"seq": seq, "ts": ts, "by": by, "requestId": request_id, "source": source, "changes": changes}


def head(seq: int, ts: int) -> dict[str, Any]:
    return {"seq": seq, "ts": ts}


# ---------- snapshot ----------
def manifest(
    seq: int, ts: int, om_version: str, entities: list[dict[str, Any]], lineage_file: str, lineage_count: int
) -> dict[str, Any]:
    return {
        "v": V,
        "seq": seq,
        "ts": ts,
        "omVersion": om_version,
        "files": {"entities": entities, "lineage": {"file": lineage_file, "count": lineage_count}},
    }


# ---------- liveness ----------
def heartbeat(
    *,
    worker: str,
    ts: int,
    started_at: int,
    seq: int,
    om_url: str,
    om_version: str,
    version: str,
    inbox_backlog: int,
    role: Literal["leader", "standby"],
) -> dict[str, Any]:
    return {
        "worker": worker,
        "ts": ts,
        "startedAt": started_at,
        "seq": seq,
        "omUrl": om_url,
        "omVersion": om_version,
        "version": version,
        "inboxBacklog": inbox_backlog,
        "role": role,
    }


def lease(holder: str, expires: int) -> dict[str, Any]:
    return {"holder": holder, "expires": expires}
