import { COLLECTION } from '@/features/om/api'

/**
 * Every OpenMetadata 2.0.8 entity type, grouped the way OpenMetadata groups them. The REST
 * collection of each comes from `COLLECTION` (src/features/om/api.ts), the label from
 * `entityLabel()` and the icon from `entityIcon()`, so those stay the one source.
 */

export interface TypeInfo {
  type: string
  /** For lists and the type navigator. */
  plural: string
  /** One line on what OpenMetadata uses it for. */
  description: string
}

export interface TypeGroup {
  id: string
  label: string
  description: string
  types: TypeInfo[]
}

export const GROUPS: TypeGroup[] = [
  {
    id: 'assets',
    label: 'Data assets',
    description: 'What the catalog describes: tables and everything else ingestion finds.',
    types: [
      { type: 'table', plural: 'Tables', description: 'Tables and views, with columns, constraints, profiles and lineage.' },
      { type: 'database', plural: 'Projects', description: 'BigQuery projects (OpenMetadata databases), under a database service.' },
      { type: 'databaseSchema', plural: 'Datasets', description: 'BigQuery datasets (OpenMetadata database schemas), under a project.' },
      { type: 'storedProcedure', plural: 'Stored procedures', description: 'Routines in a dataset, with their code.' },
      { type: 'query', plural: 'Queries', description: 'SQL run against tables, from usage ingestion or saved by people.' },
      {
        type: 'metric',
        plural: 'Metrics',
        description: 'Business metrics with their definitions, including the ones published from Malloy.',
      },
      { type: 'dashboard', plural: 'Dashboards', description: 'Dashboards from a BI tool, with their charts.' },
      { type: 'chart', plural: 'Charts', description: 'Charts on dashboards.' },
      {
        type: 'dashboardDataModel',
        plural: 'Dashboard data models',
        description: 'Semantic models inside BI tools (LookML views, Power BI datasets).',
      },
      { type: 'pipeline', plural: 'Pipelines', description: 'Data pipelines (Airflow DAGs, dbt jobs) and their tasks.' },
      { type: 'topic', plural: 'Topics', description: 'Message topics with their schemas.' },
      { type: 'mlmodel', plural: 'ML models', description: 'Machine learning models, their features and hyperparameters.' },
      { type: 'container', plural: 'Containers', description: 'Storage buckets and folders, with their data models.' },
      { type: 'searchIndex', plural: 'Search indexes', description: 'Indexes in a search service, with their fields.' },
      { type: 'apiCollection', plural: 'API collections', description: 'Groups of API endpoints.' },
      { type: 'apiEndpoint', plural: 'API endpoints', description: 'API endpoints with request and response schemas.' },
      { type: 'directory', plural: 'Directories', description: 'Folders in a drive service.' },
      { type: 'file', plural: 'Files', description: 'Files in a drive service.' },
      { type: 'spreadsheet', plural: 'Spreadsheets', description: 'Spreadsheets in a drive service.' },
      { type: 'worksheet', plural: 'Worksheets', description: 'Sheets in a spreadsheet, with their columns.' },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    description: 'Connections to the systems OpenMetadata ingests from, and the pipelines that ingest.',
    types: [
      { type: 'databaseService', plural: 'Database services', description: 'Warehouses and databases, such as BigQuery.' },
      { type: 'dashboardService', plural: 'Dashboard services', description: 'BI tools.' },
      { type: 'messagingService', plural: 'Messaging services', description: 'Kafka, Pub/Sub and similar.' },
      { type: 'pipelineService', plural: 'Pipeline services', description: 'Orchestrators such as Airflow.' },
      { type: 'mlmodelService', plural: 'ML model services', description: 'Model registries such as Vertex AI or MLflow.' },
      { type: 'storageService', plural: 'Storage services', description: 'Object stores such as GCS.' },
      { type: 'searchService', plural: 'Search services', description: 'Elasticsearch and OpenSearch.' },
      { type: 'apiService', plural: 'API services', description: 'REST APIs described by OpenAPI.' },
      { type: 'metadataService', plural: 'Metadata services', description: 'Other catalogs OpenMetadata reads from, and itself.' },
      { type: 'securityService', plural: 'Security services', description: 'Access-policy systems such as Ranger.' },
      { type: 'driveService', plural: 'Drive services', description: 'Google Drive and similar.' },
      {
        type: 'ingestionPipeline',
        plural: 'Ingestion pipelines',
        description: 'Scheduled metadata, usage, lineage, profiler and test runs.',
      },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    description: 'The shared vocabulary and structure that assets are described with.',
    types: [
      { type: 'glossary', plural: 'Glossaries', description: 'Business glossaries.' },
      { type: 'glossaryTerm', plural: 'Glossary terms', description: 'Terms with definitions, synonyms and related terms.' },
      { type: 'classification', plural: 'Classifications', description: 'Groups of tags, such as Tier or PII.' },
      { type: 'tag', plural: 'Tags', description: 'Labels within a classification.' },
      { type: 'domain', plural: 'Domains', description: 'Business areas that own assets.' },
      { type: 'dataProduct', plural: 'Data products', description: 'Curated sets of assets a domain publishes.' },
      { type: 'dataContract', plural: 'Data contracts', description: 'Schema, quality and semantic guarantees on an asset.' },
    ],
  },
  {
    id: 'quality',
    label: 'Data quality',
    description: 'Tests and their results.',
    types: [
      { type: 'testDefinition', plural: 'Test definitions', description: 'The kinds of test available, with their parameters.' },
      { type: 'testSuite', plural: 'Test suites', description: 'Sets of test cases that run together.' },
      { type: 'testCase', plural: 'Test cases', description: 'A test definition applied to a table or column.' },
    ],
  },
  {
    id: 'access',
    label: 'Teams and access',
    description: 'Who people are, and what they may do.',
    types: [
      { type: 'user', plural: 'Users', description: 'People and bots.' },
      { type: 'team', plural: 'Teams', description: 'The organization, its business units, divisions, departments and groups.' },
      { type: 'role', plural: 'Roles', description: 'Sets of policies given to users and teams.' },
      { type: 'policy', plural: 'Policies', description: 'Rules allowing or denying operations on resources.' },
      { type: 'persona', plural: 'Personas', description: 'Kinds of user, each with its own default experience.' },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    description: "OpenMetadata's own configuration.",
    types: [
      { type: 'eventsubscription', plural: 'Alerts', description: 'Notifications and observability alerts on changes and test results.' },
      { type: 'app', plural: 'Apps', description: 'Installed applications, such as Data Insights and search indexing.' },
      { type: 'kpi', plural: 'KPIs', description: 'Documentation and ownership targets for Data Insights.' },
      { type: 'type', plural: 'Types', description: 'Entity and property types, with the custom properties added to each.' },
    ],
  },
]

export const TYPES: (TypeInfo & { group: string })[] = GROUPS.flatMap((g) => g.types.map((t) => ({ ...t, group: g.id })))

const BY_TYPE = new Map(TYPES.map((t) => [t.type, t]))

export function typeInfo(type: string | null | undefined) {
  return type ? BY_TYPE.get(type) : undefined
}

// Every type here needs a REST collection, and every collection a place here.
if (import.meta.env.DEV) {
  for (const t of TYPES) if (!COLLECTION[t.type]) console.error(`OpenMetadata page: no REST collection for ${t.type}`)
  for (const type of Object.keys(COLLECTION)) if (!BY_TYPE.has(type)) console.error(`OpenMetadata page: ${type} is in no group`)
}
