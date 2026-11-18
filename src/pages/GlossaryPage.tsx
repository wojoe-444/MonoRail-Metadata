import { useState } from 'react'
import { Book, Plus } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getGlossary, listGlossaries, listGlossaryTerms, tagUsageCounts, type GlossaryTermV2 } from '@/features/governance/api'
import { CreateGlossaryDialog, CreateTermDialog } from '@/features/governance/components/GlossaryDialogs'
import { DescriptionCard, PeopleDetail, SideList } from '@/features/governance/components/Parts'
import { TermTree } from '@/features/governance/components/TermTree'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { TagList } from '@/features/om/components/Labels'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import { displayName, entityHref, formatCount } from '@/features/om/entity'
import type { Glossary } from '@/features/om/types'
import { useEntity } from '@/features/om/useEntity'
import { useQuery } from '@/hooks/useQuery'
import { useSearchParams } from '@/lib/router'

export function GlossaryPage() {
  const params = useSearchParams()
  const glossaries = useQuery(['glossaries'], listGlossaries)
  const list = [...(glossaries.data?.data ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b)))
  const fqn = params.get('fqn') ?? list[0]?.fullyQualifiedName ?? null
  const [creating, setCreating] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Glossary"
        description="Business terms and what they mean, with the data assets that carry them."
        actions={
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus />
            New glossary
          </Button>
        }
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <SideList
          title="Glossaries"
          query={glossaries}
          emptyTitle="No glossaries yet"
          items={list.map((g) => ({
            key: g.id,
            href: entityHref('glossary', g.fullyQualifiedName ?? g.name),
            title: displayName(g),
            meta: g.termCount !== undefined ? formatCount(g.termCount) : undefined,
            active: g.fullyQualifiedName === fqn,
          }))}
        />
        {fqn ? (
          <GlossaryDetail key={fqn} fqn={fqn} />
        ) : glossaries.data ? (
          <EmptyState
            icon={<Book className="size-5" aria-hidden />}
            title="No glossaries yet"
            description="Create a glossary to start defining business terms."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus />
                New glossary
              </Button>
            }
          />
        ) : null}
      </div>
      <CreateGlossaryDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function GlossaryDetail({ fqn }: { fqn: string }) {
  const { entity: glossary, query, save } = useEntity<Glossary>('glossary', fqn, getGlossary)
  const terms = useQuery(glossary ? ['glossary-terms', glossary.id] : null, () => listGlossaryTerms(glossary!.id))
  const usage = useQuery(['search', 'tag-usage'], tagUsageCounts)
  const [newTerm, setNewTerm] = useState<{ parent?: GlossaryTermV2 } | null>(null)

  if (!glossary) return query.error ? <ErrorState error={query.error} onRetry={query.refetch} /> : <LoadingState />

  const termList = terms.data?.data ?? []
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon type="glossary" className="size-10" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">{displayName(glossary)}</h2>
              {glossary.mutuallyExclusive && <Badge variant="secondary">Mutually exclusive</Badge>}
            </div>
            <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{glossary.fullyQualifiedName}</div>
          </div>
        </div>
        <Button onClick={() => setNewTerm({})}>
          <Plus />
          New term
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <DescriptionCard
          className="xl:col-span-2"
          value={glossary.description}
          onSave={(description) => save({ ...glossary, description })}
        />
        <Card>
          <CardContent className="flex flex-col gap-4">
            <PeopleDetail label="Owners" people={glossary.owners} empty="No owner" onSave={(owners) => save({ ...glossary, owners })} />
            <PeopleDetail
              label="Reviewers"
              people={glossary.reviewers}
              empty="No reviewers"
              description="Reviewers approve new and changed terms."
              onSave={(reviewers) => save({ ...glossary, reviewers })}
            />
            {glossary.tags?.length ? (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Tags</span>
                <TagList tags={glossary.tags} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Terms</CardTitle>
          <CardDescription>
            {terms.data ? `${formatCount(termList.length)} ${termList.length === 1 ? 'term' : 'terms'}` : ' '}
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setNewTerm({})}>
              <Plus />
              Add term
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {terms.error && !terms.data ? (
            <ErrorState error={terms.error} onRetry={terms.refetch} />
          ) : !terms.data ? (
            <LoadingState />
          ) : !termList.length ? (
            <EmptyState title="No terms yet" description="Add the first term to this glossary." />
          ) : (
            <TermTree terms={termList} usage={usage.data} onAddChild={(parent) => setNewTerm({ parent })} />
          )}
        </CardContent>
      </Card>

      <CreateTermDialog open={newTerm !== null} onOpenChange={(o) => !o && setNewTerm(null)} glossary={glossary} parent={newTerm?.parent} />
    </div>
  )
}
