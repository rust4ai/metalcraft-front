import { Bot, Gauge, ServerCog, ShieldCheck } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { useSessions } from '@/stores/sessions'
import { useConnection } from '@/stores/connection'
import { useLayout } from '@/stores/layout'
import { unseen, useDiagnostics } from '@/stores/diagnostics'
import { activeView, canThink, useUi } from '@/stores/ui'
import { StatusDot } from '@/components/ui/StatusDot'
import { Collapsible } from '@/components/ui/Collapsible'
import { Empty, Row } from '@/components/ui/Facts'
import { UsageMeter } from '@/components/ui/Usage'
import { relative } from '@/features/fleet/FleetView'
import { Resizer } from './Resizer'
import { PersonaSwitcher } from '@/features/session/PersonaSwitcher'
import { DeleteAgent } from '@/features/fleet/DeleteAgent'
import { EditableName } from '@/features/fleet/EditableName'
import { cn } from '@/lib/cn'

/**
 * The Inspector (HARNESS_UI_PLAN §4, H4; was UI_PLAN §2, S4).
 *
 * One scroll of folding sections, not tabs. Tabs made the rail's contents
 * mutually exclusive for no reason: an agent's identity and the state of its
 * credentials are not alternatives. They are two things you read one after the
 * other, and the fold lets someone keep open exactly the ones they care about.
 *
 * The **model** is shown but not editable, and that is a property of the pod
 * rather than a shortcut: a model is chosen when a conversation is created
 * (`NewConversationRequest.model_name`) and there is no endpoint to change it
 * afterwards. A picker here would have to silently start a new conversation,
 * which is not what "change the model" looks like to anyone.
 */
export function RightRail() {
  const { railWidth, setRailWidth } = useLayout()
  const view = useUi(activeView)

  return (
    <aside
      className="relative flex min-h-0 min-w-0 flex-col border-l border-line bg-canvas"
      // Capped against the window for the same reason as the sidebar's width.
      style={{ width: railWidth, maxWidth: '34vw' }}
    >
      <Resizer side="left" width={railWidth} onResize={setRailWidth} />

      <div className="flex h-[34px] shrink-0 items-center border-b border-line px-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Inspector
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {view.kind === 'session' ? (
          <InstanceDetails instanceId={view.instanceId} />
        ) : (
          <PodDetails />
        )}
      </div>
    </aside>
  )
}

/**
 * The card the reference leads its Inspector with (`● Ready … sandbox`).
 *
 * A state and a subtitle, in a box, above the rows — because "what is this thing
 * doing right now" is a different question from "what is it made of", and asking
 * it as one more label/value row buries it among ten others.
 */
function StateCard({
  status,
  label,
  detail,
}: {
  status: 'idle' | 'running' | 'thinking'
  label: string
  detail?: string
}) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-card bg-inset px-2.5 py-2 shadow-hairline">
      <StatusDot status={status} className="shrink-0" />
      <span className="text-[12px] font-medium text-ink">{label}</span>
      {detail && (
        <span className="ml-auto min-w-0 truncate font-mono text-[10.5px] text-ink-3">
          {detail}
        </span>
      )}
    </div>
  )
}

function InstanceDetails({ instanceId }: { instanceId: string }) {
  const instance = useFleet((s) => s.instances.find((i) => i.id === instanceId))
  const session = useSessions((s) => s.byInstance[instanceId])
  if (!instance) return <Empty text="This agent is no longer on the pod." />

  const busy = session?.transcript.busy ?? false
  const thinking = session?.transcript.thinking ?? false
  const state = busy ? (thinking ? 'thinking' : 'running') : 'idle'

  return (
    <>
      <Collapsible id="agent" title="Agent" icon={<Bot className="h-3.5 w-3.5" />}>
        <StateCard
          status={state}
          label={busy ? (thinking ? 'Thinking' : 'Running a tool') : 'Ready'}
          detail={instance.agent_preset}
        />
        <Row
          label="Name"
          value={<EditableName instance={instance} className="text-[11.5px] text-ink-2" />}
        />
        <Row label="Pack" value={instance.agent_pack} mono />
        <Row label="Persona" value={<PersonaSwitcher instance={instance} />} />
        <Row
          label="Origin"
          value={instance.origin.kind === 'gateway' ? instance.origin.channel : instance.origin.kind}
        />
      </Collapsible>

      <Collapsible id="history" title="History">
        <Row label="Created" value={relative(instance.created_at)} />
        <Row label="Last active" value={relative(instance.last_active_at || instance.created_at)} />
        <Row label="Conversations" value={instance.conversation_count ?? 0} />
      </Collapsible>

      {/* The chat id is what a support conversation or a pod-side log grep needs,
          and it is otherwise invisible to the user. */}
      <Collapsible id="conversation" title="This conversation">
        {/* `Row` hides an absent value, so without this the section was a
            heading with nothing under it whenever the chat had not opened yet
            — a fold you expand onto blank space, which is the same lie as a
            hollow control. */}
        {session?.chatId ? (
          <>
            <Row label="Chat" value={session.chatId} mono />
            <Row label="Model" value={session.modelName} mono />
          </>
        ) : (
          <Empty text="No conversation open yet." />
        )}
      </Collapsible>

      <Collapsible id="usage" title="Usage" icon={<Gauge className="h-3.5 w-3.5" />}>
        <UsageMeter instanceId={instanceId} />
      </Collapsible>

      {/* What this agent does unattended used to be a section here. It is the
          Schedules mode now — one click away on the row above, with room for the
          trigger text the rail was truncating. Not mirrored: two copies of one
          list is how they drift. */}

      <Checks />

      {/* Last, and after a rule. The rail is read top-down for facts about the
          agent; the one control that ends it does not belong among them. */}
      <div className="mt-4 border-t border-line pt-3">
        <DeleteAgent instance={instance} />
      </div>
    </>
  )
}

