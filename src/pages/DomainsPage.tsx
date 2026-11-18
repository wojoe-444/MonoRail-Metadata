import { useEffect, useId, useState } from 'react'
import { Boxes, ChevronDown, Package, Plus } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import {
  createDataProduct,
  createDomain,
  DOMAIN_FIELDS,
  DOMAIN_TYPES,
  domainAssetCounts,
  domainAssetsFilter,
  listDataProducts,
  listDomains,
} from '@/features/governance/api'
import { AssetList } from '@/features/governance/components/AssetList'
import { CreateDialog } from '@/features/governance/components/CreateDialog'
import { DescriptionCard, Detail, PeopleDetail, SideList } from '@/features/governance/components/Parts'
import { getEntity } from '@/features/om/api'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { OwnerList } from '@/features/om/components/Labels'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import { displayName, entityHref, entityPath, formatCount } from '@/features/om/entity'
import type { Domain, EntityReference } from '@/features/om/types'
import { useCurrentUser, useEntity } from '@/features/om/useEntity'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { navigate, useSearchParams } from '@/lib/router'

const meRef = (me: ReturnType<typeof useCurrentUser>): EntityReference[] =>
  me ? [{ id: me.id, type: 'user', name: me.name, displayName: me.displayName, fullyQualifiedName: me.fullyQualifiedName }] : []

export function DomainsPage() {
  const params = useSearchParams()
  const domains = useQuery(['domains'], listDomains)
  const counts = useQuery(['search', 'domain-asset-counts'], domainAssetCounts)
  const list = [...(domains.data?.data ?? [])].sort((a, b) => (a.fullyQualifiedName ?? '').localeCompare(b.fullyQualifiedName ?? ''))
  const fqn = params.get('fqn') ?? list[0]?.fullyQualifiedName ?? null
  const [creating, setCreating] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Domains"
        description="Business areas that own data, the data products they publish, and the assets in each."
        actions={
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus />
            New domain
          </Button>
        }
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <SideList
          title="Domains"
          query={domains}
          emptyTitle="No domains yet"
          items={list.map((d) => ({
            key: d.id,
            href: entityHref('domain', d.fullyQualifiedName ?? d.name),
            title: displayName(d),
            subtitle: d.domainType,
            meta: counts.data ? formatCount(counts.data.get(d.fullyQualifiedName ?? d.name) ?? 0) : undefined,
            active: d.fullyQualifiedName === fqn,
          }))}
        />
        {fqn ? (
          <DomainDetail key={fqn} fqn={fqn} />
        ) : domains.data ? (
          <EmptyState
            icon={<Boxes className="size-5" aria-hidden />}
            title="No domains yet"
            description="Create a domain to group data by the part of the business that owns it."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus />
                New domain
              </Button>
            }
          />
        ) : null}
      </div>
      <CreateDomainDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function DomainDetail({ fqn }: { fqn: string }) {
  const { entity: domain, query, save } = useEntity<Domain>('domain', fqn, (f) => getEntity<Domain>('domain', f, DOMAIN_FIELDS))
  const products = useQuery(['data-products', fqn], () => listDataProducts(fqn))
  const [creating, setCreating] = useState(false)
  const me = useCurrentUser()

  if (!domain) return query.error ? <ErrorState error={query.error} onRetry={query.refetch} /> : <LoadingState />
  const productList = [...(products.data?.data ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b)))

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon type="domain" className="size-10" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">{displayName(domain)}</h2>
              {domain.domainType && <Badge variant="primary">{domain.domainType}</Badge>}
            </div>
            <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{domain.fullyQualifiedName}</div>
          </div>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New data product
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <DescriptionCard className="xl:col-span-2" value={domain.description} onSave={(description) => save({ ...domain, description })} />
        <Card>
          <CardContent className="flex flex-col gap-4">
            <PeopleDetail label="Owners" people={domain.owners} empty="No owner" onSave={(owners) => save({ ...domain, owners })} />
            <PeopleDetail
              label="Experts"
              people={domain.experts}
              empty="No experts"
              usersOnly
              onSave={(experts) => save({ ...domain, experts })}
            />
            <Detail label="Domain type">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" aria-label="Change domain type">
                    {domain.domainType ?? 'Set type'}
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {DOMAIN_TYPES.map((t) => (
                    <DropdownMenuItem key={t} onSelect={() => void save({ ...domain, domainType: t }).then(() => invalidate('domains'))}>
                      {t}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Detail>
            {domain.children?.length ? (
              <Detail label="Subdomains">
                <div className="flex flex-col gap-1">
                  {domain.children.map((c) => (
                    <a key={c.id} href={entityHref('domain', c.fullyQualifiedName ?? c.name ?? c.id)} className="truncate hover:underline">
                      {displayName(c)}
                    </a>
                  ))}
                </div>
              </Detail>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data products</CardTitle>
          <CardDescription>{products.data ? `${formatCount(productList.length)} in this domain` : ' '}</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              Add data product
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {products.error && !products.data ? (
            <ErrorState error={products.error} onRetry={products.refetch} />
          ) : !products.data ? (
            <LoadingState />
          ) : !productList.length ? (
            <EmptyState
              icon={<Package className="size-5" aria-hidden />}
              title="No data products yet"
              description="A data product bundles the assets a team publishes for others to use."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {productList.map((p) => (
                <a
                  key={p.id}
                  href={entityHref('dataProduct', p.fullyQualifiedName ?? p.name)}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border p-3 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <EntityIcon type="dataProduct" className="size-7" />
                    <span className="truncate text-sm font-medium">{displayName(p)}</span>
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{p.description || 'No description yet.'}</span>
                  <OwnerList owners={p.owners} compact />
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AssetList
        title="Assets"
        filter={domainAssetsFilter(domain.fullyQualifiedName ?? fqn)}
        emptyTitle="No assets in this domain"
        emptyDescription="Assign a domain from an asset's page."
      />

      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        title={`New data product in ${displayName(domain)}`}
        description="You become its owner. Add assets from its page."
        onSubmit={async (v) => {
          const p = await createDataProduct({ ...v, domains: [domain.fullyQualifiedName ?? domain.name], owners: meRef(me) })
          invalidate('data-products')
          invalidate('search')
          navigate(entityPath('dataProduct', p.fullyQualifiedName ?? p.name))
        }}
      />
    </div>
  )
}

function CreateDomainDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const id = useId()
  const me = useCurrentUser()
  const [domainType, setDomainType] = useState<string>('Aggregate')
  useEffect(() => {
    if (open) setDomainType('Aggregate')
  }, [open])
  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New domain"
      description="You become its owner."
      onSubmit={async (v) => {
        const d = await createDomain({ ...v, domainType, owners: meRef(me) })
        invalidate('domains')
        invalidate('search')
        navigate(entityPath('domain', d.fullyQualifiedName ?? d.name))
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-type`}>Domain type</Label>
        <NativeSelect id={`${id}-type`} value={domainType} onChange={(e) => setDomainType(e.target.value)}>
          {DOMAIN_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          Source-aligned: close to where data is produced. Consumer-aligned: shaped for a use. Aggregate: combines other domains.
        </p>
      </div>
    </CreateDialog>
  )
}
