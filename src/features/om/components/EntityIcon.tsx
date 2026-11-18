import {
  Book,
  BookOpen,
  Boxes,
  Database,
  Eye,
  FileCode,
  FolderTree,
  Gauge,
  Layers,
  Package,
  Server,
  Shield,
  Sigma,
  Table2,
  Tag,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  table: Table2,
  view: Eye,
  database: Database,
  databaseSchema: FolderTree,
  databaseService: Server,
  glossary: Book,
  glossaryTerm: BookOpen,
  classification: Shield,
  tag: Tag,
  domain: Boxes,
  dataProduct: Package,
  user: User,
  team: Users,
  query: FileCode,
  metric: Sigma,
  testCase: Gauge,
  testSuite: Layers,
  ingestionPipeline: Workflow,
  pipeline: Workflow,
}

export function entityIcon(entityType: string, tableType?: string): LucideIcon {
  if (entityType === 'table' && tableType && /View/.test(tableType)) return Eye
  return ICONS[entityType] ?? Table2
}

/** The icon for an entity type, in a soft tile (or bare with `bare`). */
export function EntityIcon({ type, tableType, className, bare }: { type: string; tableType?: string; className?: string; bare?: boolean }) {
  const Icon = entityIcon(type, tableType)
  if (bare) return <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} aria-hidden />
  return (
    <span
      className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground', className)}
      aria-hidden
    >
      <Icon className="size-4" />
    </span>
  )
}
