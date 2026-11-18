import { useState } from 'react'
import { ArrowRight, FileCode2, Plus, Sigma, SquareFunction, Table2, View } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { href, navigate } from '@/lib/router'
import { sourceHref } from '@/features/semantic/model'
import { bigQueryPath, splitFqn } from '@/features/om/entity'
import { EmptyState, Loaded } from '@/features/om/components/States'
import type { Table } from '@/features/om/types'

import { listModels, malloyName, saveModel, scaffoldSource, tableUsage, type OutlineField } from './api'

/**
 * The Malloy sources built on this table: their measures, dimensions and views,
 * with a link into the workbench. Offers to scaffold a source when there is none.
 */
export function TableMalloyTab({ table }: { table: Table }) {
  const path = bigQueryPath(table.fullyQualifiedName!)
  const usage = useQuery(['malloy-usage', path], () => tableUsage(path))
  const [scaffolding, setScaffolding] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Malloy sources define the measures and joins people query this table with. They compile against this catalog entry, so the column
          descriptions here appear in the model.
        </p>
        <Button variant="outline" size="sm" onClick={() => setScaffolding(true)}>
          <Plus />
          New source on this table
        </Button>
      </div>
      <Loaded query={usage}>
        {(models) =>
          !models.length ? (
            <EmptyState
              icon={<FileCode2 className="size-5" />}
              title="No Malloy model reads this table"
              description="Create a source to give it named measures, joins and views that everyone queries the same way."
              action={<Button onClick={() => setScaffolding(true)}>Create a source</Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {models.flatMap((m) =>
                m.sources.map((s) => {
                  const measures = s.fields.filter((f) => f.kind === 'measure')
                  const views = s.fields.filter((f) => f.kind === 'view')
                  const joins = s.fields.filter((f) => f.kind === 'join')
                  const dims = s.fields.filter((f) => f.kind === 'dimension')
                  return (
                    <Card key={`${m.model}:${s.name}`}>
                      <CardHeader>
                        <CardTitle className="font-mono">
                          <a href={sourceHref(m.model, s.name)} className="hover:underline" title="Open in Semantic models">
                            {s.name}
                          </a>
                        </CardTitle>
                        <CardDescription className="font-mono text-xs">{m.model}</CardDescription>
                        <CardAction>
                          <Button variant="ghost" size="sm" asChild>
                            <a href={href(`/malloy/workbench?path=${encodeURIComponent(m.model)}&source=${encodeURIComponent(s.name)}`)}>
                              Open
                              <ArrowRight />
                            </a>
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary">{dims.length} dimensions</Badge>
                          <Badge variant="primary">{measures.length} measures</Badge>
                          <Badge variant="secondary">{views.length} views</Badge>
                          {joins.length > 0 && <Badge variant="outline">joins {joins.map((j) => j.name).join(', ')}</Badge>}
                        </div>
                        <FieldGroup title="Measures" icon={<Sigma className="size-3.5" />} fields={measures} />
                        <FieldGroup title="Views" icon={<View className="size-3.5" />} fields={views} />
                        <FieldGroup
                          title="Computed dimensions"
                          icon={<SquareFunction className="size-3.5" />}
                          fields={dims.filter((d) => !table.columns.some((c) => c.name === d.name))}
                        />
                      </CardContent>
                    </Card>
                  )
                }),
              )}
            </div>
          )
        }
      </Loaded>
      <ScaffoldDialog open={scaffolding} onOpenChange={setScaffolding} table={table} tablePath={path} />
    </div>
  )
}

function FieldGroup({ title, icon, fields }: { title: string; icon: React.ReactNode; fields: OutlineField[] }) {
  if (!fields.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
      </div>
      <ul className="flex flex-col gap-1">
        {fields.map((f) => (
          <li key={f.name} className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="shrink-0 font-mono">{f.name}</span>
            {f.description && <span className="truncate text-xs text-muted-foreground">{f.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ScaffoldDialog({
  open,
  onOpenChange,
  table,
  tablePath,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  table: Table
  tablePath: string
}) {
  const parts = splitFqn(table.fullyQualifiedName!)
  const dataset = parts.at(-2) ?? 'models'
  const [file, setFile] = useState(`${malloyName(dataset)}/${malloyName(table.name)}.malloy`)
  const [error, setError] = useState<string>()
  const content = scaffoldSource(malloyName(table.name), tablePath, table.columns)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Malloy source</DialogTitle>
          <DialogDescription>
            Starts with a count and a sum of each numeric column. Columns are dimensions already. Edit it in the workbench.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="scaffold-file">Model file</Label>
          <Input id="scaffold-file" value={file} onChange={(e) => setFile(e.target.value)} className="font-mono" />
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{content}</pre>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              try {
                if ((await listModels()).some((m) => m.path === file))
                  throw new Error(`${file} already exists. Pick another file name, or add the source to that model in the workbench.`)
                await saveModel(file, content)
                invalidate('malloy')
                invalidate('malloy-usage')
                navigate(`/malloy/workbench?path=${encodeURIComponent(file)}`)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            <Table2 />
            Create and open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
