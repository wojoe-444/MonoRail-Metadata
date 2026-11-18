import { useState, type ReactNode } from 'react'
import { Brain, Database, GitFork, Activity, FileCode2, ScanSearch, LoaderCircle, Play, type LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { invalidate } from '@/hooks/useQuery'

import { triggerIngestionPipeline } from './api'
import type { IngestionPipeline, PipelineState } from './types'

/** Ingestion pipeline types this app creates for a BigQuery service. */
export const PIPELINE_TYPES: {
  value: 'metadata' | 'usage' | 'lineage' | 'profiler' | 'dbt' | 'autoClassification'
  label: string
  description: string
  icon: LucideIcon
}[] = [
  { value: 'metadata', label: 'Metadata', description: 'Projects, datasets, tables, views, columns and policy tags.', icon: Database },
  { value: 'usage', label: 'Usage', description: 'Query counts from INFORMATION_SCHEMA.JOBS, for popularity and joins.', icon: Activity },
  { value: 'lineage', label: 'Lineage', description: 'Table and column lineage from view definitions and query history.', icon: GitFork },
  { value: 'profiler', label: 'Profiler', description: 'Row counts and column statistics on a sample.', icon: ScanSearch },
  { value: 'dbt', label: 'dbt', description: 'Models, tests, descriptions and lineage from dbt artifacts.', icon: FileCode2 },
  { value: 'autoClassification', label: 'Auto-classification', description: 'Tags columns that look like personal data.', icon: Brain },
]

export function pipelineTypeLabel(type: string): string {
  return PIPELINE_TYPES.find((t) => t.value === type)?.label ?? type.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

export function pipelineTypeIcon(type: string): LucideIcon {
  return PIPELINE_TYPES.find((t) => t.value === type)?.icon ?? Database
}

const STATE: Record<PipelineState, { label: string; variant: 'success' | 'destructive' | 'warning' | 'info' | 'secondary' }> = {
  success: { label: 'Success', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  partialSuccess: { label: 'Partial success', variant: 'warning' },
  running: { label: 'Running', variant: 'info' },
  queued: { label: 'Queued', variant: 'info' },
  stopped: { label: 'Stopped', variant: 'secondary' },
}

export function PipelineStateBadge({ state }: { state: PipelineState | undefined }) {
  if (!state) return <Badge variant="outline">No runs</Badge>
  const s = STATE[state] ?? { label: state, variant: 'secondary' as const }
  return (
    <Badge variant={s.variant}>
      {(state === 'running' || state === 'queued') && <LoaderCircle className="animate-spin" aria-hidden />}
      {s.label}
    </Badge>
  )
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0 || Number.isNaN(ms)) return '–'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function formatDateTime(ts: number | undefined): string {
  if (!ts) return '–'
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ---------- Schedules (Airflow cron) ----------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = (n: string | number) => String(n).padStart(2, '0')

/** "0 2 * * *" → "Daily at 02:00 UTC". Unusual expressions come back as-is. */
export function describeSchedule(cron: string | undefined, tz = 'UTC'): string {
  if (!cron) return 'Manual only'
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string]
  const num = (s: string) => /^\d+$/.test(s)
  if (dom === '*' && mon === '*') {
    if (num(min) && hour === '*' && dow === '*') return min === '0' ? 'Hourly' : `Hourly at :${pad(min)}`
    if (num(min) && num(hour) && dow === '*') return `Daily at ${pad(hour)}:${pad(min)} ${tz}`
    if (num(min) && num(hour) && num(dow)) return `Weekly on ${DAYS[Number(dow) % 7]} at ${pad(hour)}:${pad(min)} ${tz}`
  }
  return cron
}

type Mode = 'manual' | 'hourly' | 'daily' | 'weekly' | 'custom'

function modeOf(cron: string): Mode {
  if (!cron) return 'manual'
  const p = cron.trim().split(/\s+/)
  if (p.length !== 5 || p[2] !== '*' || p[3] !== '*' || !/^\d+$/.test(p[0]!)) return 'custom'
  if (p[1] === '*' && p[4] === '*') return 'hourly'
  if (/^\d+$/.test(p[1]!) && p[4] === '*') return 'daily'
  if (/^\d+$/.test(p[1]!) && /^\d$/.test(p[4]!)) return 'weekly'
  return 'custom'
}

/** Pick a schedule: manual, hourly, daily at an hour, weekly on a day, or a cron expression. */
export function ScheduleField({ id, value, onChange }: { id: string; value: string; onChange: (cron: string) => void }) {
  const [mode, setMode] = useState<Mode>(() => modeOf(value))
  const parts = value.trim().split(/\s+/)
  const hour = /^\d+$/.test(parts[1] ?? '') ? Number(parts[1]) : 2
  const minute = /^\d+$/.test(parts[0] ?? '') ? Number(parts[0]) : 0
  const dow = /^\d$/.test(parts[4] ?? '') ? Number(parts[4]) : 0

  const build = (m: Mode, h = hour, d = dow, min = minute) => {
    switch (m) {
      case 'manual':
        return ''
      case 'hourly':
        return `${min} * * * *`
      case 'daily':
        return `${min} ${h} * * *`
      case 'weekly':
        return `${min} ${h} * * ${d}`
      default:
        return value || '0 2 * * *'
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <NativeSelect
          id={id}
          value={mode}
          onChange={(e) => {
            const m = e.target.value as Mode
            setMode(m)
            onChange(build(m))
          }}
        >
          <option value="manual">Manual only</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="custom">Custom (cron)</option>
        </NativeSelect>
        {mode === 'weekly' && (
          <NativeSelect aria-label="Day of week" value={dow} onChange={(e) => onChange(build('weekly', hour, Number(e.target.value)))}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </NativeSelect>
        )}
        {(mode === 'daily' || mode === 'weekly') && (
          <NativeSelect aria-label="Hour (UTC)" value={hour} onChange={(e) => onChange(build(mode, Number(e.target.value)))}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {pad(h)}:{pad(minute)} UTC
              </option>
            ))}
          </NativeSelect>
        )}
        {mode === 'custom' && (
          <Input
            aria-label="Cron expression"
            className="font-mono sm:col-span-2"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 2 * * *"
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{describeSchedule(value)}</p>
    </div>
  )
}

// ---------- Running ----------

/** Trigger a run; refreshes pipeline queries after. */
export function useRunPipeline() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const run = async (p: IngestionPipeline) => {
    setBusy(p.id)
    setError(null)
    try {
      await triggerIngestionPipeline(p.id)
      invalidate('ingestion')
    } catch (e) {
      setError({ id: p.id, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }
  return { run, busy, error }
}

/** Why a pipeline can't run right now, if it can't. */
export function cannotRun(p: IngestionPipeline, running: boolean): string | undefined {
  if (!p.deployed) return 'Deploy the pipeline before running it.'
  if (p.enabled === false) return 'The pipeline is paused. Enable it to run.'
  if (running) return 'A run is in progress.'
  return undefined
}

export function RunButton({
  pipeline,
  running,
  busy,
  onRun,
  size = 'sm',
  variant = 'outline',
}: {
  pipeline: IngestionPipeline
  running: boolean
  busy: boolean
  onRun: () => void
  size?: 'sm' | 'default'
  variant?: 'outline' | 'default' | 'soft'
}) {
  const reason = cannotRun(pipeline, running)
  const button = (
    <Button
      variant={variant}
      size={size}
      onClick={onRun}
      disabled={Boolean(reason) || busy}
      aria-label={`Run ${pipeline.displayName || pipeline.name}`}
    >
      {busy ? <LoaderCircle className="animate-spin" /> : <Play />}
      Run
    </Button>
  )
  if (!reason) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

/** A label + value pair for fact grids. */
export function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? 'truncate font-mono text-sm' : 'truncate text-sm'}>{children}</div>
    </div>
  )
}
