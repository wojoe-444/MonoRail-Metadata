import { CircleAlert, CircleCheck, CircleDashed, CircleSlash } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

import { INCIDENT_LABEL, INCIDENT_VARIANT, SEVERITY_LABEL, STATUS_LABEL, STATUS_VARIANT } from '../format'
import type { IncidentStatusType, Severity, TestCaseStatus } from '../types'

const STATUS_ICON = { Success: CircleCheck, Failed: CircleAlert, Aborted: CircleSlash, Queued: CircleDashed } as const

export function TestStatusBadge({ status }: { status: TestCaseStatus | undefined }) {
  if (!status) return <Badge variant="outline">Not run</Badge>
  const Icon = STATUS_ICON[status]
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      <Icon aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  )
}

export function IncidentBadge({ status }: { status: IncidentStatusType }) {
  return <Badge variant={INCIDENT_VARIANT[status]}>{INCIDENT_LABEL[status]}</Badge>
}

export function SeverityBadge({ severity }: { severity: Severity | undefined }) {
  if (!severity) return <span className="text-xs text-muted-foreground">No severity</span>
  const n = Number(severity.slice(-1))
  return <Badge variant={n === 1 ? 'destructive' : n === 2 ? 'warning' : 'secondary'}>{SEVERITY_LABEL[severity]}</Badge>
}
