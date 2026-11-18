import { useEffect, useId, useState } from 'react'
import { ChevronDown, ExternalLink, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  addTermRelation,
  getGlossaryTerm,
  listGlossaryTerms,
  relatedTermRefs,
  removeTermRelation,
  tagAssetsFilter,
  tagUsageCounts,
  termStatus,
  TERM_STATUSES,
  type GlossaryTermV2,
} from '@/features/governance/api'
import { AssetList } from '@/features/governance/components/AssetList'
import { CreateTermDialog } from '@/features/governance/components/GlossaryDialogs'
import { DescriptionCard, Detail, PeopleDetail, StatusBadge } from '@/features/governance/components/Parts'
import { TermTree } from '@/features/governance/components/TermTree'
import { TermMeasures } from '@/features/semantic/components/TermMeasures'
import { getEntity } from '@/features/om/api'
import { TagPickerDialog } from '@/features/om/components/Editors'
import { EntityHeader } from '@/features/om/components/EntityHeader'
import { TagList } from '@/features/om/components/Labels'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import { displayName, formatCount, newTagLabel, splitFqn } from '@/features/om/entity'
import type { EntityReference } from '@/features/om/types'
import { useEntity } from '@/features/om/useEntity'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { useSearchParams } from '@/lib/router'

const joinFqn = (parts: string[]) => parts.map((p) => (p.includes('.') ? `"${p}"` : p)).join('.')

/** Glossary, then each ancestor term, from the term's FQN. */
function ancestors(term: GlossaryTermV2): EntityReference[] {
  const parts = splitFqn(term.fullyQualifiedName ?? term.name)
  const out: EntityReference[] = [{ ...term.glossary, type: 'glossary' }]
  for (let i = 2; i < parts.length; i++) {
    const fqn = joinFqn(parts.slice(0, i))
    out.push(
      term.parent?.fullyQualifiedName === fqn
        ? { ...term.parent, type: 'glossaryTerm' }
        : { id: fqn, type: 'glossaryTerm', name: parts[i - 1], fullyQualifiedName: fqn },
    )
  }
  return out
}

