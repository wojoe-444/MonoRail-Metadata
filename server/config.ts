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

  // ---- Team backend (docs/team-backend.md) ----
  /** The shared bucket: gs://bucket/prefix, or a local folder (default .team-bucket/ at the repo root). */
  teamBucket: env('TEAM_BUCKET', path.join(root, '.team-bucket')),
  /** How requests prove who sent them: "local" (a name, for one-machine development) or "google" (an ID token). */
  teamAuth: env('TEAM_AUTH', 'local') as 'local' | 'google',
  /** Who you are when TEAM_AUTH=local: an OpenMetadata user name or email. */
  teamUser: env('TEAM_USER', 'admin'),
  /** Google OAuth client (Desktop app type) for TEAM_AUTH=google. */
  googleClientId: env('GOOGLE_OAUTH_CLIENT_ID'),
  googleClientSecret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
  /** How often to check the change feed, in ms. */
  teamFeedPollMs: Number(env('TEAM_FEED_POLL_MS', '3000')),
}

/**
 * Where OpenMetadata calls go:
 * - demo: the in-process demo catalog (no OpenMetadata needed)
 * - direct: this server calls OpenMetadata at OM_URL
 * - team: reads from a replica of the catalog, writes through the shared worker (docs/team-backend.md)
 * Set APP_BACKEND explicitly, or leave it empty: OM_URL set means direct, otherwise demo.
 */
export const BACKEND = ((): 'demo' | 'direct' | 'team' => {
  const b = env('APP_BACKEND').toLowerCase()
  if (b === 'demo' || b === 'direct' || b === 'team') return b
  if (b) throw new Error(`APP_BACKEND must be demo, direct or team (got "${b}")`)
  return CONFIG.omUrl ? 'direct' : 'demo'
})()

export const DEMO_MODE = BACKEND === 'demo'

export function bigQueryConfigured(): boolean {
  return Boolean(CONFIG.bqProjectId || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT)
}
