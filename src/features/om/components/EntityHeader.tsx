import { useState, type ReactNode } from 'react'
import { ChevronRight, ExternalLink, Pencil, Star } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { followEntity, unfollowEntity } from '../api'
import { certificationOf, displayName, entityLabel, plainTags, refHref, tierOf } from '../entity'
import type { EntityBase, EntityReference, TagLabel } from '../types'
import { useCurrentUser } from '../useEntity'
import { OwnerPickerDialog, SingleTagDialog, TagPickerDialog } from './Editors'
import { EntityIcon } from './EntityIcon'
import { CertificationBadge, DomainList, OwnerList, TagList, TierBadge } from './Labels'

/**
 * The top of every entity page: breadcrumb of parents, icon, name, badges,
 * and an editable strip of owners, tier, certification, domain and tags.
 * Pass `onSave` to make the strip editable (it receives the whole updated entity).
 */
export function EntityHeader<T extends EntityBase>({
  entity,
  entityType,
  subtype,
  parents = [],
  badges,
  actions,
  sourceUrl,
  onSave,
  onFollowChange,
  fields = ['owners', 'tier', 'certification', 'domains', 'tags'],
}: {
  entity: T
  entityType: string
  subtype?: string
  parents?: EntityReference[]
  badges?: ReactNode
  actions?: ReactNode
  sourceUrl?: string
  onSave?: (next: T) => Promise<unknown>
  onFollowChange?: () => void
  fields?: ('owners' | 'tier' | 'certification' | 'domains' | 'tags')[]
}) {
  const me = useCurrentUser()
  const [editing, setEditing] = useState<null | 'owners' | 'tier' | 'certification' | 'tags'>(null)
  const following = Boolean(me && entity.followers?.some((f) => f.id === me.id))
  const tags = entity.tags ?? []
  const tier = tierOf(tags)
  const cert = certificationOf(tags)

  const setTags = async (next: TagLabel[]) => onSave?.({ ...entity, tags: next })
  const replaceIn = (prefix: string, t: TagLabel | undefined) =>
    setTags([...tags.filter((x) => !x.tagFQN.startsWith(prefix)), ...(t ? [t] : [])])

  return (
    <div className="flex flex-col gap-4">
      {parents.length > 0 && (
        <nav aria-label="Location" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {parents.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3" aria-hidden />}
              <a href={refHref(p)} className="hover:text-foreground hover:underline">
                {displayName(p)}
              </a>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon type={entityType} tableType={subtype} className="size-10" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{displayName(entity)}</h1>
              <TierBadge tier={tier} />
              <CertificationBadge tag={cert} />
              {badges}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{subtype && subtype !== 'Regular' ? subtype.replace(/([A-Z])/g, ' $1').trim() : entityLabel(entityType)}</span>
              <span aria-hidden>·</span>
              <span className="truncate font-mono">{entity.fullyQualifiedName}</span>
              {entity.version !== undefined && (
                <Badge variant="outline" className="font-mono">
                  v{entity.version}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sourceUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open in BigQuery
              </a>
            </Button>
          )}
          {me && (
            <Button
              variant={following ? 'soft' : 'outline'}
              size="sm"
              aria-pressed={following}
              onClick={async () => {
                if (following) await unfollowEntity(entityType, entity.id, me.id)
                else await followEntity(entityType, entity.id, me.id)
                onFollowChange?.()
              }}
            >
              <Star className={following ? 'fill-current' : undefined} />
              {following ? 'Following' : 'Follow'}
              {entity.followers?.length ? <span className="text-muted-foreground tabular-nums">{entity.followers.length}</span> : null}
            </Button>
          )}
          {actions}
        </div>
      </div>

      <Card className="py-0">
        <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
          {fields.includes('owners') && (
            <Field label="Owners" onEdit={onSave && (() => setEditing('owners'))}>
              <OwnerList owners={entity.owners} compact />
            </Field>
          )}
          {fields.includes('tier') && (
            <Field label="Tier" onEdit={onSave && (() => setEditing('tier'))}>
              {tier ? <TierBadge tier={tier} /> : <span className="text-sm text-muted-foreground">No tier</span>}
            </Field>
          )}
          {fields.includes('certification') && (
            <Field label="Certification" onEdit={onSave && (() => setEditing('certification'))}>
              {cert ? <CertificationBadge tag={cert} /> : <span className="text-sm text-muted-foreground">Not certified</span>}
            </Field>
          )}
          {fields.includes('domains') && (
            <Field label="Domain">
              <DomainList domains={entity.domains} />
            </Field>
          )}
          {fields.includes('tags') && (
            <Field label="Tags and terms" onEdit={onSave && (() => setEditing('tags'))} wide>
              <TagList tags={plainTags(tags)} empty="None" />
            </Field>
          )}
        </CardContent>
      </Card>

      {onSave && (
        <>
          <OwnerPickerDialog
            open={editing === 'owners'}
            onOpenChange={(o) => !o && setEditing(null)}
            title="Owners"
            description="People or teams accountable for this asset."
            value={entity.owners ?? []}
            onSave={(owners) => onSave({ ...entity, owners })}
          />
          <SingleTagDialog
            open={editing === 'tier'}
            onOpenChange={(o) => !o && setEditing(null)}
            title="Tier"
            classification="Tier"
            value={tier}
            onSave={(t) => replaceIn('Tier.', t)}
          />
          <SingleTagDialog
            open={editing === 'certification'}
            onOpenChange={(o) => !o && setEditing(null)}
            title="Certification"
            classification="Certification"
            value={cert}
            onSave={(t) => replaceIn('Certification.', t)}
          />
          <TagPickerDialog
            open={editing === 'tags'}
            onOpenChange={(o) => !o && setEditing(null)}
            title="Tags and glossary terms"
            value={plainTags(tags)}
            onSave={(next) => setTags([...tags.filter((t) => tierOf([t]) || certificationOf([t])), ...next])}
          />
        </>
      )}
    </div>
  )
}

function Field({ label, children, onEdit, wide }: { label: string; children: ReactNode; onEdit?: () => void; wide?: boolean }) {
  return (
    <div className={wide ? 'min-w-0 sm:col-span-2 xl:col-span-1' : 'min-w-0'}>
      <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {onEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onEdit}
                className="rounded p-0.5 hover:bg-accent hover:text-accent-foreground"
                aria-label={`Edit ${label.toLowerCase()}`}
              >
                <Pencil className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Edit {label.toLowerCase()}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  )
}
