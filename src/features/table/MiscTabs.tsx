import { useState } from 'react'
import { Clock, MessageSquare, Megaphone, ThumbsUp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Table as T, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { createThread, getSampleData, getTableQueries, getThreads, getVersions, replyToThread } from '@/features/om/api'
import { displayName, formatDate, refHref, timeAgo } from '@/features/om/entity'
import { OwnerAvatar } from '@/features/om/components/Labels'
import { Markdown } from '@/features/om/components/Markdown'
import { EmptyState, Loaded } from '@/features/om/components/States'
import type { EntityBase, Table, Thread } from '@/features/om/types'
import { useCurrentUser } from '@/features/om/useEntity'

/** The table page's smaller tabs: sample data, queries, activity, version history, view definition. */

export function SampleDataTab({ table }: { table: Table }) {
  const q = useQuery(['sample-data', table.id], () => getSampleData(table.id))
  return (
    <Loaded query={q}>
      {(t) => {
        const s = t.sampleData
        if (!s?.rows.length)
          return (
            <EmptyState
              title="No sample data"
              description="Enable sample data in the profiler ingestion to keep a few rows here. Sample rows are stored in OpenMetadata, so leave it off for sensitive tables."
            />
          )
        return (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{s.rows.length} rows captured by the profiler.</p>
            <div className="overflow-x-auto rounded-xl border">
              <T>
                <TableHeader>
                  <TableRow>
                    {s.columns.map((c) => (
                      <TableHead key={c} className="font-mono text-xs">
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.rows.map((r, i) => (
                    <TableRow key={i}>
                      {r.map((v, j) => (
                        <TableCell key={j} className="font-mono text-xs whitespace-nowrap tabular-nums">
                          {v === null || v === undefined ? <span className="text-muted-foreground">null</span> : String(v)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </T>
            </div>
          </div>
        )
      }}
    </Loaded>
  )
}

export function QueriesTab({ table }: { table: Table }) {
  const q = useQuery(['table-queries', table.id], () => getTableQueries(table.id))
  return (
    <Loaded query={q}>
      {(res) =>
        !res.data.length ? (
          <EmptyState
            title="No queries recorded"
            description="The usage ingestion reads BigQuery's job history (INFORMATION_SCHEMA.JOBS) and records queries that touch this table."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {res.data.map((query) => (
              <Card key={query.id} className="gap-3 py-4">
                <CardContent className="flex flex-col gap-3 px-4">
                  <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                    {query.query}
                  </pre>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {query.users?.map((u) => (
                      <a key={u.id} href={refHref(u)} className="flex items-center gap-1.5 hover:underline">
                        <OwnerAvatar owner={u} className="size-5" />
                        {displayName(u)}
                      </a>
                    ))}
                    {query.queryDate && <span>{timeAgo(query.queryDate)}</span>}
                    {query.duration !== undefined && (
                      <span className="flex items-center gap-1 tabular-nums">
                        <Clock className="size-3.5" aria-hidden />
                        {query.duration.toFixed(1)} s
                      </span>
                    )}
                    {query.votes?.upVotes ? (
                      <span className="flex items-center gap-1 tabular-nums">
                        <ThumbsUp className="size-3.5" aria-hidden />
                        {query.votes.upVotes}
                      </span>
                    ) : null}
                    {(query.queryUsedIn?.length ?? 0) > 1 && (
                      <span>
                        Also uses{' '}
                        {query
                          .queryUsedIn!.filter((r) => r.id !== table.id)
                          .map((r) => displayName(r))
                          .join(', ')}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      }
    </Loaded>
  )
}

export function ActivityTab({ entityType, entity }: { entityType: string; entity: EntityBase }) {
  const fqn = entity.fullyQualifiedName!
  const me = useCurrentUser()
  const q = useQuery(['threads', entityType, fqn], () => getThreads(entityType, fqn))
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const post = async () => {
    if (!draft.trim() || !me) return
    setPosting(true)
    try {
      await createThread(entityType, fqn, draft.trim())
      setDraft('')
      invalidate('threads', entityType, fqn)
    } finally {
      setPosting(false)
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-3 py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <Label htmlFor="new-thread">Start a conversation</Label>
          <Textarea
            id="new-thread"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask a question or leave a note for the owners…"
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={!draft.trim() || posting || !me} onClick={post}>
              Post
            </Button>
          </div>
        </CardContent>
      </Card>
      <Loaded query={q}>
        {(res) =>
          !res.data.length ? (
            <EmptyState title="No conversations yet" />
          ) : (
            <div className="flex flex-col gap-4">
              {res.data.map((t) => (
                <ThreadCard key={t.id} thread={t} entityType={entityType} fqn={fqn} />
              ))}
            </div>
          )
        }
      </Loaded>
    </div>
  )
}

function ThreadCard({ thread, entityType, fqn }: { thread: Thread; entityType: string; fqn: string }) {
  const me = useCurrentUser()
  const [reply, setReply] = useState('')
  const [open, setOpen] = useState(false)
  const author = (name: string) => ({ id: name, type: 'user', name })
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm font-normal">
          <OwnerAvatar owner={author(thread.createdBy)} />
          <span className="font-medium">{thread.createdBy}</span>
          <span className="text-xs text-muted-foreground">{timeAgo(thread.threadTs)}</span>
          {thread.type === 'Announcement' && (
            <Badge variant="info">
              <Megaphone aria-hidden />
              Announcement
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <Markdown>{thread.message}</Markdown>
        {thread.posts.length > 0 && (
          <div className="flex flex-col gap-3 border-l-2 pl-4">
            {thread.posts.map((p) => (
              <div key={p.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm">
                  <OwnerAvatar owner={author(p.from)} className="size-5" />
                  <span className="font-medium">{p.from}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(p.postTs)}</span>
                </div>
                <Markdown>{p.message}</Markdown>
              </div>
            ))}
          </div>
        )}
        {open ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`reply-${thread.id}`} className="sr-only">
              Reply
            </Label>
            <Textarea id={`reply-${thread.id}`} rows={2} value={reply} onChange={(e) => setReply(e.target.value)} autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!reply.trim() || !me}
                onClick={async () => {
                  await replyToThread(thread.id, reply.trim())
                  setReply('')
                  setOpen(false)
                  invalidate('threads', entityType, fqn)
                }}
              >
                Reply
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => setOpen(true)}>
            <MessageSquare />
            Reply
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function VersionsTab({ entityType, entity }: { entityType: string; entity: EntityBase }) {
  const q = useQuery(['versions', entityType, entity.id, entity.version], () => getVersions(entityType, entity.id))
  return (
    <Loaded query={q}>
      {(res) => {
        const versions = res.versions.map((v) => JSON.parse(v) as EntityBase)
        return (
          <ol className="relative flex flex-col gap-4 border-l pl-6">
            {versions.map((v) => {
              const ch = v.changeDescription
              const fields = [
                ...(ch?.fieldsAdded ?? []).map((f) => ['added', f.name] as const),
                ...(ch?.fieldsUpdated ?? []).map((f) => ['changed', f.name] as const),
                ...(ch?.fieldsDeleted ?? []).map((f) => ['removed', f.name] as const),
              ]
              return (
                <li key={v.version} className="relative">
                  <span
                    className="absolute top-1.5 -left-[1.9rem] size-2.5 rounded-full border-2 border-background bg-primary"
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline" className="font-mono">
                      v{v.version}
                    </Badge>
                    <span className="font-medium">{v.updatedBy}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(v.updatedAt)}</span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {fields.length
                      ? fields.map(([kind, name]) => `${kind} ${name.replace(/\./g, ' › ')}`).join(', ')
                      : v.version === 0.1
                        ? 'Created'
                        : 'No field changes recorded'}
                  </div>
                </li>
              )
            })}
          </ol>
        )
      }}
    </Loaded>
  )
}

export function DefinitionTab({ sql }: { sql: string }) {
  return <pre className="overflow-x-auto rounded-xl border bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{sql}</pre>
}
