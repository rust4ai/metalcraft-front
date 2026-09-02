import { Clock } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { StatusDot } from '@/components/ui/StatusDot'
import { monogram, shortAge } from './activity'
import { cn } from '@/lib/cn'
import type { AgentInstance } from '@/types'

/**
 * One agent in the sidebar tree (HARNESS_UI_PLAN §4, H7).
 *
 * Two lines, because the name is chosen by the user and the preset is chosen by
 * the pack, and telling them apart at a glance is the whole job of this row in a
 * fleet where three agents share a preset.
 *
 * **The tile is a monogram, not a colour.** The reference gives each session a
 * coloured square, and copying that here would mean either inventing hues
 * outside the palette or reusing the four we have — and those four *mean*
 * things. A red tile on an agent called Rita would read as an error. So the tile
 * is neutral and the selected one takes the accent, which is the one colour
 * statement that is true.
 */
export function InstanceRow({ instance }: { instance: AgentInstance }) {
  const status = useFleet((s) => s.status[instance.id] ?? 'idle')
  const activeKey = useUi((s) => s.activeKey)
  const go = useUi((s) => s.go)
  const selected = activeKey === `session:${instance.id}`
  const age = shortAge(instance)

  return (
    <button
      type="button"
      onClick={() => go({ kind: 'session', instanceId: instance.id })}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left transition-colors duration-150',
        selected ? 'bg-hover-2' : 'hover:bg-hover',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid h-6 w-6 shrink-0 place-items-center rounded-chip text-[11px] font-semibold',
          selected ? 'bg-accent text-accent-ink' : 'bg-hover-2 text-ink-2',
        )}
      >
        {monogram(instance)}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot status={status} className="shrink-0" />
          <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', selected && 'font-medium')}>
            {instance.name}
          </span>
          {/* Every agent is kept, so "kept" says nothing. What is worth knowing
              at a glance is that this one works on a timer — that it may be
              doing something while you are not looking. */}
          {instance.origin.kind === 'flow' && (
            <Clock className="h-3 w-3 shrink-0 text-ink-3" aria-label="Runs on a schedule" />
          )}
          {age && <span className="tnum shrink-0 text-[10.5px] text-ink-3">{age}</span>}
        </span>
        <span className="truncate font-mono text-[10.5px] text-ink-3">{instance.agent_preset}</span>
      </span>
    </button>
  )
}
