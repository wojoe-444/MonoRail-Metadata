import { Sigma } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useQuery } from '@/hooks/useQuery'
import { href } from '@/lib/router'
import { ErrorState, LoadingState } from '@/features/om/components/States'

import { getMetrics } from '../api'
import { CodeBlock, MetricKindBadge } from './Parts'

/**
 * The Malloy measures that implement a glossary term (annotated
 * `# <Term FQN>: …`), for the term page. Flags a term with no implementation,
 * or with several that may disagree.
 */
export function TermMeasures({ termFqn }: { termFqn: string }) {
  const metrics = useQuery(['malloy', 'metrics'], getMetrics)
  const own = metrics.data?.filter((m) => m.glossaryTerm === termFqn) ?? []
  const narrower = metrics.data?.filter((m) => m.glossaryTerm?.startsWith(`${termFqn}.`)) ?? []
  const definitions = new Set(own.map((m) => m.definition?.replace(/^\w+\s+is\s+/, '').replace(/\s+/g, ' ')))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sigma className="size-4 text-muted-foreground" aria-hidden />
          Implemented in Malloy
        </CardTitle>
        <CardDescription>Measures annotated with this term in the semantic layer.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {metrics.error && !metrics.data ? (
          <ErrorState error={metrics.error} onRetry={metrics.refetch} />
        ) : !metrics.data ? (
          <LoadingState />
        ) : (
          <>
            {!own.length && (
              <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                No measure implements this term yet. Annotate one in a Malloy model with{' '}
                <span className="font-mono text-foreground"># {termFqn}: …</span>
                {narrower.length ? `; ${narrower.length} measure${narrower.length > 1 ? 's' : ''} implement narrower terms.` : '.'}
              </p>
            )}
            {own.length > 1 && definitions.size > 1 && (
              <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
                {own.length} measures implement this term with different definitions. Check they mean the same thing, or point one at a
                narrower term.
              </p>
            )}
            {own.map((m) => (
              <div key={`${m.model}:${m.source}.${m.name}`} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={href(`/metrics?metric=${encodeURIComponent(`${m.source}.${m.name}`)}`)}
                    className="font-mono text-sm font-medium hover:underline"
                  >
                    {m.source}.{m.name}
                  </a>
                  <MetricKindBadge kind={m.metricKind} aggregate={m.aggregate} />
                </div>
                {m.definition && <CodeBlock code={m.definition} label="Copy definition" />}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}