function PodDetails() {
  const { info, pod } = useConnection()
  const { instances, presets } = useFleet()
  return (
    <>
      <Collapsible id="pod" title="Pod" icon={<ServerCog className="h-3.5 w-3.5" />}>
        <StateCard
          status={info ? 'idle' : 'running'}
          label={info ? 'Connected' : 'Connecting'}
          detail={pod?.slug}
        />
        <Row label="Agent" value={info?.name} />
        <Row label="Version" value={info?.version && `v${info.version}`} mono />
        <Row label="URL" value={pod?.url} mono />
      </Collapsible>

      <Collapsible id="onthispod" title="On this pod">
        <Row label="Agents" value={instances.length} />
        <Row label="Presets" value={presets.length} />
      </Collapsible>

      <Checks />
    </>
  )
}

/**
 * Where the reference has CI checks.
 *
 * There is no CI, so this answers the question a pod actually raises: can the
 * next turn run, and has anything quietly failed. Both are invisible until they
 * bite — an unbindable credential looks exactly like a working one until a turn
 * is refused — which is why the collapsed header carries a dot.
 *
 * Everything here is already in memory. The section fires no requests of its own:
 * `inference` is read at boot by `checkOwnSource`, and the diagnostics are polled
 * by the window bar's error-log button. A **service** key's health (Octaweave,
 * Buildr) is deliberately absent — the settings store only holds it once the
 * Settings tab has fetched it, and a row reading "unknown" would be a check that
 * never checked.
 */
function Checks() {
  const inference = useUi((s) => s.inference)
  const ownSource = useUi((s) => s.ownSource)
  const go = useUi((s) => s.go)
  const { info, session } = useConnection()
  const entries = useDiagnostics((s) => s.entries)
  const seenAt = useDiagnostics((s) => s.seenAt)
  const { count, failed } = unseen({ entries, seenAt })

  const thinkable = canThink({ inference, ownSource }, session?.premium ?? false)

  // The worst state anything here is in, which is what the collapsed header has
  // to convey: a section that folds away must not hide the one red row in it.
  const tone: Tone =
    thinkable === false || failed > 0 || !info ? 'bad' : count > 0 || thinkable === null ? 'warn' : 'ok'

  return (
    <Collapsible
      id="checks"
      title="Checks"
      icon={<ShieldCheck className="h-3.5 w-3.5" />}
      // Collapsed by default. Everything here is fine almost always, and a rail
      // that opens on a list of green ticks trains people to scroll past it.
      defaultOpen={false}
      badge={
        tone === 'ok' ? null : (
          <span
            aria-hidden
            className={cn('block h-2 w-2 rounded-full', tone === 'bad' ? 'bg-red' : 'bg-orange')}
          />
        )
      }
    >
      <Check
        tone={info ? 'ok' : 'bad'}
        label="Pod"
        detail={info ? `answering · v${info.version ?? '?'}` : 'not answering'}
      />
      <Check
        tone={thinkable === false ? 'bad' : thinkable === null ? 'warn' : 'ok'}
        label="Inference"
        detail={describeInference(inference, thinkable)}
        onClick={thinkable === false ? () => go({ kind: 'source' }) : undefined}
      />
      <Check
        tone={failed > 0 ? 'bad' : count > 0 ? 'warn' : 'ok'}
        label="Error log"
        detail={
          count === 0 ? 'nothing new' : `${count} new${failed > 0 ? `, ${failed} failed` : ''}`
        }
        onClick={() => go({ kind: 'errors' })}
      />
    </Collapsible>
  )
}

type Tone = 'ok' | 'warn' | 'bad'

/** One check: a dot, what it is, and what it found. Never colour alone — the
 *  detail text carries the finding too. */
function Check({
  tone,
  label,
  detail,
  onClick,
}: {
  tone: Tone
  label: string
  detail: string
  onClick?: () => void
}) {
  const body = (
    <>
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          tone === 'bad' ? 'bg-red' : tone === 'warn' ? 'bg-orange' : 'bg-green',
        )}
      />
      <span className="shrink-0 text-[11px] text-ink-2">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[11px] text-ink-3">{detail}</span>
    </>
  )
  const cls = 'flex w-full items-center gap-2 py-1 text-left'
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'hover:text-ink')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/**
 * What the inference check found, in the words that name the actual problem.
 *
 * `canThink` returns three values and all three matter here: `false` is a pod
 * that will be refused, `null` is a pod too old to say, and neither should be
 * reported as the other. The gateway case is the one worth spelling out — a
 * perfectly good credential is still refused without premium on the account, and
 * "no key" is the wrong thing to go looking for then.
 */
function describeInference(
  inference: ReturnType<typeof useUi.getState>['inference'],
  thinkable: boolean | null,
): string {
  if (!inference) return thinkable === null ? 'this pod cannot say' : 'assumed ready'
  if (!inference.ready) return 'no credential resolves'
  if (inference.gateway && thinkable === false) return 'billed to credits — needs premium'
  return inference.gateway ? 'billed to your credits' : `key: ${inference.credential}`
}
