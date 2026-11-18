import {
  BookOpen,
  Boxes,
  ChartPie,
  Compass,
  FileCode2,
  Gauge,
  GitFork,
  House,
  Network,
  Server,
  Settings,
  Sigma,
  SlidersHorizontal,
  Tags,
  Users,
} from 'lucide-react'

import type { NavSection } from '@/components/layout/nav'
import { DataProductPage } from '@/pages/DataProductPage'
import { DataQualityPage } from '@/pages/DataQualityPage'
import { DomainsPage } from '@/pages/DomainsPage'
import { ExplorePage } from '@/pages/ExplorePage'
import { GlossaryPage } from '@/pages/GlossaryPage'
import { GlossaryTermPage } from '@/pages/GlossaryTermPage'
import { HomePage } from '@/pages/HomePage'
import { IngestionPipelinePage } from '@/pages/IngestionPipelinePage'
import { InsightsPage } from '@/pages/InsightsPage'
import { LineagePage } from '@/pages/LineagePage'
import { MalloyModelsPage } from '@/pages/MalloyModelsPage'
import { MalloyWorkbenchPage } from '@/pages/MalloyWorkbenchPage'
import { MetricsPage } from '@/pages/MetricsPage'
import { QueryBuilderPage } from '@/pages/QueryBuilderPage'
import { SemanticModelsPage } from '@/pages/SemanticModelsPage'
import { SemanticSourcePage } from '@/pages/SemanticSourcePage'
import { ServiceBrowsePage } from '@/pages/ServiceBrowsePage'
import { ServicesPage } from '@/pages/ServicesPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { TablePage } from '@/pages/TablePage'
import { TagsPage } from '@/pages/TagsPage'
import { TeamsPage } from '@/pages/TeamsPage'
import { TestCasePage } from '@/pages/TestCasePage'
import { UserPage } from '@/pages/UserPage'

/**
 * Every page in the app, in drawer order. This is the one place to add a
 * page: give it a path, a label, a lucide icon and the component to render.
 *
 * - `heading` groups items under an overline label in the drawer.
 * - `children` makes a collapsible group (one level deep).
 * - `layout: 'full'` drops the page padding and max width (canvases, editors, maps).
 * - `hidden: true` keeps a route out of the drawer (detail pages, wizards).
 * - The `pinned` section sits at the bottom of the drawer (Settings).
 *
 * Entity links are built in one place, `entityPath()` in src/features/om/entity.ts.
 * Keep it in step when a detail page moves.
 */
export const NAV: NavSection[] = [
  {
    items: [{ path: '/', label: 'Home', icon: House, page: HomePage }],
  },
  {
    heading: 'Discover',
    items: [
      {
        path: '/explore',
        label: 'Explore',
        icon: Compass,
        page: ExplorePage,
        children: [{ path: '/explore/table', label: 'Table', page: TablePage, hidden: true }],
      },
      { path: '/lineage', label: 'Lineage', icon: GitFork, page: LineagePage, layout: 'full' },
    ],
  },
  {
    heading: 'Semantic layer',
    items: [
      {
        path: '/semantic',
        label: 'Semantic models',
        icon: Network,
        page: SemanticModelsPage,
        children: [{ path: '/semantic/source', label: 'Source', page: SemanticSourcePage, hidden: true }],
      },
      { path: '/metrics', label: 'Metrics', icon: Sigma, page: MetricsPage },
      { path: '/query', label: 'Query builder', icon: SlidersHorizontal, page: QueryBuilderPage },
      {
        path: '/malloy',
        label: 'Malloy models',
        icon: FileCode2,
        page: MalloyModelsPage,
        children: [{ path: '/malloy/workbench', label: 'Workbench', page: MalloyWorkbenchPage, hidden: true, layout: 'full' }],
      },
    ],
  },
  {
    heading: 'Govern',
    items: [
      {
        path: '/glossary',
        label: 'Glossary',
        icon: BookOpen,
        page: GlossaryPage,
        children: [{ path: '/glossary/term', label: 'Term', page: GlossaryTermPage, hidden: true }],
      },
      { path: '/tags', label: 'Classifications', icon: Tags, page: TagsPage },
      {
        path: '/domains',
        label: 'Domains',
        icon: Boxes,
        page: DomainsPage,
        children: [{ path: '/domains/product', label: 'Data product', page: DataProductPage, hidden: true }],
      },
    ],
  },
  {
    heading: 'Observe',
    items: [
      {
        path: '/quality',
        label: 'Data quality',
        icon: Gauge,
        page: DataQualityPage,
        children: [{ path: '/quality/test', label: 'Test case', page: TestCasePage, hidden: true }],
      },
      { path: '/insights', label: 'Insights', icon: ChartPie, page: InsightsPage },
    ],
  },
  {
    heading: 'Administer',
    items: [
      {
        path: '/services',
        label: 'Services',
        icon: Server,
        page: ServicesPage,
        children: [
          { path: '/services/browse', label: 'Browse', page: ServiceBrowsePage, hidden: true },
          { path: '/services/pipeline', label: 'Ingestion pipeline', page: IngestionPipelinePage, hidden: true },
        ],
      },
      {
        path: '/teams',
        label: 'Teams and users',
        icon: Users,
        page: TeamsPage,
        children: [{ path: '/teams/user', label: 'User', page: UserPage, hidden: true }],
      },
    ],
  },
  {
    pinned: true,
    items: [{ path: '/settings', label: 'Settings', icon: Settings, page: SettingsPage }],
  },
]
