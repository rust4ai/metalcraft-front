import { useEffect } from 'react'
import { Brain, Info, Wrench } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { useMemory } from '@/stores/memory'
import { useSessions } from '@/stores/sessions'
import { useConnection } from '@/stores/connection'
import { useLayout, type RailTab } from '@/stores/layout'
import { activeView, useUi } from '@/stores/ui'
import { StatusDot } from '@/components/ui/StatusDot'
import { relative } from '@/features/fleet/FleetView'
import { describeTool, truncateTarget } from '@/features/session/describeTool'
import type { ToolCard } from '@/features/session/transcript'
import { Resizer } from './Resizer'
import { PersonaSwitcher } from '@/features/session/PersonaSwitcher'
import { cn } from '@/lib/cn'

/**
 * The third column (UI_PLAN §2, S4).
 *
 * PLAN §10.2 asks this rail for instance memory, a persona switcher and a model
 * picker, and the pod serves all the endpoints needed for the first two:
 * `PATCH /agents/instances/{id}` switches persona (validated against the
 * preset's roster), `GET /agent-presets/{slug}` resolves that roster, and
 * `GET /agents/instances/{id}/memory` reads what the agent knows.
 *
 * The **model** is shown but not editable, and that is a property of the pod
 * rather than a shortcut: a model is chosen when a conversation is created
 * (`NewConversationRequest.model_name`) and there is no endpoint to change it
 * afterwards. A picker here would have to silently start a new conversation,
 * which is not what "change the model" looks like to anyone.
 */
const TABS: { id: RailTab; icon: typeof Info; label: string }[] = [
  { id: 'details', icon: Info, label: 'Details' },
  { id: 'memory', icon: Brain, label: 'Memory' },
  { id: 'activity', icon: Wrench, label: 'Activity' },
]

export function RightRail() {
  const { railWidth, setRailWidth, railTab, setRailTab } = useLayout()
  const view = useUi(activeView)

  return (
    <aside
      className="relative flex min-w-0 flex-col border-l border-line bg-canvas"
      style={{ width: railWidth }}
    >
      <Resizer side="left" width={railWidth} onResize={setRailWidth} />

      <div data-tauri-drag-region className="flex h-[38px] shrink-0 items-center gap-1 px-2">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            title={label}
            aria-current={railTab === id ? 'page' : undefined}
            onClick={() => setRailTab(id)}
            className={cn(
              'rounded-chip p-1.5 transition-colors duration-150',
              railTab === id ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {view.kind === 'session' ? (
          railTab === 'activity' ? (
            <Activity instanceId={view.instanceId} />
          ) : railTab === 'memory' ? (
            <Memory instanceId={view.instanceId} />
          ) : (
            <InstanceDetails instanceId={view.instanceId} />
          )
        ) : (
          <PodDetails />
        )}
      </div>
    </aside>
  )
}

/** A label/value pair. `mono` marks machine-owned values, per index.css. */
function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[11.5px] text-ink-3">{label}</span>
      <span className={cn('min-w-0 truncate text-right text-[12px] text-ink-2', mono && 'font-mono text-[11px]')}>
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-3">
      <h2 className="pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">{title}</h2>
      {children}
    </section>
  )
}

function InstanceDetails({ instanceId }: { instanceId: string }) {
  const instance = useFleet((s) => s.instances.find((i) => i.id === instanceId))
  const session = useSessions((s) => s.byInstance[instanceId])
  if (!instance) return <Empty text="This agent is no longer on the pod." />

  return (
    <>
      <Section title="Agent">
        <Row label="Name" value={instance.name} />
        <Row label="Preset" value={instance.agent_preset} mono />
        <Row label="Pack" value={instance.agent_pack} mono />
        <Row label="Persona" value={<PersonaSwitcher instance={instance} />} />
        <Row label="Origin" value={instance.origin.kind === 'gateway' ? instance.origin.channel : instance.origin.kind} />
        <Row label="Lifetime" value={instance.persistent ? 'persistent' : 'ephemeral'} />
      </Section>

      <Section title="History">
        <Row label="Created" value={relative(instance.created_at)} />
        <Row label="Last active" value={relative(instance.last_active_at || instance.created_at)} />
        <Row label="Conversations" value={instance.conversation_count ?? 0} />
      </Section>

      {/* The chat id is what a support conversation or a pod-side log grep needs,
          and it is otherwise invisible to the user. */}
      <Section title="This conversation">
        <Row label="Chat" value={session?.chatId} mono />
        <Row label="Model" value={session?.modelName} mono />
        <Row
          label="State"
          value={
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={session?.transcript.busy ? (session.transcript.thinking ? 'thinking' : 'running') : 'idle'} />
              {session?.transcript.busy ? (session.transcript.thinking ? 'thinking' : 'running a tool') : 'idle'}
            </span>
          }
        />
      </Section>
    </>
  )
}

