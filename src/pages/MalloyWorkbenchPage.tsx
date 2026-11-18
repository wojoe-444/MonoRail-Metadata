import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, CircleAlert, Hash, Link2, Play, Save, Sigma, View } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { navigate, useSearchParams } from '@/lib/router'
import {
  compileModel,
  listModels,
  readModel,
  runQuery,
  saveModel,
  type CompileResult,
  type OutlineField,
  type OutlineSource,
  type RunResult,
} from '@/features/malloy/api'
import { ResultView } from '@/features/malloy/ResultView'
import { GuardrailBar } from '@/features/semantic/components/Parts'
import { getHealth } from '@/features/om/api'
import { entityHref } from '@/features/om/entity'
import { EmptyState, LoadingState } from '@/features/om/components/States'
import { cn } from '@/lib/utils'

/**
 * Edit a Malloy model, see its sources as an outline (compiled live against
 * the catalog), and run queries on BigQuery. Clicking a view or field in the
 * outline writes a query for it.
 */
export function MalloyWorkbenchPage() {
  const params = useSearchParams()
  const path = params.get('path')
  const models = useQuery(['malloy', 'models'], listModels)
  const file = useQuery(path ? ['malloy', 'model', path] : null, () => readModel(path!))
  const health = useQuery(['health'], getHealth)

  const [content, setContent] = useState<string>()
  const [saved, setSaved] = useState<string>()
  const [compiled, setCompiled] = useState<CompileResult>()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<RunResult>()
  const [running, setRunning] = useState(false)
  const [view, setView] = useState<'results' | 'sql'>('results')
  const [saving, setSaving] = useState(false)

  // Load the file into the editor once per path.
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (file.data && loadedFor.current !== path) {
      loadedFor.current = path
      setContent(file.data.content)
      setSaved(file.data.content)
      setResult(undefined)
      setQuery('')
    }
  }, [file.data, path])

  // Compile shortly after typing stops, to keep the outline and problems current.
  useEffect(() => {
    if (content === undefined) return
    const t = setTimeout(() => {
      compileModel(content, path ?? undefined)
        .then(setCompiled)
        .catch((e: unknown) =>
          setCompiled({ ok: false, sources: [], problems: [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }] }),
        )
    }, 500)
    return () => clearTimeout(t)
  }, [content, path])

  // Start with a query on the source named in the URL (or the first source).
  // A query in the URL (from the query builder or the semantic catalog) wins.
  const wanted = params.get('source')
  const initialQuery = params.get('query')
  useEffect(() => {
    if (query || !compiled?.sources.length) return
    if (initialQuery) return setQuery(initialQuery)
    const s = compiled.sources.find((x) => x.name === wanted) ?? compiled.sources[0]!
    const v = s.fields.find((f) => f.kind === 'view')
    setQuery(
      v
        ? `run: ${s.name} -> ${v.name}`
        : `run: ${s.name} -> { aggregate: ${s.fields.find((f) => f.kind === 'measure')?.name ?? 'row_count is count()'} }`,
    )
  }, [compiled, wanted, initialQuery, query])

  const dirty = content !== undefined && content !== saved
  const run = async (showSql = false) => {
    if (content === undefined || !query.trim()) return
    setRunning(true)
    try {
      const r = await runQuery(content, query, path ?? undefined)
      setResult(r)
      setView(showSql || !r.rows ? 'sql' : 'results')
    } catch (e) {
      setResult({ ok: false, problems: [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }] })
    } finally {
      setRunning(false)
    }
  }
  const save = async () => {
    if (!path || content === undefined) return
    setSaving(true)
    try {
      await saveModel(path, content)
      setSaved(content)
      invalidate('malloy')
      invalidate('malloy-usage')
    } finally {
      setSaving(false)
    }
  }

  // Ctrl/Cmd+S saves, Ctrl/Cmd+Enter runs.
  const keys = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      void save()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void run()
    }
  }

  const service = health.data?.openmetadata.service ?? 'bigquery'
  const modelProblems = compiled?.problems ?? []

  return (
    <div className="flex h-full flex-col" onKeyDown={keys}>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 lg:px-6">
        <Label htmlFor="wb-model" className="sr-only">
          Model
        </Label>
        <NativeSelect
          id="wb-model"
          value={path ?? ''}
          onChange={(e) => navigate(`/malloy/workbench?path=${encodeURIComponent(e.target.value)}`)}
          className="w-72 font-mono"
        >
          {!path && <option value="">Pick a model…</option>}
          {models.data?.map((m) => (
            <option key={m.path} value={m.path}>
              {m.path}
            </option>
          ))}
        </NativeSelect>
        {dirty && <Badge variant="warning">Unsaved</Badge>}
        {compiled &&
          (compiled.ok ? (
            <Badge variant="success">Compiles</Badge>
          ) : (
            <Badge variant="destructive">
              {modelProblems.length} problem{modelProblems.length === 1 ? '' : 's'}
            </Badge>
          ))}
        {health.data && !health.data.bigquery.configured && <Badge variant="secondary">Compile only: BigQuery not set up</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={save} title="Ctrl+S">
            <Save />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {!path ? (
        <div className="p-6">
          <EmptyState title="Pick a model" description="Choose a model above, or create one on the Malloy models page." />
        </div>
      ) : content === undefined ? (
        <LoadingState />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b p-3 lg:border-r lg:border-b-0">
            <Outline sources={compiled?.sources ?? []} service={service} onQuery={setQuery} />
          </aside>
          <div className="grid min-h-0 grid-rows-[minmax(12rem,2fr)_auto_minmax(14rem,3fr)]">
            <div className="flex min-h-0 flex-col">
              <Label htmlFor="wb-source" className="sr-only">
                Model source
              </Label>
              <Textarea
                id="wb-source"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none rounded-none border-0 bg-card font-mono text-xs leading-relaxed shadow-none focus-visible:ring-0"
              />
              {modelProblems.length > 0 && <Problems problems={modelProblems} />}
            </div>
            <div className="flex flex-col gap-2 border-y bg-muted/40 p-3">
              <div className="flex items-start gap-2">
                <Label htmlFor="wb-query" className="sr-only">
                  Query
                </Label>
                <Textarea
                  id="wb-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  rows={2}
                  spellCheck={false}
                  placeholder="run: source -> { group_by: field; aggregate: measure }"
                  className="min-h-0 flex-1 resize-y bg-card font-mono text-xs"
                />
                <div className="flex flex-col gap-1.5">
                  <Button size="sm" onClick={() => run()} disabled={running || !query.trim()} title="Ctrl+Enter">
                    <Play />
                    {running ? 'Running…' : 'Run'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => run(true)} disabled={running || !query.trim()}>
                    SQL
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex min-h-0 flex-col">
              {result ? (
                <>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <Segmented
                      aria-label="Result view"
                      value={view}
                      onChange={setView}
                      options={[
                        { value: 'results', label: 'Results', disabled: !result.rows },
                        { value: 'sql', label: 'SQL', disabled: !result.sql },
                      ]}
                    />
                    {result.rows && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {result.rows.length} rows{result.ms !== undefined ? ` · ${(result.ms / 1000).toFixed(1)} s` : ''}
                      </span>
                    )}
                  </div>
                  <GuardrailBar estimate={result.estimate} className="mx-3 mb-2" />
                  {result.problems && result.problems.length > 0 && <Problems problems={result.problems} />}
                  <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
                    {view === 'sql' && result.sql ? (
                      <pre className="rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{result.sql}</pre>
                    ) : result.rows && result.fields ? (
                      <ResultView rows={result.rows} fields={result.fields} />
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                  Run a query to see results. Click a view or field on the left to start one.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Problems({ problems }: { problems: { message: string; severity: string; line?: number }[] }) {
  return (
    <ul className="max-h-32 overflow-y-auto border-t bg-destructive-soft/50 px-3 py-2 text-xs">
      {problems.map((p, i) => (
        <li key={i} className={cn('flex items-start gap-2', p.severity === 'error' ? 'text-destructive' : 'text-warning-soft-foreground')}>
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {p.line !== undefined && <span className="font-mono">line {p.line + 1}: </span>}
            {p.message}
          </span>
        </li>
      ))}
    </ul>
  )
}

const KIND_ICON = { dimension: Hash, measure: Sigma, view: View, join: Link2 }

function Outline({ sources, service, onQuery }: { sources: OutlineSource[]; service: string; onQuery: (q: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!sources.length) return <p className="p-2 text-sm text-muted-foreground">No sources yet.</p>
  return (
    <div className="flex flex-col gap-3">
      {sources.map((s) => {
        const isOpen = open[s.name] ?? true
        return (
          <div key={s.name}>
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [s.name]: !isOpen }))}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-left hover:bg-accent"
            >
              <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
              <span className="font-mono text-sm font-semibold">{s.name}</span>
            </button>
            {s.tablePath && (
              <a
                href={entityHref('table', `${service}.${s.tablePath.replace(/`/g, '')}`)}
                className="ml-5 block truncate font-mono text-[11px] text-muted-foreground hover:underline"
                title="Open in the catalog"
              >
                {s.tablePath}
              </a>
            )}
            {isOpen && <FieldTree source={s.name} fields={s.fields} onQuery={onQuery} path={[]} />}
          </div>
        )
      })}
    </div>
  )
}

function FieldTree({
  source,
  fields,
  onQuery,
  path,
}: {
  source: string
  fields: OutlineField[]
  onQuery: (q: string) => void
  path: string[]
}) {
  const order = { view: 0, measure: 1, dimension: 2, join: 3 }
  const sorted = useMemo(() => [...fields].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)), [fields]) // eslint-disable-line react-hooks/exhaustive-deps
  const [openJoins, setOpenJoins] = useState<Record<string, boolean>>({})
  const ref = (f: OutlineField) => [...path, f.name].join('.')
  const click = (f: OutlineField) => {
    if (f.kind === 'view' && !path.length) onQuery(`run: ${source} -> ${f.name}`)
    else if (f.kind === 'measure') onQuery(`run: ${source} -> { aggregate: ${ref(f)} }`)
    else if (f.kind === 'dimension') onQuery(`run: ${source} -> { group_by: ${ref(f)}; aggregate: row_count is count(); limit: 50 }`)
  }
  return (
    <ul className="mt-0.5 ml-3 flex flex-col border-l pl-2">
      {sorted.map((f) => {
        const Icon = KIND_ICON[f.kind]
        if (f.kind === 'join') {
          const isOpen = openJoins[f.name] ?? false
          return (
            <li key={f.name}>
              <button
                type="button"
                onClick={() => setOpenJoins((o) => ({ ...o, [f.name]: !isOpen }))}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
              >
                <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-mono">{f.name}</span>
              </button>
              {isOpen && f.fields && (
                <FieldTree source={source} fields={f.fields.filter((x) => x.kind !== 'join')} onQuery={onQuery} path={[...path, f.name]} />
              )}
            </li>
          )
        }
        return (
          <li key={f.name}>
            <button
              type="button"
              onClick={() => click(f)}
              title={f.description ?? f.type}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
            >
              <Icon
                className={cn(
                  'size-3 shrink-0',
                  f.kind === 'measure' ? 'text-primary' : f.kind === 'view' ? 'text-highlight' : 'text-muted-foreground',
                )}
                aria-hidden
              />
              <span className="truncate font-mono">{f.name}</span>
              {f.type && f.kind === 'dimension' && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{f.type}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
