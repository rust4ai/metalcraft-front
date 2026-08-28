import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, MessageSquareText, Pencil, UserX, X } from 'lucide-react'
import { automations } from '@/rpc'
import { FlowGraph } from './FlowGraph'
import { FlowEditor } from './FlowEditor'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { useFleet } from '@/stores/fleet'
import { useSessions } from '@/stores/sessions'
import { useUi } from '@/stores/ui'
import { describeAgent, explain, provenanceOf } from '../runProvenance'
import type { Flow, FlowRun, FlowRunDetail, SavedFlow } from '@/types'

/**
 * What an automation does, and what it did.
 *
 * Two questions, one surface, because they are answered by the same picture: the
 * graph shows the shape, and a run laid over it shows the path taken through
 * that shape. Neither was answerable before without reading JSON off the pod's
 * disk — `GET /flows` stops at `node_count`.
 *
 * A run is read against **its own snapshot** of the flow when it has one. A run
 * that paused yesterday took the graph as it was then, and replaying it onto a
 * since-edited flow would draw a path through nodes that did not exist.
 */
export function FlowGraphPanel({
  flow,
  runs,
  onClose,
}: {
  flow: Flow
  /** This flow's runs, newest first — from the automations store. */
  runs: FlowRun[]
  onClose: () => void
}) {
  const [saved, setSaved] = useState<SavedFlow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<FlowRunDetail | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let live = true
    setSaved(null)
    setError(null)
    automations
      .get(flow.id)
      .then((f) => live && setSaved(f))
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [flow.id])

  useEffect(() => {
    if (!runId) {
      setRun(null)
      return
    }
    let live = true
    automations
      .run_detail(runId)
      .then((r) => live && setRun(r))
      // A run that will not load leaves the structural graph on screen rather
      // than replacing it with an error: the flow is still worth reading.
      .catch(() => live && setRun(null))
    return () => {
      live = false
    }
  }, [runId])

  // The graph the run actually took, when the run carried one.
  const definition = (run?.flow ?? saved)?.flow
  const steps = run?.steps ?? []
  const visited = steps.map((s) => s.node_id)
  const failedAt = steps.find((s) => s.outcome === 'failed')?.node_id
  const waitingAt = run?.status === 'paused' ? run.current_node_id : undefined
  const stale = Boolean(run && !run.flow)

  if (editing && saved) {
    return (
      <FlowEditor
        flow={saved}
        onSaved={(next) => {
          setSaved(next)
          // Back to reading. Staying in the editor after a save invites a second
          // edit on top of one nobody has looked at yet.
          setEditing(false)
        }}
        onClose={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{flow.name}</div>
          <div className="truncate text-xs text-ink-2">
            {flow.node_count === 1 ? '1 step' : `${flow.node_count} steps`}
            {!flow.v2 && ' · legacy v1'}
          </div>
        </div>

        {runs.length > 0 && (
          <select
            value={runId ?? ''}
            onChange={(e) => setRunId(e.target.value || null)}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-2"
            aria-label="Show a run on the graph"
          >
            <option value="">No run — structure only</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.status} · {new Date(r.created_at).toLocaleString()}
              </option>
            ))}
          </select>
        )}

        {/* Editing a *run's* snapshot would be editing history; the button is
            only offered against the flow as it is now. */}
        {saved && !run && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {stale && (
        <p className="flex items-center gap-1.5 border-b border-line bg-orange-tint px-4 py-1.5 text-[11.5px] text-orange">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          This run kept no snapshot of the flow, so it is drawn on the current graph — which may
          have changed since.
        </p>
      )}

      <div className="min-h-0 flex-1">
        {error ? (
          <p className="p-6 text-center text-[12px] text-red">{error}</p>
        ) : !definition ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the graph…
          </div>
        ) : (
          <FlowGraph
            definition={definition}
            visited={visited}
            failedAt={failedAt}
            waitingAt={waitingAt}
          />
        )}
      </div>

      {run && <RanAs run={run} />}
      {steps.length > 0 && <StepTrace steps={steps} />}
    </div>
  )
}

/**
 * The agent a run ran as, and the way into the conversation it wrote.
 *
 * The step trace says which nodes fired; this says where to read what they
 * actually *said*. That is the better answer to "why did it do that at 3am",
 * and the one node ids cannot give.
 */
function RanAs({ run }: { run: FlowRunDetail }) {
  const instances = useFleet((s) => s.instances)
  const loaded = useFleet((s) => s.loaded)
  const go = useUi((s) => s.go)
  const openAt = useSessions((s) => s.openAt)

  // `null` until the fleet has loaded — not an empty roster. See `provenanceOf`.
  const agents = loaded ? new Map(instances.map((i) => [i.id, i.name])) : null
  const provenance = provenanceOf(run, agents)
  const note = explain(provenance)

  const openable = provenance.kind === 'conversation' || provenance.kind === 'silent'

  return (
    <div className="shrink-0 border-t border-line bg-inset px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-3">Ran as</span>
        {openable ? (
          <button
            type="button"
            onClick={() => {
              go({ kind: 'session', instanceId: provenance.instanceId })
              // Only a conversation run has somewhere specific to land; a silent
              // one opens the agent on whatever it was last saying.
              if (provenance.kind === 'conversation') {
                void openAt(provenance.instanceId, provenance.chatId)
              }
            }}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11.5px] text-accent transition-colors hover:bg-hover"
          >
            <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {provenance.kind === 'conversation'
                ? `Read what ${describeAgent(provenance)} said`
                : `Open ${describeAgent(provenance)}`}
            </span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-2">
            <UserX className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{describeAgent(provenance)}</span>
          </span>
        )}
      </div>
      {note && <p className="mt-1 text-[11px] leading-snug text-ink-3">{note}</p>}
    </div>
  )
}

/**
 * The run as a list, under the run as a picture.
 *
 * The graph says where it went; this says what happened at each stop — which
 * handle a branch chose, what a failure said. A canvas cannot hold that text
 * without becoming unreadable, and a trace cannot show shape.
 */
function StepTrace({ steps }: { steps: NonNullable<FlowRunDetail['steps']> }) {
  return (
    <div className="max-h-44 shrink-0 overflow-y-auto border-t border-line bg-inset px-4 py-2">
      {steps.map((s, i) => {
        const routed = s.outcome.startsWith('routed:')
        return (
          <div key={`${s.node_id}-${i}`} className="flex items-baseline gap-2 py-0.5 text-[11.5px]">
            <span className="w-5 shrink-0 text-right font-mono text-ink-3">{i + 1}</span>
            <span className="shrink-0 font-medium text-ink">{s.node_id}</span>
            <span
              className={cn(
                'shrink-0 rounded-chip px-1.5 text-[10px]',
                s.outcome === 'failed'
                  ? 'bg-red-tint text-red'
                  : routed
                    ? 'bg-orange-tint text-orange'
                    : 'bg-hover text-ink-2',
              )}
            >
              {routed ? s.outcome.slice('routed:'.length) : s.outcome}
            </span>
            {s.detail && <span className="truncate text-ink-2">{s.detail}</span>}
          </div>
        )
      })}
    </div>
  )
}
