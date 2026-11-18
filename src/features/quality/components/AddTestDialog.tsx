import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { Table } from '@/features/om/types'
import { invalidate, useQuery } from '@/hooks/useQuery'

import { createTestCase, listTestDefinitions } from '../api'
import { columnLink } from '../format'
import type { TestCase, TestCaseParameterDefinition, TestDefinition } from '../types'

const NUMERIC = new Set(['NUMBER', 'INT', 'FLOAT', 'DOUBLE', 'DECIMAL'])

/**
 * Create a test case on a table or one of its columns: pick a level, a column,
 * a test definition (filtered to what applies), and fill its parameters.
 * Sends OpenMetadata's CreateTestCase; the server adds it to the table's basic suite.
 */
export function AddTestDialog({
  table,
  open,
  onOpenChange,
  defaultColumn,
  onCreated,
}: {
  table: Table
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultColumn?: string
  onCreated?: (tc: TestCase) => void
}) {
  const columns = table.columns ?? []
  const [level, setLevel] = useState<'TABLE' | 'COLUMN'>(defaultColumn ? 'COLUMN' : 'TABLE')
  const [column, setColumn] = useState(defaultColumn ?? columns[0]?.name ?? '')
  const [defFqn, setDefFqn] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [params, setParams] = useState<Record<string, string>>({})
  const [rowCounts, setRowCounts] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    setLevel(defaultColumn ? 'COLUMN' : 'TABLE')
    setColumn(defaultColumn ?? columns[0]?.name ?? '')
    setDefFqn('')
    setNameEdited(false)
    setDescription('')
    setParams({})
    setRowCounts(false)
    setError(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultColumn])

  const dataType = level === 'COLUMN' ? columns.find((c) => c.name === column)?.dataType : undefined
  const defsQuery = useQuery(
    open ? ['quality', 'testDefinitions', level, dataType ?? ''] : null,
    () => listTestDefinitions({ entityType: level, supportedDataType: dataType }),
    { staleMs: 5 * 60_000 },
  )
  const defs = useMemo(
    () => [...(defsQuery.data?.data ?? [])].sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name)),
    [defsQuery.data],
  )
  const def: TestDefinition | undefined = defs.find((d) => (d.fullyQualifiedName ?? d.name) === defFqn) ?? defs[0]

  // Default name, as OpenMetadata's UI builds it, until the person edits it.
  useEffect(() => {
    if (nameEdited || !def) return
    setName([table.name, level === 'COLUMN' ? column : undefined, def.name].filter(Boolean).join('_'))
  }, [def, column, level, nameEdited, table.name])

  const missing = (def?.parameterDefinition ?? []).filter((p) => p.required && !params[p.name]?.trim())
  const canSave = Boolean(def && name.trim() && !missing.length && (level === 'TABLE' || column))

  const save = async () => {
    if (!def) return
    setSaving(true)
    setError(undefined)
    try {
      const tc = await createTestCase({
        name: name.trim(),
        description: description.trim() || undefined,
        testDefinition: def.fullyQualifiedName ?? def.name,
        entityLink: columnLink(table.fullyQualifiedName ?? table.name, level === 'COLUMN' ? column : undefined),
        parameterValues: (def.parameterDefinition ?? [])
          .filter((p) => params[p.name] !== undefined && params[p.name] !== '')
          .map((p) => ({ name: p.name, value: encodeParam(p, params[p.name]!) })),
        computePassedFailedRowCount: def.supportsRowLevelPassedFailed ? rowCounts : undefined,
      })
      invalidate('quality')
      onCreated?.(tc)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add test</DialogTitle>
          <DialogDescription>Runs with this table&apos;s test suite pipeline. Results appear after the next run.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Level</Label>
            <Segmented
              aria-label="Test level"
              value={level}
              onChange={(v) => {
                setLevel(v)
                setDefFqn('')
                setParams({})
              }}
              options={[
                { value: 'TABLE', label: 'Table' },
                { value: 'COLUMN', label: 'Column', disabled: !columns.length },
              ]}
            />
          </div>

          {level === 'COLUMN' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-test-column">Column</Label>
              <NativeSelect
                id="add-test-column"
                value={column}
                onChange={(e) => {
                  setColumn(e.target.value)
                  setDefFqn('')
                  setParams({})
                }}
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.dataTypeDisplay ?? c.dataType})
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="add-test-definition">Test type</Label>
            <NativeSelect
              id="add-test-definition"
              value={def ? (def.fullyQualifiedName ?? def.name) : ''}
              disabled={!defs.length}
              onChange={(e) => {
                setDefFqn(e.target.value)
                setParams({})
              }}
            >
              {defsQuery.loading && <option value="">Loading…</option>}
              {!defsQuery.loading && !defs.length && (
                <option value="">No test types for this {level === 'COLUMN' ? 'column type' : 'level'}</option>
              )}
              {defs.map((d) => (
                <option key={d.id} value={d.fullyQualifiedName ?? d.name}>
                  {d.displayName ?? d.name}
                </option>
              ))}
            </NativeSelect>
            {def?.description && <p className="text-xs text-muted-foreground">{def.description}</p>}
            {defsQuery.error && <p className="text-sm text-destructive">{defsQuery.error.message}</p>}
          </div>

          {(def?.parameterDefinition ?? []).map((p) => (
            <ParamField
              key={`${def!.id}-${p.name}`}
              param={p}
              value={params[p.name] ?? ''}
              onChange={(v) => setParams((cur) => ({ ...cur, [p.name]: v }))}
            />
          ))}

          {def?.supportsRowLevelPassedFailed && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="add-test-rows" className="flex flex-col items-start gap-0.5">
                <span>Compute passed and failed row counts</span>
                <span className="text-xs font-normal text-muted-foreground">Scans the column on every run.</span>
              </Label>
              <Switch id="add-test-rows" checked={rowCounts} onCheckedChange={setRowCounts} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="add-test-name">Name</Label>
            <Input
              id="add-test-name"
              value={name}
              className="font-mono"
              onChange={(e) => {
                setName(e.target.value)
                setNameEdited(true)
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="add-test-description">Description (optional)</Label>
            <Textarea id="add-test-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving ? 'Adding…' : 'Add test'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ParamField({ param, value, onChange }: { param: TestCaseParameterDefinition; value: string; onChange: (v: string) => void }) {
  const id = `param-${param.name}`
  const label = (
    <Label htmlFor={id}>
      {param.displayName ?? param.name}
      {param.required && <span className="text-destructive">*</span>}
    </Label>
  )
  const help = param.description ? <p className="text-xs text-muted-foreground">{param.description.replace(/[{}]/g, '')}</p> : null

  if (param.dataType === 'BOOLEAN') {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          {label}
          {help}
        </div>
        <Switch id={id} checked={value === 'true'} onCheckedChange={(on) => onChange(on ? 'true' : '')} />
      </div>
    )
  }
  if (param.optionValues?.length) {
    return (
      <div className="flex flex-col gap-2">
        {label}
        <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{param.required ? 'Choose…' : 'Default'}</option>
          {param.optionValues.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
        {help}
      </div>
    )
  }
  const sql = /sql/i.test(param.name)
  return (
    <div className="flex flex-col gap-2">
      {label}
      {sql ? (
        <Textarea id={id} rows={4} className="font-mono text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          id={id}
          value={value}
          inputMode={NUMERIC.has(param.dataType ?? '') ? 'decimal' : undefined}
          type={NUMERIC.has(param.dataType ?? '') ? 'number' : 'text'}
          placeholder={param.dataType === 'ARRAY' ? 'Comma-separated values' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {help}
    </div>
  )
}

/** ARRAY parameters travel as a JSON array string, the way OpenMetadata's UI sends them. */
function encodeParam(p: TestCaseParameterDefinition, raw: string): string {
  if (p.dataType === 'ARRAY' && !p.optionValues?.length) {
    const trimmed = raw.trim()
    if (trimmed.startsWith('[')) return trimmed
    return JSON.stringify(
      trimmed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
  }
  return raw.trim()
}
