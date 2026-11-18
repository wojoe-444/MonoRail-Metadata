import type { ReactNode } from 'react'
import { CircleCheck, CircleAlert, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useQuery } from '@/hooks/useQuery'
import { getHealth } from '@/features/om/api'
import { formatBytes } from '@/features/om/entity'
import { ErrorState, LoadingState } from '@/features/om/components/States'
import { TeamRow } from '@/features/team/TeamRow'

/** What the app server is connected to (GET /api/health), with what to set to change it. */
export function ConnectionCard() {
  const health = useQuery(['health'], getHealth)
  const h = health.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections</CardTitle>
        <CardDescription>Set on the server, in the environment or a .env file. Restart the server after changing them.</CardDescription>
        <CardAction>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Check again" onClick={health.refetch}>
                <RefreshCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Check again</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent>
        {health.error && !h ? (
          <ErrorState error={health.error} onRetry={health.refetch} />
        ) : !h ? (
          <LoadingState />
        ) : (
          <div className="flex flex-col divide-y">
            {h.team && (
              <div className="flex flex-col gap-3 pb-4">
                <span className="text-sm font-medium">Team backend</span>
                <TeamRow team={h.team} />
              </div>
            )}
            <Row
              title="OpenMetadata"
              status={
                h.mode === 'demo' ? (
                  <Badge variant="info">Demo catalog</Badge>
                ) : h.mode === 'team' ? (
                  <Badge variant="outline">Through the team worker</Badge>
                ) : h.openmetadata.ok ? (
                  <Badge variant="success">Connected</Badge>
                ) : (
                  <Badge variant="destructive">Unreachable</Badge>
                )
              }
              ok={h.mode !== 'openmetadata' || h.openmetadata.ok}
              facts={
                h.mode === 'demo'
                  ? [
                      ['Mode', 'In-memory demo, edits last until restart'],
                      ['API version', h.openmetadata.version ?? '–'],
                    ]
                  : h.mode === 'team'
                    ? [
                        ['Version', h.openmetadata.version ?? '–'],
                        ['BigQuery service', h.openmetadata.service, true],
                        ['Reached by', 'The worker only'],
                      ]
                    : [
                        ['URL', h.openmetadata.url ?? '–', true],
                        ['Version', h.openmetadata.version ?? '–'],
                        ['BigQuery service', h.openmetadata.service, true],
                      ]
              }
              error={h.mode === 'openmetadata' && !h.openmetadata.ok ? h.openmetadata.error : undefined}
              hint={
                h.mode === 'demo' ? (
                  <>
                    Set <Code>OM_URL</Code> (e.g. http://localhost:8585) and <Code>OM_TOKEN</Code>, a bot JWT from OpenMetadata's Settings ›
                    Bots, to use a real server. <Code>OM_BIGQUERY_SERVICE</Code> names the BigQuery service.
                  </>
                ) : h.mode === 'openmetadata' && !h.openmetadata.ok ? (
                  <>
                    Check that OpenMetadata is up at that URL and that <Code>OM_TOKEN</Code> (or <Code>OM_EMAIL</Code> /{' '}
                    <Code>OM_PASSWORD</Code>) is valid.
                  </>
                ) : undefined
              }
            />
            <Row
              title="BigQuery"
              status={h.bigquery.configured ? <Badge variant="success">Configured</Badge> : <Badge variant="warning">Not configured</Badge>}
              ok={h.bigquery.configured}
              facts={[
                ['Project', h.bigquery.projectId ?? (h.bigquery.configured ? 'From credentials' : '–'), true],
                ['Max bytes billed per query', formatBytes(h.bigquery.maxBytesBilled)],
              ]}
              hint={
                h.bigquery.configured ? undefined : (
                  <>
                    Malloy models compile from catalog schemas but can't run. Set <Code>BQ_PROJECT_ID</Code> and sign in with{' '}
                    <Code>gcloud auth application-default login</Code> (or point <Code>GOOGLE_APPLICATION_CREDENTIALS</Code> at a key file).{' '}
                    <Code>BQ_MAX_BYTES_BILLED</Code> caps each query.
                  </>
                )
              }
            />
            <Row
              title="Malloy"
              status={<Badge variant="outline">Models folder</Badge>}
              ok
              facts={[['Folder', h.malloy.dir || '.', true]]}
              hint={
                <>
                  Change it with <Code>MALLOY_DIR</Code>.
                </>
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{children}</code>
}

function Row({
  title,
  status,
  ok,
  facts,
  error,
  hint,
}: {
  title: string
  status: ReactNode
  ok: boolean
  facts: [string, string, boolean?][]
  error?: string
  hint?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        {ok ? <CircleCheck className="size-4 text-success" aria-hidden /> : <CircleAlert className="size-4 text-warning" aria-hidden />}
        <span className="text-sm font-medium">{title}</span>
        {status}
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
      {error && <p className="rounded-lg bg-destructive-soft px-3 py-2 text-xs break-words text-destructive-soft-foreground">{error}</p>}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
