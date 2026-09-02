import { useEffect } from 'react'
import {
  ChevronRight,
  Hexagon,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  ScrollText,
  Search,
  Sun,
} from 'lucide-react'
import { useConnection } from '@/stores/connection'
import { useFleet } from '@/stores/fleet'
import { useLayout } from '@/stores/layout'
import { useTheme, themeLabel } from '@/stores/theme'
import { activeView, useUi } from '@/stores/ui'
import { DIAG_POLL_MS, unseen, useDiagnostics } from '@/stores/diagnostics'
import { cn } from '@/lib/cn'
import { tabLabel } from './TabStrip'

/**
 * The window's one piece of chrome (HARNESS_UI_PLAN §4, H1).
 *
 * Before this, the frameless window paid for its own title bar three times: the
 * sidebar header carried the pod name and the traffic-light inset, the tab strip
 * carried the same inset again for when the sidebar was hidden, and the status
 * bar carried the account because deleting the title bar had left it homeless.
 * Three headers at one height, none of them the window's.
 *
 * Collecting them costs one grid row and buys the thing the reference has and we
 * did not: a place where "which pod, which room, who am I" is answered once, in
 * reading order, above everything that changes.
 *
 * This is the drag region, and the only row that reserves the traffic lights.
 */
export function TopBar() {
  const { info, pod, session } = useConnection()
  const { sidebarOpen, toggleSidebar, railOpen, toggleRail } = useLayout()

  return (
    <header
      data-tauri-drag-region
      // A three-column grid rather than a flex row so the search field is centred
      // on the *window*, not on whatever space the two clusters happen to leave.
      // With flex, renaming a pod would slide the search box.
      className="col-span-full grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-line bg-canvas pr-2"
    >
      {/* The traffic lights live here now, and only here. */}
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-1.5 pl-20">
        <button
          type="button"
          aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          title="Sidebar  ⌘B"
          onClick={toggleSidebar}
          className={cn(
            'shrink-0 rounded-chip p-1 hover:bg-hover hover:text-ink',
            sidebarOpen ? 'text-ink-2' : 'text-ink-3',
          )}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <span
          data-tauri-drag-region
          className="ml-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-chip bg-hover-2 text-ink-2"
        >
          <Hexagon className="h-3 w-3" />
        </span>
        <span data-tauri-drag-region className="shrink-0 text-[12.5px] font-semibold">
          Metalcraft
        </span>

        {/* The breadcrumb, only once there is a pod. The name is the human one;
            the slug and the version are machine facts and stay in the status
            bar, so neither row repeats the other. */}
        {(info?.name || pod) && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
            <span data-tauri-drag-region className="shrink-0 truncate text-[12.5px] text-ink-2">
              {info?.name ?? pod?.slug}
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
            <ActiveRoom />
          </>
        )}
      </div>

      <SearchField />

      <div className="flex min-w-0 items-center justify-end gap-0.5">
        {/* The usage ring the reference puts here is deliberately absent until
            H5: there is no number behind it yet, and a ring reading `<1%` off a
            figure the pod never sent is exactly the hollow control §0 forbids. */}
        <ErrorLogButton />
        <ThemeButton />
        <button
          type="button"
          aria-label={railOpen ? 'Hide details' : 'Show details'}
          title="Details  ⌘J"
          onClick={toggleRail}
          className={cn(
            'shrink-0 rounded-chip p-1 hover:bg-hover hover:text-ink',
            railOpen ? 'text-ink-2' : 'text-ink-3',
          )}
        >
          <PanelRight className="h-4 w-4" />
        </button>
        {/* Only with an account. A pod you run yourself needs no Metalcraft
            identity, and this corner must not imply one is missing. */}
        {session && <Account email={session.email} />}
      </div>
    </header>
  )
}

