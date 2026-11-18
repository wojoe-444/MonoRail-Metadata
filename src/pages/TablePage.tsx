import { useState } from 'react'
import { ArrowRight, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useQuery } from '@/hooks/useQuery'
import { href, navigate, useRoute, useSearchParams } from '@/lib/router'
import { LineageGraph } from '@/features/lineage/LineageGraph'
import { TableMalloyTab } from '@/features/malloy/TableMalloyTab'
import { getLatestProfile, getLineage, getTable } from '@/features/om/api'
import { displayName, formatBytes, formatCount, formatDate, timeAgo } from '@/features/om/entity'
import { DescriptionDialog } from '@/features/om/components/Editors'
import { EntityHeader } from '@/features/om/components/EntityHeader'
import { Markdown } from '@/features/om/components/Markdown'
import { EmptyState, ErrorState, Loaded, LoadingState } from '@/features/om/components/States'
import type { ColumnProfile, EntityReference, Table } from '@/features/om/types'
import { useEntity } from '@/features/om/useEntity'
import { TableQualityTab } from '@/features/quality/TableQualityTab'
import { ActivityTab, DefinitionTab, QueriesTab, SampleDataTab, VersionsTab } from '@/features/table/MiscTabs'
import { ProfilerTab } from '@/features/table/ProfilerTab'
import { SchemaTab } from '@/features/table/SchemaTab'

const TABS = ['schema', 'lineage', 'profiler', 'quality', 'semantic', 'sample', 'queries', 'definition', 'activity', 'history'] as const
type Tab = (typeof TABS)[number]

/** A table: what it is, who owns it, its columns, where it comes from and goes, how it's used and how healthy it is. */
export function TablePage() {
  const params = useSearchParams()
  const [path] = useRoute()
  const fqn = params.get('fqn')
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'schema'
  const { entity: table, query, save } = useEntity<Table>('table', fqn, getTable)
  const latest = useQuery(table ? ['latest-profile', fqn] : null, () => getLatestProfile(fqn!))
  const [editingDescription, setEditingDescription] = useState(false)

  if (!fqn)
    return (
      <EmptyState
        title="No table selected"
        description="Open a table from Explore."
        action={<Button onClick={() => navigate('/explore?scope=table')}>Browse tables</Button>}
      />
    )
  if (query.error && !table) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!table) return <LoadingState />

  const setTab = (t: string) => {
    const next = new URLSearchParams(params)
    if (t === 'schema') next.delete('tab')
    else next.set('tab', t)
    navigate(`${path.split('?')[0]}?${next.toString()}`)
  }
  const profiles: Record<string, ColumnProfile | undefined> = Object.fromEntries(
    (latest.data?.columns ?? []).map((c) => [c.name, c.profile]),
  )
  const parents = [table.service, table.database, table.databaseSchema].filter(Boolean) as EntityReference[]
  const profile = latest.data?.profile ?? table.profile

  return (
    <div className="flex flex-col gap-6">
      <EntityHeader
        entity={table}
        entityType="table"
        subtype={table.tableType}
        parents={parents}
        sourceUrl={table.sourceUrl}
        onSave={save}
        onFollowChange={query.refetch}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>About</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setEditingDescription(true)}>
                <Pencil />
                Edit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Markdown placeholder="No description yet. Say what one row is, where the data comes from, and when to use it.">
              {table.description}
            </Markdown>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Fact label="Rows" value={formatCount(profile?.rowCount)} />
            <Fact label="Size" value={formatBytes(profile?.sizeInByte)} />
            <Fact label="Columns" value={String(table.columns.length)} />
            <Fact label="Queries / week" value={formatCount(table.usageSummary?.weeklyStats?.count)} />
            <Fact
              label="Partitioned by"
              value={table.tablePartition?.columns?.map((c) => `${c.columnName} (${c.interval?.toLowerCase() ?? 'day'})`).join(', ') ?? '–'}
              mono
            />
            <Fact
              label="Clustered by"
              value={table.tableConstraints?.find((c) => c.constraintType === 'CLUSTER_KEY')?.columns.join(', ') ?? '–'}
              mono
            />
            <Fact label="Updated" value={timeAgo(table.updatedAt)} title={formatDate(table.updatedAt)} />
            <Fact label="Data products" value={table.dataProducts?.map((d) => displayName(d)).join(', ') || '–'} />
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            <TabsTrigger value="schema">Schema</TabsTrigger>
            <TabsTrigger value="lineage">Lineage</TabsTrigger>
            <TabsTrigger value="profiler">Profiler</TabsTrigger>
            <TabsTrigger value="quality">Data quality</TabsTrigger>
            <TabsTrigger value="semantic">Malloy</TabsTrigger>
            <TabsTrigger value="sample">Sample data</TabsTrigger>
            <TabsTrigger value="queries">Queries</TabsTrigger>
            {table.schemaDefinition && <TabsTrigger value="definition">Definition</TabsTrigger>}
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="schema">
          <SchemaTab table={table} profiles={profiles} onSave={save} />
        </TabsContent>
        <TabsContent value="lineage">
          <TableLineage table={table} />
        </TabsContent>
        <TabsContent value="profiler">
          <ProfilerTab table={table} latest={profiles} />
        </TabsContent>
        <TabsContent value="quality">
          <TableQualityTab table={table} />
        </TabsContent>
        <TabsContent value="semantic">
          <TableMalloyTab table={table} />
        </TabsContent>
        <TabsContent value="sample">
          <SampleDataTab table={table} />
        </TabsContent>
        <TabsContent value="queries">
          <QueriesTab table={table} />
        </TabsContent>
        {table.schemaDefinition && (
          <TabsContent value="definition">
            <DefinitionTab sql={table.schemaDefinition} />
          </TabsContent>
        )}
        <TabsContent value="activity">
          <ActivityTab entityType="table" entity={table} />
        </TabsContent>
        <TabsContent value="history">
          <VersionsTab entityType="table" entity={table} />
        </TabsContent>
      </Tabs>

      <DescriptionDialog
        open={editingDescription}
        onOpenChange={setEditingDescription}
        title={`Description of ${displayName(table)}`}
        value={table.description}
        onSave={(description) => save({ ...table, description })}
      />
    </div>
  )
}

function Fact({ label, value, mono, title }: { label: string; value: string; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? 'truncate font-mono text-xs leading-5' : 'truncate font-medium tabular-nums'}>{value}</div>
    </div>
  )
}

function TableLineage({ table }: { table: Table }) {
  const lineage = useQuery(['lineage', 'table', table.fullyQualifiedName, 2], () => getLineage('table', table.fullyQualifiedName!, 2, 2))
  return (
    <Loaded query={lineage}>
      {(data) =>
        Object.keys(data.nodes).length <= 1 ? (
          <EmptyState
            title="No lineage recorded"
            description="The lineage ingestion reads BigQuery query history and view definitions. You can also add edges by hand on the Lineage page."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" asChild>
                <a href={href(`/lineage?fqn=${encodeURIComponent(table.fullyQualifiedName!)}`)}>
                  Open full lineage
                  <ArrowRight />
                </a>
              </Button>
            </div>
            <div className="h-[32rem] overflow-hidden rounded-xl border bg-muted/30">
              <LineageGraph data={data} rootId={table.id} />
            </div>
          </div>
        )
      }
    </Loaded>
  )
}
