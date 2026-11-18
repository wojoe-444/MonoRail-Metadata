import { useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DescriptionDialog, OwnerPickerDialog } from '@/features/om/components/Editors'
import { OwnerList } from '@/features/om/components/Labels'
import { Markdown } from '@/features/om/components/Markdown'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import type { EntityReference } from '@/features/om/types'
import { cn } from '@/lib/utils'

/** Small building blocks shared by the governance pages. */

/** An icon-only edit button with a tooltip. */
export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClick} aria-label={label}>
          <Pencil className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** A card showing a Markdown description, with an edit dialog when `onSave` is given. */
export function DescriptionCard({
  title = 'Description',
  value,
  onSave,
  className,
}: {
  title?: string
  value: string | undefined
  onSave?: (v: string) => Promise<unknown>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {onSave && (
          <CardAction>
            <EditButton label="Edit description" onClick={() => setOpen(true)} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <Markdown>{value}</Markdown>
      </CardContent>
      {onSave && <DescriptionDialog open={open} onOpenChange={setOpen} title="Edit description" value={value} onSave={onSave} />}
    </Card>
  )
}

/** A labeled detail with an optional edit button. */
export function Detail({
  label,
  children,
  onEdit,
  editLabel,
}: {
  label: string
  children: ReactNode
  onEdit?: () => void
  editLabel?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex h-7 items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {onEdit && <EditButton label={editLabel ?? `Edit ${label.toLowerCase()}`} onClick={onEdit} />}
      </div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  )
}

/**
 * Owners, reviewers or experts: a list of users/teams with a picker. `usersOnly`
 * drops teams on save (OpenMetadata's experts must be users).
 */
export function PeopleDetail({
  label,
  people,
  empty,
  onSave,
  usersOnly,
  description,
}: {
  label: string
  people: EntityReference[] | undefined
  empty: string
  onSave?: (next: EntityReference[]) => Promise<unknown>
  usersOnly?: boolean
  description?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Detail label={label} onEdit={onSave && (() => setOpen(true))}>
      <OwnerList owners={people} empty={empty} compact />
      {onSave && (
        <OwnerPickerDialog
          open={open}
          onOpenChange={setOpen}
          title={label}
          description={description ?? (usersOnly ? 'Only users can be picked here; teams are left out.' : undefined)}
          value={people ?? []}
          onSave={(next) => onSave(usersOnly ? next.filter((p) => p.type === 'user') : next)}
        />
      )}
    </Detail>
  )
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'destructive' | 'secondary' | 'outline'> = {
  Approved: 'success',
  'In Review': 'info',
  Draft: 'warning',
  Deprecated: 'secondary',
  Rejected: 'destructive',
}

export function StatusBadge({ status }: { status: string | undefined }) {
  if (!status) return null
  return <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{status}</Badge>
}

/** The left-hand list on Glossary, Classifications and Domains: links, the selected one highlighted. */
export function SideList({
  title,
  action,
  query,
  items,
  emptyTitle,
}: {
  title: string
  action?: ReactNode
  query: { error: Error | undefined; loading: boolean; refetch: () => void }
  items: { key: string; href: string; title: string; subtitle?: ReactNode; meta?: ReactNode; active: boolean }[]
  emptyTitle: string
}) {
  return (
    <Card className="gap-3 py-4 lg:sticky lg:top-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="px-2">
        {query.error ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : query.loading ? (
          <LoadingState />
        ) : !items.length ? (
          <EmptyState title={emptyTitle} className="mx-2" />
        ) : (
          <nav aria-label={title} className="flex flex-col gap-0.5">
            {items.map((i) => (
              <a
                key={i.key}
                href={i.href}
                aria-current={i.active ? 'page' : undefined}
                className={cn(
                  'flex min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
                  i.active && 'bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft hover:text-primary-soft-foreground',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.title}</span>
                  {i.subtitle && <span className="block truncate text-xs text-muted-foreground">{i.subtitle}</span>}
                </span>
                {i.meta && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{i.meta}</span>}
              </a>
            ))}
          </nav>
        )}
      </CardContent>
    </Card>
  )
}
