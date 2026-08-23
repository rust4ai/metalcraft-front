import { useEffect } from 'react'
import { AlertTriangle, Clock, PauseCircle, RefreshCw, Zap } from 'lucide-react'
import { useAutomations, pausedFirst } from '@/stores/automations'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { relative } from '@/features/fleet/FleetView'
import type { Flow, FlowRun, FlowSchedule } from '@/types'

/**
 * PLAN §10.7 — what this pod is set up to do on its own.
 *
 * Two sections, and the split is the design (UI_PLAN S9): **an armed automation
 * is an agent** and lives in the fleet, so this view is not a second agent list.
 * It holds the two things the fleet structurally cannot show — flows nobody has
 * armed yet (which is most of them: packs ship flows disabled), and **runs**,
 * which are neither flow nor agent and can sit waiting on a human indefinitely.
 */
export function AutomationsView() {
  const { flows, runs, loading, error, load } = useAutomations()

  useEffect(() => {
    void load()
  }, [load])

  const waiting = runs.filter((r) => r.status === 'paused')

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Automations</h1>
          <p className="text-sm text-ink-2">
            {flows.length === 0
              ? 'Nothing scheduled on this pod'
              : `${flows.length} automation${flows.length === 1 ? '' : 's'}, ${
                  flows.filter((f) => f.armed).length
                } armed`}
          </p>
        </div>
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
            <FlowCard key={flow.id} flow={flow} />
          ))}
        </div>
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

function FlowCard({ flow }: { flow: Flow }) {
  return (
    <Card className="p-0">
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{flow.name}</span>
            {/* Disabled is a state, not an absence — a pack ships its flows off
                and someone has to turn them on deliberately. */}
            {!flow.enabled && (
              <span className="shrink-0 rounded-chip bg-inset px-1.5 py-px text-[10px] text-ink-3">
                off
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
      </div>
      <div className="mt-3 divide-y divide-line border-t border-line">
        {flow.schedules.map((s) => (
          <ScheduleRow key={s.id} flow={flow} schedule={s} />
        ))}
      </div>
    </Card>
  )
}

function ScheduleRow({ flow, schedule }: { flow: Flow; schedule: FlowSchedule }) {
  const { arm, disarm, busy } = useAutomations()
  const go = useUi((s) => s.go)
  const instances = useFleet((s) => s.instances)
  const working = busy[`${flow.id}:${schedule.id}`] ?? false
  const armed = Boolean(schedule.instance_id)
  // The pod names an armed schedule's agent, but the fleet holds the current
  // name — an agent renamed after arming should not read stale here.
  const agentName =
    instances.find((i) => i.id === schedule.instance_id)?.name ?? schedule.instance_name

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="truncate">{schedule.name ?? schedule.id}</span>
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

      {armed ? (
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
      ) : (
        <span className="shrink-0 text-[11.5px] text-ink-3">not armed</span>
      )}

      <Button
        variant="ghost"
        size="sm"
        disabled={working}
        onClick={() =>
          void (armed ? disarm(flow.id, schedule.id) : arm(flow.id, schedule.id))
        }
      >
        {working ? '…' : armed ? 'Disarm' : 'Arm'}
      </Button>
    </div>
  )
}

function RunRow({ run, flows }: { run: FlowRun; flows: Flow[] }) {
  const go = useUi((s) => s.go)
  const name = flows.find((f) => f.id === run.flow_id)?.name ?? run.flow_id
  const paused = run.status === 'paused'

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
      {/* Resuming an approval is a decision with consequences and needs the
          run's own surface; this is the way back to the agent that paused. */}
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
  const go = useUi((s) => s.go)
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      <Zap className="h-6 w-6 text-ink-3" />
      <div>
        <p className="text-sm font-medium">No automations on this pod</p>
        <p className="mt-1 max-w-md text-[12.5px] text-ink-2">
          An automation is an agent doing scheduled work — a flow bound to an agent preset.
          Agent packs bring them; arming one is what creates the agent that runs it.
        </p>
      </div>
      <Button size="sm" onClick={() => go({ kind: 'packs' })}>
        Browse agent presets
      </Button>
    </Card>
  )
}
