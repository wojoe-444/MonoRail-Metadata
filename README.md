# MonoRail Metadata

A metadata platform for BigQuery: search and browse the catalog, document and govern it, follow lineage, watch data quality, and define metrics once in Malloy. It runs on [OpenMetadata](https://open-metadata.org) 2.0.8 as a headless backend, with our own UI (the [MonoRail UI](https://github.com/wojoe-444/monorail-ui) design system) and server on top.

```
browser ──▶ server/ (Hono, :8787) ──/api/om/*────▶ OpenMetadata 2.0.8 REST API  (or the built-in demo catalog)
                    └──/api/malloy/*──▶ Malloy ──▶ BigQuery  (table schemas from the catalog)
```

Why this shape: OpenMetadata already does the hard backend work (a typed metadata store, search, versioning, lineage, ingestion connectors for BigQuery, profiler, data quality runner, Airflow scheduling). We keep all of that and own everything people see and touch, so we can change the experience, add Malloy, and build features OpenMetadata doesn't have, without forking it.

## Run it

```sh
npm install
npm run dev
```

Open http://localhost:5173. With no configuration it runs on the **demo catalog**: the server answers OpenMetadata's API itself, over BigQuery's public `thelook_ecommerce` dataset plus a modeled `acme-analytics` layer (staging, marts, reporting) with lineage, profiles, sample rows, queries, a glossary, tags, domains and data products. Edits last until the server restarts.

To use a real OpenMetadata, start it from [`deploy/openmetadata`](deploy/openmetadata/README.md), set `OM_URL` in `.env` (copy `.env.example`), and optionally `npm run seed:om` to fill it with the same sample content. To run Malloy queries, set `BQ_PROJECT_ID` and sign in with `gcloud auth application-default login`.

## Running it for a team

For a team with Google sign-in, a GCS bucket, a BigQuery dataset and one long-running Python job, but no server people can reach, the app runs on each person's machine and shares one backend through the bucket ([docs/team-backend.md](docs/team-backend.md)):

- A **worker** (`worker/`, Python) is the only thing that talks to OpenMetadata. It publishes a snapshot of the catalog and a change feed to the bucket, and applies everyone's changes from request files.
- Each **app** (`APP_BACKEND=team`) loads the snapshot, follows the feed, answers reads from memory (entities, search, lineage, and each table's latest profile), and sends changes to the worker. Browsing keeps working when the worker is down; changes queue. A request the worker would refuse is refused by the app at once, from the same allowlist.
- Every change records who made it: the worker maps the signed-in person to their OpenMetadata user (`byUser` in the feed and the audit table). With `TEAM_IMPERSONATE=true` and a bot created with `allowImpersonation`, OpenMetadata itself applies that person's permissions and shows them as `updatedBy`.

### Pilot

While test users pilot the app, each tester runs the whole team backend on their own machine. The bucket is a folder in their app data, and the worker (framed as the Vertex AI job in the Google Cloud setup) runs locally next to a local OpenMetadata:

1. Start OpenMetadata ([deploy/openmetadata](deploy/openmetadata/README.md)): `cd deploy/openmetadata && docker compose up -d`.
2. Copy `.env.example` to `.env` and set `OM_URL=http://localhost:8585` and `OM_TOKEN` (or `OM_EMAIL`/`OM_PASSWORD`). Optionally `npm run seed:om` for the sample catalog.
3. Install [uv](https://docs.astral.sh/uv/) for the worker, then:

```sh
npm install
npm run pilot      # the UI, the app server with APP_BACKEND=team, and the worker, together
```

The bucket folder is `%LOCALAPPDATA%\MonoRail-Metadata\team-bucket` on Windows (`~/Library/Application Support/MonoRail-Metadata/team-bucket` on macOS, `~/.local/share/monorail-metadata/team-bucket` on Linux). Set `TEAM_BUCKET` to use another folder. The app and the worker work out the same default, and the server prints the path it uses on start. Deleting the folder loses nothing that matters: OpenMetadata holds the catalog, and the worker rebuilds the snapshot on its next start.

**Coming:** easier ways for a team to share the app without a central server. For now, a pilot installation is one person's.

The two halves can also run separately: `npm run worker`, and the app with `APP_BACKEND=team` in `.env` and `npm run dev`.

`TEAM_BUCKET=gs://bucket/prefix` and `TEAM_AUTH=google` switch to Google Cloud Storage and Google sign-in. On Vertex AI, `TEAM_VERTEX_SUCCESSOR=true` has the worker start its own successor job before the job's maximum runtime ([worker/README.md](worker/README.md#vertex-ai-successor-jobs)).

## What's in it

| Area | Pages |
| --- | --- |
| **Discover** | Home (search, catalog health, most used, following, recent changes). Explore (full-text search with facets for type, project, dataset, owner, domain, tier, certification, tags; URL-addressable). Table pages with schema (nested columns, per-column descriptions and tags), lineage, profiler, data quality, Malloy, sample data, queries, view definition, conversations and version history. Full-screen lineage with manual edges. |
| **Semantic layer** | Semantic models: every Malloy source with its table, key and joins, each field's description, glossary term and definition, and a join graph that explains grain and fan-out. Metrics: every measure, searchable, by kind; publish them to the catalog. Query builder: measures, group-bys through joins with time grains, filters, prior period and running totals; shows the Malloy and SQL, dry-runs for cost, runs, saves as a view. Malloy models: list, workbench (editor, live outline, query runner with charts and SQL), and each table's Malloy sources. Scaffold a source from any table. |
| **Govern** | Glossary and terms, classifications and tags, domains and data products. Owners, tiers, certification and tags editable on every asset. Certification is OpenMetadata 2.x's own field (with its applied and expiry dates); older `Certification.*` tags are still read. |
| **Observe** | Data quality (test cases, results, incidents, add tests from a table), insights (documentation, ownership, tier and PII coverage). |
| **Administer** | Services (BigQuery connection, ingestion pipelines and runs), browse projects and datasets, teams and users, connection status in Settings. |

[docs/roadmap.md](docs/roadmap.md) maps OpenMetadata's features to what's built, and lists what's next.

## Malloy and the catalog

Malloy models live in [`malloy/`](malloy) as plain `.malloy` files (edit them in the workbench or your editor). The server compiles them with a BigQuery connection that reads table schemas **from OpenMetadata first**, so:

- models compile, show their fields and generate SQL without BigQuery credentials;
- the schema Malloy sees is the one documented in the catalog;
- each table page lists the Malloy sources built on it.

Running a query needs BigQuery credentials on the server. Every run is dry-run first: the page shows the bytes it would scan, and a query over `BQ_MAX_BYTES_BILLED` (10 GB by default) is refused. Results are capped at `MALLOY_ROW_LIMIT` rows. Without credentials, pages say the results are compile-only and show the SQL instead.

### The semantic layer

Malloy is the semantic layer: a source is a semantic model, a measure is a metric. The app reads the compiled model, so there's no second copy of a definition to keep in step.

- **Annotations.** `# Some text` above a field is its description. `# Business.<Term>: some text` also links it to that glossary term. The term page lists the measures that implement it, and flags a term implemented by measures with different definitions. The definitions the app shows are the field's own text, cut from the model at the field's source location.
- **Metric kinds** come from the expression: _simple_ (one aggregate), _filtered_ (`{ where: }`), _ratio_ (a division, computed at the query's grain, never an average of ratios), _derived_ (arithmetic over measures). Period-over-period and running totals are `calculate:` window functions (`lag`, `sum_cumulative`, `avg_moving`), in views or from the query builder. [`malloy/ecommerce.malloy`](malloy/ecommerce.malloy) has an annotated example of each.
- **Fan-out.** Malloy uses _symmetric aggregates_. A measure split by a dimension behind a `join_many`, or aggregated up through a `join_one`, is computed once per primary key, so it stays correct. MetricFlow refuses those queries; Malloy answers them. The join graph on each semantic model shows the path, the grain and the SQL. The example: `orders.units_ordered` by `order_items.products.category`.
- **Saved queries are views in the model.** "Save as view" in the query builder inserts `view: <name> is { … }` at the end of the source's `extend { }` block in its `.malloy` file. The description and the builder state go above it as annotations (`# builder: <url query>`, so "Edit in builder" reopens it). The model is compiled with the view before the file is written; if it doesn't compile, nothing changes. Views live in git with the rest of the model, and show in the catalog and the workbench.
- **Publishing to the catalog.** Metrics > Publish to catalog, `POST /api/malloy/publish-metrics`, and the last step of `npm run seed:om` all create or update one OpenMetadata `metric` per measure, named `<source>__<measure>`. Each carries the Malloy definition (`metricExpression`, language External), type, unit, the tables it reads as `assets`, the measures it uses as `relatedMetrics`, its `{ where: }` as `filters`, and its glossary term as a tag. Each table it reads gets a table → metric lineage edge.

| Endpoint | What it does |
| --- | --- |
| `GET /api/malloy/semantic[?path=]` | Every model (or one) as semantic sources: nested joins, and fields with descriptions, glossary terms, definitions, metric kinds and tables read. |
| `GET /api/malloy/metrics` | Every measure across models. |
| `POST /api/malloy/dryrun` | `{ path or content, query }` → the SQL and a BigQuery dry-run estimate (bytes, cap, row limit). |
| `POST /api/malloy/run` | Takes `path` without `content`. Dry-runs first, refuses a query over the cap, and returns `estimate` and `compileOnly`. |
| `POST /api/malloy/views` | `{ model, source, name, description?, body, builder? }` → saves a view into the model. |
| `POST /api/malloy/publish-metrics` | `{ dryRun? }` → metric entities and lineage in OpenMetadata (or the demo catalog). |

## Layout

| Path | What it is |
| --- | --- |
| `src/` | The UI. Pages in `src/pages`, registered in `src/app/routes.tsx` (heavy pages through `lazyPage()`, so they load on first visit); feature code in `src/features/<feature>`; OpenMetadata client and shared entity components in `src/features/om`. |
| `server/` | The app server: OpenMetadata pass-through with server-held credentials (`om/client.ts`), the demo catalog (`om/demo/`), the team backend's app side (`team/`), Malloy (`malloy/`). |
| `worker/` | The team backend's worker (Python). See [worker/README.md](worker/README.md). |
| `malloy/` | Malloy models. |
| `deploy/openmetadata/` | OpenMetadata 2.0.8 Docker Compose and BigQuery ingestion workflows. |
| `docs/` | Roadmap and design notes. |

[`AGENTS.md`](AGENTS.md) has the conventions for working in the code (and the MonoRail UI design rules).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | UI on :5173 with hot reload, and the server on :8787 (restarts on change). |
| `npm run dev:web` / `npm run dev:api` | One of the two. |
| `npm run typecheck` | Web and server. |
| `npm run build` | Typecheck, then build the UI to `dist/`. |
| `npm start` | The server, which also serves `dist/`. One process for production. |
| `npm run seed:om` | Load the demo catalog into the OpenMetadata at `OM_URL` (for a local or test server). |
| `npm run pilot` | The pilot setup: UI, app server (`APP_BACKEND=team`) and worker on one machine, sharing the bucket folder in app data. |
| `npm run worker` / `npm run worker:test` | The team-backend worker, and its tests (pytest, with the `vertex` extra). |
| `npm run ui:add -- <name>` | Add a shadcn/ui component wired to the theme. |

## Licenses

OpenMetadata is Apache 2.0 (its compose file is vendored unmodified in `deploy/openmetadata`). Malloy is MIT. See [licenses](licenses) for shadcn/ui, Tailwind CSS, tw-animate-css, and the Inter and JetBrains Mono fonts. The demo catalog describes Google's public `thelook_ecommerce` dataset; its sample rows are generated, not copied.
