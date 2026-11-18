# The MonoRail Metadata worker, for a Vertex AI custom job (docs/team-backend.md, "Moving to Google Cloud").
#
#   docker build -t monorail-worker worker/
#   docker run --env-file .env -e TEAM_BUCKET=gs://bucket/prefix monorail-worker
#
# Configuration is all environment variables (worker/README.md). On Google Cloud, credentials for the
# bucket and BigQuery come from the job's service account (Application Default Credentials); nothing
# secret is baked into the image. OM_TOKEN should come from Secret Manager, not the job spec.
#
# OpenMetadata beside it: this image holds only the worker, which reaches OpenMetadata at OM_URL.
# A Vertex AI custom job runs one container per replica, so "OpenMetadata in the same job" means one of:
#   1. A combined image: FROM the openmetadata/server image of the same version, add Python and this
#      package, and run both under a small supervisor (OpenMetadata on :8585, the worker with
#      OM_URL=http://127.0.0.1:8585). MySQL/Postgres (Cloud SQL) and Elasticsearch/OpenSearch stay
#      outside the job, because the job is replaced when it hits its maximum runtime.
#   2. OpenMetadata somewhere long-lived (a VM or GKE, as in deploy/openmetadata), and this image alone
#      as the job, with OM_URL pointing at it over the VPC.
# The lease (system/lease.json) makes the hand-off safe: a successor job starts as a standby and takes
# over within 30 s of the old one stopping.

FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 worker
USER worker

ENTRYPOINT ["/opt/venv/bin/monorail-worker"]
CMD ["run"]
