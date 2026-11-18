# Team backend: one worker, a bucket, and everyone's laptop

How MonoRail Metadata runs for a team that has **Google sign-in, a GCS bucket, a BigQuery dataset, and one long-running Python job** (a Vertex AI custom job), but no web server anyone can reach. This document is the contract between the app and the worker. Change it first, then both sides.

## Shape

```
 Each teammate (localhost)                        Bucket (GCS, or a local folder)          Worker (Python, one process)
 ───────────────────────────                      ───────────────────────────────          ────────────────────────────
 UI ─▶ app server (Node)                                                                    holds the OpenMetadata bot token
       reads: in-memory replica  ◀── load ─────  state/catalog/*      ◀── snapshot ─────  exports the catalog from OpenMetadata
                                 ◀── poll ─────  feed/head.json, feed/{seq}  ◀── append ──  one event per change
       writes: request file      ── create ──▶  inbox/{id}.json      ── list ──────────▶  verifies identity, applies to OpenMetadata
                                 ◀── poll ─────  outbox/{id}.json     ◀── write ─────────  reply
       banner if stale           ◀── read ─────  system/heartbeat.json ◀── every 15 s ───  lease + heartbeat
       Malloy ─▶ BigQuery (as the person)                                                    ─▶ OpenMetadata REST (only client)
                                                                                             ─▶ BigQuery events table (audit, optional)
                                                                                             ─▶ ingestion runs (later phase)
```

- **The worker is the only writer** of shared state and the only client of OpenMetadata. OpenMetadata runs next to it: on a developer's machine for now (`deploy/openmetadata`), later in the same container as the worker.
- **Reads never wait on the worker.** The app loads a snapshot of the catalog and keeps it current from the change feed, then answers OpenMetadata read endpoints from memory with the same code as the demo catalog (`server/om/demo`). If the worker is down, people can still browse.
- **Writes are request files.** The app writes `inbox/{id}.json`; the worker applies it, appends a feed event, and writes `outbox/{id}.json`. A round trip is about 1–3 s.
- **Malloy runs in each person's app**, against BigQuery with their own credentials. It never goes through the worker.

`APP_BACKEND` picks the mode in the app: `demo` (in-process fixtures), `direct` (the app calls OpenMetadata at `OM_URL`, as before), or `team` (this document). Locally, the bucket is a folder; `TEAM_BUCKET=gs://bucket/prefix` switches to GCS without changing anything else.

## Bucket layout

All paths are relative to the bucket root (`TEAM_BUCKET`, a `gs://bucket/prefix` URL or a local folder path).

| Path | Written by | Read by | Contents |
| --- | --- | --- | --- |
| `inbox/{id}.json` | apps (create only) | worker | A request. `id` is a ULID, so names sort by time. |
| `outbox/{id}.json` | worker | the app that sent `{id}` | The reply. |
| `feed/head.json` | worker | apps (poll) | `{ "seq": 123, "ts": 1794… }`, the latest feed sequence number. |
| `feed/{seq}.json` | worker | apps | One feed event. `seq` zero-padded to 12 digits. |
| `state/catalog/manifest.json` | worker | apps | Which snapshot files make up the catalog, and the feed `seq` they include. |
| `state/catalog/{name}.json.gz` | worker | apps | Snapshot files (gzipped JSON arrays). |
| `system/heartbeat.json` | worker | apps | Liveness. |
| `system/lease.json` | worker | worker | Leader lease, so two workers never both process requests. |
| `system/cursor.json` | worker | worker | The last processed inbox id and other worker bookkeeping. |

Writes of JSON files are atomic: GCS objects are replaced whole, and the local backend writes a temp file then renames. Requests are created with "only if it doesn't exist" (`ifGenerationMatch=0` on GCS, exclusive create locally).

