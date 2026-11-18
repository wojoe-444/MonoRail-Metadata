import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { invalidate } from '@/hooks/useQuery'
import type { DatabaseService } from '@/features/om/types'

import { createDatabaseService } from './api'

/**
 * Register a BigQuery database service, as OpenMetadata 2.0.8's
 * CreateDatabaseService expects: serviceType "BigQuery" and a
 * BigQueryConnection (entity/services/connections/database/bigQueryConnection.json)
 * whose credentials are a GCPCredentials (security/credentials/gcpCredentials.json):
 * service-account values or application default credentials.
 */

type CredMode = 'service_account' | 'gcp_adc'

const list = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean)

/** One project id is a string, several are an array (singleProjectId / multipleProjectId). */
const projectIdValue = (ids: string[]) => (ids.length === 0 ? undefined : ids.length === 1 ? ids[0] : ids)

interface KeyFile {
  type?: string
  project_id?: string
  private_key_id?: string
  private_key?: string
  client_email?: string
  client_id?: string
  auth_uri?: string
  token_uri?: string
  auth_provider_x509_cert_url?: string
  client_x509_cert_url?: string
}

function parseKey(text: string): { key?: KeyFile; error?: string } {
  if (!text.trim()) return { error: 'Paste the service account key (JSON).' }
  try {
    const key = JSON.parse(text) as KeyFile
    if (key.type && key.type !== 'service_account') return { error: `This key is of type "${key.type}", not a service account.` }
    if (!key.private_key || !key.client_email) return { error: 'The key needs private_key and client_email.' }
    return { key }
  } catch {
    return { error: 'That is not valid JSON.' }
  }
}

export function buildBigQueryService(f: Form, key?: KeyFile) {
  const projects = list(f.projectIds)
  const gcpConfig =
    f.mode === 'gcp_adc'
      ? { type: 'gcp_adc', projectId: projectIdValue(projects) }
      : {
          type: 'service_account',
          projectId: projectIdValue(projects.length ? projects : key?.project_id ? [key.project_id] : []),
          privateKeyId: key?.private_key_id,
          privateKey: key?.private_key,
          clientEmail: key?.client_email,
          clientId: key?.client_id,
          authUri: key?.auth_uri ?? 'https://accounts.google.com/o/oauth2/auth',
          tokenUri: key?.token_uri ?? 'https://oauth2.googleapis.com/token',
          authProviderX509CertUrl: key?.auth_provider_x509_cert_url ?? 'https://www.googleapis.com/oauth2/v1/certs',
          clientX509CertUrl: key?.client_x509_cert_url,
        }
  const taxonomy = list(f.taxonomyProjectIds)
  return {
    name: f.name.trim(),
    displayName: f.displayName.trim() || undefined,
    description: f.description.trim() || undefined,
    serviceType: 'BigQuery',
    connection: {
      config: {
        type: 'BigQuery',
        scheme: 'bigquery',
        hostPort: 'bigquery.googleapis.com',
        billingProjectId: f.billingProjectId.trim() || undefined,
        credentials: { gcpConfig },
        includePolicyTags: f.includePolicyTags,
        taxonomyProjectID: taxonomy.length ? taxonomy : undefined,
        taxonomyLocation: f.taxonomyLocation.trim() || 'us',
        usageLocation: f.usageLocation.trim() || 'us',
      },
    },
  }
}

interface Form {
  name: string
  displayName: string
  description: string
  projectIds: string
  billingProjectId: string
  mode: CredMode
  keyJson: string
  usageLocation: string
  includePolicyTags: boolean
  taxonomyProjectIds: string
  taxonomyLocation: string
}

const EMPTY: Form = {
  name: '',
  displayName: '',
  description: '',
  projectIds: '',
  billingProjectId: '',
  mode: 'service_account',
  keyJson: '',
  usageLocation: 'us',
  includePolicyTags: true,
  taxonomyProjectIds: '',
  taxonomyLocation: 'us',
}

const NAME_RE = /^[A-Za-z0-9_-]+$/

