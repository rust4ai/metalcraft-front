import { useEffect } from 'react'
import { FleetView } from '@/features/fleet/FleetView'
import { SessionView } from '@/features/session/SessionView'
import { PacksView } from '@/features/packs/PacksView'
import { AutomationsView } from '@/features/automations/AutomationsView'
import { ProjectsView } from '@/features/projects/ProjectsView'
import { SettingsView } from '@/features/settings/SettingsView'
import { ErrorLogView } from '@/features/diagnostics/ErrorLogView'
import { LibraryView } from '@/features/library/LibraryView'
import { InterfaceSourceView } from '@/features/onboarding/InterfaceSourceView'
import { LaunchpadView } from '@/features/onboarding/LaunchpadView'
import { NewAgentDialog } from '@/features/fleet/NewAgentDialog'
import { UpdateReportDialog } from '@/features/packs/UpdateReportDialog'
import { useFleet } from '@/stores/fleet'
import { usePacks } from '@/stores/packs'
import { useLayout } from '@/stores/layout'
import { activeView, useUi } from '@/stores/ui'
import { Sidebar } from './Sidebar'
import { TabStrip } from './TabStrip'
import { TopBar } from './TopBar'
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
  const loadPacks = usePacks((s) => s.load)

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

  // Ask the pod's registries whether anything it has installed is out of date.
  // Here rather than in `App`, because the question only exists once there is a
  // pod — and this frame is exactly the "there is a pod" case, so a window that
  // never gets one never loads any of it.
  //
  // Detecting is not applying: the pod's rule is that nothing changes under a
  // running agent because somebody published. But a pack you run every day
  // should not go a year out of date because the shop was a tab you never
  // opened, so the sidebar carries the count and pressing anything stays a
  // decision.
  useEffect(() => {
    void loadPacks()
  }, [loadPacks])

  const paletteOpen = useUi((s) => s.paletteOpen)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  useShortcuts()

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
        // Three rows now: the window's own bar, the columns, the status bar.
        // The first and last are `auto` and the middle takes the rest, which is
        // what keeps a long sidebar from pushing the composer off the bottom.
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
      }}
    >
      <TopBar />
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
          ) : view.kind === 'projects' ? (
            <ProjectsView />
          ) : view.kind === 'automations' ? (
            <AutomationsView />
          ) : view.kind === 'settings' ? (
            <SettingsView />
          ) : view.kind === 'errors' ? (
            <ErrorLogView />
          ) : view.kind === 'library' ? (
            <LibraryView />
          ) : view.kind === 'source' ? (
            <SourceTab />
          ) : view.kind === 'pods' ? (
            // The same component the app opens on with no pod. Inside the frame
            // it reads as a pod switcher, because that is what it is once one is
            // connected (LAUNCHPAD_PLAN §4).
            <LaunchpadView />
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
      {/* At the frame, not inside the registry browser: a pack can now be updated
          from the Library too, and an account of which agents that changed must
          not depend on which tab you happened to press the button in. */}
      <UpdateReportDialog />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

function SourceTab() {
  const markOwnSource = useUi((s) => s.markOwnSource)
  return <InterfaceSourceView onDone={markOwnSource} />
}

function useShortcuts() {
  const { close, select, step, activeKey, tabs, setNewAgentOpen, setPaletteOpen } = useUi()
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
  }, [activeKey, close, select, step, tabs, toggleSidebar, toggleRail, setNewAgentOpen, setPaletteOpen])
}
