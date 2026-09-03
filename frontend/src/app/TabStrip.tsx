import { BookOpen, Bot, Clock, KeyRound, LayoutGrid, Plus, ScrollText, ServerCog, Settings, Store, Target, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useFleet } from '@/stores/fleet'
import { useUi, type View } from '@/stores/ui'
import { cn } from '@/lib/cn'

/** What a tab calls itself. Session tabs borrow the instance's name, so renaming
 *  an agent renames its tab without the tab model knowing anything about it. */
export function tabLabel(view: View, nameOf: (id: string) => string | undefined): string {
  switch (view.kind) {
    case 'fleet':
      return 'Home'
    case 'packs':
      return 'Extensions'
    // Not "Artifacts": the word for what is on the pod has to be the word
    // someone would reach for, and nobody goes looking for their artifacts.
    case 'library':
      return 'Library'
    case 'automations':
      return 'Automations'
    case 'goals':
      return 'Goals'
    // Not "Interface source": a tab label is a word, not a sentence, and the
    // pane it opens already carries the full title.
    case 'source':
      return 'Source'
    case 'pods':
      return 'Pods'
    case 'settings':
      return 'Settings'
    case 'errors':
      return 'Error log'
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
    case 'library':
      return <BookOpen className={cls} />
    case 'automations':
      return <Clock className={cls} />
    case 'goals':
      return <Target className={cls} />
    case 'source':
      return <KeyRound className={cls} />
    case 'pods':
      return <ServerCog className={cls} />
    case 'settings':
      return <Settings className={cls} />
    case 'errors':
      return <ScrollText className={cls} />
    case 'session':
      return <Bot className={cls} />
  }
}

/**
 * The centre column's header (UI_PLAN §2, S3).
 *
 * Open documents, not modes — this strip holds Home, Settings and three agents
 * at once, which is a different object from the session mode switcher below it.
 *
 * It no longer reserves the traffic lights: since HARNESS_UI_PLAN H1 the window
 * bar above does that, whether or not the sidebar is open. The empty space to
 * the right of the last tab is still a drag region.
 */
export function TabStrip() {
  const { tabs, activeKey, select, close, setNewAgentOpen } = useUi()
  const instances = useFleet((s) => s.instances)
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
      className="flex h-[34px] shrink-0 items-center gap-1 border-b border-line bg-canvas pr-2"
    >
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto pl-2">
        {tabs.map((tab) => {
          const active = tab.key === activeKey
          const closable = tab.key !== 'fleet'
          return (
            <div
              key={tab.key}
              ref={active ? activeTab : undefined}
              className={cn(
                'group flex h-[28px] min-w-0 shrink-0 items-center gap-1.5 rounded-full pl-2.5 text-[12.5px] transition-colors duration-150',
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

      {/* The rest of the row is window chrome. The command button and the rail
          toggle that used to end it are in the window bar now — one search
          affordance, one panel toggle, both above. */}
      <div data-tauri-drag-region className="h-full flex-1" />
    </div>
  )
}
