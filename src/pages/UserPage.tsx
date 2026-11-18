import { useState } from 'react'
import { Bot, Mail, ShieldCheck } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { navigate, useSearchParams } from '@/lib/router'
import { searchFollowedBy, searchOwnedBy } from '@/features/admin/api'
import { AssetList } from '@/features/admin/AssetList'
import { Fact } from '@/features/admin/pipelines'
import { getEntity } from '@/features/om/api'
import { displayName, formatDate, refHref, timeAgo } from '@/features/om/entity'
import { DomainList } from '@/features/om/components/Labels'
import { Markdown } from '@/features/om/components/Markdown'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import type { User } from '@/features/om/types'
import { useCurrentUser, useEntity } from '@/features/om/useEntity'

/** One person (or bot): profile, teams, roles, and what they own and follow. `?fqn=` is the user name. */
export function UserPage() {
  const name = useSearchParams().get('fqn')
  const me = useCurrentUser()
  const { entity: user, query, save } = useEntity<User>('user', name, (n) => getEntity<User>('user', n, 'teams,roles,profile,domains'))
  const [savingAdmin, setSavingAdmin] = useState(false)
  const [error, setError] = useState<string>()

  if (!name) return <EmptyState title="No user selected" action={<Button onClick={() => navigate('/teams')}>Teams and users</Button>} />
  if (query.error && !user) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!user) return <LoadingState />

  const canEditAdmin = Boolean(me?.isAdmin) && me?.id !== user.id && !user.isBot

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow={user.isBot ? 'Bot' : 'User'} title={displayName(user)} description={user.email} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {user.isAdmin && (
                <Badge variant="primary">
                  <ShieldCheck aria-hidden />
                  Admin
                </Badge>
              )}
              {user.isBot && (
                <Badge variant="info">
                  <Bot aria-hidden />
                  Bot
                </Badge>
              )}
              {!user.isAdmin && !user.isBot && <Badge variant="outline">Member</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="User name" mono>
                {user.name}
              </Fact>
              <Fact label="Updated">
                <span title={formatDate(user.updatedAt)}>{timeAgo(user.updatedAt)}</span>
              </Fact>
              <div className="col-span-2 min-w-0">
                <div className="text-xs text-muted-foreground">Email</div>
                <a href={`mailto:${user.email}`} className="flex items-center gap-1.5 truncate text-sm hover:underline">
                  <Mail className="size-3.5 text-muted-foreground" aria-hidden />
                  {user.email}
                </a>
              </div>
              <div className="col-span-2 min-w-0">
                <div className="text-xs text-muted-foreground">Domains</div>
                <DomainList domains={user.domains} empty="–" />
              </div>
            </div>
            {canEditAdmin && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
                <div className="flex flex-col">
                  <Label htmlFor="user-admin">Administrator</Label>
                  <span className="text-xs text-muted-foreground">Full access to every setting and asset.</span>
                </div>
                <Switch
                  id="user-admin"
                  checked={Boolean(user.isAdmin)}
                  disabled={savingAdmin}
                  onCheckedChange={async (v) => {
                    setSavingAdmin(true)
                    setError(undefined)
                    try {
                      await save({ ...user, isAdmin: v })
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e))
                    } finally {
                      setSavingAdmin(false)
                    }
                  }}
                />
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Teams and roles</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted-foreground">Teams</div>
              {user.teams?.length ? (
                <ul className="flex flex-col gap-1">
                  {user.teams.map((t) => (
                    <li key={t.id}>
                      <a href={refHref(t)} className="text-sm hover:underline">
                        {displayName(t)}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm text-muted-foreground">Not in a team</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted-foreground">Roles</div>
              {user.roles?.length ? (
                <div className="flex flex-wrap gap-1">
                  {user.roles.map((r) => (
                    <Badge key={r.id} variant="secondary">
                      {displayName(r)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Default roles only</span>
              )}
            </div>
            {user.description?.trim() && (
              <div className="sm:col-span-2">
                <Markdown>{user.description}</Markdown>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AssetList
          title="Owns"
          queryKey={['owned', user.id]}
          load={() => searchOwnedBy(user.id)}
          empty={`${displayName(user)} owns nothing directly.`}
        />
        <AssetList
          title="Follows"
          queryKey={['followed', user.id]}
          load={() => searchFollowedBy(user.id)}
          empty="Not following anything."
        />
      </div>
    </div>
  )
}
