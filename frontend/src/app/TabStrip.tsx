import { Bot, Clock, KeyRound, LayoutGrid, PanelLeft, PanelRight, Play, Plus, Settings, Store, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useFleet } from '@/stores/fleet'
import { useUi, type View } from '@/stores/ui'
import { useLayout } from '@/stores/layout'
import { cn } from '@/lib/cn'

/** What a tab calls itself. Session tabs borrow the instance's name, so renaming
 *  an agent renames its tab without the tab model knowing anything about it. */
export function tabLabel(view: View, nameOf: (id: string) => string | undefined): string {
  switch (view.kind) {
    case 'fleet':
      return 'Fleet'
    case 'packs':
      return 'Agent presets'
    case 'automations':
      return 'Automations'
    // Not "Interface source": a tab label is a word, not a sentence, and the
    // pane it opens already carries the full title.
    case 'source':
      return 'Source'
    case 'settings':
      return 'Settings'
    case 'session':
      return nameOf(view.instanceId) ?? 'Agent'
  }
}

function TabIcon({ view }: { view: View }) {
  const cls = 'h-3.5 w-3.5 shrink-0'
  switch (view.kind) {
    case 'fleet':
      return <LayoutGrid className={cls} />
    case 'packs':
      return <Store className={cls} />
    case 'automations':
      return <Clock className={cls} />
    case 'source':
      return <KeyRound className={cls} />
    case 'settings':
      return <Settings className={cls} />
    case 'session':
      return <Bot className={cls} />
  }
}

/**
 * The centre column's header (UI_PLAN §2, S3).
 *
 * Shares the 38px top row with the sidebar header rather than sitting under a
 * full-width title bar, so the empty space to the right of the last tab is the
 * window's other drag region.
 */
export function TabStrip({ onCommand }: { onCommand: () => void }) {
  const { tabs, activeKey, select, close, setNewAgentOpen } = useUi()
  const instances = useFleet((s) => s.instances)
  const { sidebarOpen, toggleSidebar, railOpen, toggleRail } = useLayout()
  const nameOf = (id: string) => instances.find((i) => i.id === id)?.name
  const activeTab = useRef<HTMLDivElement>(null)

  // Keep the focused tab visible. The strip scrolls once the tabs outgrow it,
  // and with both side panels widened the centre column gets narrow enough that
  // the active tab can sit almost entirely outside the scroller — reading as
  // "Ge" with its close button out of reach. Selecting a tab you cannot see is
  // the state this prevents.
  //
  // `inline: 'nearest'` so an already-visible tab does not jolt the strip, and
  // `block: 'nearest'` so a horizontal scroll never drags the page vertically.
  useEffect(() => {
    activeTab.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeKey, tabs.length])

  return (
    <div
      data-tauri-drag-region
      className="flex h-[38px] shrink-0 items-center gap-1 border-b border-line bg-canvas pr-2"
    >
      {/* When the sidebar is hidden it takes the traffic lights' inset with it,
          so the tab strip has to reserve that space instead. */}
      {!sidebarOpen && (
        <div className="flex shrink-0 items-center pl-20 pr-1" data-tauri-drag-region>
          <button
            type="button"
            aria-label="Show sidebar"
            title="Show sidebar  ⌘B"
            onClick={toggleSidebar}
            className="rounded-chip p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className={cn('flex min-w-0 items-center gap-1 overflow-x-auto', sidebarOpen && 'pl-2')}>
        {tabs.map((tab) => {
          const active = tab.key === activeKey
          const closable = tab.key !== 'fleet'
          return (
            <div
              key={tab.key}
              ref={active ? activeTab : undefined}
              className={cn(
                'group flex h-[26px] min-w-0 shrink-0 items-center gap-1.5 rounded-control pl-2.5 text-[12.5px] transition-colors duration-150',
                closable ? 'pr-1' : 'pr-2.5',
                active ? 'bg-page text-ink shadow-hairline' : 'text-ink-2 hover:bg-hover hover:text-ink',
              )}
              // Middle-click closes, the way every tab strip does.
              onAuxClick={(e) => {
                if (e.button === 1 && closable) close(tab.key)
              }}
            >
              <button
                type="button"
                onClick={() => select(tab.key)}
                aria-current={active ? 'page' : undefined}
                className="flex min-w-0 items-center gap-1.5"
              >
                <span className={active ? 'text-ink-2' : 'text-ink-3'}>
                  <TabIcon view={tab.view} />
                </span>
                <span className="max-w-40 truncate">{tabLabel(tab.view, nameOf)}</span>
              </button>
              {closable && (
                <button
                  type="button"
                  aria-label={`Close ${tabLabel(tab.view, nameOf)}`}
                  onClick={() => close(tab.key)}
                  className="rounded-chip p-0.5 text-ink-3 opacity-0 transition-opacity duration-150 hover:bg-hover-2 hover:text-ink group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        aria-label="New agent"
        title="New agent"
        onClick={() => setNewAgentOpen(true)}
        className="shrink-0 rounded-chip p-1 text-ink-3 hover:bg-hover hover:text-ink"
      >
        <Plus className="h-4 w-4" />
      </button>

      {/* The rest of the row is window chrome. */}
      <div data-tauri-drag-region className="h-full flex-1" />

      <button
        type="button"
        onClick={onCommand}
        title="Command palette  ⌘K"
        className="flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-[12px] text-ink-2 hover:bg-hover hover:text-ink"
      >
        <Play className="h-3 w-3" />
        Command
      </button>

      <button
        type="button"
        aria-label={railOpen ? 'Hide details' : 'Show details'}
        title="Details  ⌘J"
        onClick={toggleRail}
        className={cn(
          'shrink-0 rounded-chip p-1 hover:bg-hover hover:text-ink',
          railOpen ? 'text-ink' : 'text-ink-3',
        )}
      >
        <PanelRight className="h-4 w-4" />
      </button>
    </div>
  )
}
