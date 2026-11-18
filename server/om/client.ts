import { CONFIG, DEMO_MODE } from '../config'
import { demoApp } from './demo/app'

/**
 * The one way server code talks to OpenMetadata. `path` is relative to
 * `/api/v1`, e.g. `/tables/name/x.y.z?fields=columns`.
 *
 * With OM_URL set it calls the real server with a bot token (or a basic-auth
 * login). Without it, the request goes to the in-process demo catalog, which
 * answers the same endpoints, so the rest of the app can't tell the difference.
 */
export async function omFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const p = path.startsWith('/') ? path : `/${path}`
  if (DEMO_MODE) return demoApp.request(`/api/v1${p}`, init)

  const send = async (token: string) => {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(`${CONFIG.omUrl}/api/v1${p}`, { ...init, headers })
  }
  let res = await send(await accessToken())
  if (res.status === 401 && !CONFIG.omToken && CONFIG.omEmail) {
    cachedLogin = undefined
    res = await send(await accessToken())
  }
  return res
}

/** JSON helper over `omFetch`. Throws `OmError` on a non-2xx answer. */
export async function omJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await omFetch(path, init)
  const text = await res.text()
  if (!res.ok) throw new OmError(res.status, text)
  return (text ? JSON.parse(text) : undefined) as T
}

export class OmError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`OpenMetadata answered ${status}: ${body.slice(0, 300)}`)
  }
}

let cachedLogin: { token: string; expires: number } | undefined

async function accessToken(): Promise<string> {
  if (CONFIG.omToken) return CONFIG.omToken
  if (!CONFIG.omEmail) return ''
  if (cachedLogin && cachedLogin.expires > Date.now() + 60_000) return cachedLogin.token
  const res = await fetch(`${CONFIG.omUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // OpenMetadata's basic auth expects the password base64-encoded.
    body: JSON.stringify({ email: CONFIG.omEmail, password: Buffer.from(CONFIG.omPassword).toString('base64') }),
  })
  if (!res.ok) throw new OmError(res.status, `Login as ${CONFIG.omEmail} failed: ${await res.text()}`)
  const body = (await res.json()) as { accessToken: string; expiryDuration?: number }
  // expiryDuration is an epoch-ms timestamp in current releases; treat small values as seconds.
  const exp = body.expiryDuration
  const expires = !exp ? Date.now() + 30 * 60_000 : exp > 1e12 ? exp : Date.now() + exp * 1000
  cachedLogin = { token: body.accessToken, expires }
  return cachedLogin.token
}
