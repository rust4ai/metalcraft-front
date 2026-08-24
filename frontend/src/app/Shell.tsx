import { useEffect, useState } from 'react'
import { FleetView } from '@/features/fleet/FleetView'
import { SessionView } from '@/features/session/SessionView'
import { PacksView } from '@/features/packs/PacksView'
import { AutomationsView } from '@/features/automations/AutomationsView'
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
  const fleetLoaded = useFleet((s) => s.loaded)
  const prune = useUi((s) => s.prune)

  // A restored tab can outlive the agent it pointed at — the instance may have
  // been deleted from another client while this one was closed.
  //
  // Gated on `loaded`, not on `instances.length`. The first version skipped an
  // empty fleet to avoid pruning before the first load had answered — but that
  // also meant a pod whose agents were *all* deleted kept every dead tab, each
  // one opening onto a 404. Empty is a real answer; not-yet-asked is not.
  useEffect(() => {
    if (fleetLoaded) prune(instances.map((i) => i.id))
  }, [fleetLoaded, instances, prune])

  const [paletteOpen, setPaletteOpen] = useState(false)
  useShortcuts(setPaletteOpen)

  return (
    <div
      // `relative` so the nudge card can sit over the bottom-left corner the way
      // Orca's does, without taking a column in the grid.
      className="relative grid h-full min-h-0 overflow-hidden"
      style={{
        gridTemplateColumns: `${sidebarOpen ? 'auto ' : ''}minmax(0, 1fr)${railOpen ? ' auto' : ''}`,
        // `minmax(0, 1fr)`, not `1fr`: a bare `1fr` row takes its *minimum* from
        // its content, so a sidebar holding thirty agents made the row taller
        // than the window — which pushed the composer and the status bar below
        // the bottom edge, and left an agent chat looking like it had no input
        // field at all. A zero minimum lets the panes' own scrollers do their
        // job instead.
        gridTemplateRows: 'minmax(0, 1fr) auto',
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
          ) : view.kind === 'automations' ? (
            <AutomationsView />
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
      {/* One dialog for the whole shell: the sidebar, the tab strip, the palette
          and the fleet's own button all open the same thing. */}
      <NewAgentDialog />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

function SourceTab() {
  const markOwnSource = useUi((s) => s.markOwnSource)
  return <InterfaceSourceView onDone={markOwnSource} />
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
