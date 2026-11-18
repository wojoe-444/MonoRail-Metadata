import type { ReactNode } from 'react'

import { Progress } from '@/components/ui/progress'
import { formatCount, formatPercent } from '@/features/om/entity'

/** Horizontal bars for one categorical breakdown: label, bar, count (and share of `of`). One series color. */
export function BarList({
  items,
  of,
  color = 'var(--series-1)',
}: {
  items: { key: string; label: ReactNode; value: number; color?: string }[]
  of?: number
  color?: string
}) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="truncate">{i.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? color }} />
          </span>
          <span className="text-right text-xs whitespace-nowrap tabular-nums">
            {formatCount(i.value)}
            {of ? <span className="ml-1.5 text-muted-foreground">{formatPercent(i.value / of)}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** One coverage measure: label, percent, a meter, and "n of total". Green when complete, amber below 50%. */
export function CoverageRow({ label, value, total, hint }: { label: string; value: number; total: number; hint?: string }) {
  const share = total ? value / total : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">{total ? formatPercent(share) : '–'}</span>
      </div>
      <Progress
        value={share * 100}
        aria-label={`${label}: ${formatPercent(share)}`}
        indicatorClassName={share >= 0.999 ? 'bg-success' : share < 0.5 ? 'bg-warning' : 'bg-primary'}
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatCount(value)} of {formatCount(total)}
        {hint ? ` · ${hint}` : ''}
      </span>
    </div>
  )
}

/** "tier.tier1" or "Tier.Tier1" → "Tier 1"; "certification.gold" → "Gold"; other tag FQNs keep their case. */
export function tagKeyLabel(key: string): string {
  const tier = /^tier\.tier(\d)$/i.exec(key)
  if (tier) return `Tier ${tier[1]}`
  const last = key.split('.').pop() ?? key
  return key === key.toLowerCase() ? last.charAt(0).toUpperCase() + last.slice(1) : last
}
