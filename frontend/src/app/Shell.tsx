import { useEffect, useState } from 'react'
import { FleetView } from '@/features/fleet/FleetView'
import { SessionView } from '@/features/session/SessionView'
import { PacksView } from '@/features/packs/PacksView'
import { SettingsView } from '@/features/settings/SettingsView'
import { InterfaceSourceView } from '@/features/onboarding/InterfaceSourceView'
import { NewAgentDialog } from '@/features/fleet/NewAgentDialog'
import { useFleet } from '@/stores/fleet'
import { useLayout } from '@/stores/layout'
import { activeView, useUi } from '@/stores/ui'
import { Sidebar } from './Sidebar'
import { TabStrip } from './TabStrip'
import { StatusBar } from './StatusBar'
import { RightRail } from './RightRail'
import { Nudges } from './Nudges'
import { CommandPalette } from './CommandPalette'

/**
 * The persistent frame (UI_PLAN §2, S1).
 *
 * The point of this component is what it *doesn't* do: it never unmounts. Only
 * the body of the centre column swaps, so the fleet stays visible in the sidebar
 * while you are inside a session and navigation stops being a scene change.
 *
 * Both side columns are `auto`-sized rather than fractional: their widths come
 * from the layout store, and the centre takes whatever is left.
 */
export function Shell() {
  const sidebarOpen = useLayout((s) => s.sidebarOpen)
  const railOpen = useLayout((s) => s.railOpen)
  const view = useUi(activeView)
  const instances = useFleet((s) => s.instances)
  const prune = useUi((s) => s.prune)

  // A restored tab can outlive the agent it pointed at — the instance may have
  // been deleted from another client while this one was closed.
  useEffect(() => {
    if (instances.length) prune(instances.map((i) => i.id))
  }, [instances, prune])

  const [paletteOpen, setPaletteOpen] = useState(false)
  useShortcuts(setPaletteOpen)

  return (
    <div
      // `relative` so the nudge card can sit over the bottom-left corner the way
      // Orca's does, without taking a column in the grid.
      className="relative grid h-full min-h-0"
      style={{
        gridTemplateColumns: `${sidebarOpen ? 'auto ' : ''}1fr${railOpen ? ' auto' : ''}`,
        gridTemplateRows: '1fr auto',
      }}
    >
      {sidebarOpen && <Sidebar />}
      <main className="flex min-h-0 min-w-0 flex-col bg-page">
        <TabStrip onCommand={() => setPaletteOpen(true)} />
        <div className="min-h-0 flex-1">
          {view.kind === 'session' ? (
            // Keyed so switching agents rebuilds the transcript rather than
            // letting one session's scroll state bleed into another's.
            <SessionView key={view.instanceId} instanceId={view.instanceId} />
          ) : view.kind === 'packs' ? (
            <PacksView />
          ) : view.kind === 'settings' ? (
            <SettingsView />
          ) : view.kind === 'source' ? (
            <SourceTab />
          ) : (
            <FleetView />
          )}
        </div>
      </main>
      {railOpen && <RightRail />}
      <StatusBar />
      <Nudges />
      {/* One dialog for the whole shell: the sidebar, the tab strip, the palette
          and the fleet's own button all open the same thing. */}
      <NewAgentDialog />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

function SourceTab() {
  const markSourceBound = useUi((s) => s.markSourceBound)
  return <InterfaceSourceView onDone={markSourceBound} />
}

function useShortcuts(setPaletteOpen: (open: boolean) => void) {
  const { close, select, step, activeKey, tabs, setNewAgentOpen } = useUi()
  const toggleSidebar = useLayout((s) => s.toggleSidebar)
  const toggleRail = useLayout((s) => s.toggleRail)

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
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setNewAgentOpen(true)
      } else if (e.key.toLowerCase() === 'w') {
        e.preventDefault()
        close(activeKey)
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key.toLowerCase() === 'j') {
        e.preventDefault()
        toggleRail()
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
