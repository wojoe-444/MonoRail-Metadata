import { LayoutGrid } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { formatCount, openMetadataPath } from '@/features/om/entity'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { href, navigate } from '@/lib/router'
import { cn } from '@/lib/utils'

import { useCount } from './api'
import { GROUPS, type TypeInfo } from './catalog'

/** Every entity type, by group, with its count: a rail on wide screens, a select on narrow ones. */
export function TypeNav({ current }: { current: string | null }) {
  return (
    <>
      <div className="flex flex-col gap-2 lg:hidden">
        <Label htmlFor="om-type">Entity type</Label>
        <NativeSelect
          id="om-type"
          value={current ?? ''}
          onChange={(e) => navigate(e.target.value ? openMetadataPath(e.target.value) : '/openmetadata')}
        >
          <option value="">Overview</option>
          {GROUPS.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {g.types.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.plural}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </div>
      <nav aria-label="Entity types" className="hidden lg:block">
        <Card className="sticky top-4 max-h-[calc(100dvh-8rem)] gap-4 overflow-y-auto px-2 py-3">
          <a
            href={href('/openmetadata')}
            aria-current={current ? undefined : 'page'}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
              !current && 'bg-accent font-medium text-accent-foreground',
            )}
          >
            <LayoutGrid className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Overview
          </a>
          {GROUPS.map((g) => (
            <div key={g.id} className="flex flex-col gap-0.5">
              <div className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.label}</div>
              {g.types.map((t) => (
                <NavItem key={t.type} info={t} active={t.type === current} />
              ))}
            </div>
          ))}
        </Card>
      </nav>
    </>
  )
}

function NavItem({ info, active }: { info: TypeInfo; active: boolean }) {
  const count = useCount(info.type)
  const empty = count.data === 0 || Boolean(count.error)
  return (
    <a
      href={href(openMetadataPath(info.type))}
      aria-current={active ? 'page' : undefined}
      title={count.error ? `Not available: ${count.error.message}` : info.description}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
        empty && !active && 'text-muted-foreground',
        active && 'bg-accent font-medium text-accent-foreground',
      )}
    >
      <EntityIcon type={info.type} bare />
      <span className="min-w-0 flex-1 truncate">{info.plural}</span>
      <CountText count={count} />
    </a>
  )
}

export function CountText({ count, className }: { count: { data?: number; error?: Error }; className?: string }) {
  const text = count.error ? '–' : count.data === undefined ? '' : formatCount(count.data)
  return <span className={cn('text-xs text-muted-foreground tabular-nums', className)}>{text}</span>
}
