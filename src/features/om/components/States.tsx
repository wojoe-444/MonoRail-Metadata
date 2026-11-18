import type { ReactNode } from 'react'
import { CircleAlert, Inbox, LoaderCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Loading, error and empty placeholders, so every page handles the three the same way. */

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground', className)}>
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: Error; onRetry?: () => void; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive-soft px-6 py-8 text-center',
        className,
      )}
    >
      <CircleAlert className="size-5 text-destructive" aria-hidden />
      <div className="max-w-xl text-sm text-destructive-soft-foreground">{error.message}</div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center', className)}>
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-5" aria-hidden />}</div>
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="max-w-md text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Renders `children(data)` once loaded; the loading and error states otherwise. */
export function Loaded<T>({
  query,
  children,
  loading,
}: {
  query: { data: T | undefined; error: Error | undefined; loading: boolean; refetch: () => void }
  children: (data: T) => ReactNode
  loading?: ReactNode
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  return <>{loading ?? <LoadingState />}</>
}
