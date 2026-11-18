import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function env(name: string, fallback = ''): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

/**
 * Server settings, all from the environment (or a `.env` file at the repo root).
 * See `.env.example` for what each one does.
 */
export const CONFIG = {
  port: Number(env('PORT', '8787')),
  root,

  /** OpenMetadata server, e.g. http://localhost:8585. Empty runs the built-in demo catalog. */
  omUrl: env('OM_URL').replace(/\/+$/, ''),
  /** A bot JWT (Settings > Bots in OpenMetadata). Preferred over a user login. */
  omToken: env('OM_TOKEN'),
  /** Basic-auth login, used when there is no token (the docker default is admin@open-metadata.org / admin). */
  omEmail: env('OM_EMAIL'),
  omPassword: env('OM_PASSWORD'),
  /** The OpenMetadata database service that holds the BigQuery catalog. */
  omBigQueryService: env('OM_BIGQUERY_SERVICE', 'bigquery'),

  /** BigQuery project that queries bill to. Credentials come from ADC or GOOGLE_APPLICATION_CREDENTIALS. */
  bqProjectId: env('BQ_PROJECT_ID'),
  bqBillingProjectId: env('BQ_BILLING_PROJECT_ID'),
  bqLocation: env('BQ_LOCATION'),
  /** Safety cap per Malloy query, in bytes. Default 10 GB. */
  bqMaxBytesBilled: env('BQ_MAX_BYTES_BILLED', String(10 * 1024 ** 3)),
  /** Rows returned to the browser per Malloy run. */
  malloyRowLimit: Number(env('MALLOY_ROW_LIMIT', '5000')),

  /** Folder of .malloy models. */
  malloyDir: path.resolve(root, env('MALLOY_DIR', 'malloy')),
}

export const DEMO_MODE = !CONFIG.omUrl

export function bigQueryConfigured(): boolean {
  return Boolean(CONFIG.bqProjectId || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT)
}