export function AddServiceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated?: (s: DatabaseService) => void
}) {
  const [f, setF] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [tried, setTried] = useState(false)
  useEffect(() => {
    if (open) {
      setF(EMPTY)
      setError(undefined)
      setTried(false)
    }
  }, [open])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))

  const parsed = f.mode === 'service_account' ? parseKey(f.keyJson) : {}
  const nameError = !f.name.trim()
    ? 'A name is required.'
    : !NAME_RE.test(f.name.trim())
      ? 'Use letters, numbers, - and _ only.'
      : undefined
  const adcNeedsProject =
    f.mode === 'gcp_adc' && list(f.projectIds).length === 0 ? 'With application default credentials, name at least one project.' : undefined
  const invalid = nameError || parsed.error || adcNeedsProject

  const submit = async () => {
    setTried(true)
    if (invalid) return
    setSaving(true)
    setError(undefined)
    try {
      const created = await createDatabaseService(buildBigQueryService(f, parsed.key))
      invalidate('services')
      invalidate('search')
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
          <DialogTitle>Add BigQuery service</DialogTitle>
          <DialogDescription>
            OpenMetadata stores the connection encrypted and uses it for every ingestion pipeline on this service.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-name">Name</Label>
              <Input
                id="svc-name"
                value={f.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="bigquery_prod"
                aria-invalid={tried && Boolean(nameError)}
              />
              {tried && nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-display">Display name</Label>
              <Input
                id="svc-display"
                value={f.displayName}
                onChange={(e) => set('displayName', e.target.value)}
                placeholder="BigQuery (prod)"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="svc-desc">Description</Label>
              <Textarea
                id="svc-desc"
                rows={2}
                value={f.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What this service holds and who runs it."
              />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-projects">Project IDs to ingest</Label>
              <Input
                id="svc-projects"
                value={f.projectIds}
                onChange={(e) => set('projectIds', e.target.value)}
                placeholder="acme-analytics, bigquery-public-data"
              />
              <p className="text-xs text-muted-foreground">Comma separated. Empty uses the service account's project.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-billing">Billing project ID</Label>
              <Input
                id="svc-billing"
                value={f.billingProjectId}
                onChange={(e) => set('billingProjectId', e.target.value)}
                placeholder="acme-analytics"
              />
              <p className="text-xs text-muted-foreground">Where metadata and profiler queries are billed.</p>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Credentials</Label>
              <Segmented
                aria-label="Credentials"
                value={f.mode}
                onChange={(v) => set('mode', v)}
                options={[
                  { value: 'service_account', label: 'Service account key' },
                  { value: 'gcp_adc', label: 'Application default' },
                ]}
              />
            </div>
            {f.mode === 'service_account' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="svc-key" className="sr-only">
                  Service account key JSON
                </Label>
                <Textarea
                  id="svc-key"
                  rows={6}
                  className="font-mono text-xs"
                  value={f.keyJson}
                  onChange={(e) => set('keyJson', e.target.value)}
                  placeholder='{ "type": "service_account", "project_id": "…", "private_key": "…", "client_email": "…" }'
                  aria-invalid={tried && Boolean(parsed.error)}
                />
                {tried && parsed.error ? (
                  <p className="text-xs text-destructive">{parsed.error}</p>
                ) : parsed.key ? (
                  <p className="text-xs text-muted-foreground">
                    Key for <span className="font-mono">{parsed.key.client_email}</span>. It is sent once to OpenMetadata, which encrypts
                    it; this app never shows it again.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Paste the JSON key file. The account needs BigQuery Metadata Viewer and Job User (plus Data Viewer for the profiler).
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                The ingestion runner (OpenMetadata's Airflow) uses its own Google credentials: an attached service account, or{' '}
                <span className="font-mono">gcloud auth application-default login</span> on that host.
                {tried && adcNeedsProject && <span className="mt-1 block text-destructive">{adcNeedsProject}</span>}
              </p>
            )}
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-usage">Usage location</Label>
              <Input id="svc-usage" value={f.usageLocation} onChange={(e) => set('usageLocation', e.target.value)} placeholder="us" />
              <p className="text-xs text-muted-foreground">Region of INFORMATION_SCHEMA.JOBS for usage and lineage: us, eu, or a region.</p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="svc-policy">Import policy tags</Label>
                <Switch id="svc-policy" checked={f.includePolicyTags} onCheckedChange={(v) => set('includePolicyTags', v)} />
              </div>
              {f.includePolicyTags && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_6rem]">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="svc-tax" className="text-xs">
                      Taxonomy project IDs
                    </Label>
                    <Input
                      id="svc-tax"
                      value={f.taxonomyProjectIds}
                      onChange={(e) => set('taxonomyProjectIds', e.target.value)}
                      placeholder="acme-governance"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="svc-taxloc" className="text-xs">
                      Location
                    </Label>
                    <Input id="svc-taxloc" value={f.taxonomyLocation} onChange={(e) => set('taxonomyLocation', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          </section>

          {error && <p className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Adding…' : 'Add service'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
