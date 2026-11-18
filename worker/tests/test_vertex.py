"""Vertex AI successor jobs (vertex.py), against a fake JobServiceClient. No Google Cloud here."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from conftest import make_worker

from monorail_worker import protocol as P
from monorail_worker.config import Settings
from monorail_worker.storage import read_json
from monorail_worker.vertex import Successor, load_spec

H = 3_600_000
START = datetime(2026, 11, 10, tzinfo=timezone.utc)
START_MS = int(START.timestamp() * 1000)
SPEC = {
    "displayName": "monorail-worker",
    "jobSpec": {
        "workerPoolSpecs": [{"machineSpec": {"machineType": "n2-standard-4"}, "replicaCount": "1", "containerSpec": {"imageUri": "us-docker.pkg.dev/p/r/worker:1"}}],
        "scheduling": {"timeout": "86400s"},
        "serviceAccount": "worker@acme.iam.gserviceaccount.com",
    },
}


class FakeJobs:
    """The two JobServiceClient methods the worker calls, with google-cloud-aiplatform's attribute names."""

    def __init__(self, timeout=timedelta(days=1), start=START, fail_creates=0):
        self.timeout = timeout
        self.start = start
        self.created: list[tuple[str, object]] = []
        self.gets: list[str] = []
        self.fail_creates = fail_creates

    def get_custom_job(self, *, name):
        self.gets.append(name)
        return SimpleNamespace(name=name, start_time=self.start, create_time=self.start, job_spec=SimpleNamespace(scheduling=SimpleNamespace(timeout=self.timeout)))

    def create_custom_job(self, *, parent, custom_job):
        if self.fail_creates:
            self.fail_creates -= 1
            raise RuntimeError("403 Permission 'aiplatform.customJobs.create' denied")
        self.created.append((parent, custom_job))
        return SimpleNamespace(name=f"{parent}/customJobs/{1000 + len(self.created)}")


def vsettings(tmp_path, **kw) -> Settings:
    spec = tmp_path / "job.json"
    spec.write_text(json.dumps(SPEC))
    base = dict(
        team_bucket=str(tmp_path / "bucket"),
        vertex_successor=True,
        vertex_project="acme",
        vertex_region="us-central1",
        vertex_job_spec=str(spec),
    )
    return Settings(**{**base, **kw})


def test_deadline_from_the_running_job(tmp_path):
    jobs = FakeJobs(timeout=timedelta(days=7))
    s = Successor(vsettings(tmp_path), started_at=START_MS + 60_000, client=jobs, env={"CLOUD_ML_JOB_ID": "42"})
    assert s.deadline() == START_MS + 7 * 24 * H
    assert jobs.gets == ["projects/acme/locations/us-central1/customJobs/42"]
    s.deadline()
    assert len(jobs.gets) == 1  # read once


def test_deadline_fallback_without_a_job_id(tmp_path):
    s = Successor(vsettings(tmp_path, vertex_max_runtime_hours=24), started_at=START_MS, client=FakeJobs(), env={})
    assert s.deadline() == START_MS + 24 * H


def test_deadline_fallback_when_the_job_cant_be_read(tmp_path):
    class Broken(FakeJobs):
        def get_custom_job(self, *, name):
            raise RuntimeError("403")

    s = Successor(vsettings(tmp_path, vertex_max_runtime_hours=10), started_at=START_MS, client=Broken(), env={"CLOUD_ML_JOB_ID": "42"})
    assert s.deadline() == START_MS + 10 * H


def test_submits_once_in_the_lead_window_then_stops(tmp_path):
    jobs = FakeJobs()  # deadline = START + 24 h
    s = Successor(vsettings(tmp_path), started_at=START_MS, client=jobs, env={"CLOUD_ML_JOB_ID": "42"})
    cursor: dict = {}
    dl = START_MS + 24 * H
    assert s.tick(dl - 2 * H, leader=True, cursor=cursor, worker_id="w") is None
    assert s.tick(dl - 59 * 60_000, leader=False, cursor=cursor, worker_id="w") is None  # only the leader submits
    assert s.tick(dl - 59 * 60_000, leader=True, cursor=cursor, worker_id="w") == "submitted"
    [(parent, job)] = jobs.created
    assert parent == "projects/acme/locations/us-central1"
    name = job.display_name if hasattr(job, "display_name") else job["displayName"]
    assert name == "monorail-worker-20261110-2301"
    assert cursor["successor"]["for"] == "42" and cursor["successor"]["job"].endswith("/customJobs/1001")
    assert s.tick(dl - 30 * 60_000, leader=True, cursor=cursor, worker_id="w") is None
    assert len(jobs.created) == 1  # not again
    assert s.tick(dl - 5 * 60_000, leader=True, cursor=cursor, worker_id="w") == "stop"
    assert s.tick(dl - 4 * 60_000, leader=False, cursor=cursor, worker_id="w") == "stop"


