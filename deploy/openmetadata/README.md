# OpenMetadata for MonoRail Metadata

`docker-compose.yml` is OpenMetadata 2.0.8's official compose file, unmodified (from the [2.0.8 release](https://github.com/open-metadata/OpenMetadata/releases/tag/2.0.8-release), Apache 2.0). It runs:

| Service | Port | What it is |
| --- | --- | --- |
| `openmetadata-server` | 8585 | The REST API this app talks to (and OpenMetadata's own UI, which we don't use) |
| `mysql` | 3306 | The metadata store |
| `elasticsearch` | 9200 | Search |
| `ingestion` | 8080 | Airflow, which runs the ingestion pipelines the app creates |

## Run it

Needs Docker with about 6 GB of memory for the containers. The first pull is about 5 GB.

`docker-compose.override.yml` (loaded automatically) changes three things for local use: every port binds to 127.0.0.1 only, Airflow moves to host port **8090** (8080 is often taken), and MySQL keeps its data in a Docker volume. That last one matters on Windows: with Docker in WSL, a bind mount on the Windows drive can't hold MySQL's file permissions and it won't start.

```sh
cd deploy/openmetadata
docker compose up -d      # on Windows with Docker in WSL: wsl -d Ubuntu-24.04 -- docker compose up -d
# first start takes a few minutes; ready when this answers:
curl http://localhost:8585/api/v1/system/version
```

Then point the app at it, in the repo's `.env`:

```sh
OM_URL=http://localhost:8585
OM_EMAIL=admin@open-metadata.org
OM_PASSWORD=admin
```

OpenMetadata's own UI is at http://localhost:8585 (same login). Airflow is at http://localhost:8090 (admin / admin).

### Sample content without BigQuery

A fresh OpenMetadata is empty. To load the same content as the app's demo catalog (a `bigquery` service with theLook and an analytics layer, lineage, profiles, sample rows, queries, glossary, tags, domains, data products, tests, pipelines and conversations):

```sh
npm run seed:om
```

It goes through the REST API, so it doubles as a check of the app's request shapes, and it's safe to re-run. Don't point it at a production catalog. To start over, `docker compose down -v` (deletes the database and search volumes).

For anything beyond a laptop, use a bot token instead of the admin login: in OpenMetadata, Settings > Bots > create a bot with the Data Steward and Data Consumer roles, copy its JWT into `OM_TOKEN`, and drop `OM_EMAIL`/`OM_PASSWORD`. Change the admin password (or switch `AUTHENTICATION_PROVIDER` to Google SSO) before exposing port 8585.

## Load BigQuery

1. Make a GCP service account with `BigQuery Data Viewer`, `BigQuery Job User`, `BigQuery Resource Viewer` (for `INFORMATION_SCHEMA.JOBS`), and `Data Catalog Viewer` if you use policy tags, on each project to catalog.
2. In the app: Services > Add BigQuery service, paste the key JSON, list the projects. Then Add ingestion: Metadata first, then Usage, Lineage, Profiler.

Or run the workflows from the CLI with the YAML in `ingestion/` (`pip install "openmetadata-ingestion[bigquery]==2.0.8"`, then `metadata ingest -c ...`). They use `gcp_adc` credentials; switch to `service_account` for a key file.

The app expects the service to be named `bigquery` (`OM_BIGQUERY_SERVICE` changes that). Malloy uses it to find table schemas.

## Upgrading

Download the new release's `docker-compose.yml` over this one, check the release notes for migrations, and keep the image tags matched (server, ingestion, db). Bump the version in `AGENTS.md` and check the demo catalog still matches the API shapes.
