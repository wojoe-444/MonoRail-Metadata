import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, CloudUpload, FileText, LoaderCircle, Pencil, Square } from 'lucide-react'

import { Sparkline } from '@/components/charts/Sparkline'
import { StatTile } from '@/components/charts/StatTile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { navigate, useSearchParams } from '@/lib/router'
import {
  deployIngestionPipeline,
  getIngestionPipeline,
  getLastRunLogs,
  getRunHistory,
  killIngestionPipeline,
  latestStatus,
  logTextOf,
  toggleIngestionPipeline,
  triggerIngestionPipeline,
} from '@/features/admin/api'
import {
  describeSchedule,
  Fact,
  formatDateTime,
  formatDuration,
  PipelineStateBadge,
  pipelineTypeLabel,
  RunButton,
  ScheduleField,
} from '@/features/admin/pipelines'
import { ConfigValue, configRows, redact } from '@/features/admin/sourceConfig'
import type { IngestionPipeline, PipelineStatus } from '@/features/admin/types'
import { formatCount, formatPercent, timeAgo } from '@/features/om/entity'
import { EntityHeader } from '@/features/om/components/EntityHeader'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import type { EntityReference } from '@/features/om/types'
import { useEntity } from '@/features/om/useEntity'

const HISTORY_DAYS = 30
const isActive = (s: string | undefined) => s === 'running' || s === 'queued'

