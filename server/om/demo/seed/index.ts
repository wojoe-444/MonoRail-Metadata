import { store } from '../store'
import { OTHER_COLLECTIONS, seedAccess } from './access'
import { seedCatalog } from './catalog'
import { seedGovernance } from './governance'
import { seedIngestion } from './ingestion'
import { seedQuality } from './quality'

/** Register every demo collection, then fill them. Order matters: later seeds reference earlier ones. */
export function seedAll() {
  store.define('users', 'user')
  store.define('teams', 'team')
  store.define('classifications', 'classification')
  store.define('tags', 'tag')
  store.define('glossaries', 'glossary')
  store.define('glossaryTerms', 'glossaryTerm')
  store.define('domains', 'domain')
  store.define('dataProducts', 'dataProduct')
  store.define('services/databaseServices', 'databaseService')
  store.define('databases', 'database')
  store.define('databaseSchemas', 'databaseSchema')
  store.define('tables', 'table')
  store.define('queries', 'query')
  store.define('metrics', 'metric')
  store.define('dataQuality/testDefinitions', 'testDefinition', false)
  store.define('dataQuality/testSuites', 'testSuite')
  store.define('dataQuality/testCases', 'testCase')
  store.define('services/ingestionPipelines', 'ingestionPipeline')
  for (const [path, type, searchable] of OTHER_COLLECTIONS) store.define(path, type, searchable)

  seedAccess()
  seedGovernance()
  seedCatalog()
  seedQuality()
  seedIngestion()
}
