import { Columns3, Sheet } from 'lucide-react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayName, entityHref, timeAgo } from '@/features/om/entity'

import { formatDateTime, parseEntityLink, shortTable, statusOf } from '../format'
import type { TestCase } from '../types'
import { TestStatusBadge } from './Badges'

/**
 * Test cases as rows: name (links to the test case page), what it tests,
 * test type, status, last result and when it ran.
 */
export function TestCaseTable({ cases, showTable = true }: { cases: TestCase[]; showTable?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Test</TableHead>
          <TableHead>{showTable ? 'Tests' : 'Column'}</TableHead>
          <TableHead className="hidden md:table-cell">Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden lg:table-cell">Last result</TableHead>
          <TableHead className="text-right">Last run</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cases.map((tc) => {
          const link = parseEntityLink(tc.entityLink)
          const tableFqn = link?.entityFQN ?? tc.entityFQN ?? ''
          const result = tc.testCaseResult
          return (
            <TableRow key={tc.id}>
              <TableCell className="max-w-72">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <a href={entityHref('testCase', tc.fullyQualifiedName ?? tc.name)} className="truncate font-medium hover:underline">
                    {displayName(tc)}
                  </a>
                  {tc.incidentId && <span className="text-xs text-destructive">Open incident</span>}
                </div>
              </TableCell>
              <TableCell className="max-w-64">
                <div className="flex min-w-0 items-center gap-1.5 text-sm">
                  {link?.column ? (
                    <Columns3 className="size-3.5 shrink-0 text-muted-foreground" aria-label="Column" />
                  ) : (
                    <Sheet className="size-3.5 shrink-0 text-muted-foreground" aria-label="Table" />
                  )}
                  {showTable ? (
                    <a href={entityHref('table', tableFqn)} className="truncate hover:underline">
                      {shortTable(tableFqn)}
                      {link?.column && <span className="font-mono text-muted-foreground">.{link.column}</span>}
                    </a>
                  ) : (
                    <span className="truncate font-mono">{link?.column ?? 'Table'}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="hidden max-w-56 truncate text-muted-foreground md:table-cell">
                {displayName(tc.testDefinition)}
              </TableCell>
              <TableCell>
                <TestStatusBadge status={statusOf(tc)} />
              </TableCell>
              <TableCell className="hidden max-w-80 lg:table-cell">
                {result?.result ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="line-clamp-1 text-xs text-muted-foreground">{result.result}</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">{result.result}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-xs text-muted-foreground">–</span>
                )}
              </TableCell>
              <TableCell
                className="text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                title={formatDateTime(result?.timestamp)}
              >
                {result ? timeAgo(result.timestamp) : 'Never'}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
