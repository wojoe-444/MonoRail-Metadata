import { useId, useState } from 'react'
import { Plus, Shield, Tag as TagIcon, X } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  CLASSIFICATION_FIELDS,
  createClassification,
  createTag,
  listClassifications,
  listTags,
  tagAssetsFilter,
  tagUsageCounts,
  TAG_FIELDS,
} from '@/features/governance/api'
import { AssetList } from '@/features/governance/components/AssetList'
import { CreateDialog } from '@/features/governance/components/CreateDialog'
import { DescriptionCard, EditButton, SideList } from '@/features/governance/components/Parts'
import { getEntity } from '@/features/om/api'
import { DescriptionDialog } from '@/features/om/components/Editors'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { Markdown } from '@/features/om/components/Markdown'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import { displayName, entityHref, formatCount, splitFqn } from '@/features/om/entity'
import type { Classification, Tag } from '@/features/om/types'
import { useEntity } from '@/features/om/useEntity'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { navigate, useSearchParams } from '@/lib/router'
import { cn } from '@/lib/utils'

const quote = (p: string) => (p.includes('.') ? `"${p}"` : p)

export function TagsPage() {
  const fqn = useSearchParams().get('fqn')
  const classifications = useQuery(['classifications'], listClassifications)
  const list = [...(classifications.data?.data ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b)))
  // ?fqn= is a classification ("PII") or a tag in one ("PII.Sensitive").
  const parts = fqn ? splitFqn(fqn) : []
  const classificationFqn = parts[0] ? quote(parts[0]) : (list[0]?.fullyQualifiedName ?? null)
  const tagFqn = parts.length > 1 ? fqn : null
  const [creating, setCreating] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Classifications"
        description="Tag sets that label data by sensitivity, tier, trust and layer, with how many assets carry each tag."
        actions={
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus />
            New classification
          </Button>
        }
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <SideList
          title="Classifications"
          query={classifications}
          emptyTitle="No classifications yet"
          items={list.map((c) => ({
            key: c.id,
            href: entityHref('classification', c.fullyQualifiedName ?? c.name),
            title: displayName(c),
            subtitle: c.mutuallyExclusive ? 'Mutually exclusive' : undefined,
            meta: c.termCount !== undefined ? formatCount(c.termCount) : undefined,
            active: c.fullyQualifiedName === classificationFqn,
          }))}
        />
        {classificationFqn ? (
          <ClassificationDetail key={classificationFqn} fqn={classificationFqn} tagFqn={tagFqn} />
        ) : classifications.data ? (
          <EmptyState icon={<Shield className="size-5" aria-hidden />} title="No classifications yet" />
        ) : null}
      </div>
      <CreateClassificationDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function ClassificationDetail({ fqn, tagFqn }: { fqn: string; tagFqn: string | null }) {
  const {
    entity: cls,
    query,
    save,
  } = useEntity<Classification>('classification', fqn, (f) => getEntity<Classification>('classification', f, CLASSIFICATION_FIELDS))
  const tags = useQuery(cls ? ['tags', cls.name] : null, () => listTags(cls!.fullyQualifiedName ?? cls!.name))
  const usage = useQuery(['search', 'tag-usage'], tagUsageCounts)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()

  if (!cls) return query.error ? <ErrorState error={query.error} onRetry={query.refetch} /> : <LoadingState />
  const tagList = [...(tags.data?.data ?? [])].sort((a, b) => (a.fullyQualifiedName ?? '').localeCompare(b.fullyQualifiedName ?? ''))

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon type="classification" className="size-10" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">{displayName(cls)}</h2>
              {cls.provider === 'system' && <Badge variant="outline">System</Badge>}
            </div>
            <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{cls.fullyQualifiedName}</div>
          </div>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New tag
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <DescriptionCard className="xl:col-span-2" value={cls.description} onSave={(description) => save({ ...cls, description })} />
        <Card>
          <CardContent className="flex flex-col gap-4">
            <MutuallyExclusive
              checked={Boolean(cls.mutuallyExclusive)}
              onChange={async (mutuallyExclusive) => {
                setError(undefined)
                try {
                  await save({ ...cls, mutuallyExclusive })
                  invalidate('classifications')
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tags</span>
              <span className="tabular-nums">{formatCount(tags.data ? tagList.length : cls.termCount)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {tagFqn && <TagDetail key={tagFqn} fqn={tagFqn} classificationFqn={fqn} />}

      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <CardDescription>Usage counts how many data assets carry each tag, column tags included.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              Add tag
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {tags.error && !tags.data ? (
            <ErrorState error={tags.error} onRetry={tags.refetch} />
          ) : !tags.data ? (
            <LoadingState />
          ) : !tagList.length ? (
            <EmptyState title="No tags yet" description="Add the first tag to this classification." />
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tag</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead className="text-right">Usage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tagList.map((t) => {
                    const tfqn = t.fullyQualifiedName ?? t.name
                    return (
                      <TableRow key={t.id} data-state={tfqn === tagFqn ? 'selected' : undefined}>
                        <TableCell className="max-w-0 min-w-40">
                          <a
                            href={entityHref('tag', tfqn)}
                            className={cn('flex min-w-0 items-center gap-2 hover:underline', tfqn === tagFqn && 'font-semibold')}
                          >
                            <TagIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate font-medium">{displayName(t)}</span>
                          </a>
                        </TableCell>
                        <TableCell className="hidden max-w-0 min-w-48 md:table-cell">
                          <span className="block truncate text-muted-foreground">{t.description || '–'}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {usage.data ? formatCount(usage.data.get(tfqn) ?? t.usageCount ?? 0) : formatCount(t.usageCount)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        title={`New tag in ${displayName(cls)}`}
        onSubmit={async (v) => {
          const t = await createTag({ ...v, classification: cls.fullyQualifiedName ?? cls.name })
          invalidate('tags', cls.name)
          invalidate('classifications')
          invalidate('entity', 'classification')
          invalidate('search')
          navigate(`/tags?fqn=${encodeURIComponent(t.fullyQualifiedName ?? `${fqn}.${t.name}`)}`)
        }}
      />
    </div>
  )
}

function MutuallyExclusive({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id}>Mutually exclusive</Label>
        <p className="mt-1 text-xs text-muted-foreground">An asset can carry only one tag from this classification.</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function TagDetail({ fqn, classificationFqn }: { fqn: string; classificationFqn: string }) {
  const { entity: tag, query, save } = useEntity<Tag>('tag', fqn, (f) => getEntity('tag', f, TAG_FIELDS))
  if (!tag) return query.error ? <ErrorState error={query.error} onRetry={query.refetch} /> : <LoadingState />
  return (
    <Card className="border-primary/30 ring-primary/30">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <TagIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{displayName(tag)}</span>
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs">{tag.fullyQualifiedName}</CardDescription>
        <CardAction>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Close tag"
                onClick={() => navigate(`/tags?fqn=${encodeURIComponent(classificationFqn)}`)}
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TagDescription value={tag.description} onSave={(description) => save({ ...tag, description })} />
        <AssetList title="Tagged assets" filter={tagAssetsFilter(tag.fullyQualifiedName ?? fqn)} emptyTitle="No assets carry this tag" />
      </CardContent>
    </Card>
  )
}

function TagDescription({ value, onSave }: { value: string | undefined; onSave: (v: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Description</span>
        <EditButton label="Edit description" onClick={() => setOpen(true)} />
      </div>
      <Markdown>{value}</Markdown>
      <DescriptionDialog open={open} onOpenChange={setOpen} title="Edit description" value={value} onSave={onSave} />
    </div>
  )
}

function CreateClassificationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [exclusive, setExclusive] = useState(false)
  const id = useId()
  return (
    <CreateDialog
      open={open}
      onOpenChange={(o) => {
        if (o) setExclusive(false)
        onOpenChange(o)
      }}
      title="New classification"
      description="A classification is a set of tags, e.g. data sensitivity levels."
      onSubmit={async (v) => {
        const c = await createClassification({ ...v, mutuallyExclusive: exclusive })
        invalidate('classifications')
        invalidate('search')
        navigate(`/tags?fqn=${encodeURIComponent(c.fullyQualifiedName ?? c.name)}`)
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor={id}>Mutually exclusive</Label>
          <p className="mt-1 text-xs text-muted-foreground">An asset can carry only one of its tags.</p>
        </div>
        <Switch id={id} checked={exclusive} onCheckedChange={setExclusive} />
      </div>
    </CreateDialog>
  )
}
