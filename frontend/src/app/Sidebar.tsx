import { useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronRight, Clock, LayoutGrid, Plus, Search, Settings, Store } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { useLayout } from '@/stores/layout'
import { usePackUpdateCount } from '@/features/packs/updates'
import { InstanceRow } from '@/features/fleet/InstanceRow'
import { partitionByActivity } from '@/features/fleet/activity'
import { Nudges } from './Nudges'
import { Resizer } from './Resizer'
import { cn } from '@/lib/cn'

/**
 * The left column (UI_PLAN §2, S2).
 *
 * The nav rows above the search field are destinations, not fleet contents: "My
 * fleet" focuses the pinned fleet tab (the grid view of every agent), while the
 * tree below is the fleet itself, one row per agent. The row and the tree open
 * the same room, but only one of them scales with the number of agents.
 *
 * The tree is in two parts: the agents that have been chatted with or updated
 * recently, and — folded away beneath them — everything that has gone quiet for
 * longer than the window in `activity.ts`. This is the list someone reads
 * dozens of times a day, so the ones they are actually working with are worth
 * keeping at the top of it.
 */
export function Sidebar() {
  const { sidebarWidth, setSidebarWidth } = useLayout()
  const { instances, load } = useFleet()
  const { go, setNewAgentOpen, activeKey } = useUi()
  const [query, setQuery] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return instances
    return instances.filter((i) =>
      `${i.name} ${i.agent_preset} ${i.persona}`.toLowerCase().includes(q),
    )
  }, [instances, query])

  const { active, history } = useMemo(() => partitionByActivity(matches), [matches])
  // A search reaches the whole fleet, so it opens the shelf: a query whose only
  // hits are old agents must not come back looking like nothing was found.
  const searching = query.trim().length > 0
  const showHistory = historyOpen || searching

  return (
    <aside
      className="relative flex min-h-0 min-w-0 flex-col border-r border-line bg-canvas"
      // The cap is on the *window*, not on the stored width: the grid gives this
      // column whatever it asks for and the centre takes the remainder, so a
      // sidebar and a rail sized on a large display could together be wider than
      // a small one and squeeze the conversation down to nothing.
      style={{ width: sidebarWidth, maxWidth: '30vw' }}
    >
      {/* No header. The pod's name and this column's own toggle both moved to
          the window bar, and the traffic lights are reserved there now — leaving
          a 38px strip here that held nothing but its own drag region. */}
      <nav className="px-2 pb-2 pt-2">
        <NavRow
          icon={<LayoutGrid className="h-4 w-4" />}
          label="Home"
          selected={activeKey === 'fleet'}
          onClick={() => go({ kind: 'fleet' })}
        />
        <NavRow
          icon={<Clock className="h-4 w-4" />}
          label="Automations"
          selected={activeKey === 'automations'}
          onClick={() => go({ kind: 'automations' })}
        />
        {/* A rule, because the row below is a shop and the two above are rooms
            in this pod. */}
        <div className="my-1.5 h-px bg-line" />
        <NavRow
          icon={<Store className="h-4 w-4" />}
          label="Extensions"
          selected={activeKey === 'packs'}
          onClick={() => go({ kind: 'packs' })}
          count={usePackUpdateCount()}
        />
      </nav>

      <div className="px-2 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents"
            aria-label="Search agents"
            className="h-8 w-full rounded-control bg-field pl-8 pr-2 text-[13px] text-ink placeholder:text-ink-3 focus-visible:outline-accent"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pb-1">
        <span className="text-[11.5px] font-medium text-ink-2">Agents</span>
        <span className="tnum text-[11.5px] text-ink-3">{active.length}</span>
        <button
          type="button"
          aria-label="New agent"
          onClick={() => setNewAgentOpen(true)}
          className="ml-auto rounded-chip p-1 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div className="space-y-px">
          {active.map((i) => (
            <InstanceRow key={i.id} instance={i} />
          ))}
        </div>
        {matches.length === 0 && (
          <p className="px-2.5 py-2 text-[12px] text-ink-3">
            {instances.length === 0 ? 'No agents yet' : 'No agent matches that'}
          </p>
        )}
        {/* Not while searching: there the empty half means "no recent match",
            and the hits are right below in the fold the search opened. */}
        {!searching && active.length === 0 && history.length > 0 && (
          <p className="px-2.5 py-2 text-[12px] text-ink-3">Nothing active in the last few days</p>
        )}

        {history.length > 0 && (
          <div className="mt-2 border-t border-line pt-2">
            {/* A heading rather than a toggle while a search is running: the
                fold is forced open there, and a control that does nothing when
                clicked is worse than no control. */}
            <button
              type="button"
              onClick={() => setHistoryOpen(!historyOpen)}
              aria-expanded={showHistory}
              disabled={searching}
              className="flex w-full items-center gap-1.5 rounded-control px-2.5 py-1.5 text-left text-[11.5px] font-medium text-ink-2 enabled:hover:bg-hover enabled:hover:text-ink"
            >
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-150',
                  showHistory && 'rotate-90',
                )}
              />
              <span className="truncate">Agent History</span>
              <span className="tnum ml-auto text-ink-3">{history.length}</span>
            </button>
            {showHistory && (
              <div className="mt-px space-y-px">
                {history.map((i) => (
                  <InstanceRow key={i.id} instance={i} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="flex h-9 shrink-0 items-center gap-1 border-t border-line px-2">
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={() => go({ kind: 'settings' })}
          className={cn(
            'rounded-chip p-1.5 hover:bg-hover hover:text-ink',
            activeKey === 'settings' ? 'text-ink' : 'text-ink-3',
          )}
        >
          <Settings className="h-4 w-4" />
        </button>
        {/* The library, between the two. All three are "what is this pod
            actually doing", asked at three depths: how it is configured, what
            it is made of, and what went wrong. */}
        <button
          type="button"
          aria-label="Library"
          title="Library — everything installed on this pod"
          onClick={() => go({ kind: 'library' })}
          className={cn(
            'rounded-chip p-1.5 hover:bg-hover hover:text-ink',
            activeKey === 'library' ? 'text-ink' : 'text-ink-3',
          )}
        >
          <BookOpen className="h-4 w-4" />
        </button>
      </footer>

      <Nudges />

      <Resizer side="right" width={sidebarWidth} onResize={setSidebarWidth} />
    </aside>
  )
}

function NavRow({
  icon,
  label,
  selected,
  onClick,
  count,
}: {
  icon: React.ReactNode
  label: string
  selected: boolean
  onClick: () => void
  /** Shown as a pill when non-zero. Absent for rows that never carry one. */
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-[13px] transition-colors duration-150',
        selected ? 'bg-hover-2 font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
      )}
    >
      <span className="shrink-0 text-ink-3">{icon}</span>
      <span className="truncate">{label}</span>
      {!!count && (
        // A number, not a dot: "something to look at" is not the same message as
        // "six of your agents have a newer version waiting".
        <span className="tnum ml-auto shrink-0 rounded-chip bg-accent-tint px-1.5 text-[10.5px] text-ink">
          {count}
        </span>
      )}
    </button>
  )
}
