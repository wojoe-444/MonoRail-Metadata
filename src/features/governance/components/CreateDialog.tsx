import { useEffect, useId, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface CreateValues {
  name: string
  displayName?: string
  description: string
}

/**
 * The create dialog every governance entity uses: name, display name and
 * description (OpenMetadata requires a description on these Create* requests),
 * plus whatever fields the caller adds as `children`.
 */
export function CreateDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel = 'Create',
  children,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: ReactNode
  submitLabel?: string
  children?: ReactNode
  onSubmit: (v: CreateValues) => Promise<unknown>
}) {
  const id = useId()
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setName('')
      setDisplayName('')
      setDesc('')
      setError(undefined)
    }
  }, [open])

  const nameError = name.includes('::') || name.includes('"') ? 'Names cannot contain "::" or double quotes.' : undefined
  const canSave = name.trim() && desc.trim() && !nameError && !saving

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!canSave) return
            setSaving(true)
            setError(undefined)
            try {
              await onSubmit({ name: name.trim(), displayName: displayName.trim() || undefined, description: desc.trim() })
              onOpenChange(false)
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            } finally {
              setSaving(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              aria-invalid={Boolean(nameError)}
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-display`}>Display name (optional)</Label>
            <Input id={`${id}-display`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-desc`}>Description</Label>
            <Textarea
              id={`${id}-desc`}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={4}
              required
              placeholder="Markdown is supported."
            />
          </div>
          {children}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? 'Creating…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
