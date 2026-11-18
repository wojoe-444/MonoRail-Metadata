import { useState } from 'react'
import { ArrowRight, KeyRound, Network, Search, SlidersHorizontal } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useQuery } from '@/hooks/useQuery'
import { href } from '@/lib/router'
import { getSemantic, type SemanticSource } from '@/features/semantic/api'
import { Overline, TableLink } from '@/features/semantic/components/Parts'
import { joinTree, sourceHref } from '@/features/semantic/model'
import { EmptyState, Loaded } from '@/features/om/components/States'

/** Every Malloy source as a semantic model: what table it wraps, its key, its joins, and how many fields it defines. */
export function SemanticModelsPage() {
  const semantic = useQuery(['malloy', 'semantic'], getSemantic)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Semantic models"
        description="Each Malloy source is a semantic model: a table with a primary key, joins, dimensions, measures and views, defined once in malloy/."
        actions={
          <Button asChild>
            <a href={href('/query')}>
              <SlidersHorizontal />
              Query builder
            </a>
          </Button>
        }
      />
      <Loaded query={semantic}>
        {(models) => {
          const problems = models.filter((m) => !m.ok)
          const sources = models
            .flatMap((m) => m.sources)
            .filter(
              (s) =>
                !needle ||
                s.name.toLowerCase().includes(needle) ||
                (s.description ?? '').toLowerCase().includes(needle) ||
                (s.tablePath ?? '').toLowerCase().includes(needle),
            )
          return (
            <>
              {problems.map((m) => (
                <div
                  key={m.path}
                  role="alert"
                  className="rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-foreground"
                >
                  <span className="font-mono font-medium">{m.path}</span> doesn&apos;t compile: {m.problems[0]?.message}{' '}
                  <a className="underline" href={href(`/malloy/workbench?path=${encodeURIComponent(m.path)}`)}>
                    Open in workbench
                  </a>
                </div>
              ))}
              <div className="relative max-w-sm">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  aria-label="Search semantic models"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search sources"
                  className="pl-8"
                />
              </div>
              {!sources.length ? (
                <EmptyState
                  icon={<Network className="size-5" />}
                  title={needle ? `No source matches “${q}”` : 'No sources yet'}
                  description={needle ? undefined : 'Add a source to a model in malloy/, or scaffold one from a table’s Malloy tab.'}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {sources.map((s) => (
                    <SourceCard key={`${s.model}:${s.name}`} source={s} />
                  ))}
                </div>
              )}
            </>
          )
        }}
      </Loaded>
    </div>
  )
}

function SourceCard({ source: s }: { source: SemanticSource }) {
  const own = s.fields.filter((f) => !f.column)
  const count = (k: string) => own.filter((f) => f.kind === k).length
  const columns = s.fields.filter((f) => f.column).length
  const joins = joinTree(s).filter((n) => n.path.length)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono">
          <a href={sourceHref(s.model, s.name)} className="hover:underline">
            {s.name}
          </a>
        </CardTitle>
        <CardDescription className="line-clamp-2">{s.description ?? <span className="font-mono">{s.model}</span>}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <a href={sourceHref(s.model, s.name)}>
              Open
              <ArrowRight />
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <Overline>Table</Overline>
            <TableLink path={s.tablePath} fqn={s.tableFqn} />
          </div>
          <div>
            <Overline>Primary key</Overline>
            <span className="flex items-center gap-1 font-mono text-xs">
              <KeyRound className="size-3.5 text-muted-foreground" aria-hidden />
              {s.primaryKey ?? <span className="text-muted-foreground">None</span>}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
          <span>
            <span className="font-medium">{count('measure')}</span> <span className="text-muted-foreground">measures</span>
          </span>
          <span>
            <span className="font-medium">{count('dimension')}</span> <span className="text-muted-foreground">dimensions</span>
            <span className="text-muted-foreground"> + {columns} columns</span>
          </span>
          <span>
            <span className="font-medium">{count('view')}</span> <span className="text-muted-foreground">views</span>
          </span>
        </div>
        {joins.length > 0 && (
          <div>
            <Overline>Joins</Overline>
            <div className="flex flex-wrap gap-1.5">
              {joins.map((j) => (
                <Badge key={j.path.join('.')} variant={j.edge === 'many' ? 'primary' : 'secondary'} className="font-mono">
                  {j.path.join('.')} · join_{j.edge}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
