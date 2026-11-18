import type { Hono } from 'hono'

import { registerAdminRoutes } from './admin'
import { registerGovernanceRoutes } from './governance'
import { registerIngestionRoutes } from './ingestion'
import { registerQualityRoutes } from './quality'

/**
 * Feature endpoints of the demo catalog that the generic CRUD in ../app.ts
 * doesn't cover. One file per feature; register it here. These run before the
 * generic handler, so a specific route here wins.
 */
export function registerExtraRoutes(app: Hono) {
  registerGovernanceRoutes(app)
  registerQualityRoutes(app)
  registerIngestionRoutes(app)
  registerAdminRoutes(app)
}
