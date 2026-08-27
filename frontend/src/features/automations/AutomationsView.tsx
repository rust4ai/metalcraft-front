import { lazy, Suspense, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Loader2,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  Workflow,
  Zap,
} from 'lucide-react'
import { useAutomations, pausedFirst } from '@/stores/automations'
import { ArmDialog } from './ArmDialog'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { relative } from '@/features/fleet/FleetView'
import { cn } from '@/lib/cn'
import type { Flow, FlowRun, SavedFlow, ScheduledFlow } from '@/types'

/**
 * PLAN §10.7 — what this pod is set up to do on its own.
 *
 * Two sections, and the split is the design (UI_PLAN S9): **an armed automation
 * is an agent** and lives in the fleet, so this view is not a second agent list.
 * It holds the two things the fleet structurally cannot show — flows nobody has
 * scheduled yet (which is most of them: packs install flows scheduling nothing),
 * and **runs**, which are neither flow nor agent and can sit waiting on a human
 * indefinitely.
 *
 * The pod keeps the work and the timing apart, and so does this: a flow card is
 * the work, and each row under it is one schedule pointing at it.
 */
/**
 * Loaded only when someone opens a graph.
 *
 * `@xyflow/react` is a large dependency and this is the one screen that needs
 * it. Imported eagerly it rode along with the automations list — into the app's
 * startup path, and into every test that renders this view, where it turned
 * sub-second renders into five-second timeouts.
 */
const FlowGraphPanel = lazy(() =>
  import('./graph/FlowGraphPanel').then((m) => ({ default: m.FlowGraphPanel })),
)
const FlowEditor = lazy(() =>
  import('./graph/FlowEditor').then((m) => ({ default: m.FlowEditor })),
)
const NewFlowDialog = lazy(() =>
  import('./graph/NewFlowDialog').then((m) => ({ default: m.NewFlowDialog })),
)

/** The one wait shared by every lazily-loaded graph surface. */
function Opening() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading the graph…
    </div>
  )
}

