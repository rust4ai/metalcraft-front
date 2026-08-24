import { create } from 'zustand'
import { diagnostics as rpc } from '@/rpc'
import { onCallError } from '@/rpc/transport'
import type { Diagnostic } from '@/types'

/**
 * The error log.
 *
 * It exists because of a specific failure mode this app is full of, and which is
 * invisible by construction: a call fails, something catches it to keep a pane
 * alive, and the reason is gone. `octaweave_status` is the worst case — the core
 * degrades a pod that will not answer into an empty integration list, the card
 * renders that as "the pack is not installed", and someone is offered an Install
 * button for tools they already have. Every layer behaved correctly and the
 * result is a lie with no trace.
 *
 * So this store collects from three places, and the point is that none of them
 * required the failing code to opt in:
 *
 * - **Every rejected command**, via the transport's error sink. Callers keep
 *   their own handling; this sees the rejection on the way past.
 * - **The core's own log** (`list_diagnostics`), where a command that chose to
 *   degrade says what it degraded and what it cost.
 * - **Anything the renderer throws** that nobody caught, plus the handful of
 *   places that catch deliberately and call {@link useDiagnostics.report}.
 *
 * Entries are memory-only and per-session on the app side, on purpose. A log
 * that survives a reload has to answer "is this still true?", and the honest
 * answer for a transport failure recorded an hour and a restart ago is usually
 * no. The core's half survives as long as the core process does, which is the
 * right lifetime for it and is why the two halves are labelled.
 */

/** Distinct problems worth keeping. Repeats collapse, so this is a lot of log. */
const CAP = 200

/**
 * How stale the core's half may be before the badge is worth doubting.
 *
 * Slow, because it is a fallback rather than the main path: the core is only
 * asked on a schedule so an unattended window still notices a degradation, and
 * the log refetches on open regardless. Anything faster would be polling for
 * something that mostly never changes.
 */
export const DIAG_POLL_MS = 30_000

interface DiagnosticsState {
  /** Newest first, both halves merged. */
  entries: Diagnostic[]
  /** `at` of the newest entry the user has actually looked at. */
  seenAt: number
  loading: boolean

  /** Record something this window saw. */
  report: (
    source: string,
    message: string,
    detail?: unknown,
    level?: 'warn' | 'error',
  ) => void
  /** Pull the core's half and merge it in. */
  load: () => Promise<void>
  /** Empty both halves. */
  clear: () => Promise<void>
  /** Mark everything currently held as read. */
  markSeen: () => void
}

/**
 * What has arrived since the last look, and whether any of it actually failed.
 *
 * Two numbers rather than one because the badge should not cry wolf: a pod that
 * degraded something is worth a mark, and a command that failed outright is
 * worth a redder one. Returned together so the sidebar reads the store once.
 */
export function unseen(s: Pick<DiagnosticsState, 'entries' | 'seenAt'>): {
  count: number
  failed: number
} {
  const fresh = s.entries.filter((d) => d.at > s.seenAt)
  return { count: fresh.length, failed: fresh.filter((d) => d.level === 'error').length }
}

/**
 * An error as a sentence.
 *
 * `String(e)` on an Error gives "Error: the pod would not answer", and the
 * prefix is noise in a list where every line is already an error. Tauri rejects
 * with a bare string, the http transport with an `Error`, and a thrown object
 * with neither — all three have to come out readable.
 */
export function describe(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message || e.name
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

/**
 * One list, newest first, capped.
 *
 * Interleaving by time rather than grouping by half is the whole value of
 * merging them: "the pod stopped answering, and then the card degraded" reads as
 * cause and effect in one column, and as two unrelated lists in two.
 */
function merge(...lists: Diagnostic[][]): Diagnostic[] {
  // `sort` rather than `toSorted`: the build targets safari15 for older macOS
  // webviews. `flat()` already returns a new array, so nothing is sorted in place.
  // oxlint-disable-next-line unicorn/no-array-sort
  return lists.flat().sort((a, b) => b.at - a.at).slice(0, CAP)
}

export const useDiagnostics = create<DiagnosticsState>((set, get) => ({
  entries: [],
  seenAt: 0,
  loading: false,

  report: (source, message, detail, level = 'error') => {
    const at = Date.now()
    const text = detail === undefined ? undefined : describe(detail)
    const entries = get().entries

    // Collapse repeats the same way the core does. Without it, a poll against a
    // pod that is down writes a line every 2.5 seconds and the log becomes the
    // thing it was built to prevent.
    const hit = entries.find(
      (d) => d.origin === 'app' && d.source === source && d.message === message,
    )

    // The newest cause wins under a stable summary: when a problem changes shape
    // without changing what it means, the current reason is the useful one.
    const next: Diagnostic = hit
      ? { ...hit, at, count: hit.count + 1, detail: text ?? null }
      : {
          id: `app:${source}:${at}`,
          at,
          level,
          source,
          message,
          detail: text ?? null,
          count: 1,
          origin: 'app',
        }

    set({ entries: merge([next], hit ? entries.filter((d) => d !== hit) : entries) })
  },

  load: async () => {
    set({ loading: true })
    try {
      const core = await rpc.list()
      set({
        entries: merge(
          get().entries.filter((d) => d.origin === 'app'),
          core.map((d) => ({ ...d, id: `core:${d.id}`, origin: 'core' as const })),
        ),
        loading: false,
      })
    } catch {
      // The log failing to load must not write itself a line about failing to
      // load — that is a loop, and the transport sink already skips this
      // command for the same reason.
      set({ loading: false })
    }
  },

  clear: async () => {
    set({ entries: [], seenAt: Date.now() })
    try {
      await rpc.clear()
    } catch {
      // The app's half is cleared either way. A core that will not clear keeps
      // its entries and the next load brings them back, which is the truthful
      // outcome — they are still there.
    }
  },

  markSeen: () => set({ seenAt: Math.max(get().entries[0]?.at ?? 0, get().seenAt) }),
}))

/**
 * Point the capture sources at the store. Called once at startup.
 *
 * Split out rather than run on import so a test can mount the store without a
 * transport, and so the one place that installs global handlers is the entry
 * point rather than a module side effect.
 */
export function captureDiagnostics(target: Window = window) {
  onCallError((method, error) => {
    // Reporting the log's own failure through the log is a loop.
    if (method === 'list_diagnostics' || method === 'clear_diagnostics') return
    useDiagnostics.getState().report(method, describe(error), undefined)
  })

  target.addEventListener('error', (e) => {
    const ev = e as ErrorEvent
    useDiagnostics
      .getState()
      .report(
        'renderer',
        ev.message || 'an uncaught error',
        ev.filename ? `${ev.filename}:${ev.lineno ?? 0}` : undefined,
      )
  })

  // The one that matters most in an app this async: a rejected promise nobody
  // awaited used to reach the Rust log via the boot probe and nowhere a user
  // would look.
  target.addEventListener('unhandledrejection', (e) => {
    const ev = e as PromiseRejectionEvent
    useDiagnostics.getState().report('renderer', `unhandled rejection: ${describe(ev.reason)}`)
  })
}