export function GlossaryTermPage() {
  const fqn = useSearchParams().get('fqn')
  const { entity: term, query, save } = useEntity<GlossaryTermV2>('glossaryTerm', fqn, getGlossaryTerm)
  const [editing, setEditing] = useState<null | 'synonyms' | 'related' | 'child'>(null)
  const [tab, setTab] = useState('assets')
  const allTerms = useQuery(term ? ['glossary-terms', term.glossary.id] : null, () => listGlossaryTerms(term!.glossary.id))
  const usage = useQuery(['search', 'tag-usage'], tagUsageCounts)

  if (!fqn) return <EmptyState title="No term selected" description="Open a term from the glossary." />
  if (!term) return query.error ? <ErrorState error={query.error} onRetry={query.refetch} /> : <LoadingState />

  const termFqn = term.fullyQualifiedName ?? term.name
  const descendants = (allTerms.data?.data ?? []).filter((t) => (t.fullyQualifiedName ?? '').startsWith(`${termFqn}.`))
  const related = relatedTermRefs(term)
  const status = termStatus(term)
  const assetCount = usage.data?.get(termFqn)

  const saveRelated = async (fqns: string[]) => {
    const before = new Map(related.map((r) => [r.fullyQualifiedName ?? r.name ?? r.id, r]))
    const added = fqns.filter((f) => !before.has(f))
    const removed = [...before.entries()].filter(([f]) => !fqns.includes(f)).map(([, r]) => r)
    for (const f of added) {
      const target = await getEntity<GlossaryTermV2>('glossaryTerm', f, '')
      await addTermRelation(term.id, { id: target.id, type: 'glossaryTerm' })
    }
    for (const r of removed) {
      const rel = (term.relatedTerms ?? []).find((x) => ('term' in x ? x.term.id : x.id) === r.id)
      await removeTermRelation(term.id, r.id, rel && 'term' in rel ? (rel.relationType ?? 'relatedTo') : 'relatedTo')
    }
    invalidate('entity', 'glossaryTerm')
  }

  return (
    <div className="flex flex-col gap-8">
      <EntityHeader
        entity={term}
        entityType="glossaryTerm"
        parents={ancestors(term)}
        badges={<StatusBadge status={status} />}
        fields={['owners', 'domains', 'tags']}
        onSave={save}
        onFollowChange={query.refetch}
        actions={
          <Button variant="outline" size="sm" onClick={() => setEditing('child')}>
            <Plus />
            Child term
          </Button>
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <DescriptionCard value={term.description} onSave={(description) => save({ ...term, description })} />
          <TermMeasures termFqn={termFqn} />
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="assets">Assets{assetCount !== undefined ? ` (${formatCount(assetCount)})` : ''}</TabsTrigger>
              <TabsTrigger value="children">
                Child terms ({formatCount(term.childrenCount ?? descendants.filter((d) => d.parent?.fullyQualifiedName === termFqn).length)}
                )
              </TabsTrigger>
            </TabsList>
            <TabsContent value="assets">
              <AssetList
                title="Assets"
                filter={tagAssetsFilter(termFqn)}
                emptyTitle="No assets use this term"
                emptyDescription="Label a table or column with this term from its page, and it shows up here."
              />
            </TabsContent>
            <TabsContent value="children">
              <Card>
                <CardHeader>
                  <CardTitle>Child terms</CardTitle>
                  <CardDescription>Narrower terms nested under {displayName(term)}.</CardDescription>
                  <CardAction>
                    <Button variant="outline" size="sm" onClick={() => setEditing('child')}>
                      <Plus />
                      Add child term
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {allTerms.error && !allTerms.data ? (
                    <ErrorState error={allTerms.error} onRetry={allTerms.refetch} />
                  ) : !allTerms.data ? (
                    <LoadingState />
                  ) : !descendants.length ? (
                    <EmptyState title="No child terms" />
                  ) : (
                    <TermTree terms={descendants} usage={usage.data} />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Detail label="Status">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" aria-label="Change status">
                    {status ? <StatusBadge status={status} /> : 'Set status'}
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {TERM_STATUSES.map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onSelect={() => void save({ ...term, entityStatus: s, ...(term.status !== undefined ? { status: s } : {}) })}
                    >
                      {s}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Detail>
            <Detail label="Synonyms" onEdit={() => setEditing('synonyms')}>
              {term.synonyms?.length ? (
                <div className="flex flex-wrap gap-1">
                  {term.synonyms.map((s) => (
                    <span key={s} className="rounded-md border bg-muted px-1.5 py-0.5 text-xs">
                      {s}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </Detail>
            <Detail label="Related terms" onEdit={() => setEditing('related')}>
              <TagList
                tags={related.map((r) =>
                  newTagLabel(r.fullyQualifiedName ?? r.name ?? '', 'Glossary', {
                    name: r.name,
                    displayName: r.displayName,
                    description: r.description,
                  }),
                )}
                empty="None"
              />
            </Detail>
            <PeopleDetail
              label="Reviewers"
              people={term.reviewers}
              empty="No reviewers"
              description="Reviewers approve changes to this term."
              onSave={(reviewers) => save({ ...term, reviewers })}
            />
            {term.references?.length ? (
              <Detail label="References">
                <ul className="flex flex-col gap-1">
                  {term.references.map((r) => (
                    <li key={r.endpoint}>
                      <a
                        href={r.endpoint}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {r.name}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              </Detail>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <SynonymsDialog
        open={editing === 'synonyms'}
        onOpenChange={(o) => !o && setEditing(null)}
        value={term.synonyms ?? []}
        onSave={(synonyms) => save({ ...term, synonyms })}
      />
      <TagPickerDialog
        kind="Glossary"
        open={editing === 'related'}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Related terms"
        description="Terms with a related meaning. The relation shows on both terms."
        value={related.map((r) =>
          newTagLabel(r.fullyQualifiedName ?? r.name ?? '', 'Glossary', { name: r.name, displayName: r.displayName }),
        )}
        onSave={(next) => saveRelated(next.map((t) => t.tagFQN).filter((f) => f !== termFqn))}
      />
      <CreateTermDialog
        open={editing === 'child'}
        onOpenChange={(o) => !o && setEditing(null)}
        glossary={term.glossary}
        parent={term}
        onCreated={() => setTab('children')}
      />
    </div>
  )
}

function SynonymsDialog({
  open,
  onOpenChange,
  value,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  value: string[]
  onSave: (v: string[]) => Promise<unknown>
}) {
  const id = useId()
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setDraft(value.join(', '))
      setError(undefined)
    }
  }, [open, value])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setSaving(true)
            try {
              await onSave([
                ...new Set(
                  draft
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                ),
              ])
              onOpenChange(false)
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            } finally {
              setSaving(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Synonyms</DialogTitle>
            <DialogDescription>Other words people use for this term. Search finds the term by these too.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-syn`}>Synonyms, comma separated</Label>
            <Input id={`${id}-syn`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
