import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/features/om/components/States'
import { typeInfo } from '@/features/openmetadata/catalog'
import { EntityList } from '@/features/openmetadata/EntityList'
import { EntityView } from '@/features/openmetadata/EntityView'
import { Overview } from '@/features/openmetadata/Overview'
import { TypeNav } from '@/features/openmetadata/TypeNav'
import { href, useSearchParams } from '@/lib/router'

/**
 * All of OpenMetadata's standard on one page: every entity type it defines, browsed and edited
 * through its REST API. No `type`: the overview. `?type=`: that type's entities. `?type=&fqn=`:
 * one entity, with everything OpenMetadata holds about it.
 */
export function OpenMetadataPage() {
  const params = useSearchParams()
  const type = params.get('type')
  const fqn = params.get('fqn')
  const info = typeInfo(type)

  let body
  if (!type) body = <Overview />
  else if (!info)
    body = (
      <EmptyState
        title={`OpenMetadata has no "${type}" type here`}
        action={
          <Button variant="outline" asChild>
            <a href={href('/openmetadata')}>All entity types</a>
          </Button>
        }
      />
    )
  else if (fqn) body = <EntityView key={`${info.type}|${fqn}`} info={info} fqn={fqn} />
  else body = <EntityList key={info.type} info={info} />

  return (
    <div className="flex flex-col gap-8">
      {!(info && fqn) && (
        <PageHeader
          title="OpenMetadata"
          description="Every entity type in OpenMetadata's standard, as OpenMetadata stores it: browse any of them, see every field and relationship, and edit them."
        />
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <TypeNav current={info ? info.type : null} />
        <div className="min-w-0">{body}</div>
      </div>
    </div>
  )
}
