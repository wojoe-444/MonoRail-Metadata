# MonoRail worker

The worker side of the team backend in [`docs/team-backend.md`](../docs/team-backend.md). It's one Python process, and the only client of OpenMetadata. It:

- applies the requests apps drop in `inbox/` and writes replies to `outbox/`,
- publishes every change to the feed (`feed/{seq}.json`, `feed/head.json`),
- exports the catalog snapshot (`state/catalog/`),
- holds the leader lease and writes the heartbeat (`system/`),
- picks up changes made in OpenMetadata some other way (`om-events`),
- optionally writes an audit trail to BigQuery.

## Run it locally

Needs [uv](https://docs.astral.sh/uv/). uv fetches Python 3.12 and the dependencies on first run. You also need a running OpenMetadata (`deploy/openmetadata`), with `OM_URL` and `OM_TOKEN` or `OM_EMAIL`/`OM_PASSWORD` in the repo-root `.env`.

```sh
npm run worker         # = uv run --project worker monorail-worker
npm run team:echo      # one echo request through the bucket, prints the round trip
npm run worker:test    # pytest (the OpenMetadata integration test is skipped if it isn't reachable)
```

By default the bucket is the `.team-bucket/` folder at the repo root. The app reads the same folder when it runs with `APP_BACKEND=team`. Other commands:

```sh
uv run --project worker monorail-worker resync      # ask the worker to rebuild the snapshot now
uv run --project worker monorail-worker -v run      # debug logging
```

On start the worker takes the lease (or waits as a standby), recovers anything a crash left half done, exports a snapshot (about 2 s against the local sample catalog), and then polls the inbox every `TEAM_POLL_SECONDS`. An echo round trip on one machine takes 150–300 ms, and a write about 100–300 ms.

## Settings

Read from the environment, then the repo-root `.env` (the environment wins).

| Variable | Default | What it does |
| --- | --- | --- |
| `TEAM_BUCKET` | `<repo>/.team-bucket` | The bucket: `gs://bucket/prefix`, or a local folder (relative paths are from the repo root). |
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

Google credentials (for `gs://` buckets and BigQuery) come from Application Default Credentials: the job's service account on Google Cloud, or `gcloud auth application-default login` on a laptop.

## How it maps to the contract

| Contract | Code |
| --- | --- |
| Bucket layout, atomic writes, create-if-absent | `storage/local.py` (temp file + rename; hard link for exclusive create; lock file for compare-and-swap), `storage/gcs.py` (`if_generation_match`, `list_blobs(start_offset=…)`), `storage/base.py` (the interface). |
| Request, reply, feed event, manifest, heartbeat, lease shapes | `protocol.py` |
| Identity | `identity.py`: `google.oauth2.id_token.verify_oauth2_token` against `GOOGLE_OAUTH_CLIENT_ID` (signature, audience, expiry), then `email_verified` and the allowlist. |
| Allowlist | `allowlist.py`. Paths are normalized first: no `..`, no full URLs, no `?` in the path, nothing under `/api/`. Only `Content-Type` is passed through from request headers. |
| Processing rules | `worker.py`: one request at a time in id order, skipped if `outbox/{id}.json` exists. TTL, identity, allowlist, the OpenMetadata call, re-read, feed event, head, audit row, reply, cursor, in that order. |
| "Re-read what changed" | `touched.py`. `resolve()` maps a write to targets; `materialize()` re-reads them with `fields=*`. Entity writes: the response's `href`/`id`. Sub-resources (`/followers`, `/votes`, `/sampleData`…): the parent. `PUT /lineage`: re-read the edge. `DELETE /lineage/…`: `lineage.delete`. Data product, domain and term `assets/add\|remove`: the parent and each asset. Test case results: the test case and its suites. Creates and deletes also re-read parents whose counts and lists change (term → glossary, table → schema…). Deletes also drop the entity's edges. `feed`: no event. Renames, recursive deletes, bulk/import and unknown shapes: a full `resync`. |
| Crash recovery | `worker.py`. The request is recorded as in flight in `system/cursor.json` with a stage (`calling` → `called` → `fed` → `audited`). On restart: `called`/`fed`/`audited` continue from the stored response and reuse the feed event if it's already written. `calling` re-sends GET/PUT/DELETE, but not PATCH/POST: those get an `internal` reply saying the change may have been applied, plus a re-read of the target. `Feed.recover()` moves the head past events written before a crash. A snapshot whose resync event never landed gets that event at its `seq`. |
| Snapshot | `snapshot.py`: pages every listed collection (`limit=1000`, `after` cursor) with `fields=*`, falling back to a per-collection list (`entities.FALLBACK_FIELDS`) and then to no `fields` if OpenMetadata answers 400. Lineage: `GET /lineage/getLineage?fqn=…&type=table&upstreamDepth=1&downstreamDepth=1` for every table and metric, de-duplicated, `sqlQueryKey` resolved from the target node's `lineageSqlQueries`. Files first, manifest last, unique file names per snapshot. |
| Secrets | `sanitize.py`. Service `connection.config` is reduced to an allowlist (type, host, project ids, locations, `supports*` flags; `credentials.gcpConfig` keeps only `type` and `projectId`). Keys naming secrets (password, token, private key, credentials, `authenticationMechanism`, `securityConfig`, `openMetadataServerConnection`…) are dropped at any depth, in snapshots, feed events and replies. |
| Change events | `events.py`: `GET /api/v1/events?entityCreated=*&entityUpdated=*&entityRestored=*&entityDeleted=*&timestamp=…&limit=1000&after=…`. Details below. |
| Lease and heartbeat | `lease.py`. A background thread renews the lease every 10 s (for 30 s, compare-and-swap) and writes the heartbeat every 15 s. A worker stops acting 2 s before its lease would run out. |
| BigQuery audit | `audit.py`: `CREATE TABLE … metadata_events` (day partitions on `ts`, clustered by `entity_type, entity_id`), then one parameterized `INSERT … SELECT … FROM UNNEST(@rows)` per feed event, with one row per change. |
| Retention | `housekeeping.py`, hourly. It deletes inbox/outbox objects older than 7 days (inbox only once processed), feed events below the snapshot `seq` once they're 7 days old, and unreferenced snapshot files after an hour. |

### OpenMetadata change events (2.0.8)

`GET /api/v1/events` (`EventResource.listChangeEvents`) returns events in the order of the `change_event` table's `offset` column. `paging.after` is the base64 offset of the last event on a page, and it is null on the last page. To keep a cursor that survives restarts, the worker re-asks for the last page with `limit = k - 1`, which yields the cursor of the second-to-last event. The last one comes back next time and is skipped by its event id, from a bounded set kept in `system/cursor.json`. The `timestamp` filter applies to the event time, which some events backdate (test case results carry the result's time), so the worker uses it only before it has a cursor. Events are coalesced per entity. Each entity is re-read with `fields=*`, and skipped if apps already hold that exact version: that's how the change events for the worker's own writes are dropped. Event types outside the replica (threads, tasks) are ignored.

