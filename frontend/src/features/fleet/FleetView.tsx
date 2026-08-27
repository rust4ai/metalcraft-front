import { useEffect, useMemo, useState } from 'react'
import { Bot, ChevronRight, Plus, RefreshCw, AlertTriangle } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingState } from '@/components/ui/LoadingState'
import { StatusDot } from '@/components/ui/StatusDot'
import { partitionByActivity } from './activity'
import { EditableName } from './EditableName'
import { cn } from '@/lib/cn'
import type { AgentInstance, InstanceOrigin } from '@/types'

/** PLAN §10.1 — the home screen: every agent on the pod, at a glance. */
export function FleetView() {
  const { instances, presets, status, loading, loaded, error, load } = useFleet()
  const { go, setNewAgentOpen } = useUi()
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  // Everything that has gone quiet for longer than the window drops to a folded
  // shelf under the grid, so the home screen stays a picture of what is being
  // worked with rather than of everything ever spawned.
  const { active, history } = useMemo(() => partitionByActivity(instances), [instances])

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Fleet</h1>
          {/* A count of a list nobody has read is not zero — it is nothing to
              say yet, and saying "0 agents on this pod" to somebody with twelve
              of them is the first thing they see after connecting. */}
          <p className="text-sm text-ink-2">
            {loaded
              ? `${instances.length} agent${instances.length === 1 ? '' : 's'} on this pod`
              : 'Asking the pod what is running…'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-8 px-0"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
          <Button size="sm" disabled={presets.length === 0} onClick={() => setNewAgentOpen(true)}>
            <Plus className="h-4 w-4" />
            New agent
          </Button>
        </div>
      </header>

      {error && <p className="mb-4 text-sm text-red">{error}</p>}

      {/* `loaded`, not `!loading`: both are true in the beat before the first
          load starts, which is exactly when the pod's agents are least known and
          an empty-state is most wrong. */}
      {!loaded ? (
        <LoadingFleet />
      ) : instances.length === 0 ? (
        <EmptyFleet presetCount={presets.length} />
      ) : (
        <>
          {active.length > 0 ? (
            <Grid>
              {active.map((i, index) => (
                <InstanceCard
                  key={i.id}
                  instance={i}
                  status={status[i.id] ?? 'idle'}
                  onOpen={() => go({ kind: 'session', instanceId: i.id })}
                  index={index}
                />
              ))}
            </Grid>
          ) : (
            history.length > 0 && (
              <p className="text-sm text-ink-2">
                Nothing active in the last few days — every agent is in history below.
              </p>
            )
          )}

          {history.length > 0 && (
            <section className="mt-8 border-t border-line pt-5">
              <button
                type="button"
                onClick={() => setHistoryOpen(!historyOpen)}
                aria-expanded={historyOpen}
                className="-ml-1.5 flex items-center gap-1.5 rounded-control px-1.5 py-1 hover:bg-hover"
              >
                <ChevronRight
                  className={cn(
                    'h-4 w-4 text-ink-3 transition-transform duration-150',
                    historyOpen && 'rotate-90',
                  )}
                />
                <span className="text-sm font-medium">Agent History</span>
                <span className="tnum text-sm text-ink-3">{history.length}</span>
              </button>
              <p className="mb-4 ml-4 mt-0.5 text-[12px] text-ink-3">
                No chat or update in over three days. Still here — open one and it comes back up.
              </p>
              {historyOpen && (
                <Grid>
                  {history.map((i, index) => (
                    <InstanceCard
                      key={i.id}
                      instance={i}
                      status={status[i.id] ?? 'idle'}
                      onOpen={() => go({ kind: 'session', instanceId: i.id })}
                      index={index}
                    />
                  ))}
                </Grid>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
      {children}
    </div>
  )
}

function InstanceCard({
  instance,
  status,
  onOpen,
  index,
}: {
  instance: AgentInstance
  status: Parameters<typeof StatusDot>[0]['status']
  onOpen: () => void
  index: number
}) {
  return (
    // 600ms entrance, 60ms apart — the stagger is what makes a grid land rather
    // than blink into place.
    <Card
      className="animate-fade-up cursor-pointer"
      style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            {/* Editable in place. The card still opens the session — the name
                stops the click, so a rename here never costs a navigation. */}
            <EditableName instance={instance} className="-ml-1.5 font-medium" />
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-ink-2">
            {instance.agent_preset} · {instance.persona}
          </p>
        </div>
        <OriginBadge origin={instance.origin} />
      </div>

      {/* Reported, not hidden: the pack that provided this agent withdrew its
          preset, or an update changed its voice. Both are things the user did
          not ask for and should hear about. */}
      {instance.orphaned_from && (
        <Notice text={`${instance.orphaned_from} no longer provides this agent — running on a frozen copy`} />
      )}
      {instance.persona_fallback_from && (
        <Notice text={`persona ${instance.persona_fallback_from} was withdrawn; fell back to the preset default`} />
      )}

      <div className="mt-3 flex items-center justify-between text-[11.5px] text-ink-3">
        <span>
          {/* No lifetime to report any more: the pod keeps every agent until
              somebody deletes it, so the only number here is the one that says
              how much has been said. */}
          {instance.conversation_count
            ? `${instance.conversation_count} conversation${instance.conversation_count === 1 ? '' : 's'}`
            : 'no conversations yet'}
        </span>
        <span className="tnum">{relative(instance.last_active_at || instance.created_at)}</span>
      </div>
    </Card>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="mt-3 flex gap-2 rounded-chip bg-orange-tint px-2.5 py-2 text-[11.5px] text-ink-2">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange" />
      <span>{text}</span>
    </div>
  )
}

function OriginBadge({ origin }: { origin: InstanceOrigin }) {
  const label =
    origin.kind === 'gateway' ? origin.channel : origin.kind === 'flow' ? 'flow' : origin.kind
  return (
    <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
      {label}
    </span>
  )
}

/** The same frame the grid will fill, so connecting to a pod does not collapse
 *  the page height and push everything back down a moment later. */
function LoadingFleet() {
  return (
    <div className="grid place-items-center rounded-card border border-dashed border-line bg-canvas py-20">
      <LoadingState label="Loading your agents" />
    </div>
  )
}

function EmptyFleet({ presetCount }: { presetCount: number }) {
  return (
    <div className="grid place-items-center rounded-card border border-dashed border-line bg-canvas py-20 text-center">
      <Bot className="mb-3 h-8 w-8 text-ink-3" />
      <p className="font-medium">No agents yet</p>
      <p className="mt-1 max-w-sm text-sm text-ink-2">
        {presetCount === 0
          ? 'Install an agent from a registry to get a preset to spawn from.'
          : 'Spawn one from a preset to start a conversation.'}
      </p>
    </div>
  )
}

export function relative(iso: string): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, (Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}
