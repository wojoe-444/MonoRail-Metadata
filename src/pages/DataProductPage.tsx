import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  addDataProductAssets,
  DATA_PRODUCT_FIELDS,
  dataProductAssetsFilter,
  removeDataProductAssets,
  type BulkOperationResult,
} from '@/features/governance/api'
import { AddAssetsDialog, AssetList } from '@/features/governance/components/AssetList'
import { DescriptionCard, PeopleDetail } from '@/features/governance/components/Parts'
import { getEntity } from '@/features/om/api'
import { EntityHeader } from '@/features/om/components/EntityHeader'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import type { DataProduct, EntityReference } from '@/features/om/types'
import { useEntity } from '@/features/om/useEntity'
import { invalidate } from '@/hooks/useQuery'
import { useSearchParams } from '@/lib/router'

/** A bulk asset call can answer 200 with failed rows; surface them. */
function checkBulk(res: BulkOperationResult | undefined) {
  if (res?.failedRequest?.length)
    throw new Error(
      res.failedRequest
        .map((f) => f.message)
        .filter(Boolean)
        .join('; ') || 'Some assets could not be changed.',
    )
}

export function DataProductPage() {
  const fqn = useSearchParams().get('fqn')
  const {
    entity: product,
    query,
    save,
  } = useEntity<DataProduct & { reviewers?: EntityReference[] }>('dataProduct', fqn, (f) =>
    getEntity('dataProduct', f, DATA_PRODUCT_FIELDS),
  )
  const [adding, setAdding] = useState(false)

  if (!fqn) return <EmptyState title="No data product selected" description="Open a data product from its domain." />
  if (!product) return query.error ? <ErrorState error={query.error} onRetry={query.refetch} /> : <LoadingState />

  const productFqn = product.fullyQualifiedName ?? product.name
  const refresh = () => {
    invalidate('search')
    invalidate('data-products')
  }

  return (
    <div className="flex flex-col gap-8">
      <EntityHeader
        entity={product}
        entityType="dataProduct"
        parents={(product.domains ?? []).map((d) => ({ ...d, type: 'domain' }))}
        fields={['owners', 'domains', 'tags']}
        onSave={save}
        onFollowChange={query.refetch}
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <DescriptionCard value={product.description} onSave={(description) => save({ ...product, description })} />
          <AssetList
            title="Assets"
            filter={dataProductAssetsFilter(productFqn)}
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus />
                Add assets
              </Button>
            }
            onRemove={async (a) => {
              checkBulk(await removeDataProductAssets(productFqn, [{ id: a.id, type: a.entityType }]))
              refresh()
            }}
            emptyTitle="No assets yet"
            emptyDescription="Add the tables this data product publishes."
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>People</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <PeopleDetail
              label="Experts"
              people={product.experts}
              empty="No experts"
              usersOnly
              onSave={(experts) => save({ ...product, experts })}
            />
            <PeopleDetail
              label="Reviewers"
              people={product.reviewers}
              empty="No reviewers"
              onSave={(reviewers) => save({ ...product, reviewers })}
            />
          </CardContent>
        </Card>
      </div>

      <AddAssetsDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add assets"
        exclude={dataProductAssetsFilter(productFqn)}
        onAdd={async (assets) => {
          checkBulk(await addDataProductAssets(productFqn, assets))
          refresh()
        }}
      />
    </div>
  )
}
