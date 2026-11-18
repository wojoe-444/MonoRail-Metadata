import { useState } from 'react'
import { Mail, Pencil, Plus, UserMinus, Users } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { navigate, useSearchParams } from '@/lib/router'
import { removeTeamUser, searchOwnedBy } from '@/features/admin/api'
import { AssetList } from '@/features/admin/AssetList'
import { Fact } from '@/features/admin/pipelines'
import { CreateTeamDialog, MembersDialog, teamTypeLabel } from '@/features/admin/TeamDialogs'
import { getEntity, listEntities } from '@/features/om/api'
import { displayName, entityHref, refHref } from '@/features/om/entity'
import { DescriptionDialog } from '@/features/om/components/Editors'
import { EntityHeader } from '@/features/om/components/EntityHeader'
import { OwnerAvatar } from '@/features/om/components/Labels'
import { Markdown } from '@/features/om/components/Markdown'
import { EmptyState, ErrorState, Loaded, LoadingState } from '@/features/om/components/States'
import type { EntityReference, Team, User } from '@/features/om/types'
import { useEntity } from '@/features/om/useEntity'

const TEAM_FIELDS = 'users,owners,parents,children,userCount,domains,defaultRoles'

/** Teams and the people in them. `?fqn=` opens one team. */
export function TeamsPage() {
  const fqn = useSearchParams().get('fqn')
  const teams = useQuery(['teams', 'list'], () => listEntities<Team>('team', { fields: 'users,owners,parents,userCount', limit: 200 }))
  const [creating, setCreating] = useState(false)
  const list = teams.data?.data ?? []

  const dialog = (
    <CreateTeamDialog
      open={creating}
      onOpenChange={setCreating}
      teams={list}
      defaultParentId={fqn ? list.find((t) => t.fullyQualifiedName === fqn || t.name === fqn)?.id : undefined}
      onCreated={(t) => {
        invalidate('teams')
        invalidate('search')
        navigate(`/teams?fqn=${encodeURIComponent(t.fullyQualifiedName ?? t.name)}`)
      }}
    />
  )

  if (fqn)
    return (
      <>
        <TeamDetail fqn={fqn} onNewTeam={() => setCreating(true)} />
        {dialog}
      </>
    )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Teams and users"
        description="Who owns what. Teams and people own assets, answer questions about them, and review changes."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New team
          </Button>
        }
      />
      <Loaded query={teams}>
        {() =>
          list.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" aria-hidden />}
              title="No teams yet"
              action={<Button onClick={() => setCreating(true)}>New team</Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((t) => (
                <TeamCard key={t.id} team={t} />
              ))}
            </div>
          )
        }
      </Loaded>
      <UsersCard />
      {dialog}
    </div>
  )
}

function TeamCard({ team }: { team: Team }) {
  const members = team.users ?? []
  const count = team.userCount ?? members.length
  return (
    <Card className="relative gap-3 hover:bg-accent/40">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <a
            href={entityHref('team', team.fullyQualifiedName ?? team.name)}
            className="truncate after:absolute after:inset-0 hover:underline"
          >
            {displayName(team)}
          </a>
          <Badge variant="secondary">{teamTypeLabel(team.teamType)}</Badge>
        </CardTitle>
        <CardDescription className="line-clamp-2">{team.description || 'No description.'}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="flex -space-x-1.5">
          {members.slice(0, 5).map((m) => (
            <OwnerAvatar key={m.id} owner={m} className="ring-2 ring-card" />
          ))}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count} member{count === 1 ? '' : 's'}
        </span>
      </CardContent>
    </Card>
  )
}

function UsersCard() {
  const [kind, setKind] = useState<'people' | 'bots'>('people')
  const users = useQuery(['users', 'list', kind], () =>
    listEntities<User>('user', { fields: 'teams,roles', limit: 200, isBot: kind === 'bots' ? 'true' : 'false' }),
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>{users.data ? `${users.data.paging.total} ${kind === 'bots' ? 'bot' : 'people'}` : ' '}</CardDescription>
        <CardAction>
          <Segmented
            aria-label="User kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'people', label: 'People' },
              { value: 'bots', label: 'Bots' },
            ]}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Loaded query={users}>
          {(data) =>
            data.data.length === 0 ? (
              <EmptyState title={kind === 'bots' ? 'No bots' : 'No users'} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Email</TableHead>
                    <TableHead>Teams</TableHead>
                    <TableHead className="hidden md:table-cell">Roles</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <a href={entityHref('user', u.name)} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                          <OwnerAvatar owner={{ id: u.id, type: 'user', name: u.name, displayName: u.displayName }} />
                          <span className="truncate">{displayName(u)}</span>
                          {u.isAdmin && <Badge variant="primary">Admin</Badge>}
                        </a>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{u.email}</TableCell>
                      <TableCell className="whitespace-normal">
                        <RefLinks refs={u.teams} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {u.roles?.map((r) => displayName(r)).join(', ') || '–'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </Loaded>
      </CardContent>
    </Card>
  )
}

function RefLinks({ refs }: { refs: EntityReference[] | undefined }) {
  if (!refs?.length) return <span className="text-muted-foreground">–</span>
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {refs.map((r) => (
        <a key={r.id} href={refHref(r)} className="text-sm hover:underline">
          {displayName(r)}
        </a>
      ))}
    </span>
  )
}

