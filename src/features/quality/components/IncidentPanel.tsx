import { useState } from 'react'
import { CircleCheck, Eye, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { listEntities } from '@/features/om/api'
import { OwnerList } from '@/features/om/components/Labels'
import { Loaded } from '@/features/om/components/States'
import { displayName, timeAgo } from '@/features/om/entity'
import type { User } from '@/features/om/types'
import { invalidate, useQuery } from '@/hooks/useQuery'

import { getIncidentHistory, listIncidents, postIncidentStatus, type CreateIncidentStatus } from '../api'
import { FAILURE_REASON_LABEL, formatDateTime, INCIDENT_LABEL, SEVERITY_LABEL } from '../format'
import type { FailureReason, Severity, TestCase, TestCaseResolutionStatus } from '../types'
import { IncidentBadge, SeverityBadge } from './Badges'

const DAY = 86_400_000

/**
 * The test case's incident: the open one with its steps (New → Ack → Assigned
 * → Resolved) and actions to move it on, or past incidents when none is open.
 * Each action POSTs a TestCaseResolutionStatus, as OpenMetadata's incident manager does.
 */
export function IncidentPanel({ testCase, onChange }: { testCase: TestCase; onChange: () => void }) {
  const fqn = testCase.fullyQualifiedName ?? testCase.name
  return (
    <Card>
      <CardHeader>
        <CardTitle>Incident</CardTitle>
        <CardDescription>
          {testCase.incidentId ? 'This test is failing and has an open incident.' : 'Opened automatically when the test fails.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {testCase.incidentId ? <OpenIncident stateId={testCase.incidentId} fqn={fqn} onChange={onChange} /> : <PastIncidents fqn={fqn} />}
      </CardContent>
    </Card>
  )
}

function OpenIncident({ stateId, fqn, onChange }: { stateId: string; fqn: string; onChange: () => void }) {
  const query = useQuery(['quality', 'incident', stateId], () => getIncidentHistory(stateId))
  const [dialog, setDialog] = useState<null | 'assign' | 'resolve'>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const send = async (body: Omit<CreateIncidentStatus, 'testCaseReference'>) => {
    setBusy(true)
    setError(undefined)
    try {
      await postIncidentStatus({ testCaseReference: fqn, ...body })
      invalidate('quality')
      onChange()
      setDialog(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  return (
    <Loaded query={query}>
      {(res) => {
        const steps = [...res.data].sort((a, b) => a.timestamp - b.timestamp)
        const current = steps.at(-1)
        if (!current) return <p className="text-sm text-muted-foreground">No status recorded yet.</p>
        const assignee = [...steps].reverse().find((s) => s.testCaseResolutionStatusDetails?.assignee)
          ?.testCaseResolutionStatusDetails?.assignee
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <IncidentBadge status={current.testCaseResolutionStatusType} />
              <SeverityBadge severity={current.severity} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Assignee</span>
              {assignee ? <OwnerList owners={[assignee]} compact /> : <span className="text-sm text-muted-foreground">Unassigned</span>}
            </div>
            <Timeline steps={steps} />
            <div className="flex flex-wrap gap-2">
              {current.testCaseResolutionStatusType === 'New' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => send({ testCaseResolutionStatusType: 'Ack', severity: current.severity }).catch(() => {})}
                >
                  <Eye aria-hidden />
                  Acknowledge
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog('assign')}>
                <UserPlus aria-hidden />
                {assignee ? 'Reassign' : 'Assign'}
              </Button>
              <Button size="sm" variant="soft" disabled={busy} onClick={() => setDialog('resolve')}>
                <CircleCheck aria-hidden />
                Resolve
              </Button>
            </div>
            {error && !dialog && <p className="text-sm text-destructive">{error}</p>}
            <AssignDialog
              open={dialog === 'assign'}
              onOpenChange={(o) => setDialog(o ? 'assign' : null)}
              severity={current.severity}
              busy={busy}
              error={error}
              onSubmit={send}
            />
            <ResolveDialog
              open={dialog === 'resolve'}
              onOpenChange={(o) => setDialog(o ? 'resolve' : null)}
              severity={current.severity}
              busy={busy}
              error={error}
              onSubmit={send}
            />
          </div>
        )
      }}
    </Loaded>
  )
}

function Timeline({ steps }: { steps: TestCaseResolutionStatus[] }) {
  return (
    <ol className="flex flex-col gap-3 border-l pl-4">
      {steps.map((s) => {
        const d = s.testCaseResolutionStatusDetails
        return (
          <li key={s.id} className="relative flex flex-col gap-0.5">
            <span aria-hidden className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-border" />
            <span className="text-sm">
              <span className="font-medium">{INCIDENT_LABEL[s.testCaseResolutionStatusType]}</span>
              {s.updatedBy && <span className="text-muted-foreground"> by {displayName(s.updatedBy)}</span>}
              {d?.assignee && <span className="text-muted-foreground"> to {displayName(d.assignee)}</span>}
            </span>
            {d?.testCaseFailureReason && (
              <span className="text-xs text-muted-foreground">
                {FAILURE_REASON_LABEL[d.testCaseFailureReason]}
                {d.testCaseFailureComment && `: ${d.testCaseFailureComment}`}
              </span>
            )}
            <span className="text-xs text-muted-foreground" title={formatDateTime(s.timestamp)}>
              {timeAgo(s.timestamp)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function PastIncidents({ fqn }: { fqn: string }) {
  const [range] = useState(() => ({ startTs: Date.now() - 90 * DAY, endTs: Date.now() + DAY }))
  const query = useQuery(['quality', 'incidents', 'test', fqn], () => listIncidents({ testCaseFQN: fqn, latest: true, ...range }))
  return (
    <Loaded query={query}>
      {(res) =>
        res.data.length ? (
          <div className="flex flex-col gap-3">
            <span className="text-xs text-muted-foreground">Resolved in the last 90 days</span>
            <IncidentHistoryList incidents={res.data.sort((a, b) => b.timestamp - a.timestamp)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No incidents in the last 90 days.</p>
        )
      }
    </Loaded>
  )
}

function IncidentHistoryList({ incidents }: { incidents: TestCaseResolutionStatus[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {incidents.map((s) => {
        const d = s.testCaseResolutionStatusDetails
        return (
          <li key={s.id} className="flex flex-col gap-1 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <IncidentBadge status={s.testCaseResolutionStatusType} />
              <SeverityBadge severity={s.severity} />
              <span className="ml-auto text-xs text-muted-foreground">{timeAgo(s.timestamp)}</span>
            </div>
            {d?.testCaseFailureReason && (
              <span className="text-xs text-muted-foreground">
                {FAILURE_REASON_LABEL[d.testCaseFailureReason]}
                {d.testCaseFailureComment && `: ${d.testCaseFailureComment}`}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const SEVERITIES = Object.keys(SEVERITY_LABEL) as Severity[]

function SeveritySelect({ value, onChange }: { value: Severity | ''; onChange: (s: Severity | '') => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="incident-severity">Severity</Label>
      <NativeSelect id="incident-severity" value={value} onChange={(e) => onChange(e.target.value as Severity | '')}>
        <option value="">Not set</option>
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {SEVERITY_LABEL[s]}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

interface ActionDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  severity?: Severity
  busy: boolean
  error?: string
  onSubmit: (body: Omit<CreateIncidentStatus, 'testCaseReference'>) => Promise<void>
}

function AssignDialog({ open, onOpenChange, severity, busy, error, onSubmit }: ActionDialogProps) {
  const users = useQuery(
    open ? ['quality', 'users'] : null,
    () => listEntities<User>('user', { fields: 'teams', isBot: 'false', limit: 500 }),
    { staleMs: 5 * 60_000 },
  )
  const [userId, setUserId] = useState('')
  const [sev, setSev] = useState<Severity | ''>(severity ?? '')
  const people = (users.data?.data ?? []).filter((u) => !u.isBot)
  const user = people.find((u) => u.id === userId)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign incident</DialogTitle>
          <DialogDescription>The assignee works on the failure until it is resolved.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="incident-assignee">Assignee</Label>
            <NativeSelect id="incident-assignee" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={!people.length}>
              <option value="">{users.loading ? 'Loading…' : 'Choose a person'}</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {displayName(u)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <SeveritySelect value={sev} onChange={setSev} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!user || busy}
            onClick={() =>
              onSubmit({
                testCaseResolutionStatusType: 'Assigned',
                testCaseResolutionStatusDetails: {
                  assignee: { id: user!.id, type: 'user', name: user!.name, fullyQualifiedName: user!.fullyQualifiedName },
                },
                severity: sev || undefined,
              }).catch(() => {})
            }
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResolveDialog({ open, onOpenChange, severity, busy, error, onSubmit }: ActionDialogProps) {
  const [reason, setReason] = useState<FailureReason>('MissingData')
  const [comment, setComment] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve incident</DialogTitle>
          <DialogDescription>Record why the test failed. The next failure opens a new incident.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="incident-reason">Reason</Label>
            <NativeSelect id="incident-reason" value={reason} onChange={(e) => setReason(e.target.value as FailureReason)}>
              {(Object.keys(FAILURE_REASON_LABEL) as FailureReason[]).map((r) => (
                <option key={r} value={r}>
                  {FAILURE_REASON_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="incident-comment">Comment</Label>
            <Textarea
              id="incident-comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What happened and what fixed it"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!comment.trim() || busy}
            onClick={() =>
              onSubmit({
                testCaseResolutionStatusType: 'Resolved',
                testCaseResolutionStatusDetails: { testCaseFailureReason: reason, testCaseFailureComment: comment.trim() },
                severity,
              }).catch(() => {})
            }
          >
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
