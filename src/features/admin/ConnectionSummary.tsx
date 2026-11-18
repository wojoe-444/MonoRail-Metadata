import { Fact } from './pipelines'

/**
 * A database service's connection, as safe facts. Only whitelisted fields are
 * read; keys, tokens and passwords are never shown (OpenMetadata returns them
 * masked anyway, but this doesn't rely on it).
 */

type Config = Record<string, unknown>

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])

export function credentialsLabel(config: Config | undefined): string {
  const gcp = ((config?.credentials as Config | undefined)?.gcpConfig ?? {}) as Config
  switch (gcp.type) {
    case 'service_account':
      return gcp.clientEmail ? `Service account · ${String(gcp.clientEmail)}` : 'Service account key'
    case 'gcp_adc':
      return 'Application default credentials'
    case 'gcp_credential_path':
      return `Key file · ${String(gcp.path ?? '')}`
    case 'external_account':
      return 'Workload identity federation'
    default:
      return config?.credentials ? 'Configured' : '–'
  }
}

export function ConnectionSummary({ serviceType, config }: { serviceType: string; config: Config | undefined }) {
  if (!config) return <p className="text-sm text-muted-foreground">No connection stored (or you lack permission to see it).</p>
  if (serviceType !== 'BigQuery') {
    const host = config.hostPort ?? config.host
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact label="Type">{String(config.type ?? serviceType)}</Fact>
        <Fact label="Host" mono>
          {host ? String(host) : '–'}
        </Fact>
      </div>
    )
  }
  const gcp = ((config.credentials as Config | undefined)?.gcpConfig ?? {}) as Config
  const projects = asList(gcp.projectId)
  const taxonomy = asList(config.taxonomyProjectID)
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      <Fact label="Credentials">{credentialsLabel(config)}</Fact>
      <Fact label="Projects" mono>
        {projects.length ? projects.join(', ') : 'From credentials'}
      </Fact>
      <Fact label="Billing project" mono>
        {config.billingProjectId ? String(config.billingProjectId) : 'Same as project'}
      </Fact>
      <Fact label="Usage location" mono>
        {String(config.usageLocation ?? 'us')}
      </Fact>
      <Fact label="Policy tags">
        {config.includePolicyTags === false
          ? 'Not imported'
          : taxonomy.length
            ? `From ${taxonomy.join(', ')} (${String(config.taxonomyLocation ?? 'us')})`
            : 'Imported'}
      </Fact>
      <Fact label="Endpoint" mono>
        {String(config.hostPort ?? 'bigquery.googleapis.com')}
      </Fact>
    </div>
  )
}
