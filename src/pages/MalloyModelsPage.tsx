import { useState } from 'react'
import { ArrowRight, FileCode2, Plus, Table2 } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { href, navigate } from '@/lib/router'
import { listModels, saveModel } from '@/features/malloy/api'
import { getHealth } from '@/features/om/api'
import { entityHref, timeAgo } from '@/features/om/entity'
import { EmptyState, Loaded } from '@/features/om/components/States'

const NEW_MODEL = `// A Malloy model. Sources wrap BigQuery tables with measures, joins and views.
// Docs: https://docs.malloydata.dev

source: my_source is bigquery.table('project.dataset.table') extend {
  measure: row_count is count()
}
`

/** The Malloy models in the repo's malloy/ folder, with the tables each one reads. */
export function MalloyModelsPage() {
  const models = useQuery(['malloy', 'models'], listModels)
  const health = useQuery(['health'], getHealth)
  const service = health.data?.openmetadata.service ?? 'bigquery'
  const [creating, setCreating] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Malloy models"
        description="The semantic layer: named measures, joins and views over BigQuery tables. Models compile against the catalog's schemas."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New model
          </Button>
        }
      />
      {health.data && !health.data.bigquery.configured && (
        <p className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
          BigQuery credentials aren't set up on the server, so queries compile and show their SQL but don't run. See Settings for setup.
        </p>
      )}
      <Loaded query={models}>
        {(ms) =>
          !ms.length ? (
            <EmptyState
              icon={<FileCode2 className="size-5" />}
              title="No models yet"
              description="Create one here, or from a table's Malloy tab."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {ms.map((m) => (
                <Card key={m.path}>
                  <CardHeader>
                    <CardTitle className="font-mono">{m.path}</CardTitle>
                    <CardDescription>Saved {timeAgo(m.updatedAt)}</CardDescription>
                    <CardAction>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={href(`/malloy/workbench?path=${encodeURIComponent(m.path)}`)}>
                          Open
                          <ArrowRight />
                        </a>
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div>
                      <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sources</div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.sources.length ? (
                          m.sources.map((s) => (
                            <Badge key={s} variant="primary" className="font-mono">
                              {s}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">None</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Reads</div>
                      <ul className="flex flex-col gap-1">
                        {m.tables.map((t) => (
                          <li key={t}>
                            <a
                              href={entityHref('table', `${service}.${t}`)}
                              className="flex items-center gap-1.5 font-mono text-xs hover:underline"
                            >
                              <Table2 className="size-3.5 text-muted-foreground" aria-hidden />
                              {t}
                            </a>
                          </li>
                        ))}
                        {!m.tables.length && <li className="text-sm text-muted-foreground">No tables</li>}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        }
      </Loaded>
      <NewModelDialog open={creating} onOpenChange={setCreating} existing={models.data?.map((m) => m.path) ?? []} />
    </div>
  )
}

function NewModelDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (o: boolean) => void; existing: string[] }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const file = name.trim() ? (name.trim().endsWith('.malloy') ? name.trim() : `${name.trim()}.malloy`) : ''
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New model</DialogTitle>
          <DialogDescription>A .malloy file in the models folder. Use slashes for subfolders.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="model-name">File name</Label>
          <Input
            id="model-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="marketing/attribution"
            className="font-mono"
            autoFocus
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!file}
            onClick={async () => {
              if (existing.includes(file)) return setError(`${file} already exists.`)
              try {
                await saveModel(file, NEW_MODEL)
                invalidate('malloy')
                navigate(`/malloy/workbench?path=${encodeURIComponent(file)}`)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