Retention: `inbox/` and `outbox/` objects can be deleted after 7 days (a GCS lifecycle rule; the local backend's worker cleans up on the same schedule). Feed events older than the current snapshot's `seq` can be deleted after 7 days.

## Identity

Every request carries proof of who sent it. The worker never trusts a name the client typed.

```json
"auth": { "kind": "google", "idToken": "<Google ID token (JWT)>" }
"auth": { "kind": "local",  "user": "ada.park" }
```

- `google`: the worker verifies the token (`google.oauth2.id_token.verify_oauth2_token`) against `GOOGLE_OAUTH_CLIENT_ID`, checks expiry, and checks the email against `TEAM_ALLOWED_DOMAINS` / `TEAM_ALLOWED_EMAILS`. The verified email becomes `by`.
- `local`: accepted only when the worker runs with `TEAM_AUTH=local` (development on one machine). `user` becomes `by` as-is.

The worker maps `by` to an OpenMetadata user for the audit trail. **[worker edit]** An email matches a user's `email` (case-insensitive); anything else matches a user's `name`. The users come from the snapshot and the feed; on a miss the worker asks OpenMetadata once (`GET /users/name/{name}`, or for an email `GET /users/name/{local part}`, accepted only if that user's email matches). The match is recorded as `byUser: { "id", "name" }` in the reply, the feed event and the audit row, next to `by`; it is `null` when no user matches. `by` itself doesn't change: it is still the verified identity.

**[worker edit]** OpenMetadata itself sees the worker's bot, unless impersonation is on. With `TEAM_IMPERSONATE=true` the worker sends each `om` request with `X-Impersonate-User: <byUser.name>`, so OpenMetadata applies that person's permissions and records them as `updatedBy` (with the bot as `impersonatedBy`). This is OpenMetadata 2.0.8's bot impersonation: `OM_TOKEN` must be a bot's JWT, the bot must have been created with `allowImpersonation: true` (admin only), and its roles must allow the `Impersonate` operation on the target user (`BotImpersonationRole`, or `BotNonAdminImpersonationRole` to keep it from acting as admins and bots). OpenMetadata refuses impersonated requests to credential endpoints (tokens, bots, users' auth mechanisms, policies, roles). Use it with `TEAM_AUTH=google`: with `local`, `by` is a typed name (the worker warns at start). A request whose `by` matches no user goes as the bot, as before. The worker's own reads (snapshot, re-reads, change events) never impersonate.

## Request

```json
{
  "v": 1,
  "id": "01JD3X8Q4M2N7T6R5V9W0YZABC",
  "ts": 1794956000000,
  "auth": { "kind": "local", "user": "ada.park" },
  "op": "om",
  "method": "PATCH",
  "path": "/tables/0a51e62b-5121-48a5-8aa6-86888b01be67",
  "query": { "fields": "owners" },
  "headers": { "Content-Type": "application/json-patch+json" },
  "body": [{ "op": "replace", "path": "/description", "value": "One row per order item." }],
  "client": { "app": "monorail-metadata", "version": "0.1.0" }
}
```

| `op` | Meaning |
| --- | --- |
| `om` | One OpenMetadata REST call (`method`, `path` relative to `/api/v1`, `query`, `headers`, `body`). The worker checks it against the allowlist below. Writes and reads the replica doesn't hold (profile history, sample data, versions, test results, activity) both use this. |
| `echo` | Replies with the request's `body` and the resolved identity. For latency checks. |
| `resync` | Asks the worker to rebuild the catalog snapshot now. |

**Allowlist** for `om`: `GET` on any path except `/bots`, `/system/settings`, `/users/generateToken`, `/users/token`, `/users/auth-mechanism`; `PUT`, `POST`, `PATCH` and `DELETE` on entity collections (`tables`, `databases`, `databaseSchemas`, `glossaries`, `glossaryTerms`, `classifications`, `tags`, `domains`, `dataProducts`, `metrics`, `queries`, `teams`, `dataQuality/*`, `services/ingestionPipelines`), `lineage`, `feed`, `usage`, `followers` and `votes` sub-resources. Anything else is refused with status 403. Service connections with credentials are never created through the queue; an admin does that directly.

**[app edit]** The lists live in one file, `worker/src/monorail_worker/allowlist.json`, read by the worker (`allowlist.py`) and by the app (`server/team/allowlist.ts`). The app checks every `om` request before writing it to `inbox/` and refuses what the worker would refuse, with the same 403 and message, without queueing it. The worker still checks. `worker/tests/allowlist_cases.json` holds the cases both copies are tested against.

## Reply

```json
{
  "v": 1,
  "id": "01JD3X8Q4M2N7T6R5V9W0YZABC",
  "ts": 1794956001400,
  "ok": true,
  "status": 200,
  "body": { "id": "0a51e62b-…", "description": "One row per order item.", "...": "..." },
  "error": null,
  "by": "ada.park",
  "byUser": { "id": "5d1c…", "name": "ada.park" },
  "feedSeq": 124
}
```

- `status` and `body` are OpenMetadata's answer, passed through. `ok` is `status < 400`.
- `error` is set when the worker refused or failed before calling OpenMetadata (`{"code": "forbidden" | "unauthenticated" | "invalid" | "internal" | "expired", "message": "…"}`), with `status` 400–500. **[worker edit]** Statuses: `invalid` 400, `unauthenticated` 401, `forbidden` 403, `expired` 410, `internal` 500. One `internal` case does follow a call: if the worker restarts in the middle of a `PATCH` or `POST`, it doesn't send it again (it may already have been applied); it replies `internal` with a message saying so, and still publishes the entity's current state, so `feedSeq` can be set on that error reply.
- **[worker edit]** Reply bodies and feed entities go through the same secret stripping as the snapshot.
- `feedSeq` is the feed event this request produced (null for reads). The app waits until its replica has applied that `seq` before it reports the write as done, so a page that refetches after saving sees its own change.

## Feed event

```json
{
  "seq": 124,
  "ts": 1794956001300,
  "by": "ada.park",
  "byUser": { "id": "5d1c…", "name": "ada.park" },
  "requestId": "01JD3X8Q4M2N7T6R5V9W0YZABC",
  "source": "request",
  "changes": [
    { "op": "upsert", "entityType": "table", "entity": { "id": "…", "fullyQualifiedName": "…", "...": "..." } },
    { "op": "delete", "entityType": "table", "id": "…" },
    { "op": "lineage.upsert", "edge": { "fromEntity": { "id": "…", "type": "table", "fullyQualifiedName": "…" }, "toEntity": { "...": "..." }, "sqlQuery": "…", "source": "Manual", "columns": [] } },
    { "op": "lineage.delete", "fromId": "…", "toId": "…" },
    { "op": "profile.upsert", "profile": { "id": "…", "fullyQualifiedName": "…", "profile": { "timestamp": 1794873600000, "rowCount": 118000, "...": "..." }, "columns": [{ "fullyQualifiedName": "…", "profile": { "...": "..." } }] } },
    { "op": "profile.delete", "tableId": "…" },
    { "op": "resync" }
  ]
}
```

- `source`: `request` (a queued write), `om-events` (a change made in OpenMetadata some other way, e.g. by ingestion or its own UI, picked up from OpenMetadata's change events), or `resync` (a new snapshot).
- `upsert` carries the **whole entity as OpenMetadata returns it with `fields=*`**, after the change. Apps replace their copy; they never merge.
- After a write, the worker re-reads every entity it touched (and, for lineage, the edge) and puts them in one event.
- **[worker edit]** `profile.upsert` replaces a table's latest profile (the record shape under "Snapshot"); `profile.delete` drops it. A queued profile write (`PUT /tables/{id}/tableProfile`, `DELETE /tables/{fqn}/{table|column}/{timestamp}/profile`) re-reads the latest profile into the same event. **OpenMetadata 2.0.8 records no change event for profile writes** (checked against the local server: `PUT /tables/{id}/tableProfile`, which the profiler calls, writes the time-series table directly), so profiles written by the profiler reach apps through the periodic snapshot diff, within `TEAM_SNAPSHOT_MINUTES`. Deleting a table drops its profile too.
- **[worker edit]** `byUser` is the OpenMetadata user `by` maps to (see "Identity"), or `null`. For `om-events`, `by` is OpenMetadata's `userName` when one user made every change in the batch.
- `resync` tells apps to reload the snapshot (it's emitted after a full rebuild, or when the worker can't express a change as upserts). **[worker edit]** The worker writes the new snapshot first, with `manifest.seq` equal to the resync event's own `seq`, then the event. So after reloading, an app applies only events after the resync and never sees it again. A resync can be `source: "request"` (a write the worker couldn't express, e.g. a rename, which changes FQNs elsewhere) or `source: "resync"`.

## Snapshot

`state/catalog/manifest.json`:

```json
{
  "v": 1,
  "seq": 120,
  "ts": 1794955000000,
  "omVersion": "2.0.8",
  "files": {
    "entities": [
      { "entityType": "table", "path": "tables", "file": "table.json.gz", "count": 20 },
      { "entityType": "glossaryTerm", "path": "glossaryTerms", "file": "glossaryTerm.json.gz", "count": 12 }
    ],
    "lineage": { "file": "lineage.json.gz", "count": 18 },
    "profiles": { "file": "tableProfile.json.gz", "count": 20 }
  }
}
```

- Each entity file is a JSON array of entities as OpenMetadata returns them with `fields=*` (or the widest field list that collection accepts). `path` is the REST collection, so the app can serve `/{path}`, `/{path}/{id}` and `/{path}/name/{fqn}`.
- Collections: `services/databaseServices`, `databases`, `databaseSchemas`, `tables`, `queries`, `metrics`, `users`, `teams`, `classifications`, `tags`, `glossaries`, `glossaryTerms`, `domains`, `dataProducts`, `dataQuality/testDefinitions`, `dataQuality/testSuites`, `dataQuality/testCases`, `services/ingestionPipelines`.
- Secrets never go in a snapshot. Service `connection.config` keeps only non-secret fields (type, host, project ids, usage location); bot and auth fields are dropped.
- `lineage.json.gz` is an array of edges in the feed's `lineage.upsert` shape. **[worker edit]** Edges always carry the SQL as `sqlQuery` when there is any (OpenMetadata 2.0.8's `getLineage` sends a `sqlQueryKey` instead; the worker resolves it). `columns` is `[{ "fromColumns": [...], "toColumn": "..." }]`.
- **[worker edit]** `profiles` is each table's latest profile, from `GET /tables/{fqn}/tableProfile/latest?includeColumnProfile=true`, as an array of records `{ "id", "fullyQualifiedName", "profile", "columns": [{ "fullyQualifiedName", "profile" }] }`: the table's id and FQN, its latest table profile, and the latest profile of each profiled column (nested columns flattened). Tables with no profile at all are left out. The worker re-reads every table's latest profile on each snapshot cycle and publishes differences as `profile.upsert` / `profile.delete`. A manifest without `profiles` (an older worker) means the app doesn't hold profiles.
- **[worker edit]** File names are unique per snapshot (`table.1794955000000.json.gz`, `lineage.1794955000000.json.gz`), so a reader holding the previous manifest never gets a newer file under the same name. Always take the name from `file`. Files no manifest refers to are deleted after an hour.
- The worker writes the files first and the manifest last, so a reader never sees a manifest pointing at files that aren't there yet. `seq` is the last feed event already reflected in the files: apps apply events with a higher `seq`.
- The worker rebuilds the snapshot on start, on `resync`, and every `TEAM_SNAPSHOT_MINUTES` (default 30) if anything changed.

## Liveness and the lease

- `system/heartbeat.json`: `{ "worker": "<host>:<pid>", "ts": …, "startedAt": …, "seq": …, "omUrl": "…", "omVersion": "2.0.8", "version": "0.1.0", "inboxBacklog": 0, "role": "leader" }`, written every 15 s. **[worker edit]** `role` is `leader` or `standby`. A standby writes the heartbeat only when the current one is more than 45 s old, so two workers don't take turns overwriting it. Apps call the backend **offline** when `ts` is older than 60 s, and say that writes are queued. **[worker edit]** `omVersion` is OpenMetadata's `GET /system/version`, read before the first heartbeat (by standbys too) and again at most once a minute while it's unknown, so it is empty only while OpenMetadata can't be reached.
- `system/lease.json`: `{ "holder": "<host>:<pid>", "expires": … }`, renewed every 10 s for 30 s, with compare-and-swap (GCS generation match; locally an exclusive lock file). A worker that doesn't hold the lease only heartbeats.

## Processing rules (worker)

1. List `inbox/` from the cursor in id order. **[worker edit]** The listing starts 5 minutes before the cursor's time (ids already answered are skipped). That way a request from an app whose clock runs up to 5 minutes behind the worker's still gets processed, even though its id sorts below the cursor.
2. For each request: if `outbox/{id}.json` exists, skip (already done). Verify identity and the allowlist. Call OpenMetadata. On success for a write, re-read what changed, append the feed event (`feed/{seq}.json`, then `feed/head.json`), append the audit row. Then write the reply. Then advance the cursor.
3. Requests are handled one at a time, in order. A request older than `TEAM_REQUEST_TTL_MINUTES` (default 60) that was never processed gets a reply with `error.code = "expired"` instead of being applied, so a write queued during a long outage doesn't land on a page that has moved on.
4. Poll OpenMetadata's change events every `TEAM_OM_EVENTS_SECONDS` (default 30) for changes made outside the queue, and publish them as `om-events` feed events.
5. **[worker edit]** The endpoint is `GET /api/v1/events?entityCreated=*&entityUpdated=*&entityRestored=*&entityDeleted=*&timestamp=…&limit=1000&after=…` (admin or bot only). The worker re-reads each changed entity and skips any it already published (the change events for its own writes). **Lineage edits produce no change events in 2.0.8.** So the periodic snapshot also diffs the export against what apps hold, and publishes any differences (lineage edges included) as an `om-events` event before writing the new snapshot. Apps see lineage edits made outside the queue within `TEAM_SNAPSHOT_MINUTES`. On start, the same diff covers changes made while the worker was down.

## App rules

1. On start: read the manifest, load every snapshot file into the in-memory catalog, then read `feed/head.json` and apply events from `manifest.seq + 1` up to it.
2. Poll `feed/head.json` every 3 s; apply new events in order. A missing event, or `resync`, means reload the snapshot.
3. Answer OpenMetadata `GET`s from the replica when it holds them (entities, lists, search, aggregates, lineage, and **[app edit]** `/tables/{fqn}/tableProfile/latest` when the snapshot carries `profiles`); send the rest to the worker as `om` reads. Profile history (`/tables/{fqn}/tableProfile`, `/columnProfile`) stays a queued read.
4. **[app edit]** Check `om` requests against the allowlist before queueing them (see "Allowlist").
5. Send every write as a request, wait for the reply (polling `outbox/{id}.json`: 250 ms, backing off to 2 s, giving up after 30 s with "queued, still waiting"), then wait until the replica has applied `feedSeq`, then return the reply to the UI.

## BigQuery (optional, worker only)

If `TEAM_BQ_DATASET` is set, the worker appends one row per change in each feed event (**[worker edit]** an event with three changes is three rows sharing `seq`; lineage rows have `entity_type = "lineageEdge"` and `entity_id = "<fromId>-><toId>"`) to `{dataset}.metadata_events` (`seq`, `ts`, `by`, **[worker edit]** `by_user_id`, `by_user_name`, `request_id`, `source`, `entity_type`, `entity_id`, `op`, `entity` JSON; a table made by an older worker gets the two new columns added on start; profile rows have `entity_type = "tableProfile"` and the table's id), partitioned by day and clustered by `entity_type, entity_id`. It's the audit trail and the basis for team analytics. Rows go in through the Storage Write API or parameterized inserts, never values pasted into SQL text (other teams in the project can read query history). Activity threads and anything private stay in the bucket, not BigQuery.

## Moving to Google Cloud

- **Bucket:** uniform bucket-level access. Team group: `objectCreator` on `inbox/`, `objectViewer` on the rest (IAM Conditions on `resource.name` prefixes). Worker service account: `objectAdmin`. Lifecycle rules as above.
- **Worker:** the same Python package in a container with OpenMetadata, as a Vertex AI custom job. Its successor-submission and lease handoff cover the job's maximum runtime.
- **[worker edit] Successor jobs.** A custom job stops at its `scheduling.timeout` (7 days by default). With `TEAM_VERTEX_SUCCESSOR=true` (plus `TEAM_VERTEX_PROJECT`, `TEAM_VERTEX_REGION` and `TEAM_VERTEX_JOB_SPEC`, a CustomJob as JSON), the leader works out its deadline (the job's `startTime` plus its timeout, read through `CLOUD_ML_JOB_ID`; otherwise the process start plus `TEAM_VERTEX_MAX_RUNTIME_HOURS`), and `TEAM_VERTEX_LEAD_MINUTES` (60) before it, submits a successor with the spec through `JobServiceClient.create_custom_job`. The submission is recorded in `system/cursor.json` (`successor`), so a restart or a new leader in the same job doesn't submit twice. The successor starts as a standby. `TEAM_VERTEX_STOP_MINUTES` (5) before the deadline the old worker releases the lease and exits, and the successor takes the lease within 10 s. If the successor never starts, nothing is lost: requests wait in `inbox/`. The worker's service account needs `aiplatform.customJobs.create` (and `aiplatform.customJobs.get` to read its own deadline), for example through `roles/aiplatform.user`, plus `iam.serviceAccounts.actAs` on the service account the spec runs as.
- **App:** each teammate signs in with Google (an internal OAuth client, scopes `openid email devstorage.read_write bigquery`). The app sends the ID token in requests and uses the access token for the bucket and for Malloy's BigQuery queries.
