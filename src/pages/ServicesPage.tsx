import { useEffect, useState } from 'react'
import { ChevronRight, Plus, Server } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { navigate } from '@/lib/router'
import { AddIngestionDialog } from '@/features/admin/AddIngestionDialog'
import { AddServiceDialog } from '@/features/admin/AddServiceDialog'
import { latestStatus, listDatabaseServices, listIngestionPipelines, getRunnerStatus, serviceCounts } from '@/features/admin/api'
import { ConnectionSummary } from '@/features/admin/ConnectionSummary'
import {
  describeSchedule,
  PipelineStateBadge,
  pipelineTypeIcon,
  pipelineTypeLabel,
  RunButton,
  useRunPipeline,
} from '@/features/admin/pipelines'
import type { IngestionPipeline } from '@/features/admin/types'
import { displayName, entityHref, formatCount, timeAgo } from '@/features/om/entity'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { OwnerList } from '@/features/om/components/Labels'
import { EmptyState, Loaded, LoadingState, ErrorState } from '@/features/om/components/States'
import type { DatabaseService } from '@/features/om/types'

/** Database services (BigQuery), what they hold, how they connect, and the pipelines that ingest them. */
export function ServicesPage() {
  const services = useQuery(['services', 'list'], listDatabaseServices)
  const runner = useQuery(['ingestion', 'runner'], getRunnerStatus, { staleMs: 60_000 })
  const [addService, setAddService] = useState(false)
  const [addIngestion, setAddIngestion] = useState<{ serviceId?: string } | null>(null)
  const list = services.data?.data ?? []

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Services"
        description="BigQuery connections and the ingestion pipelines that keep the catalog in step with them."
        actions={
          <>
            <Button variant="outline" onClick={() => setAddIngestion({})} disabled={!list.length}>
              <Plus />
              Add ingestion
            </Button>
            <Button onClick={() => setAddService(true)}>
              <Plus />
              Add BigQuery service
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Pipeline runner</span>
        {runner.data ? (
          <Badge variant={runner.data.code === 200 ? 'success' : 'warning'} title={runner.data.reason}>
            {runner.data.platform ?? 'Runner'} {runner.data.version ?? ''} · {runner.data.code === 200 ? 'reachable' : 'unreachable'}
          </Badge>
        ) : runner.error ? (
          <Badge variant="warning" title={runner.error.message}>
            Status unavailable
          </Badge>
        ) : (
          <Badge variant="outline">Checking…</Badge>
        )}
      </div>

      <Loaded query={services}>
        {() =>
          list.length === 0 ? (
            <EmptyState
              icon={<Server className="size-5" aria-hidden />}
              title="No database services yet"
              description="Add a BigQuery service, then a metadata ingestion to fill the catalog."
              action={<Button onClick={() => setAddService(true)}>Add BigQuery service</Button>}
            />
          ) : (
            <div className="flex flex-col gap-6">
              {list.map((s) => (
                <ServiceCard key={s.id} service={s} onAddIngestion={() => setAddIngestion({ serviceId: s.id })} />
              ))}
            </div>
          )
        }
      </Loaded>

      <AddServiceDialog open={addService} onOpenChange={setAddService} onCreated={(s) => setAddIngestion({ serviceId: s.id })} />
      <AddIngestionDialog
        open={addIngestion !== null}
        onOpenChange={(o) => !o && setAddIngestion(null)}
        services={list}
        serviceId={addIngestion?.serviceId}
        onCreated={(p) => navigate(`/services/pipeline?fqn=${encodeURIComponent(p.fullyQualifiedName ?? p.name)}`)}
      />
    </div>
  )
}