function TeamDetail({ fqn, onNewTeam }: { fqn: string; onNewTeam: () => void }) {
  const { entity: team, query, save } = useEntity<Team>('team', fqn, (f) => getEntity<Team>('team', f, TEAM_FIELDS))
  const [editingDescription, setEditingDescription] = useState(false)
  const [editingMembers, setEditingMembers] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string>()

  if (query.error && !team) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!team) return <LoadingState />

  const members = team.users ?? []
  const refresh = () => {
    query.refetch()
    invalidate('teams')
    invalidate('users')
  }

  return (
    <div className="flex flex-col gap-6">
      <EntityHeader
        entity={team}
        entityType="team"
        parents={team.parents ?? []}
        badges={<Badge variant="secondary">{teamTypeLabel(team.teamType)}</Badge>}
        fields={['owners', 'domains']}
        onSave={save}
        onFollowChange={query.refetch}
        actions={
          team.teamType !== 'Group' && (
            <Button variant="outline" size="sm" onClick={onNewTeam}>
              <Plus />
              Sub-team
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>About</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setEditingDescription(true)}>
                <Pencil />
                Edit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Markdown placeholder="No description yet. Say what the team does and what it owns.">{team.description}</Markdown>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Type">{teamTypeLabel(team.teamType)}</Fact>
            <Fact label="Members">{team.userCount ?? members.length}</Fact>
            <div className="col-span-2 min-w-0">
              <div className="text-xs text-muted-foreground">Email</div>
              {team.email ? (
                <a href={`mailto:${team.email}`} className="flex items-center gap-1.5 truncate text-sm hover:underline">
                  <Mail className="size-3.5 text-muted-foreground" aria-hidden />
                  {team.email}
                </a>
              ) : (
                <span className="text-sm text-muted-foreground">–</span>
              )}
            </div>
            <div className="col-span-2 min-w-0">
              <div className="text-xs text-muted-foreground">Sub-teams</div>
              <RefLinks refs={team.children} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card className="gap-4 self-start">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {members.length} {members.length === 1 ? 'person' : 'people'}
            </CardDescription>
            <CardAction>
              {team.teamType === 'Group' || !team.teamType ? (
                <Button variant="soft" size="sm" onClick={() => setEditingMembers(true)}>
                  <Plus />
                  Add
                </Button>
              ) : null}
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {team.teamType && team.teamType !== 'Group' && (
              <p className="pb-2 text-xs text-muted-foreground">
                In OpenMetadata only Groups hold people directly; add people to a Group under this{' '}
                {teamTypeLabel(team.teamType).toLowerCase()}.
              </p>
            )}
            {members.length === 0 ? (
              <EmptyState title="No members" />
            ) : (
              members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent/50">
                  <OwnerAvatar owner={m} />
                  <a href={refHref(m)} className="min-w-0 flex-1 truncate text-sm hover:underline">
                    {displayName(m)}
                  </a>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Remove ${displayName(m)}`}
                        disabled={removing === m.id}
                        onClick={async () => {
                          setRemoving(m.id)
                          setError(undefined)
                          try {
                            await removeTeamUser(team.id, m.id)
                            refresh()
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e))
                          } finally {
                            setRemoving(null)
                          }
                        }}
                      >
                        <UserMinus />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove from team</TooltipContent>
                  </Tooltip>
                </div>
              ))
            )}
            {error && <p className="pt-2 text-xs text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <AssetList
          title="Owned assets"
          queryKey={['owned', team.id]}
          load={() => searchOwnedBy(team.id)}
          empty="This team owns nothing yet."
        />
      </div>

      <DescriptionDialog
        open={editingDescription}
        onOpenChange={setEditingDescription}
        title={`Description of ${displayName(team)}`}
        value={team.description}
        onSave={(description) => save({ ...team, description })}
      />
      <MembersDialog open={editingMembers} onOpenChange={setEditingMembers} team={team} onSaved={refresh} />
    </div>
  )
}
