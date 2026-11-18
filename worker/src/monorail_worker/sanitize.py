"""Keep secrets out of everything the worker writes to the bucket (snapshot, feed, replies).

- Service `connection.config` keeps only an allowlist of non-secret fields (type, host, project
  ids, locations, capability flags). For GCP credentials only `gcpConfig.type` and `projectId` stay.
- Ingestion pipelines lose `openMetadataServerConnection` (it holds the bot's JWT).
- Everywhere else, keys that name secrets (passwords, tokens, private keys, credentials, auth
  mechanisms, security configs) are dropped, at any depth.
"""

from __future__ import annotations

import re
from typing import Any

SAFE_CONFIG_KEYS = {
    "type",
    "scheme",
    "hostPort",
    "host",
    "port",
    "database",
    "databaseName",
    "databaseSchema",
    "usageLocation",
    "taxonomyLocation",
    "taxonomyProjectID",
    "includePolicyTags",
    "billingProjectId",
    "costPerTB",
    "projectId",
    "region",
    "location",
}
SAFE_GCP_KEYS = {"type", "projectId"}

_SECRET_EXACT = {
    "token",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "jwttoken",
    "authenticationmechanism",
    "authmechanism",
    "securityconfig",
    "sslconfig",
    "openmetadataserverconnection",
    "connectionarguments",
    "connectionoptions",
    "authconfig",
}
_SECRET_RE = re.compile(r"password|secret|private_?key|api_?key|access_?key|credential|jwt|security_?config|ssl_?config", re.IGNORECASE)


def _secret_key(k: str) -> bool:
    return k.lower() in _SECRET_EXACT or bool(_SECRET_RE.search(k))


def safe_connection_config(cfg: Any) -> Any:
    if not isinstance(cfg, dict):
        return None
    out: dict[str, Any] = {}
    for k, v in cfg.items():
        if k in SAFE_CONFIG_KEYS or (k.startswith("supports") and isinstance(v, bool)):
            if not isinstance(v, (dict, list)) or k == "projectId":
                out[k] = v
    gcp = (cfg.get("credentials") or {}).get("gcpConfig") if isinstance(cfg.get("credentials"), dict) else None
    if isinstance(gcp, dict):
        out["credentials"] = {"gcpConfig": {k: gcp[k] for k in SAFE_GCP_KEYS if k in gcp}}
    return out


def scrub(value: Any) -> Any:
    """A copy of `value` with secret-named keys removed, at any depth."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if isinstance(k, str) and _secret_key(k):
                continue
            if k == "connection" and isinstance(v, dict) and "config" in v:
                conn = {kk: scrub(vv) for kk, vv in v.items() if kk != "config" and not _secret_key(kk)}
                conn["config"] = safe_connection_config(v["config"])
                out[k] = conn
                continue
            out[k] = scrub(v)
        return out
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


def entity(e: Any) -> Any:
    """The form an entity takes in the bucket."""
    return scrub(e)