/** One ingestion pipeline: what it reads, when it runs, how its runs went, and its logs. */
export function IngestionPipelinePage() {
  const fqn = useSearchParams().get('fqn')
  const { entity: p, query, save } = useEntity<IngestionPipeline>('ingestionPipeline', fqn, getIngestionPipeline)
  const history = useQuery(fqn ? ['ingestion', 'history', fqn] : null, () =>
    getRunHistory(fqn!, { startTs: Date.now() - HISTORY_DAYS * 86_400_000, endTs: Date.now() + 60_000 }),
  )
  const [busy, setBusy] = useState<null | 'run' | 'deploy' | 'toggle' | 'kill'>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [editingSchedule, setEditingSchedule] = useState(false)

  const runs = [...(history.data?.data ?? [])].sort((a, b) => (b.timestamp ?? b.startDate ?? 0) - (a.timestamp ?? a.startDate ?? 0))
  const last = runs[0] ?? (p ? latestStatus(p) : undefined)
  const running = isActive(last?.pipelineState)

  const refresh = () => {
    query.refetch()
    history.refetch()
    invalidate('ingestion', 'service')
  }

  // Poll while a run is in progress.
  useEffect(() => {
    if (!running) return
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, fqn])

  if (!fqn) return <EmptyState title="No pipeline selected" action={<Button onClick={() => navigate('/services')}>All services</Button>} />
  if (query.error && !p) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!p) return <LoadingState />

  const act = async (kind: 'run' | 'deploy' | 'toggle' | 'kill', fn: () => Promise<{ reason?: string } | unknown>, ok: string) => {
    setBusy(kind)
    setNotice(null)
    try {
      const res = (await fn()) as { reason?: string } | undefined
      setNotice({ kind: 'ok', text: res && typeof res === 'object' && 'reason' in res && res.reason ? res.reason : ok })
      refresh()
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const finished = runs.filter((r) => r.endDate && r.startDate && !isActive(r.pipelineState))
  const recent = finished.filter((r) => (r.startDate ?? 0) > Date.now() - 14 * 86_400_000)
  const successRate = recent.length ? recent.filter((r) => r.pipelineState === 'success').length / recent.length : undefined
  const durations = finished.map((r) => r.endDate! - r.startDate!)
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : undefined

  return (
    <div className="flex flex-col gap-6">
      <EntityHeader
        entity={p}
        entityType="ingestionPipeline"
        parents={[p.service].filter(Boolean) as EntityReference[]}
        fields={['owners']}
        onSave={save}
        onFollowChange={query.refetch}
        badges={
          <>
            <Badge variant="primary">{pipelineTypeLabel(p.pipelineType)}</Badge>
            {p.enabled === false && <Badge variant="secondary">Paused</Badge>}
            {p.deployed ? <Badge variant="outline">Deployed</Badge> : <Badge variant="warning">Not deployed</Badge>}
          </>
        }
        actions={
          <>
            {running && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => act('kill', () => killIngestionPipeline(p.id), 'Run stopped.')}
              >
                {busy === 'kill' ? <LoaderCircle className="animate-spin" /> : <Square />}
                Stop
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => act('deploy', () => deployIngestionPipeline(p.id), 'Deployed.')}
            >
              {busy === 'deploy' ? <LoaderCircle className="animate-spin" /> : <CloudUpload />}
              {p.deployed ? 'Redeploy' : 'Deploy'}
            </Button>
            <RunButton
              pipeline={p}
              running={running}
              busy={busy === 'run'}
              variant="default"
              onRun={() => act('run', () => triggerIngestionPipeline(p.id), 'Run started.')}
            />
          </>
        }
      />

      {notice && (
        <div
          role="status"
          className={
            notice.kind === 'ok'
              ? 'rounded-lg bg-info-soft px-3 py-2 text-sm text-info-soft-foreground'
              : 'rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground'
          }
        >
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-0 px-4 py-4">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Last run</span>
          <div className="mt-2 flex items-center gap-2">
            <PipelineStateBadge state={last?.pipelineState} />
          </div>
          <span className="mt-2 text-xs text-muted-foreground">
            {last
              ? `${timeAgo(last.startDate ?? last.timestamp)} · ${formatDuration(last.endDate && last.startDate ? last.endDate - last.startDate : undefined)}`
              : 'Never run'}
          </span>
        </Card>
        <StatTile label="Success rate" value={formatPercent(successRate)} hint={`${recent.length} runs in 14 days`} />
        <StatTile
          label="Average duration"
          value={formatDuration(avg)}
          trend={durations.length > 2 ? <Sparkline data={[...durations].reverse()} className="h-8 w-24" /> : undefined}
          hint={`Over ${durations.length} runs`}
        />
        <StatTile
          label="Next run"
          value={
            p.enabled === false ? 'Paused' : p.airflowConfig?.scheduleInterval ? nextRunLabel(p.airflowConfig.scheduleInterval) : 'Manual'
          }
          hint={describeSchedule(p.airflowConfig?.scheduleInterval, p.airflowConfig?.pipelineTimezone)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ConfigCard pipeline={p} />
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setEditingSchedule(true)}>
                <Pencil />
                Edit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Runs">{describeSchedule(p.airflowConfig?.scheduleInterval, p.airflowConfig?.pipelineTimezone)}</Fact>
              <Fact label="Cron" mono>
                {p.airflowConfig?.scheduleInterval || '–'}
              </Fact>
              <Fact label="Retries">{p.airflowConfig?.retries ?? 0}</Fact>
              <Fact label="Retry delay">{formatDuration((p.airflowConfig?.retryDelay ?? 300) * 1000)}</Fact>
              <Fact label="Log level" mono>
                {p.loggerLevel ?? 'INFO'}
              </Fact>
              <Fact label="Raise on error">{p.raiseOnError === false ? 'No' : 'Yes'}</Fact>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
              <div className="flex flex-col">
                <Label htmlFor="pipeline-enabled">Enabled</Label>
                <span className="text-xs text-muted-foreground">
                  {p.enabled === false ? 'Paused: scheduled runs are skipped.' : 'Runs on schedule.'}
                </span>
              </div>
              <Switch
                id="pipeline-enabled"
                checked={p.enabled !== false}
                disabled={busy !== null}
                onCheckedChange={() => act('toggle', () => toggleIngestionPipeline(p.id), p.enabled === false ? 'Enabled.' : 'Paused.')}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <RunHistory runs={runs} loading={!history.data && !history.error} error={history.error} onRetry={history.refetch} />

      <LogsCard pipeline={p} lastRunId={last?.runId} running={running} />

      <ScheduleDialog
        open={editingSchedule}
        onOpenChange={setEditingSchedule}
        value={p.airflowConfig?.scheduleInterval ?? ''}
        onSave={async (cron) => {
          await save({ ...p, airflowConfig: { ...p.airflowConfig, scheduleInterval: cron || undefined } })
          // The runner keeps its own copy of the schedule: redeploy so the change takes effect.
          if (p.deployed) await deployIngestionPipeline(p.id).catch(() => undefined)
          refresh()
        }}
      />
    </div>
  )
}

/** Roughly when a simple cron fires next (UTC). */
function nextRunLabel(cron: string): string {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/)
  if (dom !== '*' || mon !== '*' || !/^\d+$/.test(min ?? '')) return '–'
  const now = new Date()
  const next = new Date(now)
  next.setUTCSeconds(0, 0)
  next.setUTCMinutes(Number(min))
  if (hour === '*') {
    if (next <= now) next.setUTCHours(next.getUTCHours() + 1)
  } else if (/^\d+$/.test(hour ?? '')) {
    next.setUTCHours(Number(hour))
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    if (dow && dow !== '*' && /^\d$/.test(dow)) while (next.getUTCDay() !== Number(dow)) next.setUTCDate(next.getUTCDate() + 1)
  } else return '–'
  return timeAgo(next.getTime())
}

function ConfigCard({ pipeline: p }: { pipeline: IngestionPipeline }) {
  const [view, setView] = useState<'fields' | 'json'>('fields')
  const rows = configRows(p.pipelineType, p.sourceConfig?.config)
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
        <CardDescription>
          sourceConfig · <span className="font-mono">{String(p.sourceConfig?.config?.type ?? '–')}</span>
        </CardDescription>
        <CardAction>
          <Segmented
            aria-label="Configuration view"
            value={view}
            onChange={setView}
            options={[
              { value: 'fields', label: 'Fields' },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {view === 'json' ? (
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
            {JSON.stringify(redact({ sourceConfig: p.sourceConfig, airflowConfig: p.airflowConfig }), null, 2)}
          </pre>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Defaults for every option.</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.key} className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{r.label}</dt>
                <dd className="min-w-0 text-sm">
                  <ConfigValue value={r.value} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function RunHistory({ runs, loading, error, onRetry }: { runs: PipelineStatus[]; loading: boolean; error?: Error; onRetry: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run history</CardTitle>
        <CardDescription>Last {HISTORY_DAYS} days, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && !runs.length ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : loading ? (
          <LoadingState />
        ) : runs.length === 0 ? (
          <EmptyState title="No runs yet" description="Run the pipeline, or wait for its schedule." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <span className="sr-only">Details</span>
                </TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Records</TableHead>
                <TableHead className="hidden text-right md:table-cell">Warnings</TableHead>
                <TableHead className="hidden text-right md:table-cell">Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r, i) => {
                const id = r.runId ?? String(i)
                const steps = r.status ?? []
                const sum = (k: 'records' | 'warnings' | 'errors') => steps.reduce((a, s) => a + (s[k] ?? 0), 0)
                const isOpen = open === id
                return (
                  <Fragment key={id}>
                    <TableRow>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={isOpen ? 'Hide run details' : 'Show run details'}
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : id)}
                          disabled={!steps.length}
                        >
                          {isOpen ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      </TableCell>
                      <TableCell title={r.startDate ? new Date(r.startDate).toLocaleString() : undefined}>
                        {formatDateTime(r.startDate ?? r.timestamp)}
                      </TableCell>
                      <TableCell>
                        <PipelineStateBadge state={r.pipelineState} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.endDate && r.startDate
                          ? formatDuration(r.endDate - r.startDate)
                          : isActive(r.pipelineState)
                            ? formatDuration(Date.now() - (r.startDate ?? Date.now()))
                            : '–'}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {steps.length ? formatCount(steps[0]?.records) : '–'}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{steps.length ? sum('warnings') : '–'}</TableCell>
                      <TableCell className={`hidden text-right tabular-nums md:table-cell ${sum('errors') ? 'text-destructive' : ''}`}>
                        {steps.length ? sum('errors') : '–'}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="bg-muted/40 whitespace-normal">
                          <RunDetails run={r} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function RunDetails({ run }: { run: PipelineStatus }) {
  const failures = (run.status ?? []).flatMap((s) => (s.failures ?? []).map((f) => ({ step: s.name, ...f })))
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="text-xs text-muted-foreground">
        Run <span className="font-mono">{run.runId ?? '–'}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(run.status ?? []).map((s) => (
          <div key={s.name} className="rounded-lg border bg-card px-3 py-2">
            <div className="text-sm font-medium">{s.name}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
              <span>{formatCount(s.records)} processed</span>
              {s.updated_records ? <span>{formatCount(s.updated_records)} updated</span> : null}
              {s.filtered ? <span>{formatCount(s.filtered)} filtered</span> : null}
              <span>{s.warnings ?? 0} warnings</span>
              <span className={s.errors ? 'text-destructive' : undefined}>{s.errors ?? 0} errors</span>
            </div>
          </div>
        ))}
      </div>
      {failures.map((f, i) => (
        <div key={i} className="rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-destructive-soft-foreground">
          <div className="text-xs font-medium">{f.step}</div>
          <div className="text-sm break-words">{f.error}</div>
          {f.stackTrace && <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap">{f.stackTrace}</pre>}
        </div>
      ))}
    </div>
  )
}

function LogsCard({ pipeline, lastRunId, running }: { pipeline: IngestionPipeline; lastRunId?: string; running: boolean }) {
  const [show, setShow] = useState(false)
  const logs = useQuery(show ? ['ingestion', 'logs', pipeline.id, lastRunId ?? ''] : null, () => getLastRunLogs(pipeline.id), {
    staleMs: running ? 2000 : 30_000,
  })
  const text = logTextOf(logs.data)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logs</CardTitle>
        <CardDescription>The most recent run, from the pipeline runner.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => (show ? logs.refetch() : setShow(true))}>
            <FileText />
            {show ? 'Refresh' : 'Show logs'}
          </Button>
        </CardAction>
      </CardHeader>
      {show && (
        <CardContent>
          {logs.error && !logs.data ? (
            <ErrorState error={logs.error} onRetry={logs.refetch} />
          ) : !logs.data ? (
            <LoadingState />
          ) : text ? (
            <pre className="max-h-[28rem] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{text}</pre>
          ) : (
            <EmptyState title="No logs" description={logs.data.error ?? 'The runner returned no log text for the last run.'} />
          )}
        </CardContent>
      )}
    </Card>
  )
}

function ScheduleDialog({
  open,
  onOpenChange,
  value,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  value: string
  onSave: (cron: string) => Promise<void>
}) {
  const [cron, setCron] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setCron(value)
      setError(undefined)
    }
  }, [open, value])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule</DialogTitle>
          <DialogDescription>Times are UTC. Saving redeploys the pipeline so the runner picks up the change.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-edit">Run</Label>
          {open && <ScheduleField id="schedule-edit" value={cron} onChange={setCron} />}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              setError(undefined)
              try {
                await onSave(cron)
                onOpenChange(false)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
