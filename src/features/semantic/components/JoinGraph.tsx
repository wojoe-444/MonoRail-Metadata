import '@xyflow/react/dist/base.css'

import { useId, useMemo, useState } from 'react'
import { Background, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { ArrowRight, CircleCheck, KeyRound, Split } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { useQuery } from '@/hooks/useQuery'
import { entityHref } from '@/features/om/entity'
import { cn } from '@/lib/utils'

import { dryRunQuery, type SemanticSource } from '../api'
import { dimensionsOf, fanOut, isTime, joinTree, measuresOf, type JoinNode } from '../model'
import { queryMalloy, type QueryState } from '../query'
import { CodeBlock, Overline } from './Parts'

/**
 * A source's joins as a graph. Pick a measure and a dimension to see which
 * joins the query takes, the grain the measure aggregates at, and whether a
 * join fans out its rows (and how Malloy keeps the number right anyway).
 */

const COL_W = 280
const ROW_H = 120

type NodeData = { node: JoinNode; role: { measure?: boolean; dimension?: boolean; grain?: boolean }; active: boolean; dim: boolean }

function JoinNodeCard({ data }: NodeProps<Node<NodeData>>) {
  const n = data.node
  return (
    <div
      className={cn(
        'w-56 rounded-xl border bg-card px-3 py-2.5 text-card-foreground shadow-elevation-1 transition-opacity',
        data.active && 'border-primary ring-2 ring-primary/30',
        data.dim && 'opacity-40',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-muted-foreground" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-sm font-medium">{n.name}</span>
        {!n.path.length && <Badge variant="secondary">source</Badge>}
      </div>
      {n.tablePath && (
        <a
          href={entityHref('table', n.tableFqn ?? n.tablePath)}
          className="nodrag block truncate font-mono text-[11px] text-muted-foreground hover:underline"
          title={n.tablePath}
        >
          {n.tablePath.split('.').slice(-2).join('.')}
        </a>
      )}
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        <KeyRound className="size-3" aria-hidden />
        <span className="font-mono">{n.primaryKey ?? 'no primary key'}</span>
      </div>
      {(data.role.measure || data.role.dimension || data.role.grain) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {data.role.grain && <Badge variant="primary">grain</Badge>}
          {data.role.measure && <Badge variant="info">measure</Badge>}
          {data.role.dimension && <Badge variant="secondary">dimension</Badge>}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-muted-foreground" />
    </div>
  )
}

const NODE_TYPES = { join: JoinNodeCard }

export function JoinGraph({ source }: { source: SemanticSource }) {
  const id = useId()
  const tree = useMemo(() => joinTree(source), [source])
  const measures = useMemo(() => measuresOf(source), [source])
  const dims = useMemo(() => dimensionsOf(source), [source])

  // Default to a measure on the source and a dimension behind a join_many when there is one: the interesting case.
  const behindMany = (path: string[]) =>
    path.some((_, i) => tree.find((n) => n.path.join('.') === path.slice(0, i + 1).join('.'))?.edge === 'many')
  const joinedStrings = dims.filter((d) => d.node.path.length && d.field.type === 'string')
  const deepDim =
    joinedStrings.find((d) => behindMany(d.node.path) && d.field.name === 'category') ??
    joinedStrings.find((d) => behindMany(d.node.path)) ??
    joinedStrings.find((d) => d.field.name === 'category') ??
    joinedStrings[0] ??
    dims[0]
  const rootMeasures = measures.filter((m) => !m.node.path.length)
  const [mPath, setMPath] = useState<string>(
    (rootMeasures.find((m) => m.field.aggregate === 'sum') ?? rootMeasures[0] ?? measures[0])?.path ?? '',
  )
  const [dPath, setDPath] = useState<string>(deepDim?.path ?? '')
  const measure = measures.find((m) => m.path === mPath)
  const dimension = dims.find((d) => d.path === dPath)
  const fo = measure ? fanOut(source, measure, dimension) : undefined

  const joinedKeys = new Set(fo?.joined.map((p) => p.join('.')) ?? [])
  const causeKeys = new Set(fo?.causes.map((c) => c.node.path.join('.')) ?? [])
  const anySelected = Boolean(measure)

  const state: QueryState | undefined = measure
    ? {
        model: source.model,
        source: source.name,
        measures: [measure.path],
        groupBy: dimension ? [{ field: dimension.path, grain: isTime(dimension.field) ? 'month' : undefined }] : [],
        filters: [],
        compare: 'none',
      }
    : undefined
  const malloy = state ? queryMalloy(state, () => undefined) : ''
  const sql = useQuery(malloy ? ['malloy-dryrun', source.model, malloy] : null, () => dryRunQuery(source.model, malloy))
  const symmetric = sql.data?.sql ? /SUM\(DISTINCT|md5\(|FARM_FINGERPRINT/i.test(sql.data.sql) : false
  const distinctCount = sql.data?.sql ? /COUNT\(\s*DISTINCT/i.test(sql.data.sql) : false

  const { nodes, edges } = useMemo(() => {
    let row = 0
    const pos = new Map<string, { x: number; y: number }>()
    // Depth-first so children sit next to their parent.
    const visit = (n: JoinNode) => {
      pos.set(n.path.join('.'), { x: n.path.length * COL_W, y: row++ * ROW_H })
      tree.filter((c) => c.path.length === n.path.length + 1 && c.path.slice(0, -1).join('.') === n.path.join('.')).forEach(visit)
    }
    visit(tree[0]!)
    const nodes: Node<NodeData>[] = tree.map((n) => {
      const key = n.path.join('.')
      const onPath = !n.path.length || joinedKeys.has(key)
      return {
        id: key || '__root__',
        type: 'join',
        position: pos.get(key)!,
        data: {
          node: n,
          role: {
            measure: measure?.node.path.join('.') === key,
            dimension: dimension?.node.path.join('.') === key,
            grain: fo?.grain.path.join('.') === key,
          },
          active: anySelected && onPath,
          dim: anySelected && !onPath,
        },
      }
    })
    const edges: Edge[] = tree
      .filter((n) => n.path.length)
      .map((n) => {
        const key = n.path.join('.')
        const parent = n.path.slice(0, -1).join('.') || '__root__'
        const onPath = joinedKeys.has(key)
        const fan = causeKeys.has(key)
        const color = fan ? 'var(--warning)' : onPath ? 'var(--primary)' : 'var(--muted-foreground)'
        return {
          id: `${parent}->${key}`,
          source: parent,
          target: key,
          animated: onPath,
          label: `join_${n.edge}${n.join?.on ? `: ${n.join.on}` : ''}`,
          labelStyle: { fill: 'var(--foreground)', fontSize: 11, fontFamily: 'var(--font-mono)' },
          labelBgStyle: { fill: 'var(--card)' },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          style: { stroke: color, strokeWidth: onPath ? 2 : 1.25, opacity: anySelected && !onPath ? 0.35 : 1 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
        }
      })
    return { nodes, edges }
  }, [tree, measure, dimension, fo, anySelected, joinedKeys, causeKeys])

  if (!tree.length) return null
  const pathNames = (p: string[]) => [source.name, ...p].join(' → ')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-m`}>Measure</Label>
          <NativeSelect id={`${id}-m`} value={mPath} onChange={(e) => setMPath(e.target.value)} className="font-mono">
            {measures.map((m) => (
              <option key={m.path} value={m.path}>
                {m.path}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-d`}>Group by</Label>
          <NativeSelect id={`${id}-d`} value={dPath} onChange={(e) => setDPath(e.target.value)} className="font-mono">
            <option value="">Nothing (a single total)</option>
            {dims.map((d) => (
              <option key={d.path} value={d.path}>
                {d.path}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="h-96 w-full overflow-hidden rounded-xl border bg-background">
        <ReactFlowProvider>
          <ReactFlow
            key={source.model + source.name}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
            minZoom={0.3}
            nodesConnectable={false}
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--border)" gap={20} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>

      {measure && fo && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>How this query runs</CardTitle>
              <CardDescription>The joins it takes and the grain {measure.field.name} aggregates at.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <div>
                <Overline>Path</Overline>
                <div className="flex flex-col gap-1 font-mono text-xs">
                  <span>
                    measure: {pathNames(measure.node.path)}
                    <span className="text-muted-foreground"> · {measure.field.name}</span>
                  </span>
                  {dimension && (
                    <span>
                      dimension: {pathNames(dimension.node.path)}
                      <span className="text-muted-foreground"> · {dimension.field.name}</span>
                    </span>
                  )}
                </div>
              </div>
              <div>
                <Overline>Grain</Overline>
                <p>
                  <span className="font-mono">{measure.field.name}</span> aggregates rows of{' '}
                  <span className="font-mono">{fo.grain.name}</span>, one per{' '}
                  <span className="font-mono">{fo.grain.primaryKey ?? 'row'}</span>
                  {fo.grain.tablePath ? (
                    <>
                      {' '}
                      in <span className="font-mono">{fo.grain.tablePath.split('.').pop()}</span>
                    </>
                  ) : null}
                  . Results have one row per{' '}
                  {dimension ? <span className="font-mono">{dimension.field.name}</span> : 'query (a single total)'}.
                </p>
              </div>
              {fo.causes.length ? (
                <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-warning-soft-foreground">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Split className="size-4" aria-hidden />
                    This join fans out
                  </div>
                  <ul className="flex list-disc flex-col gap-1 pl-5">
                    {fo.causes.map((c) => (
                      <li key={c.node.path.join('.')}>{c.reason}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="flex items-start gap-1.5 rounded-lg border border-success/30 bg-success-soft p-3 text-success-soft-foreground">
                  <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    No fan-out. Each <span className="font-mono">{fo.grain.name}</span> row appears once in the joined rows, so a plain
                    aggregate is already right.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{fo.causes.length ? 'Why the number is still right' : 'Symmetric aggregates'}</CardTitle>
              <CardDescription>Malloy answers queries that MetricFlow refuses.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {fo.causes.length ? (
                <p>
                  A plain <span className="font-mono">SUM</span> or <span className="font-mono">COUNT</span> over the joined rows would
                  count each <span className="font-mono">{fo.grain.name}</span> row once per repeat. Malloy knows each source&apos;s primary
                  key, so it uses a <span className="font-medium">symmetric aggregate</span>: it aggregates each{' '}
                  <span className="font-mono">{fo.grain.primaryKey}</span> once (a <span className="font-mono">COUNT(DISTINCT …)</span>, or
                  a <span className="font-mono">SUM(DISTINCT …)</span> over the value plus a hash of the key). The answer equals aggregating{' '}
                  <span className="font-mono">{fo.grain.name}</span> alone, then joining.
                </p>
              ) : (
                <p>
                  When a join repeats rows (down a join_many, or up a join_one), Malloy aggregates each primary key once, so measures stay
                  correct at any grouping. Try a dimension behind a join_many to see it.
                </p>
              )}
              <p className="text-muted-foreground">
                MetricFlow handles fan-out by refusing the query (a measure can only be split by dimensions reachable through many-to-one
                joins). Malloy answers it, correctly, and the SQL below shows how.
              </p>
              {sql.data?.sql && (
                <div className="flex flex-wrap gap-1.5">
                  {symmetric ? (
                    <Badge variant="success">SQL uses SUM(DISTINCT) over hashed keys</Badge>
                  ) : distinctCount ? (
                    <Badge variant="success">SQL counts distinct keys</Badge>
                  ) : (
                    <Badge variant="secondary">Plain aggregate in SQL</Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Malloy <ArrowRight className="size-4 text-muted-foreground" aria-hidden /> SQL
              </CardTitle>
              <CardDescription>Compiled against the catalog&apos;s schemas. No BigQuery credentials needed.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <CodeBlock code={malloy} label="Copy Malloy" />
              {sql.data?.sql ? (
                <CodeBlock code={sql.data.sql} label="Copy SQL" className="max-h-96 overflow-y-auto" />
              ) : sql.data?.problems.length ? (
                <p className="text-sm text-destructive">{sql.data.problems[0]!.message}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Compiling…</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
