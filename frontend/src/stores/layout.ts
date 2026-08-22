import { create } from 'zustand'

/**
 * Where the furniture sits: sidebar and right-rail geometry.
 *
 * Layout is local (PLAN §14.2) — the pod holds no opinion about it — so this
 * persists to `localStorage` rather than the pod or `tauri-plugin-store`.
 * `localStorage` is also the only one of the three that survives the P11 web
 * build unchanged.
 *
 * Widths measured off the Orca reference (UI_PLAN §1).
 */
export const SIDEBAR = { default: 264, min: 200, max: 420 }
export const RAIL = { default: 368, min: 280, max: 560 }

interface LayoutState {
  sidebarOpen: boolean
  sidebarWidth: number
  /** The rail arrives with S4; the geometry is here so the grid does not need
   *  rewriting when it does. */
  railOpen: boolean
  railWidth: number

  toggleSidebar: () => void
  setSidebarWidth: (px: number) => void
  toggleRail: () => void
  setRailWidth: (px: number) => void
}

const KEY = 'mc.layout'

function load(): Partial<LayoutState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LayoutState>
  } catch {
    return {}
  }
}

/** Clamp on read as well as on write: a persisted width outlives the constant
 *  it was clamped against, and a 900px sidebar from an older build should not
 *  eat the window. */
const clamp = (px: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, Math.round(px)))

export const useLayout = create<LayoutState>((set, get) => {
  const saved = load()

  const persist = () => {
    const { sidebarOpen, sidebarWidth, railOpen, railWidth } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ sidebarOpen, sidebarWidth, railOpen, railWidth }))
    } catch {
      // A webview with storage disabled loses the layout on quit, which is a
      // cosmetic loss and not worth failing a render over.
    }
  }
  const commit = (patch: Partial<LayoutState>) => {
    set(patch)
    persist()
  }

  return {
    sidebarOpen: saved.sidebarOpen ?? true,
    sidebarWidth: clamp(saved.sidebarWidth ?? SIDEBAR.default, SIDEBAR),
    railOpen: saved.railOpen ?? false,
    railWidth: clamp(saved.railWidth ?? RAIL.default, RAIL),

    toggleSidebar: () => commit({ sidebarOpen: !get().sidebarOpen }),
    setSidebarWidth: (px) => commit({ sidebarWidth: clamp(px, SIDEBAR) }),
    toggleRail: () => commit({ railOpen: !get().railOpen }),
    setRailWidth: (px) => commit({ railWidth: clamp(px, RAIL) }),
  }
})
