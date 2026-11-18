/**
 * Runs allowlist cases through the app's copy of the worker's allowlist (server/team/allowlist.ts)
 * and prints [[allowed, reason], ...] as JSON. worker/tests/test_allowlist.py compares the output
 * with the worker's own answers, so the two can't drift apart.
 *
 *   npx tsx scripts/allowlist-parity.ts worker/tests/allowlist_cases.json
 */
import { readFileSync } from 'node:fs'

import { check } from '../server/team/allowlist'

const file = process.argv[2]
if (!file) throw new Error('usage: tsx scripts/allowlist-parity.ts <cases.json>')
const cases = JSON.parse(readFileSync(file, 'utf8')) as { method: string | null; path: string | null }[]
process.stdout.write(JSON.stringify(cases.map((c) => check(c.method, c.path))))
