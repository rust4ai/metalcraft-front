import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { StatusDot } from '@/components/ui/StatusDot'
import { cn } from '@/lib/cn'
import type { AgentInstance } from '@/types'

/**
 * One agent in the sidebar tree — Orca's worktree row (UI_PLAN §1): a status
 * dot, the name, a badge, and a quieter second line of provenance.
 *
 * Two lines rather than one because the name is chosen by the user and the
 * preset is chosen by the pack, and telling them apart at a glance is the whole
 * job of this row in a fleet where three agents may share a preset.
 */
export function InstanceRow({ instance }: { instance: AgentInstance }) {
  const status = useFleet((s) => s.status[instance.id] ?? 'idle')
  const activeKey = useUi((s) => s.activeKey)
  const go = useUi((s) => s.go)
  const selected = activeKey === `session:${instance.id}`

  return (
    <button
      type="button"
      onClick={() => go({ kind: 'session', instanceId: instance.id })}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'w-full rounded-control px-2.5 py-1.5 text-left transition-colors duration-150',
        selected ? 'bg-hover-2' : 'hover:bg-hover',
      )}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={status} className="shrink-0" />
        <span className={cn('truncate text-[13px]', selected ? 'font-medium text-ink' : 'text-ink')}>
          {instance.name}
        </span>
        {instance.persistent && (
          <span className="ml-auto shrink-0 rounded-chip bg-inset px-1.5 py-px text-[10px] text-ink-3">kept</span>
        )}
      </div>
      <div className="truncate pl-4 font-mono text-[11px] text-ink-3">{instance.agent_preset}</div>
    </button>
  )
}