/** The room the centre column is showing, as the last crumb. */
function ActiveRoom() {
  const view = useUi(activeView)
  const instances = useFleet((s) => s.instances)
  const label = tabLabel(view, (id) => instances.find((i) => i.id === id)?.name)
  return (
    <span data-tauri-drag-region className="min-w-0 truncate text-[12.5px] font-medium text-ink">
      {label}
    </span>
  )
}

/**
 * A button dressed as a field.
 *
 * It never takes focus or holds a query — pressing it opens the palette, which
 * has its own input and all the ranking. Drawing a real `<input>` here would mean
 * two search boxes with two different result sets, and the one you would type
 * into first is the one with nothing behind it.
 */
function SearchField() {
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      title="Search  ⌘K"
      className="flex h-7 w-[min(420px,34vw)] items-center gap-2 rounded-control bg-field px-2.5 text-[12.5px] text-ink-3 shadow-hairline transition-colors duration-150 hover:bg-hover-2 hover:text-ink-2"
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">Search agents, packs, commands…</span>
      <kbd className="ml-auto shrink-0 rounded-chip bg-hover-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
        ⌘K
      </kbd>
    </button>
  )
}

/**
 * The error log, where the reference puts a bell.
 *
 * Not *as* a bell. A bell asserts a stream of things that want your attention;
 * this is a log of things that already went wrong and were handled. Keeping the
 * `ScrollText` glyph is the difference between a control that describes itself
 * and one that borrows a promise from a screenshot.
 *
 * The badge is the whole point. Most of what this log catches is invisible by
 * definition: a call that failed and was handled, a core command that degraded
 * instead of erroring. Nothing else on screen changes when one lands, so without
 * a count the log would only ever be read by someone who already suspected it
 * had something in it.
 *
 * Moved here from the sidebar footer, where it was reachable only with the
 * sidebar open — which is the state someone hunting a fault is least likely to
 * be in.
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

  return (
    <button
      type="button"
      aria-label={count > 0 ? `Error log, ${count} new` : 'Error log'}
      title={count > 0 ? `Error log — ${count} new` : 'Error log'}
      onClick={() => go({ kind: 'errors' })}
      className={cn(
        'relative shrink-0 rounded-chip p-1 hover:bg-hover hover:text-ink',
        activeKey === 'errors' ? 'text-ink' : 'text-ink-3',
      )}
    >
      <ScrollText className="h-4 w-4" />
      {count > 0 && (
        <span
          // A dot, not a number: the count is in the tooltip and the label, and
          // a two-digit badge on a 16px icon is unreadable at every size.
          // `ring-canvas` so it reads as an overlay rather than part of the glyph.
          //
          // Red only when something actually failed. Most of what lands here is
          // a workaround that held — marking those as red teaches people to
          // ignore the dot, which costs the one time it matters.
          className={cn(
            'absolute right-0 top-0 h-2 w-2 rounded-full ring-2 ring-canvas',
            failed > 0 ? 'bg-red' : 'bg-orange',
          )}
        />
      )}
    </button>
  )
}

function ThemeButton() {
  const { theme, cycle } = useTheme()
  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon
  return (
    <button
      type="button"
      aria-label={themeLabel(theme)}
      title={`${themeLabel(theme)} — click to change`}
      onClick={cycle}
      className="shrink-0 rounded-chip p-1 text-ink-3 hover:bg-hover hover:text-ink"
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

/**
 * Who this window is signed in as.
 *
 * A monogram, not an avatar: the session is `{ email, premium }` and carries no
 * picture and no display name (`types.ts:9`). A generic person glyph in this
 * corner would claim there is a profile behind it; an initial derived from the
 * address claims only what it is derived from.
 */
function Account({ email }: { email: string }) {
  return (
    <span className="ml-1.5 flex min-w-0 items-center gap-1.5" title={email}>
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-hover-2 text-[10px] font-semibold uppercase text-ink-2">
        {email.slice(0, 1)}
      </span>
      <span className="hidden min-w-0 truncate text-[12px] text-ink-2 lg:block">{email}</span>
    </span>
  )
}
