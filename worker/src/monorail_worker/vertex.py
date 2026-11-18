"""Hand off to a successor before a Vertex AI custom job hits its maximum runtime.

A custom job is stopped at its `scheduling.timeout` (7 days by default). With
`TEAM_VERTEX_SUCCESSOR=true` the leader works out its own deadline and, `TEAM_VERTEX_LEAD_MINUTES`
before it, submits a new custom job from `TEAM_VERTEX_JOB_SPEC`. The successor starts as a standby
(the lease is held). `TEAM_VERTEX_STOP_MINUTES` before the deadline this worker releases the lease
and exits, and the successor takes over within a lease renewal (10 s).

The deadline: inside a custom job Vertex sets `CLOUD_ML_JOB_ID`; the worker reads that job
(`get_custom_job`) for its `start_time` and `job_spec.scheduling.timeout`. Without it (or if the read
fails) the deadline is the process start plus `TEAM_VERTEX_MAX_RUNTIME_HOURS`.

IAM: the worker's service account needs `aiplatform.customJobs.create` (and
`aiplatform.customJobs.get` for the deadline), e.g. `roles/aiplatform.user`, plus
`iam.serviceAccounts.actAs` on the service account the job spec runs as.

The client is google-cloud-aiplatform's `aiplatform_v1.JobServiceClient` (the `vertex` extra). Tests
pass a fake with the same two methods.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Literal, Mapping, Protocol

from .config import Settings

log = logging.getLogger(__name__)

RETRY_MS = 5 * 60_000
DEFAULT_TIMEOUT = timedelta(days=7)


class JobClient(Protocol):
    def create_custom_job(self, *, parent: str, custom_job: Any) -> Any: ...
    def get_custom_job(self, *, name: str) -> Any: ...


def default_client(region: str) -> JobClient:
    from google.cloud import aiplatform_v1

    return aiplatform_v1.JobServiceClient(client_options={"api_endpoint": f"{region}-aiplatform.googleapis.com"})


def load_spec(spec: str) -> dict[str, Any]:
    """TEAM_VERTEX_JOB_SPEC: a CustomJob as JSON (REST field names), inline or in a file."""
    text = spec.strip()
    if not text.startswith("{"):
        text = Path(spec).read_text(encoding="utf-8")
    d = json.loads(text)
    if not isinstance(d, dict) or "jobSpec" not in d and "job_spec" not in d:
        raise ValueError("TEAM_VERTEX_JOB_SPEC must be a CustomJob with a jobSpec")
    return d


def to_custom_job(spec: dict[str, Any]) -> Any:
    """The spec as an aiplatform_v1.CustomJob (or the dict itself without the library, for fakes)."""
    try:
        from google.cloud import aiplatform_v1
    except ImportError:
        return spec
    return aiplatform_v1.CustomJob.from_json(json.dumps(spec))


def _ms(dt: Any) -> int | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    return None


def _timeout(job: Any) -> timedelta:
    sched = getattr(getattr(job, "job_spec", None), "scheduling", None)
    t = getattr(sched, "timeout", None)
    if isinstance(t, timedelta) and t.total_seconds() > 0:
        return t
    return DEFAULT_TIMEOUT


class Successor:
    def __init__(
        self,
        settings: Settings,
        *,
        started_at: int,
        client: JobClient | None = None,
        client_factory: Callable[[str], JobClient] = default_client,
        env: Mapping[str, str] | None = None,
    ):
        self.s = settings
        self.started_at = started_at
        self._client = client
        self._factory = client_factory
        env = os.environ if env is None else env
        self.job_id = env.get("CLOUD_ML_JOB_ID", "")
        self._deadline: int | None = None
        self._next_try = 0

    @property
    def enabled(self) -> bool:
        return self.s.vertex_successor

    @property
    def parent(self) -> str:
        return f"projects/{self.s.vertex_project}/locations/{self.s.vertex_region}"

    @property
    def client(self) -> JobClient:
        if self._client is None:
            self._client = self._factory(self.s.vertex_region)
        return self._client

    def deadline(self) -> int:
        """When Vertex will stop this job (epoch ms)."""
        if self._deadline is not None:
            return self._deadline
        fallback = self.started_at + int(self.s.vertex_max_runtime_hours * 3_600_000)
        dl = fallback
        if self.job_id:
            try:
                job = self.client.get_custom_job(name=f"{self.parent}/customJobs/{self.job_id}")
                start = _ms(getattr(job, "start_time", None)) or _ms(getattr(job, "create_time", None))
                if start:
                    dl = start + int(_timeout(job).total_seconds() * 1000)
            except Exception:
                log.exception("couldn't read custom job %s; assuming a deadline %s h after start", self.job_id, self.s.vertex_max_runtime_hours)
        self._deadline = dl
        log.info("this job's deadline is %s", datetime.fromtimestamp(dl / 1000, timezone.utc).isoformat())
        return dl

    def key(self, worker_id: str) -> str:
        """Which job a successor record belongs to."""
        return self.job_id or worker_id

    def tick(self, now: int, *, leader: bool, cursor: dict[str, Any], worker_id: str) -> Literal["submitted", "stop"] | None:
        """Submit the successor when it's time (leader only, once per job; recorded in `cursor`),
        and say when to stop. The caller saves the cursor after "submitted"."""
        if not self.enabled:
            return None
        dl = self.deadline()
        if now >= dl - int(self.s.vertex_stop_minutes * 60_000):
            return "stop"
        if not leader or now < dl - int(self.s.vertex_lead_minutes * 60_000) or now < self._next_try:
            return None
        rec = cursor.get("successor")
        if isinstance(rec, dict) and rec.get("for") == self.key(worker_id):
            return None  # already submitted for this job
        try:
            spec = load_spec(self.s.vertex_job_spec)
            stamp = time.strftime("%Y%m%d-%H%M", time.gmtime(now / 1000))
            spec = {**spec, "displayName": f"{spec.get('displayName') or spec.get('display_name') or 'monorail-worker'}-{stamp}"}
            spec.pop("display_name", None)
            job = self.client.create_custom_job(parent=self.parent, custom_job=to_custom_job(spec))
        except Exception:
            log.exception("submitting the successor job failed; retrying in %d min", RETRY_MS // 60_000)
            self._next_try = now + RETRY_MS
            return None
        name = getattr(job, "name", "") or (job.get("name", "") if isinstance(job, dict) else "")
        cursor["successor"] = {"for": self.key(worker_id), "job": name, "submittedAt": now, "deadline": dl}
        log.info("submitted successor job %s (this job stops at %s)", name, datetime.fromtimestamp(dl / 1000, timezone.utc).isoformat())
        return "submitted"
