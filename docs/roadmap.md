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
| SSO and per-user identity | Not yet | Today the server acts as one bot. See "Identity" below. |
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

The server holds one OpenMetadata credential (a bot token), so every edit is attributed to that bot. Next step: sign people in with Google (the same identity BigQuery uses), have OpenMetadata trust the same provider, and forward each person's token from the server so OpenMetadata's roles and audit trail apply per person. BigQuery queries can run as the person too (OAuth with the BigQuery scope) instead of the server's service account.

## Deployment

Today: OpenMetadata via its Docker Compose, the app as one Node process (`npm run build && npm start`). For a team: OpenMetadata on GKE (its Helm chart) with Cloud SQL (MySQL or Postgres) and a managed search cluster; the app on Cloud Run behind IAP, using Workload Identity for BigQuery.

## Check against a real OpenMetadata

Checked on a local OpenMetadata 2.0.8 (seeded with `npm run seed:om`): every list, detail, profile, lineage, query, test and pipeline call the pages make answers 200. Fixed from that run: aggregation keys are renamed by the server (`sterms#ownerDisplayName`), lineage nodes are keyed by FQN and edge SQL can be a `sqlQueryKey`, and feed posts take the author from the token (a `from` field is rejected). Still to confirm in the browser and with real ingestion:

- **Certification.** 2.x stores it in a separate `certification` field. The app currently treats it as a `Certification.*` tag (Insights counts both). Move the header editor to the real field.
- **Search field names.** Facets and counts use `owners.displayName.keyword`, `domains.fullyQualifiedName`, `certification.tagLabel.tagFQN`, `service.name(.keyword)`, `database.fullyQualifiedName(.keyword)`. Followed assets match `followers` (real index) or `followers.id` (demo).
- **Incidents.** Acknowledge, assign and resolve POST a resolution status; 2.0.8 may expect its task-based transitions instead.
- **Ingestion.** Trigger, deploy and kill return a runner response, not the pipeline. "Test connection" (`/automations/workflows`) isn't built.
- **BigQuery connection.** `gcp_adc` credentials, and `projectId` as a string or an array.
- **Domain rules.** The server may refuse to add an asset to a data product in another domain, and glossary status changes may go through an approval workflow. The UI shows server errors as they come.

## Housekeeping

- The UI ships as one 1.6 MB script. Lazy-load the heavy pages (workbench, lineage, chart pages) when it starts to matter.
