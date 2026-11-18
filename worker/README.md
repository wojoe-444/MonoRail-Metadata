# MonoRail worker

The worker side of the team backend in [`docs/team-backend.md`](../docs/team-backend.md). It's one Python process, and the only client of OpenMetadata. It:

- applies the requests apps drop in `inbox/` and writes replies to `outbox/`,
- publishes every change to the feed (`feed/{seq}.json`, `feed/head.json`),
- exports the catalog snapshot (`state/catalog/`), including each table's latest profile,
- holds the leader lease and writes the heartbeat (`system/`),
- picks up changes made in OpenMetadata some other way (`om-events`),
- records who made each change, as their OpenMetadata user (`byUser`), and can act as them in OpenMetadata (`TEAM_IMPERSONATE`),
- optionally writes an audit trail to BigQuery,
- on Vertex AI, optionally submits its own successor job before the job's maximum runtime.

## Run it locally

Needs [uv](https://docs.astral.sh/uv/). uv fetches Python 3.12 and the dependencies on first run. You also need a running OpenMetadata (`deploy/openmetadata`), with `OM_URL` and `OM_TOKEN` or `OM_EMAIL`/`OM_PASSWORD` in the repo-root `.env`.

```sh
npm run worker         # = uv run --project worker monorail-worker
npm run team:echo      # one echo request through the bucket, prints the round trip
npm run worker:test    # pytest, with the vertex extra (the OpenMetadata integration test is skipped if it isn't reachable)
```

By default the bucket is `team-bucket` in the per-user app data folder: `%LOCALAPPDATA%\MonoRail-Metadata\team-bucket` on Windows (`~/Library/Application Support/MonoRail-Metadata/team-bucket` on macOS, `~/.local/share/monorail-metadata/team-bucket` on Linux). The app reads the same folder when it runs with `APP_BACKEND=team`.

During the pilot this is how the worker runs: on each tester's own machine, not as a Vertex AI job. `npm run pilot` (at the repo root) starts it together with the app. Easier ways for a team to share the app without a central server are coming.

Other commands:

```sh
uv run --project worker monorail-worker resync      # ask the worker to rebuild the snapshot now
uv run --project worker monorail-worker -v run      # debug logging
```

On start the worker takes the lease (or waits as a standby), recovers anything a crash left half done, exports a snapshot (about 2 s against the local sample catalog), and then polls the inbox every `TEAM_POLL_SECONDS`. An echo round trip on one machine takes 150–300 ms, and a write about 100–300 ms.

## Settings

Read from the environment, then the repo-root `.env` (the environment wins).

| Variable | Default | What it does |
| --- | --- | --- |
| `TEAM_BUCKET` | `<app data>/team-bucket` | The bucket: `gs://bucket/prefix`, or a local folder (relative paths are from the repo root). The default is above. |
| `OM_URL` | (required) | OpenMetadata, e.g. `http://localhost:8585`. On Windows, `localhost` is dialed as `127.0.0.1` (Docker doesn't answer on `::1`). |
| `OM_TOKEN` | | A bot JWT. Preferred. |
| `OM_EMAIL`, `OM_PASSWORD` | | Basic-auth login instead of a token (`POST /api/v1/auth/login`, password base64-encoded), renewed on 401. |
| `TEAM_AUTH` | `local` | `local`: accept `{"kind":"local","user":…}` as-is (one machine). `google`: only verified Google ID tokens. |
| `GOOGLE_OAUTH_CLIENT_ID` | | The audience Google ID tokens must carry (`TEAM_AUTH=google`). |
| `TEAM_ALLOWED_DOMAINS` | | Comma-separated email domains allowed with `google`. Exact match: `acme.com` doesn't admit `sub.acme.com`. |
| `TEAM_ALLOWED_EMAILS` | | Comma-separated addresses allowed with `google`. If both lists are empty, every Google identity is refused. |
| `TEAM_SNAPSHOT_MINUTES` | `30` | Rebuild the snapshot this often, if anything changed. This is also how often the worker diffs the catalog for changes that had no change event (lineage). |
| `TEAM_OM_EVENTS_SECONDS` | `30` | How often to poll OpenMetadata's change events. |
| `TEAM_REQUEST_TTL_MINUTES` | `60` | A request older than this that was never processed gets `error.code = "expired"` (status 410). |
| `TEAM_BQ_DATASET` | | `dataset` or `project.dataset` for the BigQuery audit table. Empty turns it off. The project defaults to `BQ_PROJECT_ID`, then to the ADC project. |
| `TEAM_POLL_SECONDS` | `1` | Inbox polling interval. Each poll is one list operation (on GCS, a class A operation). |
| `TEAM_WORKER_ID` | `<host>:<pid>` | The name in the lease and heartbeat. |
| `TEAM_USER` | `admin` | The identity `echo`/`resync` send with `TEAM_AUTH=local`. |
| `TEAM_IMPERSONATE` | `false` | Send each `om` request as the requesting person (`X-Impersonate-User`). Needs `OM_TOKEN` to be the JWT of a bot with `allowImpersonation`; see below. |
| `TEAM_VERTEX_SUCCESSOR` | `false` | Submit a successor Vertex AI custom job before this one's deadline; see below. Needs the next three. |
| `TEAM_VERTEX_PROJECT` | `GOOGLE_CLOUD_PROJECT` | Project the successor job is created in. |
| `TEAM_VERTEX_REGION` | | Region, e.g. `us-central1` (also picks the API endpoint). |
| `TEAM_VERTEX_JOB_SPEC` | | The successor's CustomJob, as JSON in REST field names (`displayName`, `jobSpec.workerPoolSpecs`, `jobSpec.scheduling.timeout`, `jobSpec.serviceAccount`…), inline or a file path. Usually the same spec this job was started from. |
| `TEAM_VERTEX_MAX_RUNTIME_HOURS` | `168` | The deadline when the worker can't read its own job (no `CLOUD_ML_JOB_ID`, or no `aiplatform.customJobs.get`): process start plus this. |
| `TEAM_VERTEX_LEAD_MINUTES` | `60` | Submit the successor this long before the deadline. |
| `TEAM_VERTEX_STOP_MINUTES` | `5` | Release the lease and exit this long before the deadline. |

Google credentials (for `gs://` buckets and BigQuery) come from Application Default Credentials: the job's service account on Google Cloud, or `gcloud auth application-default login` on a laptop.

## How it maps to the contract

| Contract | Code |
| --- | --- |
| Bucket layout, atomic writes, create-if-absent | `storage/local.py` (temp file + rename; hard link for exclusive create; lock file for compare-and-swap), `storage/gcs.py` (`if_generation_match`, `list_blobs(start_offset=…)`), `storage/base.py` (the interface). |
| Request, reply, feed event, manifest, heartbeat, lease shapes | `protocol.py` |
| Identity | `identity.py`: `google.oauth2.id_token.verify_oauth2_token` against `GOOGLE_OAUTH_CLIENT_ID` (signature, audience, expiry), then `email_verified` and the allowlist. |
| Allowlist | `allowlist.json` (the lists) and `allowlist.py`. Paths are normalized first: no `..`, no full URLs, no `?` in the path, nothing under `/api/`. Only `Content-Type` is passed through from request headers. The app reads the same JSON (`server/team/allowlist.ts`) and refuses forbidden requests before queueing them; `tests/test_allowlist.py` runs `tests/allowlist_cases.json` through both and compares answers and messages. |
| Attribution | `users.py`: `by` → OpenMetadata user (email to `email`, otherwise `name`), from the snapshot's users and the feed, with one `GET /users/name/…` on a miss. `byUser` goes into replies, feed events and audit rows. |
| Impersonation | `worker.py` adds `X-Impersonate-User: <byUser.name>` to `om` requests when `TEAM_IMPERSONATE` is on; `om.py` passes that one header through. The worker's own reads never carry it. |
| Processing rules | `worker.py`: one request at a time in id order, skipped if `outbox/{id}.json` exists. TTL, identity, allowlist, the OpenMetadata call, re-read, feed event, head, audit row, reply, cursor, in that order. |
| "Re-read what changed" | `touched.py`. `resolve()` maps a write to targets; `materialize()` re-reads them with `fields=*`. Entity writes: the response's `href`/`id`. Sub-resources (`/followers`, `/votes`, `/sampleData`…): the parent. `PUT /lineage`: re-read the edge. `DELETE /lineage/…`: `lineage.delete`. Data product, domain and term `assets/add\|remove`: the parent and each asset. Test case results: the test case and its suites. Creates and deletes also re-read parents whose counts and lists change (term → glossary, table → schema…). Deletes also drop the entity's edges. `feed`: no event. Renames, recursive deletes, bulk/import and unknown shapes: a full `resync`. |
| Crash recovery | `worker.py`. The request is recorded as in flight in `system/cursor.json` with a stage (`calling` → `called` → `fed` → `audited`). On restart: `called`/`fed`/`audited` continue from the stored response and reuse the feed event if it's already written. `calling` re-sends GET/PUT/DELETE, but not PATCH/POST: those get an `internal` reply saying the change may have been applied, plus a re-read of the target. `Feed.recover()` moves the head past events written before a crash. A snapshot whose resync event never landed gets that event at its `seq`. |
| Latest profiles | `profiles.py`: `GET /tables/{fqn}/tableProfile/latest?includeColumnProfile=true` per table, kept as `{id, fullyQualifiedName, profile, columns}`. Exported with every snapshot (`tableProfile.{ts}.json.gz`), diffed into `profile.upsert` / `profile.delete`, and re-read after queued profile writes (`touched.ProfileOf`). A failed read keeps the last record. |
| Snapshot | `snapshot.py`: pages every listed collection (`limit=1000`, `after` cursor) with `fields=*`, falling back to a per-collection list (`entities.FALLBACK_FIELDS`) and then to no `fields` if OpenMetadata answers 400. Lineage: `GET /lineage/getLineage?fqn=…&type=table&upstreamDepth=1&downstreamDepth=1` for every table and metric, de-duplicated, `sqlQueryKey` resolved from the target node's `lineageSqlQueries`. Files first, manifest last, unique file names per snapshot. |
| Secrets | `sanitize.py`. Service `connection.config` is reduced to an allowlist (type, host, project ids, locations, `supports*` flags; `credentials.gcpConfig` keeps only `type` and `projectId`). Keys naming secrets (password, token, private key, credentials, `authenticationMechanism`, `securityConfig`, `openMetadataServerConnection`…) are dropped at any depth, in snapshots, feed events and replies. |
| Change events | `events.py`: `GET /api/v1/events?entityCreated=*&entityUpdated=*&entityRestored=*&entityDeleted=*&timestamp=…&limit=1000&after=…`. Details below. |
| Lease and heartbeat | `lease.py`. A background thread renews the lease every 10 s (for 30 s, compare-and-swap) and writes the heartbeat every 15 s. A worker stops acting 2 s before its lease would run out. |
| BigQuery audit | `audit.py`: `CREATE TABLE … metadata_events` (day partitions on `ts`, clustered by `entity_type, entity_id`), adding `by_user_id` / `by_user_name` to a table made by an older worker, then one parameterized `INSERT … SELECT … FROM UNNEST(@rows)` per feed event, with one row per change. |
| Heartbeat `omVersion` | `worker.py` `refresh_om_version()`: read before the first heartbeat, then at most once a minute while unknown, on leaders and standbys. |
| Successor jobs | `vertex.py` (below). |
| Retention | `housekeeping.py`, hourly. It deletes inbox/outbox objects older than 7 days (inbox only once processed), feed events below the snapshot `seq` once they're 7 days old, and unreferenced snapshot files after an hour. |

### OpenMetadata change events (2.0.8)

`GET /api/v1/events` (`EventResource.listChangeEvents`) returns events in the order of the `change_event` table's `offset` column. `paging.after` is the base64 offset of the last event on a page, and it is null on the last page. To keep a cursor that survives restarts, the worker re-asks for the last page with `limit = k - 1`, which yields the cursor of the second-to-last event. The last one comes back next time and is skipped by its event id, from a bounded set kept in `system/cursor.json`. The `timestamp` filter applies to the event time, which some events backdate (test case results carry the result's time), so the worker uses it only before it has a cursor. Events are coalesced per entity. Each entity is re-read with `fields=*`, and skipped if apps already hold that exact version: that's how the change events for the worker's own writes are dropped. Event types outside the replica (threads, tasks) are ignored.

**Lineage edits produce no change events in 2.0.8** (checked against the local server). The periodic snapshot covers them. Every `TEAM_SNAPSHOT_MINUTES` the worker exports the catalog, diffs it against what apps hold (entities and edges), and publishes the differences as one `om-events` event before writing the new snapshot. On start, the same diff covers changes made while the worker was down.

### Latest profiles and change events (2.0.8)

OpenMetadata 2.0.8 writes profiles (`PUT /tables/{id}/tableProfile`, which the profiler calls) straight to its time-series table and records **no change event** for them (checked against the local server: a profile write leaves `/api/v1/events` unchanged). So profiles written by the profiler reach apps through the periodic snapshot diff, within `TEAM_SNAPSHOT_MINUTES`. Profile writes that go through the queue are published at once. On the first start after this change, the worker finds a snapshot without profiles and runs a resync, so every app reloads and starts serving profiles locally.

### Impersonation (OpenMetadata 2.0.8)

2.0.8 lets a bot act for a user: the bot sends `X-Impersonate-User: <user name>` with its own JWT, and OpenMetadata authorizes and records the request as that user (`updatedBy`), with the bot in `impersonatedBy` (`JwtFilter`, `ImpersonationAuthorizer` in the 2.0.8 source). It's gated three ways: only a bot principal may send the header; the bot must have `allowImpersonation`, which only an admin can set, at bot creation (`createBot.json`); and the bot's policies must allow the `Impersonate` operation on the target user (seed roles `BotImpersonationRole`, allow all, and `BotNonAdminImpersonationRole`, which denies admin and bot targets). Endpoints that mint, reveal or change credentials, and policy and role writes, refuse impersonated requests (`@IdentityEndpoint`).

Checked against the local 2.0.8 with a throwaway bot: a queued description edit as `june.kim` came back with `updatedBy: june.kim, impersonatedBy: <bot>`, an edit ada.park isn't allowed to make (`EditDisplayName`) was refused with OpenMetadata's 403, and `GET /users/auth-mechanism/…` as an impersonated user was refused.

Setup:

1. As an admin, create a bot with `allowImpersonation: true` (`POST /api/v1/bots`, after creating its user) and give it `BotNonAdminImpersonationRole` (recommended) or `BotImpersonationRole`, plus whatever it needs for the snapshot (reads, `/events`).
2. Put its JWT in `OM_TOKEN` (not `OM_EMAIL`/`OM_PASSWORD`: a basic-auth login is a user, and users can't impersonate) and set `TEAM_IMPERSONATE=true`. The worker logs at start whether the token is a bot with impersonation enabled.

Why it's safe to turn on, and what to know:

- The identity behind the header is the one the worker verified (a Google ID token with `TEAM_AUTH=google`). With `TEAM_AUTH=local` anyone on the machine can claim any name, so use impersonation with `google` only.
- People get their own OpenMetadata permissions, which can be fewer than the bot's: with impersonation, an edit someone isn't allowed to make fails with OpenMetadata's 403 instead of going through as the bot.
- A teammate with no OpenMetadata user (no match for `by`) is sent as the bot, as before, and `byUser` is `null`. The allowlist still applies, and it never lets credential endpoints through.
- Prefer `BotNonAdminImpersonationRole`, so the worker can't act as an admin or another bot.

### Vertex AI successor jobs

A custom job stops at its `scheduling.timeout` (7 days by default). With `TEAM_VERTEX_SUCCESSOR=true`, `vertex.py` handles the handoff:

1. The deadline: the worker reads its own job (`CLOUD_ML_JOB_ID`, which Vertex sets in the container) for `start_time` plus `job_spec.scheduling.timeout`. If it can't, it uses the process start plus `TEAM_VERTEX_MAX_RUNTIME_HOURS`.
2. `TEAM_VERTEX_LEAD_MINUTES` before the deadline, the leader submits `TEAM_VERTEX_JOB_SPEC` (display name suffixed with the time) through `aiplatform_v1.JobServiceClient.create_custom_job`. The submission is recorded in `system/cursor.json` under `successor`, so a restart in the same job doesn't submit twice. A failed submission is retried every 5 minutes.
3. The successor starts as a standby: it heartbeats only if the leader's heartbeat goes stale, and waits for the lease.
4. `TEAM_VERTEX_STOP_MINUTES` before the deadline, the old worker releases the lease and exits. The successor takes the lease within one renewal (10 s), recovers anything in flight, and carries on. Requests wait in `inbox/` meanwhile.

IAM for the worker's service account: `aiplatform.customJobs.create`, and `aiplatform.customJobs.get` to read its own deadline (both in `roles/aiplatform.user`), plus `iam.serviceAccounts.actAs` (`roles/iam.serviceAccountUser`) on the service account named in the spec.

The client library is the optional `vertex` extra: install the worker with `monorail-worker[vertex]` in the container (`uv sync --extra vertex`). `npm run worker:test` includes it.

## Known limits

- A snapshot export blocks the inbox while it runs. That's about 2 s on the sample catalog (90 requests); it grows with the number of tables, since lineage is one request per table and metric.
- Derived fields that change without a change event (tag and term `usageCount`, for example) reach apps only through the periodic diff.
- Without `TEAM_IMPERSONATE`, OpenMetadata's own `updatedBy` is the worker's bot; who made the change is in `by` / `byUser` (feed, reply, audit) only.
- Profiles written by the profiler reach apps only through the periodic snapshot (no change events for them in 2.0.8). Each snapshot reads one latest profile per table, so it costs one more request per table.
- An audit row can be written twice if the worker dies between the BigQuery insert and recording that it happened.

## Not run here

There are no Google credentials, GCS bucket or BigQuery dataset on the development machine, so these are covered by unit tests with fakes only:

- **GCS** (`storage/gcs.py`): the fake (`tests/test_gcs.py`) mirrors google-cloud-storage's `get_blob`, `download_as_bytes`, `upload_from_string(if_generation_match=…)` and `list_blobs(prefix, start_offset)`. The whole worker loop also runs on it once.
- **Google ID tokens** (`identity.py`): tested with a stub verifier. The real path calls `google.oauth2.id_token.verify_oauth2_token`, which fetches Google's certificates.
- **BigQuery** (`audit.py`): table creation, the column migration and the parameterized insert, against a fake client.
- **Vertex AI** (`vertex.py`): the deadline, submission, retry, once-per-job record and handoff, against a fake `JobServiceClient`. One test builds a real `aiplatform_v1.CustomJob` from the spec with the installed library, but nothing is sent to Google.

## Tests

```sh
npm run worker:test
# or: cd worker && uv run pytest
```

`tests/test_integration_om.py` runs against the OpenMetadata in `.env`. It queues a description PATCH on a table, checks the reply, the feed event (the whole entity) and `head.json`, then restores the description. It's skipped when OpenMetadata isn't reachable.
