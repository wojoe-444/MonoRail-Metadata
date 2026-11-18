import { useState } from 'react'
import { Check, CircleAlert, Copy, Gauge, Info, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { entityHref, formatCount } from '@/features/om/entity'
import { cn } from '@/lib/utils'

import type { Estimate, MetricKind } from '../api'
import { METRIC_KIND_HELP, METRIC_KIND_LABEL } from '../model'

/** Malloy or SQL text, monospace, with a copy button. */
export function CodeBlock({
  code,
  className,
  copy = true,
  label = 'Copy',
}: {
  code: string
  className?: string
  copy?: boolean
  label?: string
}) {
  return (
    <div className={cn('group relative', className)}>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre">{code}</pre>
      {copy && (
        <CopyButton
          text={code}
          label={label}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      )}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-7', className)}
          aria-label={label}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setDone(true)
              setTimeout(() => setDone(false), 1200)
            })
          }}
        >
          {done ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{done ? 'Copied' : label}</TooltipContent>
    </Tooltip>
  )
}

export function MetricKindBadge({ kind, aggregate }: { kind?: MetricKind; aggregate?: string }) {
  if (!kind) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Badge variant={kind === 'simple' ? 'secondary' : 'primary'}>
            {METRIC_KIND_LABEL[kind]}
            {aggregate ? <span className="font-mono opacity-70">· {aggregate}</span> : null}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{METRIC_KIND_HELP[kind]}</TooltipContent>
    </Tooltip>
  )
}

/** A glossary term FQN as a link to its page. */
export function TermLink({ fqn }: { fqn?: string }) {
  if (!fqn) return null
  return (
    <a href={entityHref('glossaryTerm', fqn)} className="inline-flex">
      <Badge variant="info" className="hover:underline">
        {fqn.split('.').slice(1).join(' › ') || fqn}
      </Badge>
    </a>
  )
}

/** A BigQuery table path as a link to the catalog table page. */
export function TableLink({ path, fqn, className }: { path?: string; fqn?: string; className?: string }) {
  if (!path) return <span className="text-muted-foreground">Not a table</span>
  return (
    <a href={entityHref('table', fqn ?? path)} className={cn('font-mono text-xs break-all hover:underline', className)}>
      {path}
    </a>
  )
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

/**
 * The guardrails a query runs under: bytes from the BigQuery dry run against
 * the BQ_MAX_BYTES_BILLED cap, and the row limit. Says plainly when results
 * are compile-only because credentials are missing.
 */
export function GuardrailBar({ estimate, limit, className }: { estimate?: Estimate; limit?: number; className?: string }) {
  if (!estimate) return null
  const rows = Math.min(limit ?? estimate.rowLimit, estimate.rowLimit)
  if (!estimate.configured) {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground',
          className,
        )}
      >
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <span className="font-medium">Compile-only.</span> BigQuery credentials aren&apos;t set up on the server, so queries compile to
          SQL but don&apos;t run or dry-run. Runs would be capped at {formatBytes(estimate.maxBytesBilled)} scanned and {formatCount(rows)}{' '}
          rows.
        </div>
      </div>
    )
  }
  if (estimate.error) {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground',
          className,
        )}
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <span className="font-medium">Dry run failed:</span> {estimate.error}
        </div>
      </div>
    )
  }
  const share = estimate.bytes !== undefined ? estimate.bytes / estimate.maxBytesBilled : 0
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-sm',
        estimate.overCap ? 'border-destructive/30 bg-destructive-soft text-destructive-soft-foreground' : 'bg-card',
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        {estimate.overCap ? <CircleAlert className="size-4" aria-hidden /> : <Gauge className="size-4 text-muted-foreground" aria-hidden />}
        Scans <span className="font-medium tabular-nums">{formatBytes(estimate.bytes ?? 0)}</span>
        <span className="text-muted-foreground">of the {formatBytes(estimate.maxBytesBilled)} cap</span>
      </span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn('h-full', estimate.overCap ? 'bg-destructive' : share > 0.5 ? 'bg-warning' : 'bg-success')}
          style={{ width: `${Math.min(100, share * 100)}%` }}
        />
      </div>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <ShieldCheck className="size-4" aria-hidden />
        Up to {formatCount(rows)} rows returned
      </span>
      {estimate.overCap && (
        <span className="font-medium">Over the cap: the run is refused. Add a filter or raise BQ_MAX_BYTES_BILLED.</span>
      )}
    </div>
  )
}

/** A small overline label for sections inside cards. */
export function Overline({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</div>
}
