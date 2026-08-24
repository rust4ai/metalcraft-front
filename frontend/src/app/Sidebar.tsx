import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  Clock,
  LayoutGrid,
  PanelLeft,
  Plus,
  ScrollText,
  Search,
  Settings,
  Store,
} from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { useLayout } from '@/stores/layout'
import { useConnection } from '@/stores/connection'
import { DIAG_POLL_MS, unseen, useDiagnostics } from '@/stores/diagnostics'
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
  const { sidebarWidth, setSidebarWidth, toggleSidebar } = useLayout()
  const { instances, load } = useFleet()
  const { go, setNewAgentOpen, activeKey } = useUi()
  const info = useConnection((s) => s.info)
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
      {/* The window is frameless: this header is the drag region, inset past the
          traffic lights, and there is no full-width title bar above it. */}
      <header
        data-tauri-drag-region
        className="flex h-[38px] shrink-0 items-center gap-2 pl-20 pr-2"
      >
        <span data-tauri-drag-region className="truncate text-[12.5px] font-semibold">
          {info?.name ?? 'Metalcraft'}
        </span>
        <button
          type="button"
          aria-label="Hide sidebar"
          title="Hide sidebar  ⌘B"
          onClick={toggleSidebar}
          className="ml-auto rounded-chip p-1 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </header>

      <nav className="px-2 pb-2">
        <NavRow
          icon={<LayoutGrid className="h-4 w-4" />}
          label="My fleet"
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
          label="Browse agent presets"
          selected={activeKey === 'packs'}
          onClick={() => go({ kind: 'packs' })}
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
        <ErrorLogButton />
      </footer>

      <Nudges />

      <Resizer side="right" width={sidebarWidth} onResize={setSidebarWidth} />
    </aside>
  )
}

/**
 * The error log, beside the gear.
 *
 * Here rather than in the status bar because it is a destination you open, not a
 * readout you glance at — and next to Settings because both answer "why is the
 * app behaving like this", which is the question that sends someone to this
 * corner in the first place.
 *
 * The badge is the whole point. Most of what this log catches is invisible by
 * definition: a call that failed and was handled, a core command that degraded
 * instead of erroring. Nothing else on screen changes when one lands, so without
 * a count the log would only ever be read by someone who already suspected it
 * had something in it.
 */
function ErrorLogButton() {
  const go = useUi((s) => s.go)
  const activeKey = useUi((s) => s.activeKey)
  const load = useDiagnostics((s) => s.load)
  const entries = useDiagnostics((s) => s.entries)
  const seenAt = useDiagnostics((s) => s.seenAt)
  // Derived outside the selector: `unseen` builds an object, and returning a
  // fresh one from a zustand selector re-renders on every store touch.
  const { count, failed } = unseen({ entries, seenAt })

  // The renderer's own entries arrive through the store as they happen; the
  // core's have to be asked for. Slowly — this is the unattended path, and the
  // log refetches the moment it is opened.
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), DIAG_POLL_MS)
    return () => clearInterval(t)
  }, [load])

  const active = activeKey === 'errors'

  return (
    <button
      type="button"
      aria-label={count > 0 ? `Error log, ${count} new` : 'Error log'}
      title={count > 0 ? `Error log — ${count} new` : 'Error log'}
      onClick={() => go({ kind: 'errors' })}
      className={cn(
        'relative rounded-chip p-1.5 hover:bg-hover hover:text-ink',
        active ? 'text-ink' : 'text-ink-3',
      )}
    >
      <ScrollText className="h-4 w-4" />
      {count > 0 && (
        <span
          // A dot, not a number: the count is in the tooltip and the label, and
          // a two-digit badge on a 16px icon is unreadable at every size.
          // `bg-canvas` ring so it reads as an overlay rather than part of the
          // glyph.
          //
          // Red only when something actually failed. Most of what lands here is
          // a workaround that held — marking those as red teaches people to
          // ignore the dot, which costs the one time it matters.
          className={cn(
            'absolute right-0.5 top-0.5 h-2 w-2 rounded-full ring-2 ring-canvas',
            failed > 0 ? 'bg-red' : 'bg-orange',
          )}
        />
      )}
    </button>
  )
}

function NavRow({
  icon,
  label,
  selected,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  selected: boolean
  onClick: () => void
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
    </button>
  )
}
