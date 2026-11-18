# Roadmap

How OpenMetadata's features map to this app, and what comes next. "Backend" means OpenMetadata already does the work and we only need UI; "ours" means we build it.

## OpenMetadata parity

| OpenMetadata feature | Status | Notes |
| --- | --- | --- |
| Search and explore with facets | Built | `/search/query` and `/search/aggregate`. |
| Table pages: schema, nested columns, descriptions, tags | Built | Edits are JSON Patch, like OpenMetadata's UI. |
| Owners, tiers, certification, domains on assets | Built (domain read-only on assets) | Assigning a domain from the asset page is next. |
| Lineage (table, column mappings, SQL), manual edges | Built | Column-level drawing in the graph is next; mappings show per edge. |
| Profiler: table and column metrics over time | Built | Backend runs the BigQuery profiler pipeline. |
| Sample data | Built | |
| Queries and usage | Built | From BigQuery `INFORMATION_SCHEMA.JOBS` via the usage pipeline. |
| Conversations on assets | Built | Feed API. Tasks (request description/tags, approvals) are next. |
| Version history | Built | Field-level diff view is next. |
| Glossary, terms, classifications, tags | Built | Glossary approval workflow (reviewers, In Review status) partly. |
| Domains, data products | Built | |
| Data quality: test cases, results, incidents | Built | Test suites (logical/executable) and alerts on failures next. |
| Data insights: coverage | Built (search-based) | OpenMetadata's Data Insights app has history (KPIs over time); wire it in later. |
| Services, ingestion pipelines, run history | Built | Pipelines deploy to OpenMetadata's Airflow. |
| Teams and users | Built (read, create team) | Roles and policies admin is next. |
| Followers | Built | |
| Custom properties | Not yet | `extension` is loaded; needs a typed editor. |
| Data contracts | Not yet | OpenMetadata 2.x has them (`contractAPI.ts`). |
| Announcements | Shown in activity | Creating them is next. |
| Alerts and notifications | Not yet | Backend has event subscriptions (Slack, email, webhooks). |
| Auto-classification (PII detection) | Pipeline type only | Review queue for suggested tags is next. |
| dbt ingestion | Pipeline type only | Shows dbt model SQL and tests as lineage and quality once run. |
| SSO and per-user identity | Partly (team backend) | The team backend signs people in with Google, attributes every change to their OpenMetadata user, and can act as them through OpenMetadata's bot impersonation (`TEAM_IMPERSONATE`). Direct mode still acts as one bot. See "Identity" below. |
| Dashboards, pipelines, topics, ML models | Not in scope yet | BigQuery-first. Looker or Airflow services are the likely next ones. |

## Ours: Malloy and beyond

Done:

- Malloy models compile against catalog schemas (no BigQuery credentials needed to compile).
- Workbench with live outline, query runner, charts and SQL.
- Table page shows the Malloy sources on each table; scaffold a source from a table.
- **Semantic model catalog.** Every source with its table, primary key, joins (nested), dimensions, measures and views; each field's description, glossary term and Malloy definition (cut from the model by source location).
- **Metrics catalog.** Every measure across models, searchable, with its kind (simple, filtered, ratio, derived), definition, glossary term, the measures it's built from and the tables it reads.
- **Query builder** with saved views. Measures, group-bys through joins with time grains, filters, order, limit, prior period (`lag`) and running totals (`sum_cumulative`). URL state, Malloy and SQL tabs, "Open in workbench", "Copy Malloy". Saved queries become `view:`s in the model file.
- **Join graph** per source: pick a measure and a dimension to see the path, the grain, whether a join fans out, and the symmetric-aggregate SQL Malloy writes for it.
- **Metric patterns** in `malloy/ecommerce.malloy`: annotated simple, filtered, ratio, derived, cross-join (symmetric), period-over-period and running-total examples, and an `orders` source with a `join_many`.
- **Cost guardrails.** Every run is dry-run first; bytes against `BQ_MAX_BYTES_BILLED` and the row limit show before it runs, and a query over the cap is refused. Compile-only is stated when credentials are missing.
- **Malloy measures as catalog metrics**, published as OpenMetadata `metric` entities (definition, type, unit, assets, related metrics, filters, glossary tag). Checked against a local 2.0.8.
- **Malloy lineage**, as table → metric edges. OpenMetadata has no entity for a Malloy source, so the edges point at the metrics.
- **Glossary-linked measures** on the term page, flagging terms with no implementation or several different ones.

