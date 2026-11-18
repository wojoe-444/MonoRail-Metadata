import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { invalidate } from '@/hooks/useQuery'
import { cn } from '@/lib/utils'
import { displayName } from '@/features/om/entity'
import type { DatabaseService } from '@/features/om/types'

import { createIngestionPipeline, deployIngestionPipeline } from './api'
import { PIPELINE_TYPES, ScheduleField } from './pipelines'
import { buildConfig, DEFAULT_SCHEDULE, defaultValues, FIELDS, type FieldValues } from './sourceConfig'
import type { IngestionPipeline } from './types'

type PipelineKind = (typeof PIPELINE_TYPES)[number]['value']
type DbtSource = 'gcs' | 'cloud'

/**
 * Create an ingestion pipeline (CreateIngestionPipeline in OpenMetadata
 * 2.0.8): name, service reference, pipelineType, sourceConfig.config for that
 * type and an airflowConfig schedule. Then deploy it to the pipeline runner,
 * as OpenMetadata's own UI does.
 */
export function AddIngestionDialog({
  open,
  onOpenChange,
  services,
  serviceId,
  initialType = 'metadata',
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  services: DatabaseService[]
  serviceId?: string
  initialType?: PipelineKind
  onCreated?: (p: IngestionPipeline) => void
}) {
  const [svcId, setSvcId] = useState(serviceId ?? services[0]?.id ?? '')
  const [type, setType] = useState<PipelineKind>(initialType)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE[initialType]!)
  const [values, setValues] = useState<FieldValues>(defaultValues(initialType))
  const [dbtSource, setDbtSource] = useState<DbtSource>('gcs')
  const [dbt, setDbt] = useState({
    bucket: '',
    prefix: '',
    gcpProject: '',
    accountId: '',
    url: 'https://cloud.getdbt.com',
    projectId: '',
    jobId: '',
    token: '',
  })
  const [deploy, setDeploy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [scheduleKey, setScheduleKey] = useState(0)

  const service = services.find((s) => s.id === svcId)
  const suggested = service ? `${service.name}_${type.replace(/([A-Z])/g, '_$1').toLowerCase()}` : ''

  useEffect(() => {
    if (!open) return
    setSvcId(serviceId ?? services[0]?.id ?? '')
    pickType(initialType)
    setName('')
    setNameTouched(false)
    setDeploy(true)
    setError(undefined)
    setDbt({ bucket: '', prefix: '', gcpProject: '', accountId: '', url: 'https://cloud.getdbt.com', projectId: '', jobId: '', token: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serviceId, initialType])

  function pickType(t: PipelineKind) {
    setType(t)
    setValues(defaultValues(t))
    setSchedule(DEFAULT_SCHEDULE[t]!)
    setScheduleKey((k) => k + 1)
  }

  const finalName = (nameTouched ? name : suggested).trim()
  const dbtError =
    type !== 'dbt'
      ? undefined
      : dbtSource === 'gcs'
        ? !dbt.bucket.trim()
          ? 'Name the GCS bucket that holds manifest.json.'
          : undefined
        : !dbt.accountId.trim() || !dbt.token.trim()
          ? 'dbt Cloud needs an account id and an API token.'
          : undefined
  const invalid = !service
    ? 'Pick a service.'
    : !finalName
      ? 'A name is required.'
      : !/^[A-Za-z0-9_-]+$/.test(finalName)
        ? 'Use letters, numbers, - and _ in the name.'
        : dbtError

  const dbtConfigSource = () =>
    dbtSource === 'gcs'
      ? {
          dbtConfigType: 'gcs',
          dbtSecurityConfig: { gcpConfig: { type: 'gcp_adc', projectId: dbt.gcpProject.trim() || undefined } },
          dbtPrefixConfig: { dbtBucketName: dbt.bucket.trim(), dbtObjectPrefix: dbt.prefix.trim() || undefined },
        }
      : {
          dbtConfigType: 'cloud',
          dbtCloudAuthToken: dbt.token.trim(),
          dbtCloudAccountId: dbt.accountId.trim(),
          dbtCloudUrl: dbt.url.trim() || 'https://cloud.getdbt.com',
          dbtCloudProjectId: dbt.projectId.trim() || undefined,
          dbtCloudJobId: dbt.jobId.trim() || undefined,
        }

  const submit = async () => {
    if (invalid || !service) return
    setSaving(true)
    setError(undefined)
    try {
      const created = await createIngestionPipeline({
        name: finalName,
        displayName: finalName,
        pipelineType: type,
        service: { id: service.id, type: 'databaseService' },
        sourceConfig: { config: buildConfig(type, values, type === 'dbt' ? { dbtConfigSource: dbtConfigSource() } : {}) },
        airflowConfig: { scheduleInterval: schedule || undefined },
        loggerLevel: 'INFO',
      })
      if (deploy) {
        try {
          await deployIngestionPipeline(created.id)
        } catch (e) {
          invalidate('ingestion')
          setError(`Created, but deploying failed: ${e instanceof Error ? e.message : String(e)}. Deploy it from the pipeline page.`)
          setSaving(false)
          return
        }
      }
      invalidate('ingestion')
      onOpenChange(false)
      onCreated?.(created)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add ingestion</DialogTitle>
          <DialogDescription>
            A scheduled job on OpenMetadata's pipeline runner that reads from BigQuery into the catalog.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div role="radiogroup" aria-label="Pipeline type" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PIPELINE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={type === t.value}
                onClick={() => pickType(t.value)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground',
                  type === t.value &&
                    'border-primary bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft hover:text-primary-soft-foreground',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <t.icon className="size-4" aria-hidden />
                  {t.label}
                </span>
                <span className="text-xs text-muted-foreground">{t.description}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {services.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ing-svc">Service</Label>
                <NativeSelect id="ing-svc" value={svcId} onChange={(e) => setSvcId(e.target.value)}>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {displayName(s)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ing-name">Name</Label>
              <Input
                id="ing-name"
                className="font-mono"
                value={nameTouched ? name : suggested}
                onChange={(e) => {
                  setNameTouched(true)
                  setName(e.target.value)
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="ing-schedule">Schedule</Label>
              <ScheduleField key={scheduleKey} id="ing-schedule" value={schedule} onChange={setSchedule} />
            </div>
          </div>

          {type === 'dbt' && (
            <section className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">dbt artifacts</span>
                <Segmented
                  aria-label="dbt source"
                  value={dbtSource}
                  onChange={setDbtSource}
                  options={[
                    { value: 'gcs', label: 'GCS bucket' },
                    { value: 'cloud', label: 'dbt Cloud' },
                  ]}
                />
              </div>
              {dbtSource === 'gcs' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <TextField
                    id="dbt-bucket"
                    label="Bucket"
                    value={dbt.bucket}
                    onChange={(v) => setDbt({ ...dbt, bucket: v })}
                    placeholder="acme-dbt-artifacts"
                  />
                  <TextField
                    id="dbt-prefix"
                    label="Object prefix"
                    value={dbt.prefix}
                    onChange={(v) => setDbt({ ...dbt, prefix: v })}
                    placeholder="prod/target"
                  />
                  <TextField
                    id="dbt-gcp"
                    label="GCP project"
                    value={dbt.gcpProject}
                    onChange={(v) => setDbt({ ...dbt, gcpProject: v })}
                    placeholder="acme-analytics"
                  />
                  <p className="text-xs text-muted-foreground sm:col-span-3">
                    Reads manifest.json, catalog.json and run_results.json with the runner's application default credentials.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField id="dbt-account" label="Account ID" value={dbt.accountId} onChange={(v) => setDbt({ ...dbt, accountId: v })} />
                  <TextField id="dbt-url" label="dbt Cloud URL" value={dbt.url} onChange={(v) => setDbt({ ...dbt, url: v })} />
                  <TextField
                    id="dbt-project"
                    label="Project ID (optional)"
                    value={dbt.projectId}
                    onChange={(v) => setDbt({ ...dbt, projectId: v })}
                  />
                  <TextField id="dbt-job" label="Job ID (optional)" value={dbt.jobId} onChange={(v) => setDbt({ ...dbt, jobId: v })} />
                  <TextField
                    id="dbt-token"
                    label="API token"
                    type="password"
                    value={dbt.token}
                    onChange={(v) => setDbt({ ...dbt, token: v })}
                  />
                </div>
              )}
              {dbtError && <p className="text-xs text-muted-foreground">{dbtError}</p>}
            </section>
          )}

          <section className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {(FIELDS[type] ?? []).map((f) => {
              const id = `ing-${f.key.replace(/\./g, '-')}`
              if (f.kind === 'bool')
                return (
                  <div key={f.key} className="flex items-start gap-2">
                    <Checkbox
                      id={id}
                      checked={Boolean(values[f.key])}
                      onCheckedChange={(v) => setValues({ ...values, [f.key]: v === true })}
                      className="mt-0.5"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor={id}>{f.label}</Label>
                      {f.help && <span className="text-xs text-muted-foreground">{f.help}</span>}
                    </div>
                  </div>
                )
              return (
                <div key={f.key} className={cn('flex flex-col gap-1.5', (f.kind === 'list' || f.kind === 'text') && 'sm:col-span-2')}>
                  <Label htmlFor={id}>{f.label}</Label>
                  <Input
                    id={id}
                    type={f.kind === 'number' ? 'number' : 'text'}
                    className={f.kind === 'list' ? 'font-mono' : undefined}
                    value={String(values[f.key] ?? '')}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [f.key]: f.kind === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                      })
                    }
                  />
                  {f.help && <span className="text-xs text-muted-foreground">{f.help}</span>}
                </div>
              )
            })}
          </section>

          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
            <div className="flex flex-col">
              <Label htmlFor="ing-deploy">Deploy now</Label>
              <span className="text-xs text-muted-foreground">
                Schedules it on the pipeline runner. Otherwise deploy it later from its page.
              </span>
            </div>
            <Switch id="ing-deploy" checked={deploy} onCheckedChange={setDeploy} />
          </div>

          {error && <p className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || Boolean(invalid)} title={invalid}>
              {saving ? 'Creating…' : deploy ? 'Create and deploy' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}
