import rules from '../../worker/src/monorail_worker/allowlist.json' with { type: 'json' }

/**
 * The worker's allowlist for `om` requests (docs/team-backend.md, "Allowlist"), checked in the app
 * before a request is queued, so a forbidden or malformed request fails at once with the status and
 * message the worker would give. The worker still enforces it.
 *
 * The lists come from the worker's own allowlist.json. This file mirrors the logic of
 * worker/src/monorail_worker/allowlist.py line for line, including Python's repr() in messages;
 * worker/tests/test_allowlist.py runs the same cases through both (scripts/allowlist-parity.ts).
 */

const WRITE_METHODS = new Set(['PUT', 'POST', 'PATCH', 'DELETE'])
const METHODS = new Set([...WRITE_METHODS, 'GET'])
const GET_DENY: readonly string[] = rules.getDeny
const WRITE_COLLECTIONS: readonly string[] = rules.writeCollections
const WRITE_SUBRESOURCES: readonly string[] = rules.writeSubresources
export const PASS_HEADERS: ReadonlySet<string> = new Set(rules.passHeaders)

/** Python's repr() of a str or None, for messages that match the worker's. */
function pyRepr(v: string | null | undefined): string {
  if (v === null || v === undefined) return 'None'
  const quote = v.includes("'") && !v.includes('"') ? '"' : "'"
  let out = ''
  for (const ch of v) {
    const code = ch.codePointAt(0)!
    if (ch === '\\') out += '\\\\'
    else if (ch === quote) out += `\\${ch}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += ch
  }
  return quote + out + quote
}

/** urllib.parse.unquote, as far as telling "." and ".." apart: only %2e can decode to a dot. */
const unquoteDots = (s: string) => s.replace(/%2e/gi, '.')

/** A clean `/a/b` path, or null if it tries anything odd (traversal, a full URL, a query). */
export function normalize(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || /[?#\\]/.test(path)) return null
  if (path.includes('://') || path.startsWith('//')) return null
  const segs = path.split('/').slice(1)
  if (segs.some((s) => ['.', '..'].includes(unquoteDots(s)))) return null
  if (path.startsWith('/api/')) return null // paths are relative to /api/v1
  return '/' + segs.filter((s) => s !== '').join('/')
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/')

/** [allowed, reason]. `method` is upper case, as the worker sees it. */
export function check(method: string | null | undefined, path: string | null | undefined): [boolean, string] {
  if (!method || !METHODS.has(method)) return [false, `Method ${pyRepr(method)} is not allowed.`]
  const norm = normalize(path || '')
  if (norm === null) return [false, `Path ${pyRepr(path)} is not a plain OpenMetadata path.`]
  const low = norm.toLowerCase()
  if (method === 'GET') {
    for (const deny of GET_DENY) {
      if (under(low, deny.toLowerCase())) return [false, `GET ${deny} is not available through the team backend.`]
    }
    return [true, '']
  }
  for (const coll of WRITE_COLLECTIONS) {
    if (under(norm, '/' + coll)) return [true, '']
  }
  const segs = norm.split('/').slice(1)
  // /{collection...}/{id}/followers[/{userId}] or /{collection...}/{id}/votes
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    if (WRITE_SUBRESOURCES.includes(s) && i >= 2 && segs.length - i <= 2) {
      if (s === 'votes' && segs.length - i !== 1) continue
      return [true, '']
    }
  }
  return [false, `${method} ${norm} is not allowed through the team backend.`]
}
