import { useState } from 'react'
import { LogIn, LogOut, Radio, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { invalidate } from '@/hooks/useQuery'
import { api } from '@/lib/api'
import { formatCount, timeAgo } from '@/features/om/entity'
import type { TeamStatus } from '@/features/om/api'

/** The team backend section of Settings > Connections: worker, bucket, identity, replica, and a round-trip test. */
export function TeamRow({ team }: { team: TeamStatus }) {
  const [echo, setEcho] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const total = Object.values(team.replica.counts).reduce((a, b) => a + b, 0)

  const act = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name)
    try {
      const msg = await fn()
      if (msg) setEcho(msg)
    } catch (e) {
      setEcho(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(undefined)
      invalidate('health')
    }
  }

  const facts: [string, string, boolean?][] = [
    ['Bucket', team.bucket, true],
    ['You are', team.identity.user ?? (team.identity.signedIn ? 'Signed in' : 'Not signed in')],
    ['Worker', team.worker.lastSeen ? `${team.worker.id ?? 'worker'} · seen ${timeAgo(team.worker.lastSeen)}` : 'Never seen'],
    ['Catalog replica', team.replica.ready ? `${formatCount(total)} entities · change ${team.replica.seq}` : 'Not loaded'],
    ['Loaded', team.replica.loadedAt ? timeAgo(team.replica.loadedAt) : '–'],
    ['Queue backlog', team.worker.backlog === null || team.worker.backlog === undefined ? '–' : String(team.worker.backlog)],
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {team.worker.online ? <Badge variant="success">Worker online</Badge> : <Badge variant="warning">Worker offline</Badge>}
        <Badge variant="outline">{team.auth === 'google' ? 'Google sign-in' : 'Local identity'}</Badge>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
        {facts.map(([label, value, mono]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={mono ? 'truncate font-mono text-sm' : 'truncate text-sm'} title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {!team.bucket.startsWith('gs://') && (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info-soft-foreground">
          Pilot setup: the bucket is a folder on this computer, and the worker (a Vertex AI job in a Google Cloud setup) runs here too.
          Easier ways for a team to share the app without a central server are on the way.
        </p>
      )}
      {team.replica.error && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">{team.replica.error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={Boolean(busy)}
          onClick={() =>
            act('echo', async () => {
              const r = await api<{ ms: number; reply: { by?: string } }>('/api/team/echo', { method: 'POST' })
              return `Round trip through the bucket: ${(r.ms / 1000).toFixed(1)} s, as ${r.reply.by ?? 'unknown'}.`
            })
          }
        >
          <Radio />
          {busy === 'echo' ? 'Waiting for the worker…' : 'Test round trip'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={Boolean(busy)}
          onClick={() =>
            act('resync', async () => {
              await api('/api/team/resync', { method: 'POST' })
              return 'The worker rebuilt the catalog snapshot; this app reloads it on its next poll.'
            })
          }
        >
          <RefreshCw />
          Rebuild snapshot
        </Button>
        {team.auth === 'google' &&
          (team.identity.signedIn ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => act('signout', async () => void (await api('/api/auth/signout', { method: 'POST' })))}
            >
              <LogOut />
              Sign out
            </Button>
          ) : (
            <Button size="sm" asChild>
              <a href="/api/auth/google/start">
                <LogIn />
                Sign in with Google
              </a>
            </Button>
          ))}
      </div>
      {echo && <p className="text-xs text-muted-foreground">{echo}</p>}
      <p className="text-xs text-muted-foreground">
        Reads come from this app's copy of the catalog, kept current from the bucket's change feed. Changes go to the worker as requests and
        take a second or two. Settings: <code className="font-mono">APP_BACKEND=team</code>, <code className="font-mono">TEAM_BUCKET</code>,{' '}
        <code className="font-mono">TEAM_AUTH</code>, <code className="font-mono">TEAM_USER</code>. See docs/team-backend.md.
      </p>
    </div>
  )
}
