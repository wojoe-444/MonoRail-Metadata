import { useMemo, useState } from 'react'
import { BookOpen, ChevronRight, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { OwnerList } from '@/features/om/components/Labels'
import { displayName, entityHref, formatCount } from '@/features/om/entity'
import { cn } from '@/lib/utils'

import { termStatus, type GlossaryTermV2 } from '../api'
import { StatusBadge } from './Parts'

interface Node {
  term: GlossaryTermV2
  children: Node[]
}

function buildTree(terms: GlossaryTermV2[]): Node[] {
  const byFqn = new Map<string, Node>()
  for (const t of terms) byFqn.set(t.fullyQualifiedName ?? t.name, { term: t, children: [] })
  const roots: Node[] = []
  for (const n of byFqn.values()) {
    const parentFqn = n.term.parent?.fullyQualifiedName
    const parent = parentFqn ? byFqn.get(parentFqn) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  const sort = (ns: Node[]) => {
    ns.sort((a, b) => displayName(a.term).localeCompare(displayName(b.term)))
    ns.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

/** A glossary's terms as an expandable parent/child tree, with status, synonyms, owners and asset counts. */
export function TermTree({
  terms,
  usage,
  onAddChild,
}: {
  terms: GlossaryTermV2[]
  usage?: Map<string, number>
  onAddChild?: (parent: GlossaryTermV2) => void
}) {
  const roots = useMemo(() => buildTree(terms), [terms])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (fqn: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(fqn)) next.delete(fqn)
      else next.add(fqn)
      return next
    })

  const rows: { node: Node; depth: number }[] = []
  const walk = (ns: Node[], depth: number) => {
    for (const n of ns) {
      rows.push({ node: n, depth })
      if (!collapsed.has(n.term.fullyQualifiedName ?? n.term.name)) walk(n.children, depth + 1)
    }
  }
  walk(roots, 0)

  return (
    <div className="-mx-2 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Term</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Synonyms</TableHead>
            <TableHead className="hidden lg:table-cell">Owners</TableHead>
            <TableHead className="text-right">Assets</TableHead>
            {onAddChild && (
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ node, depth }) => {
            const t = node.term
            const fqn = t.fullyQualifiedName ?? t.name
            const open = !collapsed.has(fqn)
            return (
              <TableRow key={t.id}>
                <TableCell className="max-w-0 min-w-56">
                  <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 20 }}>
                    {node.children.length ? (
                      <button
                        type="button"
                        onClick={() => toggle(fqn)}
                        aria-expanded={open}
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${displayName(t)}`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" aria-hidden />
                    )}
                    <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <a href={entityHref('glossaryTerm', fqn)} className="truncate font-medium hover:underline">
                      {displayName(t)}
                    </a>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={termStatus(t)} />
                </TableCell>
                <TableCell className="hidden max-w-0 min-w-32 md:table-cell">
                  <span className="block truncate text-muted-foreground">{t.synonyms?.length ? t.synonyms.join(', ') : '–'}</span>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <OwnerList owners={t.owners} empty="–" compact />
                </TableCell>
                <TableCell className="text-right tabular-nums">{usage ? formatCount(usage.get(fqn) ?? 0) : '–'}</TableCell>
                {onAddChild && (
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Add a child term to ${displayName(t)}`}
                          onClick={() => onAddChild(t)}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Add child term</TooltipContent>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