Next, roughly in order:

1. **Quality tests in Malloy.** Define tests as Malloy queries (`expect` a measure in a range) and run them as OpenMetadata test cases.
2. **Editor.** CodeMirror with Malloy syntax highlighting and completions from the outline.
3. **Rows without BigQuery.** A DuckDB connection (`@malloydata/db-duckdb`) over sample data in demo mode, so the builder returns real rows offline. Costs a native dependency (~40 MB) and a sample of the data (Parquet files, or generated rows) that would drift from BigQuery's dialect and data.
4. **Builder polish.** Filter value suggestions from the profiler's top values, `having:` filters on measures, nested views (`nest:`), a pivot table, and metric owners and units from annotations (`# owner=`, `# unit=`).
5. **Published metrics in the UI.** Show a metric entity's owner, tags and followers next to its Malloy definition, and remove metrics whose measure was deleted.

## Identity

In direct mode the server holds one OpenMetadata credential (a bot token), so every edit is attributed to that bot.

The team backend ([team-backend.md](team-backend.md)) signs each person in with Google and the worker verifies the ID token (written to Google's documented endpoints; not yet run against a real OAuth client). It maps the person to their OpenMetadata user and records `byUser` in replies, the feed and the BigQuery audit table. OpenMetadata 2.0.8 supports a bot acting for a user: a bot created with `allowImpersonation: true` (admin only) and a role granting `Impersonate` sends `X-Impersonate-User`, and OpenMetadata applies that user's permissions and stores them as `updatedBy`, with the bot as `impersonatedBy`. Credential, bot, policy and role endpoints refuse impersonated requests. The worker uses this with `TEAM_IMPERSONATE=true` (checked against the local server). Next: the same for direct mode, either through the same bot or by having OpenMetadata trust Google sign-in and forwarding each person's token. BigQuery queries already run as the person in team mode.

## Deployment

Today: OpenMetadata via its Docker Compose, the app as one Node process (`npm run build && npm start`).

Pilot: test users run the team backend on their own machines (`npm run pilot`), with the bucket in a folder in their app data and the worker, which would be a Vertex AI job on Google Cloud, running locally. Next: easier ways for a team to share the app without a central server. For a team: OpenMetadata on GKE (its Helm chart) with Cloud SQL (MySQL or Postgres) and a managed search cluster; the app on Cloud Run behind IAP, using Workload Identity for BigQuery.

## Check against a real OpenMetadata

Checked on a local OpenMetadata 2.0.8 (seeded with `npm run seed:om`): every list, detail, profile, lineage, query, test and pipeline call the pages make answers 200. Fixed from that run: aggregation keys are renamed by the server (`sterms#ownerDisplayName`), lineage nodes are keyed by FQN and edge SQL can be a `sqlQueryKey`, and feed posts take the author from the token (a `from` field is rejected). Still to confirm in the browser and with real ingestion:

- **Certification.** Done: the header editor, badges, search results, the Explore facet and Insights use 2.x's `certification` field, falling back to `Certification.*` tags. The PATCH was checked against the local server: it sets `appliedDate` and `expiryDate` itself (30 days by default, from the certification settings). 2.x silently drops `Certification.*` tags sent in `tags`, which is why earlier tag-based edits didn't stick.
- **Search field names.** Facets and counts use `owners.displayName.keyword`, `domains.fullyQualifiedName`, `certification.tagLabel.tagFQN`, `service.name(.keyword)`, `database.fullyQualifiedName(.keyword)`. Followed assets match `followers` (real index) or `followers.id` (demo).
- **Incidents.** Acknowledge, assign and resolve POST a resolution status; 2.0.8 may expect its task-based transitions instead.
- **Ingestion.** Trigger, deploy and kill return a runner response, not the pipeline. "Test connection" (`/automations/workflows`) isn't built.
- **BigQuery connection.** `gcp_adc` credentials, and `projectId` as a string or an array.
- **Domain rules.** The server may refuse to add an asset to a data product in another domain, and glossary status changes may go through an approval workflow. The UI shows server errors as they come.

## Housekeeping

- Done: the heavy pages (table, lineage, quality, test case, insights, query builder, semantic source, Malloy workbench) load on first visit. The entry script went from 1.65 MB to 678 KB; recharts and @xyflow/react are separate chunks. The entry still carries React, Radix and react-markdown; splitting further would mean lazy-loading markdown rendering.
