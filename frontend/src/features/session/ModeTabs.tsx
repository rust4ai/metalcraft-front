import { Activity, Brain, Clock, MessageSquare } from 'lucide-react'
import { useUi, type SessionMode } from '@/stores/ui'
import { useFleet } from '@/stores/fleet'
import { useSessions } from '@/stores/sessions'
import { StatusDot } from '@/components/ui/StatusDot'
import { EditableName } from '@/features/fleet/EditableName'
import { ConversationPicker } from './ConversationPicker'
import { cn } from '@/lib/cn'
import type { AgentInstance } from '@/types'

/**
 * One agent's rooms (HARNESS_UI_PLAN §4, H2).
 *
 * The reference puts `Agent · Changes · Files · Terminal · Skills` here. Those
 * are a coding harness's facets and none of them exist on a pod, so this is the
 * same *shape* holding what an agent actually has: the conversation, what it did,
 * what it knows, and what it does when nobody is watching.
 *
 * Deliberately not the tab strip above it. That strip holds open documents —
 * Home, Settings, three different agents — and this holds facets of the one
 * agent the active tab is already showing. Merging them would cost the ability
 * to have two agents open at once, which is the only reason the strip exists.
 *
 * Every mode here opens something real. There is no `Changes`, no `Files` and no
 * `Terminal` sitting greyed out to match the screenshot (§0).
 */
const MODES: { id: SessionMode; icon: typeof MessageSquare; label: string; hint: string }[] = [
  { id: 'chat', icon: MessageSquare, label: 'Chat', hint: 'The conversation' },
  { id: 'runs', icon: Activity, label: 'Runs', hint: 'Where each turn spent its time' },
  { id: 'memory', icon: Brain, label: 'Memory', hint: 'What this agent knows' },
  { id: 'schedules', icon: Clock, label: 'Schedules', hint: 'What it does unattended' },
]

export function ModeTabs({ instanceId }: { instanceId: string }) {
  const mode = useUi((s) => s.sessionMode[instanceId] ?? 'chat')
  const setSessionMode = useUi((s) => s.setSessionMode)
  const instance = useFleet((s) => s.instances.find((i) => i.id === instanceId))
  const session = useSessions((s) => s.byInstance[instanceId])
  const busy = session?.transcript.busy ?? false

  return (
    <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-line px-3">
      <StatusDot
        status={busy ? (session?.transcript.thinking ? 'thinking' : 'running') : 'idle'}
        className="shrink-0"
      />

      {/* The name stays on this row rather than moving to the breadcrumb: this
          is where someone is looking when they decide the agent deserves a
          better one, and the breadcrumb is not editable. */}
      <Name instance={instance} />

      <div className="mx-1 h-4 w-px shrink-0 bg-line" />

      <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto" aria-label="Agent views">
        {MODES.map(({ id, icon: Icon, label, hint }) => {
          const on = mode === id
          return (
            <button
              key={id}
              type="button"
              title={hint}
              aria-current={on ? 'page' : undefined}
              onClick={() => setSessionMode(instanceId, id)}
              className={cn(
                'flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] transition-colors duration-150',
                on
                  ? 'bg-hover-2 text-ink shadow-hairline'
                  : 'text-ink-2 hover:bg-hover hover:text-ink',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 shrink-0', on ? 'text-ink-2' : 'text-ink-3')} />
              {label}
            </button>
          )
        })}
      </nav>

      {/* Right-aligned, the way the reference puts `Sandbox` and `Open PR` — the
          actions that belong to the thing being worked on rather than to the
          view of it. An agent has several conversations, and this is the only
          way to any but the newest. */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ConversationPicker instanceId={instanceId} />
      </div>
    </div>
  )
}

function Name({ instance }: { instance: AgentInstance | undefined }) {
  if (!instance) return <span className="shrink-0 text-[13px] font-medium">Agent</span>
  return (
    <span className="flex min-w-0 shrink items-baseline gap-1.5">
      <EditableName instance={instance} className="-ml-1.5 text-[13px] font-medium" />
      <span className="hidden truncate font-mono text-[11px] text-ink-3 xl:block">
        {instance.agent_preset}
      </span>
    </span>
  )
}