export function AutomationsView() {
  const { flows, runs, loading, error, load } = useAutomations()
  // Held here rather than per-row so the dialog survives the list re-rendering
  // underneath it — arming reloads the flows, and a row-owned modal would
  // unmount itself mid-confirm.
  const [arming, setArming] = useState<Flow | null>(null)
  // Same reasoning as `arming`: held above the list so reloading the flows
  // underneath it cannot close the graph someone is reading.
  const [viewing, setViewing] = useState<Flow | null>(null)
  const [creating, setCreating] = useState(false)
  /** A flow that exists only on screen until the editor saves it. Abandoning one
   *  leaves nothing behind, which creating it up front would not. */
  const [drafting, setDrafting] = useState<SavedFlow | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const waiting = runs.filter((r) => r.status === 'paused')

  if (drafting) {
    return (
      <Suspense fallback={<Opening />}>
        <FlowEditor
          flow={drafting}
          onSaved={(saved) => {
            setDrafting(null)
            // The list has a flow it has never heard of until this lands.
            void load()
            setViewing({
              id: saved.id,
              name: saved.name,
              node_count: saved.flow.nodes.length,
              created_at: saved.created_at,
              updated_at: saved.updated_at,
              v2: true,
              preset: '',
              scheduled_count: 0,
              enabled_count: 0,
            })
          }}
          onClose={() => setDrafting(null)}
        />
      </Suspense>
    )
  }

  if (viewing) {
    return (
      <Suspense fallback={<Opening />}>
        <FlowGraphPanel
          flow={viewing}
          runs={runs.filter((r) => r.flow_id === viewing.id)}
          onClose={() => setViewing(null)}
        />
      </Suspense>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Automations</h1>
          <p className="text-sm text-ink-2">
            {flows.length === 0
              ? 'Nothing on this pod'
              : `${flows.length} automation${flows.length === 1 ? '' : 's'}, ${
                  flows.filter((f) => f.enabled_count > 0).length
                } running on a timer`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          Refresh
        </Button>
      </header>

      {error && <p className="mb-4 text-sm text-red">{error}</p>}

      {/* Waiting runs come first and unconditionally: a run paused on an approval
          is the only thing here that is actively blocked on a person. */}
      {waiting.length > 0 && (
        <section className="mb-8">
          <SectionTitle icon={<PauseCircle className="h-3.5 w-3.5" />} label="Waiting on you" />
          <div className="space-y-2">
            {waiting.map((run) => (
              <RunRow key={run.id} run={run} flows={flows} />
            ))}
          </div>
        </section>
      )}

      {flows.length === 0 && !loading ? (
        <Empty />
      ) : (
        <div className="space-y-3">
          {flows.map((flow) => (
            <FlowCard key={flow.id} flow={flow} onArm={setArming} onOpen={setViewing} />
          ))}
        </div>
      )}

      <ArmDialog flow={arming} onClose={() => setArming(null)} />

      {creating && (
        <Suspense fallback={null}>
          <NewFlowDialog
            takenIds={flows.map((f) => f.id)}
            onStart={(draft) => {
              setCreating(false)
              setDrafting(draft)
            }}
            onClose={() => setCreating(false)}
          />
        </Suspense>
      )}

      {runs.length > waiting.length && (
        <section className="mt-8">
          <SectionTitle icon={<Clock className="h-3.5 w-3.5" />} label="Recent runs" />
          <div className="space-y-2">
            {pausedFirst(runs)
              .filter((r) => r.status !== 'paused')
              .slice(0, 10)
              .map((run) => (
                <RunRow key={run.id} run={run} flows={flows} />
              ))}
          </div>
        </section>
      )}
    </div>
  )
}

function FlowCard({
  flow,
  onArm,
  onOpen,
}: {
  flow: Flow
  onArm: (flow: Flow) => void
  onOpen: (flow: Flow) => void
}) {
  const { run, busy, schedulesOf } = useAutomations()
  const go = useUi((s) => s.go)
  const running = busy[flow.id] ?? false
  const schedules = schedulesOf(flow.id)

  return (
    <Card className="p-0">
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{flow.name}</span>
            {/* Unscheduled is a state, not an absence — a pack installs its
                flows scheduling nothing, and someone schedules them
                deliberately. Distinct from "scheduled but paused", below. */}
            {schedules.length === 0 && (
              <span className="shrink-0 rounded-chip bg-inset px-1.5 py-px text-[10px] text-ink-3">
                not scheduled
              </span>
            )}
            {!flow.v2 && (
              <span className="shrink-0 rounded-chip bg-inset px-1.5 py-px text-[10px] text-ink-3">
                legacy
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[11px] text-ink-3">
            runs as {flow.preset} · {flow.node_count} nodes · edited {relative(flow.updated_at)}
          </div>
        </div>
        {/* Running an armed automation by hand *is* its scheduled firing — same
            agent, same memory — so this lands you in the conversation it just
            wrote rather than reporting a status code. */}
        {/* The only way to see what an automation actually does. `list_flows`
            stops at a node count, so before this the answer lived in JSON on the
            pod's disk. */}
        <Button variant="ghost" size="sm" onClick={() => onOpen(flow)}>
          <Workflow className="h-4 w-4" />
          View
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={running}
          onClick={() =>
            void run(flow.id).then((summary) => {
              const armed = schedules.find((s) => s.instance_id)?.instance_id
              if (summary?.chat_id && armed) go({ kind: 'session', instanceId: armed })
            })
          }
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Running…' : 'Run now'}
        </Button>
      </div>
      <div className="mt-3 divide-y divide-line border-t border-line">
        {schedules.map((s) => (
          <ScheduleRow key={s.id} schedule={s} />
        ))}
        <button
          type="button"
          onClick={() => onArm(flow)}
          className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-[12.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
        >
          <Plus className="h-3.5 w-3.5" />
          {schedules.length === 0 ? 'Run this on a schedule' : 'Add another schedule'}
        </button>
      </div>
    </Card>
  )
}

function ScheduleRow({ schedule }: { schedule: ScheduledFlow }) {
  const { disarm, setEnabled, busy } = useAutomations()
  const go = useUi((s) => s.go)
  const instances = useFleet((s) => s.instances)
  const working = busy[schedule.id] ?? false
  // The pod names the schedule's agent, but the fleet holds the current name —
  // an agent renamed after arming should not read stale here.
  const agentName =
    instances.find((i) => i.id === schedule.instance_id)?.name ?? schedule.instance_name

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          {/* Never the id, which is deliberately meaningless (`sf_9c31a4`). */}
          <span className={cn('truncate', !schedule.enabled && 'text-ink-3')}>
            {schedule.schedule.name || schedule.description}
          </span>
          {!schedule.enabled && (
            <span className="shrink-0 rounded-chip bg-inset px-1.5 py-px text-[10px] text-ink-3">
              paused
            </span>
          )}
          {schedule.description.startsWith('Invalid') && (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red" />
          )}
        </div>
        {/* The pod's own wording, verbatim — including "Invalid cron …", which is
            the difference between a schedule that looks empty and one that looks
            broken. */}
        <div className="truncate text-[11.5px] text-ink-3">
          {schedule.description}
          {schedule.next_fire_at && ` · next ${new Date(schedule.next_fire_at).toLocaleString()}`}
        </div>
      </div>

      {schedule.instance_id && (
        <button
          type="button"
          onClick={() =>
            schedule.instance_id && go({ kind: 'session', instanceId: schedule.instance_id })
          }
          className="max-w-[10rem] shrink-0 truncate rounded-chip bg-inset px-2 py-1 text-[11.5px] text-ink-2 hover:bg-hover hover:text-ink"
          title="Open this agent"
        >
          {agentName ?? 'its agent'}
        </button>
      )}

      {/* Pause is the reversible one and sits first. Both keep the agent and
          everything it has learned — the difference is only whether the
          schedule survives, which is why neither needs a confirmation. */}
      <Button
        variant="ghost"
        size="sm"
        disabled={working}
        onClick={() => void setEnabled(schedule.id, !schedule.enabled)}
      >
        {working ? '…' : schedule.enabled ? 'Pause' : 'Resume'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={working}
        onClick={() => void disarm(schedule.id)}
      >
        Remove
      </Button>
    </div>
  )
}

function RunRow({ run, flows }: { run: FlowRun; flows: Flow[] }) {
  const go = useUi((s) => s.go)
  const { resume, busy } = useAutomations()
  const name = flows.find((f) => f.id === run.flow_id)?.name ?? run.flow_id
  const paused = run.status === 'paused'
  const deciding = busy[run.id] ?? false
  // A `wait` pause resumes on time, not on a decision — offering "after" as a
  // button would let someone skip the wait they asked for. Only an approval's
  // handles are choices a person is meant to make.
  const decisions = run.pause?.reason === 'approval' ? (run.pause.resume_handles ?? []) : []

  return (
    <Card className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="truncate font-medium">{name}</span>
          <span
            className={
              paused
                ? 'shrink-0 rounded-chip bg-inset px-1.5 py-px text-[10px] text-orange'
                : 'shrink-0 rounded-chip bg-inset px-1.5 py-px text-[10px] text-ink-3'
            }
          >
            {run.status}
          </span>
        </div>
        <div className="truncate text-[11.5px] text-ink-3">
          {run.pause?.message ?? `at ${run.current_node_id}`} · {relative(run.updated_at)}
        </div>
        {run.warnings.length > 0 && (
          <div className="truncate text-[11.5px] text-orange">{run.warnings[0]}</div>
        )}
      </div>
      {/* The decision, taken here. The run picks up in the conversation it
          paused in, so an approval answered three days later is a continuation
          rather than a request the agent has no context for. */}
      {decisions.map((handle, i) => (
        <Button
          key={handle}
          variant={i === 0 ? 'primary' : 'ghost'}
          size="sm"
          disabled={deciding}
          onClick={() => void resume(run.id, handle)}
        >
          {deciding ? '…' : handle}
        </Button>
      ))}
      {run.instance_id && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => run.instance_id && go({ kind: 'session', instanceId: run.instance_id })}
        >
          Open agent
        </Button>
      )}
    </Card>
  )
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
      <span className="text-ink-3">{icon}</span>
      {label}
    </div>
  )
}

function Empty() {
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      <Zap className="h-6 w-6 text-ink-3" />
      <div>
        <p className="text-sm font-medium">No automations on this pod</p>
        <p className="mt-1 max-w-md text-[12.5px] text-ink-2">
          An automation is an agent doing scheduled work — a flow, plus a time to run it.
          Agent packs bring the flows; scheduling one is what creates the agent that runs it.
        </p>
      </div>
    </Card>
  )
}