function ServiceCard({ service, onAddIngestion }: { service: DatabaseService; onAddIngestion: () => void }) {
  const fqn = service.fullyQualifiedName ?? service.name
  const counts = useQuery(['search', 'service-counts', service.name], () => serviceCounts(service.name))
  const pipelines = useQuery(['ingestion', 'service', fqn], () => listIngestionPipelines(fqn))
  const { run, busy, error } = useRunPipeline()
  const anyRunning = (pipelines.data?.data ?? []).some((p) => isActive(latestStatus(p)?.pipelineState))

  // While a run is in progress, refresh every few seconds.
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => invalidate('ingestion', 'service', fqn), 4000)
    return () => clearInterval(t)
  }, [anyRunning, fqn])

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon type="databaseService" className="size-10" />
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <a href={entityHref('databaseService', fqn)} className="truncate hover:underline">
                {displayName(service)}
              </a>
              <Badge variant="primary">{service.serviceType}</Badge>
            </CardTitle>
            <CardDescription className="mt-1.5 line-clamp-2">{service.description || 'No description.'}</CardDescription>
          </div>
        </div>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <a href={entityHref('databaseService', fqn)}>
              Browse
              <ChevronRight />
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              {(['projects', 'datasets', 'tables'] as const).map((k) => (
                <div key={k} className="rounded-lg bg-muted px-3 py-2">
                  <div className="text-xs text-muted-foreground capitalize">{k}</div>
                  <div className="text-lg font-semibold tabular-nums">{counts.data ? formatCount(counts.data[k]) : '–'}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Owners</div>
              <OwnerList owners={service.owners} compact />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">Connection</div>
            <ConnectionSummary serviceType={service.serviceType} config={service.connection?.config} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Ingestion pipelines</div>
            <Button variant="soft" size="sm" onClick={onAddIngestion}>
              <Plus />
              Add ingestion
            </Button>
          </div>
          {pipelines.error && !pipelines.data ? (
            <ErrorState error={pipelines.error} onRetry={pipelines.refetch} />
          ) : !pipelines.data ? (
            <LoadingState />
          ) : pipelines.data.data.length === 0 ? (
            <EmptyState title="No pipelines" description="Add a metadata ingestion to load projects, datasets and tables." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-3">Pipeline</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead className="pr-3 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortPipelines(pipelines.data.data).map((p) => (
                    <PipelineRow
                      key={p.id}
                      pipeline={p}
                      busy={busy === p.id}
                      error={error?.id === p.id ? error.message : undefined}
                      onRun={() => run(p)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const ORDER = ['metadata', 'usage', 'lineage', 'dbt', 'profiler', 'autoClassification']
const sortPipelines = (ps: IngestionPipeline[]) =>
  [...ps].sort(
    (a, b) => (ORDER.indexOf(a.pipelineType) + 1 || 99) - (ORDER.indexOf(b.pipelineType) + 1 || 99) || a.name.localeCompare(b.name),
  )
const isActive = (s: string | undefined) => s === 'running' || s === 'queued'

function PipelineRow({
  pipeline: p,
  busy,
  error,
  onRun,
}: {
  pipeline: IngestionPipeline
  busy: boolean
  error?: string
  onRun: () => void
}) {
  const Icon = pipelineTypeIcon(p.pipelineType)
  const last = latestStatus(p)
  return (
    <TableRow>
      <TableCell className="pl-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <a
              href={entityHref('ingestionPipeline', p.fullyQualifiedName ?? p.name)}
              className="block truncate font-medium hover:underline"
            >
              {displayName(p)}
            </a>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {pipelineTypeLabel(p.pipelineType)}
              {p.enabled === false && <Badge variant="secondary">Paused</Badge>}
              {!p.deployed && <Badge variant="warning">Not deployed</Badge>}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {describeSchedule(p.airflowConfig?.scheduleInterval, p.airflowConfig?.pipelineTimezone)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <PipelineStateBadge state={last?.pipelineState} />
          <span className="text-xs text-muted-foreground" title={last?.startDate ? new Date(last.startDate).toLocaleString() : undefined}>
            {timeAgo(last?.startDate ?? last?.timestamp)}
          </span>
        </div>
        {error && (
          <div className="mt-1 max-w-xs truncate text-xs text-destructive" title={error}>
            {error}
          </div>
        )}
      </TableCell>
      <TableCell className="pr-3 text-right">
        <RunButton pipeline={p} running={isActive(last?.pipelineState)} busy={busy} onRun={onRun} />
      </TableCell>
    </TableRow>
  )
}
