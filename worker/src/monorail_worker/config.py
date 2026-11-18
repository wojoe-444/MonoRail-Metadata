"""Settings, from the environment and the repo-root `.env` (environment wins)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values

# worker/src/monorail_worker/config.py -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]


def _bool(v: str) -> bool:
    return v.strip().lower() in ("1", "true", "yes", "on")


def _split(v: str) -> list[str]:
    return [x.strip().lower() for x in v.replace(";", ",").split(",") if x.strip()]


@dataclass
class Settings:
    team_bucket: str
    om_url: str = ""
    om_token: str = ""
    om_email: str = ""
    om_password: str = ""
    team_auth: str = "local"  # local | google
    google_client_id: str = ""
    allowed_domains: list[str] = field(default_factory=list)
    allowed_emails: list[str] = field(default_factory=list)
    snapshot_minutes: float = 30
    om_events_seconds: float = 30
    request_ttl_minutes: float = 60
    bq_dataset: str = ""
    bq_project: str = ""
    poll_seconds: float = 1.0
    # Requests are listed from (cursor time - lookback), so an app whose clock is behind
    # the worker's by less than this still gets its request processed.
    inbox_lookback_seconds: float = 300
    retention_days: float = 7
    worker_id: str = ""
    team_user: str = "admin"  # identity the `echo`/`resync` CLI sends with TEAM_AUTH=local
    # Send om requests as the person (OpenMetadata's X-Impersonate-User); needs a bot token with allowImpersonation.
    impersonate: bool = False
    # Vertex AI successor jobs (vertex.py).
    vertex_successor: bool = False
    vertex_project: str = ""
    vertex_region: str = ""
    vertex_job_spec: str = ""  # a CustomJob as JSON, inline or a file path
    vertex_max_runtime_hours: float = 168
    vertex_lead_minutes: float = 60
    vertex_stop_minutes: float = 5

    @staticmethod
    def load(env: dict[str, str] | None = None, dotenv_path: Path | None = None) -> "Settings":
        if env is None:
            path = dotenv_path or REPO_ROOT / ".env"
            file_vals = {k: v or "" for k, v in dotenv_values(path).items()} if path.exists() else {}
            env = {**file_vals, **os.environ}

        def get(name: str, default: str = "") -> str:
            v = env.get(name)
            return default if v is None or v == "" else v

        bucket = get("TEAM_BUCKET", str(REPO_ROOT / ".team-bucket"))
        if not bucket.startswith("gs://") and not Path(bucket).is_absolute():
            bucket = str((REPO_ROOT / bucket).resolve())
        auth = get("TEAM_AUTH", "local").lower()
        if auth not in ("local", "google"):
            raise ValueError(f"TEAM_AUTH must be local or google (got {auth!r})")
        vertex = _bool(get("TEAM_VERTEX_SUCCESSOR", "false"))
        vertex_project = get("TEAM_VERTEX_PROJECT", get("GOOGLE_CLOUD_PROJECT"))
        if vertex:
            need = {"TEAM_VERTEX_PROJECT": vertex_project, "TEAM_VERTEX_REGION": get("TEAM_VERTEX_REGION"), "TEAM_VERTEX_JOB_SPEC": get("TEAM_VERTEX_JOB_SPEC")}
            missing = [n for n, v in need.items() if not v]
            if missing:
                raise ValueError(f"TEAM_VERTEX_SUCCESSOR=true needs {', '.join(missing)}")
        return Settings(
            team_bucket=bucket,
            om_url=get("OM_URL").rstrip("/"),
            om_token=get("OM_TOKEN"),
            om_email=get("OM_EMAIL"),
            om_password=get("OM_PASSWORD"),
            team_auth=auth,
            google_client_id=get("GOOGLE_OAUTH_CLIENT_ID"),
            allowed_domains=_split(get("TEAM_ALLOWED_DOMAINS")),
            allowed_emails=_split(get("TEAM_ALLOWED_EMAILS")),
            snapshot_minutes=float(get("TEAM_SNAPSHOT_MINUTES", "30")),
            om_events_seconds=float(get("TEAM_OM_EVENTS_SECONDS", "30")),
            request_ttl_minutes=float(get("TEAM_REQUEST_TTL_MINUTES", "60")),
            bq_dataset=get("TEAM_BQ_DATASET"),
            bq_project=get("BQ_PROJECT_ID"),
            poll_seconds=float(get("TEAM_POLL_SECONDS", "1")),
            worker_id=get("TEAM_WORKER_ID"),
            team_user=get("TEAM_USER", "admin"),
            impersonate=_bool(get("TEAM_IMPERSONATE", "false")),
            vertex_successor=vertex,
            vertex_project=vertex_project,
            vertex_region=get("TEAM_VERTEX_REGION"),
            vertex_job_spec=get("TEAM_VERTEX_JOB_SPEC"),
            vertex_max_runtime_hours=float(get("TEAM_VERTEX_MAX_RUNTIME_HOURS", "168")),
            vertex_lead_minutes=float(get("TEAM_VERTEX_LEAD_MINUTES", "60")),
            vertex_stop_minutes=float(get("TEAM_VERTEX_STOP_MINUTES", "5")),
        )
