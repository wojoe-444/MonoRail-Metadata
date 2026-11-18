import { useState, type CSSProperties } from 'react'
import { Check, ChevronLeft, Copy, ExternalLink, Pencil } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { COLLECTION } from '@/features/om/api'
import { displayName, entityLabel, entityPath, formatDate, openMetadataPath, plainTags } from '@/features/om/entity'
import { DescriptionDialog } from '@/features/om/components/Editors'
import { EntityHeader } from '@/features/om/components/EntityHeader'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { TagList } from '@/features/om/components/Labels'
import { Markdown } from '@/features/om/components/Markdown'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import type { Column, EntityReference } from '@/features/om/types'
import { useEntity } from '@/features/om/useEntity'
import { ActivityTab, VersionsTab } from '@/features/table/MiscTabs'
import { href } from '@/lib/router'

import { getOf, type AnyEntity } from './api'
import type { TypeInfo } from './catalog'

type HeaderField = 'owners' | 'tier' | 'certification' | 'domains' | 'tags'

/**
 * Any OpenMetadata entity, the way OpenMetadata stores it: the editable header (owners, tier,
 * certification, tags), the description, every other field, its relationships, its schema when
 * it has one, version history, activity, and the raw JSON.
 */
export function EntityView({ info, fqn }: { info: TypeInfo; fqn: string }) {
  const { entity, query, save } = useEntity<AnyEntity>(info.type, fqn, (f) => getOf(info.type, f))
  const [tab, setTab] = useState('details')
  const [editingDescription, setEditingDescription] = useState(false)

  const back = (
    <a
      href={href(openMetadataPath(info.type))}
      className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-3" aria-hidden />
      {info.plural}
    </a>
  )
  if (!entity)
    return (
      <div className="flex flex-col gap-4">
        {back}
        {query.error ? <ErrorState error={query.error} onRetry={query.refetch} /> : <LoadingState />}
      </div>
    )

  const fields = (['owners', 'tier', 'certification', 'domains', 'tags'] as HeaderField[]).filter((f) =>
    f === 'tier' ? 'tags' in entity : f in entity,
  )
  const page = entityPath(info.type, fqn)
  const dedicated = !page.startsWith('/openmetadata')
  const refs = referencesOf(entity)
  const schema = schemaOf(entity)

  return (
    <div className="flex flex-col gap-6">
      {back}
      <EntityHeader
        entity={entity}
        entityType={info.type}
        fields={fields}
        onSave={save}
        onFollowChange={query.refetch}
        badges={entity.deleted ? <Badge variant="destructive">Deleted</Badge> : undefined}
        actions={
          dedicated && (
            <Button variant="outline" size="sm" asChild>
              <a href={href(page)}>
                <ExternalLink />
                Open its page
              </a>
            </Button>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
          <CardAction>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Edit description" onClick={() => setEditingDescription(true)}>
                  <Pencil />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit description</TooltipContent>
            </Tooltip>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Markdown>{entity.description}</Markdown>
        </CardContent>
      </Card>
      <DescriptionDialog
        open={editingDescription}
        onOpenChange={setEditingDescription}
        title={`Description of ${displayName(entity)}`}
        value={entity.description}
        onSave={(description) => save({ ...entity, description })}
      />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            {schema && (
              <TabsTrigger value="schema">
                {schema.label} <span className="text-muted-foreground tabular-nums">{schema.count}</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="relationships">
              Relationships <span className="text-muted-foreground tabular-nums">{refs.reduce((n, [, r]) => n + r.length, 0)}</span>
            </TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="details">
          <Details entity={entity} />
        </TabsContent>
        {schema && (
          <TabsContent value="schema">
            <SchemaTable columns={schema.columns} />
          </TabsContent>
        )}
        <TabsContent value="relationships">
          <Relationships refs={refs} />
        </TabsContent>
        <TabsContent value="versions">
          <VersionsTab entityType={info.type} entity={entity} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab entityType={info.type} entity={entity} />
        </TabsContent>
        <TabsContent value="json">
          <JsonCard entity={entity} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- Field helpers ----------

/** Shown elsewhere on the page (header, description, schema, relationships), so not in Details. */
const SHOWN_ELSEWHERE = new Set([
  'name',
  'displayName',
  'description',
  'fullyQualifiedName',
  'tags',
  'certification',
  'changeDescription',
  'incrementalChangeDescription',
  'extension',
  'href',
  'entityType',
  'columns',
  'fields',
])

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function isRef(v: unknown): v is EntityReference {
  return isObject(v) && typeof v.id === 'string' && typeof v.type === 'string'
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (isObject(v) && !Object.keys(v).length)

const isScalar = (v: unknown) => ['string', 'number', 'boolean'].includes(typeof v)

const humanize = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

function formatValue(key: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number' && /(At|Date|Time|time|timestamp|Ts)$/.test(key) && v > 1e11) return formatDate(v)
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}

/** Every top-level field holding an entity reference, or a list of them. */
function referencesOf(entity: AnyEntity): [string, EntityReference[]][] {
  const out: [string, EntityReference[]][] = []
  for (const [k, v] of Object.entries(entity)) {
    if (isRef(v)) out.push([k, [v]])
    else if (Array.isArray(v) && v.length && v.every(isRef)) out.push([k, v])
  }
  return out
}

interface SchemaField extends Partial<Column> {
  name: string
}

/** The columns or fields an entity has, wherever its type keeps them. */
function schemaOf(entity: AnyEntity): { label: string; columns: SchemaField[]; count: number } | undefined {
  const at = (v: unknown) => (Array.isArray(v) && v.length ? (v as SchemaField[]) : undefined)
  const sub = (k: string, f: string) => (isObject(entity[k]) ? at((entity[k] as Record<string, unknown>)[f]) : undefined)
  const columns =
    at(entity.columns) ??
    sub('dataModel', 'columns') ??
    at(entity.fields) ??
    sub('messageSchema', 'schemaFields') ??
    sub('responseSchema', 'schemaFields')
  if (!columns) return undefined
  const count = (cs: SchemaField[]): number => cs.reduce((n, c) => n + 1 + count((c.children as SchemaField[]) ?? []), 0)
  return { label: at(entity.columns) || sub('dataModel', 'columns') ? 'Columns' : 'Fields', columns, count: count(columns) }
}

// ---------- Tabs ----------

function Details({ entity }: { entity: AnyEntity }) {
  const entries = Object.entries(entity).filter(([k, v]) => !SHOWN_ELSEWHERE.has(k) && !isEmpty(v))
  const scalars = entries.filter(([, v]) => isScalar(v))
  const structured = entries.filter(([, v]) => !isScalar(v) && !isRef(v) && !(Array.isArray(v) && v.every(isRef)))
  const extension = isObject(entity.extension) ? Object.entries(entity.extension) : []
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Properties</CardTitle>
          <CardDescription>Every simple field OpenMetadata returned.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {scalars.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{humanize(k)}</dt>
                <dd className={typeof v === 'string' && v.length > 60 ? 'text-sm break-words' : 'truncate text-sm'} title={String(v)}>
                  {k === 'id' ? <span className="font-mono text-xs">{String(v)}</span> : formatValue(k, v)}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {extension.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Custom properties</CardTitle>
            <CardDescription>Fields added to this type in OpenMetadata (its `extension`).</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {extension.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{humanize(k)}</dt>
                  <dd className="text-sm break-words">{isScalar(v) ? formatValue(k, v) : <Json value={v} />}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
      {structured.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Structured fields</CardTitle>
            <CardDescription>Nested settings and records, as JSON.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {structured.map(([k, v]) => (
              <div key={k} className="flex min-w-0 flex-col gap-1">
                <div className="text-xs text-muted-foreground">{humanize(k)}</div>
                <Json value={v} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Json({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={className ?? 'max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs'}>{JSON.stringify(value, null, 2)}</pre>
  )
}

function Relationships({ refs }: { refs: [string, EntityReference[]][] }) {
  if (!refs.length) return <EmptyState title="No relationships" description="This entity refers to no other entity." />
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {refs.map(([k, list]) => (
        <Card key={k}>
          <CardHeader>
            <CardTitle>{humanize(k)}</CardTitle>
            <CardDescription>
              {list.length} {list.length === 1 ? 'reference' : 'references'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {list.map((r) => (
                <li key={`${r.type}:${r.id}`} className="flex min-w-0 items-center gap-3 py-2">
                  <EntityIcon type={r.type} className="size-7" />
                  <div className="min-w-0 flex-1">
                    {r.type in COLLECTION ? (
                      <a
                        href={href(openMetadataPath(r.type, r.fullyQualifiedName ?? r.name ?? r.id))}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {displayName(r)}
                      </a>
                    ) : (
                      <span className="block truncate text-sm font-medium">{displayName(r)}</span>
                    )}
                    <div className="truncate text-xs text-muted-foreground">
                      {entityLabel(r.type)}
                      {r.fullyQualifiedName && (
                        <>
                          {' · '}
                          <span className="font-mono">{r.fullyQualifiedName}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {r.deleted && <Badge variant="outline">Deleted</Badge>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function SchemaTable({ columns }: { columns: SchemaField[] }) {
  const rows: { col: SchemaField; depth: number }[] = []
  const walk = (cs: SchemaField[], depth: number) => {
    for (const c of cs) {
      rows.push({ col: c, depth })
      if (c.children?.length) walk(c.children as SchemaField[], depth + 1)
    }
  }
  walk(columns, 0)
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="hidden md:table-cell">Description</TableHead>
            <TableHead className="hidden lg:table-cell">Tags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ col, depth }, i) => {
            const indent: CSSProperties = { paddingLeft: `${0.5 + depth * 1.25}rem` }
            return (
              <TableRow key={col.fullyQualifiedName ?? `${col.name}-${i}`}>
                <TableCell style={indent} className="font-medium">
                  {col.displayName || col.name}
                  {col.constraint && col.constraint !== 'NULL' && (
                    <Badge variant="outline" className="ml-2">
                      {col.constraint.replace('_', ' ').toLowerCase()}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{col.dataTypeDisplay ?? col.dataType ?? '–'}</TableCell>
                <TableCell className="hidden max-w-96 md:table-cell">
                  <span className="line-clamp-2 text-sm text-muted-foreground">{col.description || '–'}</span>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <TagList tags={plainTags(col.tags)} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}

function JsonCard({ entity }: { entity: AnyEntity }) {
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(entity, null, 2)
  return (
    <Card>
      <CardHeader>
        <CardTitle>JSON</CardTitle>
        <CardDescription>The entity exactly as OpenMetadata returned it.</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(text)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[70vh] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{text}</pre>
      </CardContent>
    </Card>
  )
}