**Lineage edits produce no change events in 2.0.8** (checked against the local server). The periodic snapshot covers them. Every `TEAM_SNAPSHOT_MINUTES` the worker exports the catalog, diffs it against what apps hold (entities and edges), and publishes the differences as one `om-events` event before writing the new snapshot. On start, the same diff covers changes made while the worker was down.

## Known limits

- A snapshot export blocks the inbox while it runs. That's about 2 s on the sample catalog (90 requests); it grows with the number of tables, since lineage is one request per table and metric.
- Derived fields that change without a change event (tag and term `usageCount`, for example) reach apps only through the periodic diff.
- `by` isn't mapped to an OpenMetadata user yet. The verified identity goes into the feed, the reply and the audit row as-is.
- An audit row can be written twice if the worker dies between the BigQuery insert and recording that it happened.

## Not run here

There are no Google credentials, GCS bucket or BigQuery dataset on the development machine, so these are covered by unit tests with fakes only:

- **GCS** (`storage/gcs.py`): the fake (`tests/test_gcs.py`) mirrors google-cloud-storage's `get_blob`, `download_as_bytes`, `upload_from_string(if_generation_match=…)` and `list_blobs(prefix, start_offset)`. The whole worker loop also runs on it once.
- **Google ID tokens** (`identity.py`): tested with a stub verifier. The real path calls `google.oauth2.id_token.verify_oauth2_token`, which fetches Google's certificates.
- **BigQuery** (`audit.py`): table creation and the parameterized insert, against a fake client.

## Tests

```sh
npm run worker:test
# or: cd worker && uv run pytest
```

`tests/test_integration_om.py` runs against the OpenMetadata in `.env`. It queues a description PATCH on a table, checks the reply, the feed event (the whole entity) and `head.json`, then restores the description. It's skipped when OpenMetadata isn't reachable.
