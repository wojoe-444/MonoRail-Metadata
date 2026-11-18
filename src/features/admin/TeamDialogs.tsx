import { useEffect, useState } from 'react'
import { Check, Search, User as UserIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useQuery } from '@/hooks/useQuery'
import { cn } from '@/lib/utils'
import { search } from '@/features/om/api'
import { displayName } from '@/features/om/entity'
import type { EntityReference, SearchSource, Team } from '@/features/om/types'

import { createTeam, setTeamUsers } from './api'

/** OpenMetadata's team hierarchy: a team's parent must sit higher (Groups hold people only, never teams). */
export const TEAM_TYPES = ['Group', 'Department', 'Division', 'BusinessUnit'] as const
const RANK: Record<string, number> = { Organization: 0, BusinessUnit: 1, Division: 2, Department: 3, Group: 4 }

export function teamTypeLabel(t: string | undefined): string {
  return t === 'BusinessUnit' ? 'Business unit' : (t ?? 'Group')
}

export function CreateTeamDialog({
  open,
  onOpenChange,
  teams,
  defaultParentId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  teams: Team[]
  defaultParentId?: string
  onCreated: (t: Team) => void
}) {
  const [f, setF] = useState({ name: '', displayName: '', email: '', description: '', teamType: 'Group' as string, parent: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setF({ name: '', displayName: '', email: '', description: '', teamType: 'Group', parent: defaultParentId ?? '' })
      setError(undefined)
    }
  }, [open, defaultParentId])
  const parents = teams.filter((t) => t.teamType !== 'Group' && (RANK[t.teamType ?? 'Group'] ?? 4) <= (RANK[f.teamType] ?? 4))
  const parentOk = !f.parent || parents.some((t) => t.id === f.parent)
  const invalid = !f.name.trim()
    ? 'A name is required.'
    : f.email && !/^\S+@\S+\.\S+$/.test(f.email)
      ? 'That email does not look right.'
      : !parentOk
        ? `A ${teamTypeLabel(f.teamType).toLowerCase()} can't sit under that team.`
        : undefined

  const submit = async () => {
    if (invalid) return
    setSaving(true)
    setError(undefined)
    try {
      const t = await createTeam({
        name: f.name.trim(),
        displayName: f.displayName.trim() || undefined,
        email: f.email.trim() || undefined,
        description: f.description.trim() || undefined,
        teamType: f.teamType,
        parents: f.parent ? [f.parent] : undefined,
      })
      onOpenChange(false)
      onCreated(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>Teams own assets and group people. Without a parent, a team sits under the organization.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="team-name">Name</Label>
              <Input id="team-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Data Platform" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="team-display">Display name</Label>
              <Input id="team-display" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="team-type">Type</Label>
              <NativeSelect id="team-type" value={f.teamType} onChange={(e) => setF({ ...f, teamType: e.target.value })}>
                {TEAM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {teamTypeLabel(t)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="team-parent">Parent</Label>
              <NativeSelect id="team-parent" value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })}>
                <option value="">Organization</option>
                {parents.map((t) => (
                  <option key={t.id} value={t.id}>
                    {displayName(t)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="team-email">Email</Label>
              <Input
                id="team-email"
                type="email"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
                placeholder="team@example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="team-desc">Description</Label>
              <Textarea
                id="team-desc"
                rows={3}
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
                placeholder="What the team does and what it owns."
              />
            </div>
          </div>
          {(error || (invalid && f.name)) && <p className="text-sm text-destructive">{error ?? invalid}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || Boolean(invalid)}>
              {saving ? 'Creating…' : 'Create team'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Choose a team's members. Saves the whole list (PUT /teams/{id}/users). */
export function MembersDialog({
  open,
  onOpenChange,
  team,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  team: Team
  onSaved: () => void
}) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<EntityReference[]>(team.users ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setSelected(team.users ?? [])
      setQ('')
      setError(undefined)
    }
  }, [open, team.users])
  const results = useQuery(open ? ['members-picker', q] : null, () =>
    search<SearchSource & { email?: string; isBot?: boolean }>({ q, index: 'user', size: 30 }),
  )
  const isOn = (id: string) => selected.some((u) => u.id === id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Members of {displayName(team)}</DialogTitle>
          <DialogDescription>{selected.length} selected</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Label htmlFor="members-q" className="sr-only">
            Search people
          </Label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="members-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="pl-9" />
        </div>
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {(results.data?.hits.hits ?? [])
            .filter(({ _source }) => !_source.isBot)
            .map(({ _source: u }) => (
              <button
                key={u.id}
                type="button"
                aria-pressed={isOn(u.id)}
                onClick={() =>
                  setSelected((s) =>
                    isOn(u.id)
                      ? s.filter((x) => x.id !== u.id)
                      : [
                          ...s,
                          { id: u.id, type: 'user', name: u.name, displayName: u.displayName, fullyQualifiedName: u.fullyQualifiedName },
                        ],
                  )
                }
                className={cn(
                  'flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground',
                  isOn(u.id) && 'bg-primary-soft text-primary-soft-foreground',
                )}
              >
                <UserIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{displayName(u)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                </span>
                {isOn(u.id) && <Check className="size-4" aria-hidden />}
              </button>
            ))}
          {results.data && !results.data.hits.hits.length && (
            <p className="py-6 text-center text-sm text-muted-foreground">No people match.</p>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              setError(undefined)
              try {
                await setTeamUsers(team.id, selected)
                onOpenChange(false)
                onSaved()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? 'Saving…' : 'Save members'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
