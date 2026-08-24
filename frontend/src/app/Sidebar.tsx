import { useEffect, useMemo, useState } from 'react'
import { Clock, LayoutGrid, PanelLeft, Plus, Search, Settings, Store } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { useLayout } from '@/stores/layout'
import { useConnection } from '@/stores/connection'
import { InstanceRow } from '@/features/fleet/InstanceRow'
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
 */
export function Sidebar() {
  const { sidebarWidth, setSidebarWidth, toggleSidebar } = useLayout()
  const { instances, load } = useFleet()
  const { go, setNewAgentOpen, activeKey } = useUi()
  const info = useConnection((s) => s.info)
  const [query, setQuery] = useState('')

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
        <span className="tnum text-[11.5px] text-ink-3">{instances.length}</span>
        <button
          type="button"
          aria-label="New agent"
          onClick={() => setNewAgentOpen(true)}
          className="ml-auto rounded-chip p-1 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-2">
        {matches.map((i) => (
          <InstanceRow key={i.id} instance={i} />
        ))}
        {matches.length === 0 && (
          <p className="px-2.5 py-2 text-[12px] text-ink-3">
            {instances.length === 0 ? 'No agents yet' : 'No agent matches that'}
          </p>
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
