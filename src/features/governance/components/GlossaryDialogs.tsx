import { useEffect, useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { displayName, entityPath } from '@/features/om/entity'
import type { EntityReference } from '@/features/om/types'
import { useCurrentUser } from '@/features/om/useEntity'
import { invalidate } from '@/hooks/useQuery'
import { navigate } from '@/lib/router'

import { createGlossary, createGlossaryTerm } from '../api'
import { CreateDialog } from './CreateDialog'

const meRef = (me: ReturnType<typeof useCurrentUser>): EntityReference[] =>
  me ? [{ id: me.id, type: 'user', name: me.name, displayName: me.displayName, fullyQualifiedName: me.fullyQualifiedName }] : []

export function CreateGlossaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useCurrentUser()
  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New glossary"
      description="A glossary holds a set of business terms. You become its owner."
      onSubmit={async (v) => {
        const g = await createGlossary({ ...v, owners: meRef(me) })
        invalidate('glossaries')
        invalidate('search')
        navigate(entityPath('glossary', g.fullyQualifiedName ?? g.name))
      }}
    />
  )
}

/** Create a term in a glossary, or a child of `parent`. Synonyms are comma separated. */
export function CreateTermDialog({
  open,
  onOpenChange,
  glossary,
  parent,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  glossary: { name?: string; displayName?: string; fullyQualifiedName?: string }
  parent?: { name?: string; displayName?: string; fullyQualifiedName?: string }
  onCreated?: () => void
}) {
  const id = useId()
  const me = useCurrentUser()
  const [synonyms, setSynonyms] = useState('')
  useEffect(() => {
    if (open) setSynonyms('')
  }, [open])
  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title={parent ? `New term under ${displayName(parent)}` : 'New term'}
      description={`In ${displayName(glossary)}. If the glossary has reviewers, the term starts in review.`}
      onSubmit={async (v) => {
        await createGlossaryTerm({
          ...v,
          glossary: glossary.fullyQualifiedName ?? glossary.name ?? '',
          parent: parent?.fullyQualifiedName,
          synonyms: synonyms
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          owners: meRef(me),
        })
        invalidate('glossary-terms')
        invalidate('entity', 'glossaryTerm')
        invalidate('entity', 'glossary')
        invalidate('glossaries')
        invalidate('search')
        onCreated?.()
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-syn`}>Synonyms (optional, comma separated)</Label>
        <Input id={`${id}-syn`} value={synonyms} onChange={(e) => setSynonyms(e.target.value)} placeholder="e.g. GMV, Bookings" />
      </div>
    </CreateDialog>
  )
}
