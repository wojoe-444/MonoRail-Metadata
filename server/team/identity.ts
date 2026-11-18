import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CONFIG } from '../config'

/**
 * Who this app is acting for, in team mode (docs/team-backend.md, "Identity").
 *
 * - TEAM_AUTH=local: a name from TEAM_USER. Only for one machine; the worker must also run with TEAM_AUTH=local.
 * - TEAM_AUTH=google: the person signs in with Google in the browser (an OAuth client of the
 *   Desktop type, PKCE, redirect back to this server). Requests carry their ID token; the bucket
 *   and BigQuery use their access token. The refresh token is kept in ~/.monorail-metadata/google.json
 *   so a restart doesn't ask again.
 *
 * The Google path is written to Google's documented OAuth endpoints but hasn't been run
 * against a real client yet (none exists on the development machine).
 */

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/devstorage.read_write',
  'https://www.googleapis.com/auth/bigquery',
]
const TOKEN_FILE = path.join(os.homedir(), '.monorail-metadata', 'google.json')

interface Tokens {
  accessToken: string
  idToken: string
  refreshToken?: string
  expiresAt: number
  email?: string
}

let tokens: Tokens | undefined
let pending: { verifier: string; state: string } | undefined

export type RequestAuth = { kind: 'local'; user: string } | { kind: 'google'; idToken: string }

export function googleMode() {
  return CONFIG.teamAuth === 'google'
}

/** The name this app shows for the current person. */
export function currentIdentity(): { kind: 'local' | 'google'; user?: string; signedIn: boolean } {
  if (!googleMode()) return { kind: 'local', user: CONFIG.teamUser, signedIn: true }
  return { kind: 'google', user: tokens?.email, signedIn: Boolean(tokens) }
}

export async function requestAuth(): Promise<RequestAuth> {
  if (!googleMode()) return { kind: 'local', user: CONFIG.teamUser }
  const t = await fresh()
  return { kind: 'google', idToken: t.idToken }
}

/** An access token for the bucket and BigQuery (google mode only). */
export async function accessToken(): Promise<string> {
  return (await fresh()).accessToken
}

export class NotSignedIn extends Error {
  constructor() {
    super('Sign in with Google first (Settings > Team backend).')
  }
}

async function fresh(): Promise<Tokens> {
  if (!tokens) tokens = await loadSaved()
  if (!tokens) throw new NotSignedIn()
  if (tokens.expiresAt - Date.now() > 120_000) return tokens
  if (!tokens.refreshToken) throw new NotSignedIn()
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: CONFIG.googleClientId,
      ...(CONFIG.googleClientSecret ? { client_secret: CONFIG.googleClientSecret } : {}),
    }),
  })
  if (!res.ok) {
    tokens = undefined
    throw new NotSignedIn()
  }
  const body = (await res.json()) as { access_token: string; id_token?: string; expires_in: number }
  tokens = {
    ...tokens,
    accessToken: body.access_token,
    idToken: body.id_token ?? tokens.idToken,
    expiresAt: Date.now() + body.expires_in * 1000,
  }
  await save(tokens)
  return tokens
}

/** Step 1: the URL to send the browser to. */
export function signInUrl(redirectUri: string): string {
  if (!CONFIG.googleClientId) throw new Error('Set GOOGLE_OAUTH_CLIENT_ID to sign in with Google.')
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(16).toString('base64url')
  pending = { verifier, state }
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const q = new URLSearchParams({
    client_id: CONFIG.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

/** Step 2: Google redirects back with a code; exchange it for tokens. */
export async function completeSignIn(code: string, state: string, redirectUri: string): Promise<string | undefined> {
  if (!pending || pending.state !== state) throw new Error('Sign-in state did not match. Start again.')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: pending.verifier,
      redirect_uri: redirectUri,
      client_id: CONFIG.googleClientId,
      ...(CONFIG.googleClientSecret ? { client_secret: CONFIG.googleClientSecret } : {}),
    }),
  })
  pending = undefined
  if (!res.ok) throw new Error(`Google sign-in failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; id_token: string; refresh_token?: string; expires_in: number }
  const email = emailFromIdToken(body.id_token)
  tokens = {
    accessToken: body.access_token,
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    email,
  }
  await save(tokens)
  return email
}

export async function signOut() {
  tokens = undefined
  await fs.rm(TOKEN_FILE, { force: true })
}

/** Read the email claim for display. The worker verifies the token properly; this is only a label. */
function emailFromIdToken(jwt: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as { email?: string }
    return payload.email
  } catch {
    return undefined
  }
}

async function loadSaved(): Promise<Tokens | undefined> {
  try {
    return JSON.parse(await fs.readFile(TOKEN_FILE, 'utf8')) as Tokens
  } catch {
    return undefined
  }
}

async function save(t: Tokens) {
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true })
  await fs.writeFile(TOKEN_FILE, JSON.stringify(t), { mode: 0o600 })
}