/**
 * Every tool this conversation has run, newest last.
 *
 * The transcript collapses tools into one `Ran N tools` line so the reading flow
 * survives; this is where the detail goes for anyone who wants it, without
 * making everyone else scroll past it.
 */
function Activity({ instanceId }: { instanceId: string }) {
  const session = useSessions((s) => s.byInstance[instanceId])
  const cards = (session?.transcript.items ?? []).filter((i): i is ToolCard => i.kind === 'tool')

  if (cards.length === 0) return <Empty text="No tools run in this conversation yet." />

  return (
    <ul className="pt-3">
      {cards.map((card) => {
        const { verb, target } = describeTool(card.name, card.args)
        return (
          <li key={card.id} className="flex items-baseline gap-2 border-b border-line py-1.5 last:border-0">
            <StatusDot status={card.status === 'running' ? 'running' : 'idle'} className="translate-y-px" />
            <span className="min-w-0 flex-1">
              <span className="text-[12px] text-ink-2">{verb}</span>
              {target && <span className="ml-1 font-mono text-[11px] text-ink-3">{truncateTarget(target, 28)}</span>}
            </span>
            {card.durationMs !== undefined && (
              <span className="tnum shrink-0 font-mono text-[10.5px] text-ink-3">
                {card.durationMs < 1000 ? `${card.durationMs}ms` : `${(card.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * What this agent knows.
 *
 * The shipped/learned split leads because it is the distinction that matters:
 * memories its pack gave it are the vendor's claims, memories it formed are its
 * own, and conflating them would make an agent look like it worked something out
 * when it was simply told. `forgotten` counts shipped memories it has been told
 * to drop, which is why the numbers need not add up to the sample length.
 */
function Memory({ instanceId }: { instanceId: string }) {
  const view = useMemory((s) => s.byInstance[instanceId])
  const loading = useMemory((s) => s.loading[instanceId])
  const error = useMemory((s) => s.error[instanceId])
  const load = useMemory((s) => s.load)

  // Lazily, and only while this tab is the one being looked at.
  useEffect(() => {
    if (!view) void load(instanceId)
  }, [instanceId, load, view])

  if (error) return <Empty text={error} />
  if (!view) return <Empty text={loading ? 'Reading memory…' : ''} />

  return (
    <>
      <Section title="Knows">
        <Row label="Learned" value={view.learned} />
        <Row label="Shipped" value={view.shipped} />
        {view.forgotten > 0 && <Row label="Forgotten" value={view.forgotten} />}
        <Row label="Base" value={view.base} mono />
      </Section>

      {view.sample.length === 0 ? (
        <Empty text="This agent has not formed any memories yet." />
      ) : (
        <ul className="pt-3">
          {view.sample.map((m) => (
            <li key={m.id} className="border-b border-line py-2 last:border-0">
              <p className="text-[12px] leading-relaxed text-ink-2">{m.text}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-3">
                <span
                  className={cn(
                    'rounded-chip px-1 py-px',
                    m.origin === 'learned' ? 'bg-accent-tint text-accent' : 'bg-inset',
                  )}
                >
                  {m.origin}
                </span>
                {m.entity && <span className="truncate font-mono">{m.entity}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function PodDetails() {
  const { info, pod } = useConnection()
  const { instances, presets } = useFleet()
  return (
    <>
      <Section title="Pod">
        <Row label="Slug" value={pod?.slug} mono />
        <Row label="Agent" value={info?.name} />
        <Row label="Version" value={info?.version && `v${info.version}`} mono />
        <Row label="URL" value={pod?.url} mono />
      </Section>
      <Section title="On this pod">
        <Row label="Agents" value={instances.length} />
        <Row label="Presets" value={presets.length} />
      </Section>
    </>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-1 pt-6 text-[12px] text-ink-3">{text}</p>
}