def test_a_restart_in_the_same_job_doesnt_submit_twice(tmp_path):
    jobs = FakeJobs()
    cursor = {"successor": {"for": "42", "job": "projects/acme/locations/us-central1/customJobs/7"}}
    s = Successor(vsettings(tmp_path), started_at=START_MS, client=jobs, env={"CLOUD_ML_JOB_ID": "42"})
    assert s.tick(START_MS + 23 * H + 30 * 60_000, leader=True, cursor=cursor, worker_id="w") is None
    assert jobs.created == []
    # The successor job itself (a different job id) submits its own successor in its turn.
    s2 = Successor(vsettings(tmp_path), started_at=START_MS, client=jobs, env={"CLOUD_ML_JOB_ID": "7"})
    assert s2.tick(START_MS + 23 * H + 30 * 60_000, leader=True, cursor=cursor, worker_id="w") == "submitted"


def test_failed_submission_retries_after_five_minutes(tmp_path):
    jobs = FakeJobs(fail_creates=1)
    s = Successor(vsettings(tmp_path), started_at=START_MS, client=jobs, env={"CLOUD_ML_JOB_ID": "42"})
    cursor: dict = {}
    t = START_MS + 23 * H
    assert s.tick(t, leader=True, cursor=cursor, worker_id="w") is None
    assert s.tick(t + 60_000, leader=True, cursor=cursor, worker_id="w") is None  # waiting
    assert s.tick(t + 5 * 60_000, leader=True, cursor=cursor, worker_id="w") == "submitted"


def test_disabled_does_nothing(tmp_path):
    jobs = FakeJobs()
    s = Successor(vsettings(tmp_path, vertex_successor=False), started_at=START_MS, client=jobs, env={"CLOUD_ML_JOB_ID": "42"})
    assert s.tick(START_MS + 24 * H, leader=True, cursor={}, worker_id="w") is None
    assert jobs.gets == [] and jobs.created == []


def test_spec_inline_or_file(tmp_path):
    assert load_spec(json.dumps(SPEC))["displayName"] == "monorail-worker"
    assert load_spec(vsettings(tmp_path).vertex_job_spec)["jobSpec"]["scheduling"]["timeout"] == "86400s"
    with pytest.raises(ValueError):
        load_spec('{"displayName": "x"}')


def test_settings_require_project_region_and_spec():
    with pytest.raises(ValueError, match="TEAM_VERTEX_REGION"):
        Settings.load({"TEAM_BUCKET": "gs://b", "TEAM_VERTEX_SUCCESSOR": "true", "TEAM_VERTEX_PROJECT": "acme", "TEAM_VERTEX_JOB_SPEC": "{}"})
    s = Settings.load({"TEAM_BUCKET": "gs://b", "TEAM_VERTEX_SUCCESSOR": "1", "GOOGLE_CLOUD_PROJECT": "acme", "TEAM_VERTEX_REGION": "europe-west4", "TEAM_VERTEX_JOB_SPEC": "{}"})
    assert s.vertex_successor and s.vertex_project == "acme" and s.vertex_lead_minutes == 60 and s.vertex_stop_minutes == 5
    assert not Settings.load({"TEAM_BUCKET": "gs://b"}).vertex_successor


def test_real_library_builds_the_custom_job(tmp_path):
    """With google-cloud-aiplatform installed (the vertex extra), the spec becomes a real CustomJob."""
    pytest.importorskip("google.cloud.aiplatform_v1")
    jobs = FakeJobs()
    s = Successor(vsettings(tmp_path), started_at=START_MS, client=jobs, env={"CLOUD_ML_JOB_ID": "42"})
    assert s.tick(START_MS + 23 * H + 30 * 60_000, leader=True, cursor={}, worker_id="w") == "submitted"
    [(_, job)] = jobs.created
    assert type(job).__name__ == "CustomJob"
    assert job.display_name.startswith("monorail-worker-") and job.job_spec.service_account == "worker@acme.iam.gserviceaccount.com"
    assert job.job_spec.scheduling.timeout == timedelta(days=1)


def test_worker_hands_over_and_stops(tmp_path, storage, om, catalog, clock):
    settings = vsettings(tmp_path)
    jobs = FakeJobs(start=datetime.fromtimestamp(clock() / 1000, timezone.utc))
    succ = Successor(settings, started_at=clock(), client=jobs, env={"CLOUD_ML_JOB_ID": "42"})
    w = make_worker(settings, storage, om, clock, successor=succ)
    w.run_once()
    assert jobs.created == [] and not w.stopping
    clock.advance(23 * H + 1)
    assert w.lease.try_acquire()
    w.run_once()
    assert len(jobs.created) == 1
    assert read_json(storage, P.CURSOR)["successor"]["for"] == "42"
    clock.advance(55 * 60_000)
    assert w.lease.try_acquire()
    w.run_once()
    assert w.stopping
