/**
 * Fetch wrapper for this app's server (`/api/...`). In development Vite
 * proxies `/api` to the server on :8787 (vite.config.ts); in production the
 * server serves the UI itself, so the paths are the same.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const headers = new Headers(rest.headers)
  if (json !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body })
  const text = await res.text()
  let body: unknown = undefined
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = text
  }
  // 202 from the team backend: the write is queued but the worker hasn't applied it yet.
  if (res.status === 202 && body && typeof body === 'object' && 'queued' in body) {
    throw new ApiError(202, String((body as { message?: unknown }).message ?? 'Queued'), body)
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && 'message' in body ? String((body as { message: unknown }).message) : text) || res.statusText
    throw new ApiError(res.status, msg, body)
  }
  return body as T
}

/** Build a query string, skipping empty values: qs({ a: 1, b: undefined }) === '?a=1'. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
