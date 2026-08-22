import { useEffect } from 'react'
import { FleetView } from '@/features/fleet/FleetView'
import { SessionView } from '@/features/session/SessionView'
import { PacksView } from '@/features/packs/PacksView'
import { InterfaceSourceView } from '@/features/onboarding/InterfaceSourceView'
import { NewAgentDialog } from '@/features/fleet/NewAgentDialog'
import { useFleet } from '@/stores/fleet'
import { useLayout } from '@/stores/layout'
import { activeView, useUi } from '@/stores/ui'
import { Sidebar } from './Sidebar'
import { TabStrip } from './TabStrip'
import { StatusBar } from './StatusBar'

/**
 * The persistent frame (UI_PLAN §2, S1).
 *
 * The point of this component is what it *doesn't* do: it never unmounts. Only
 * the body of the centre column swaps, so the fleet stays visible in the sidebar
 * while you are inside a session and navigation stops being a scene change.
 *
 * The right rail is S4; the grid is already shaped for its column.
 */
export function Shell() {
  const sidebarOpen = useLayout((s) => s.sidebarOpen)
  const view = useUi(activeView)
  const instances = useFleet((s) => s.instances)
  const prune = useUi((s) => s.prune)

  // A restored tab can outlive the agent it pointed at — the instance may have
  // been deleted from another client while this one was closed.
  useEffect(() => {
    if (instances.length) prune(instances.map((i) => i.id))
  }, [instances, prune])

  useShortcuts()

  return (
    <div
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: sidebarOpen ? 'auto 1fr' : '1fr', gridTemplateRows: '1fr auto' }}
    >
      {sidebarOpen && <Sidebar />}
      <main className="flex min-h-0 min-w-0 flex-col bg-page">
        <TabStrip />
        <div className="min-h-0 flex-1">
          {view.kind === 'session' ? (
            // Keyed so switching agents rebuilds the transcript rather than
            // letting one session's scroll state bleed into another's.
            <SessionView key={view.instanceId} instanceId={view.instanceId} />
          ) : view.kind === 'packs' ? (
            <PacksView />
          ) : view.kind === 'source' ? (
            <SourceTab />
          ) : (
            <FleetView />
          )}
        </div>
      </main>
      <StatusBar />
      {/* One dialog for the whole shell: the sidebar, the tab strip and the
          fleet's own button all open the same thing. */}
      <NewAgentDialog />
    </div>
  )
}

function SourceTab() {
  const markSourceBound = useUi((s) => s.markSourceBound)
  return <InterfaceSourceView onDone={markSourceBound} />
}

function useShortcuts() {
  const { close, select, step, activeKey, tabs } = useUi()
  const toggleSidebar = useLayout((s) => s.toggleSidebar)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      // ⌘1–⌘9 by position; ⌘9 is the last tab, not the ninth, matching browsers.
      if (!e.shiftKey && e.key >= '1' && e.key <= '9') {
        const at = e.key === '9' ? tabs.length - 1 : Number(e.key) - 1
        if (tabs[at]) {
          e.preventDefault()
          select(tabs[at].key)
        }
        return
      }
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault()
        close(activeKey)
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.shiftKey && (e.key === '[' || e.key === '{')) {
        e.preventDefault()
        step(-1)
      } else if (e.shiftKey && (e.key === ']' || e.key === '}')) {
        e.preventDefault()
        step(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeKey, close, select, step, tabs, toggleSidebar])
}
