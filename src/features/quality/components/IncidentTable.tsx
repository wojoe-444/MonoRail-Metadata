import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { OwnerList } from '@/features/om/components/Labels'
import { displayName, entityHref, timeAgo } from '@/features/om/entity'

import { formatDateTime, shortTable } from '../format'
import type { TestCaseResolutionStatus } from '../types'
import { IncidentBadge, SeverityBadge } from './Badges'

/** Latest status of each incident: the failing test, its table, status, severity, assignee and last update. */
export function IncidentTable({ incidents }: { incidents: TestCaseResolutionStatus[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Test case</TableHead>
          <TableHead className="hidden md:table-cell">Table</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Severity</TableHead>
          <TableHead className="hidden lg:table-cell">Assignee</TableHead>
          <TableHead className="text-right">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {incidents.map((i) => {
          const tc = i.testCaseReference
          const tcFqn = tc?.fullyQualifiedName ?? ''
          const tableFqn = tableOfTestCase(tcFqn)
          const details = i.testCaseResolutionStatusDetails
          return (
            <TableRow key={i.id}>
              <TableCell className="max-w-72">
                <a href={entityHref('testCase', tcFqn)} className="block truncate font-medium hover:underline">
                  {displayName(tc)}
                </a>
              </TableCell>
              <TableCell className="hidden max-w-56 md:table-cell">
                {tableFqn && (
                  <a href={entityHref('table', tableFqn)} className="block truncate text-sm hover:underline">
                    {shortTable(tableFqn)}
                  </a>
                )}
              </TableCell>
              <TableCell>
                <IncidentBadge status={i.testCaseResolutionStatusType} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <SeverityBadge severity={i.severity} />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {details?.assignee ? (
                  <OwnerList owners={[details.assignee]} compact />
                ) : (
                  <span className="text-sm text-muted-foreground">Unassigned</span>
                )}
              </TableCell>
              <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(i.timestamp)}>
                {timeAgo(i.updatedAt ?? i.timestamp)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/**
 * Test case FQNs are `<table>.<name>` or `<table>.<column>.<name>`. An OpenMetadata
 * table FQN has four parts (service.database.schema.table), so take those.
 */
export function tableOfTestCase(testCaseFqn: string): string {
  const parts: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of testCaseFqn) {
    if (ch === '"') quoted = !quoted
    if (ch === '.' && !quoted) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts.length > 4 ? parts.slice(0, 4).join('.') : ''
}
