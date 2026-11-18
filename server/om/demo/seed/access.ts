import { ref, store } from '../store'

/**
 * The collections OpenMetadata 2.0.8 has that the demo has no fixtures for, so every list
 * answers (empty) instead of 404, plus the default roles and policies every OpenMetadata
 * server starts with (a subset of its seed data, same names and rules).
 */
export const OTHER_COLLECTIONS: [path: string, entityType: string, searchable?: boolean][] = [
  ['storedProcedures', 'storedProcedure'],
  ['dashboards', 'dashboard'],
  ['charts', 'chart'],
  ['dashboard/datamodels', 'dashboardDataModel'],
  ['pipelines', 'pipeline'],
  ['topics', 'topic'],
  ['mlmodels', 'mlmodel'],
  ['containers', 'container'],
  ['searchIndexes', 'searchIndex'],
  ['apiCollections', 'apiCollection'],
  ['apiEndpoints', 'apiEndpoint'],
  ['drives/directories', 'directory'],
  ['drives/files', 'file'],
  ['drives/spreadsheets', 'spreadsheet'],
  ['drives/worksheets', 'worksheet'],
  ['services/dashboardServices', 'dashboardService'],
  ['services/messagingServices', 'messagingService'],
  ['services/pipelineServices', 'pipelineService'],
  ['services/mlmodelServices', 'mlmodelService'],
  ['services/storageServices', 'storageService'],
  ['services/searchServices', 'searchService'],
  ['services/apiServices', 'apiService'],
  ['services/metadataServices', 'metadataService'],
  ['services/securityServices', 'securityService'],
  ['services/driveServices', 'driveService'],
  ['dataContracts', 'dataContract'],
  ['roles', 'role', false],
  ['policies', 'policy', false],
  ['personas', 'persona', false],
  ['events/subscriptions', 'eventsubscription', false],
  ['apps', 'app', false],
  ['kpi', 'kpi', false],
  ['metadata/types', 'type', false],
]

const POLICIES = [
  {
    name: 'OrganizationPolicy',
    description: 'Policy for all the users of an organization.',
    rules: [
      { name: 'OrganizationPolicy-NoOwner-Rule', effect: 'allow', resources: ['All'], operations: ['EditOwners'], condition: 'noOwner()' },
      { name: 'OrganizationPolicy-Owner-Rule', effect: 'allow', resources: ['All'], operations: ['All'], condition: 'isOwner()' },
    ],
  },
  {
    name: 'DataConsumerPolicy',
    description: 'Policy for data consumers to view and suggest changes.',
    rules: [
      {
        name: 'DataConsumerPolicy-EditRule',
        effect: 'allow',
        resources: ['All'],
        operations: ['EditDescription', 'EditTags', 'ViewAll', 'EditGlossaryTerms', 'EditTier'],
      },
    ],
  },
  {
    name: 'DataStewardPolicy',
    description: 'Policy for data stewards to curate the catalog.',
    rules: [
      {
        name: 'DataStewardPolicy-EditRule',
        effect: 'allow',
        resources: ['All'],
        operations: [
          'EditDescription',
          'EditDisplayName',
          'EditLineage',
          'EditOwners',
          'EditTags',
          'ViewAll',
          'EditGlossaryTerms',
          'EditTier',
        ],
      },
    ],
  },
]

const ROLES = [
  {
    name: 'DataConsumer',
    displayName: 'Data Consumer',
    description: 'Users with the Data Consumer role use the catalog and suggest changes.',
    policies: ['DataConsumerPolicy'],
  },
  {
    name: 'DataSteward',
    displayName: 'Data Steward',
    description: 'Users with the Data Steward role curate the catalog.',
    policies: ['DataStewardPolicy'],
  },
]

export function seedAccess() {
  for (const p of POLICIES) store.add('policies', { ...p, enabled: true, provider: 'system', allowDelete: false })
  for (const r of ROLES) {
    const policies = r.policies.map((n) => ref(store.byFqn('policies', n)!, 'policy'))
    store.add('roles', { ...r, policies, provider: 'system', allowDelete: false })
  }
}
