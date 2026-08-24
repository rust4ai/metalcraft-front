/**
 * The only way the renderer reaches the outside world.
 *
 * Two implementations behind one interface: `tauri` (invoke + Tauri events) and,
 * later, `http` (fetch + EventSource against the stateless proxy) for the browser
 * build. Nothing else in `src/` may import `@tauri-apps/api` — an oxlint rule
 * enforces it — because retrofitting this after the UI is full of invoke() calls
 * is the expensive version of shipping a web target (PLAN §8, §11 P11).
 */
export interface Transport {
  /** Call a command in the core and await its result. */
  call<T>(method: string, args?: Record<string, unknown>): Promise<T>
  /** Subscribe to a stream of events on a channel. Returns an unsubscribe fn. */
  listen<T>(channel: string, onEvent: (payload: T) => void): Promise<() => void>
}

let active: Transport | null = null

export function setTransport(t: Transport) {
  active = t
}

export function transport(): Transport {
  if (!active) throw new Error('no transport installed — call setTransport() at startup')
  return active
}

/**
 * Every failed command, in one place.
 *
 * The error log needs to see failures the callers already handled — a store that
 * catches and shows "could not load" has told the user *that* it broke and
 * thrown away *what* broke. Wrapping here catches all of them without asking
 * sixty call sites to remember, and rethrows unchanged so no existing handling
 * changes behaviour.
 *
 * A registration hook rather than an import so this file keeps depending on
 * nothing: `stores/diagnostics` imports the transport, never the other way
 * round, and the boundary stays a boundary.
 */
type CallErrorSink = (method: string, error: unknown) => void

let sink: CallErrorSink | null = null

export function onCallError(fn: CallErrorSink | null) {
  sink = fn
}

export const call = async <T,>(method: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await transport().call<T>(method, args)
  } catch (e) {
    // A throwing sink must not turn a reported failure into a second, worse
    // one — the caller is owed its own error, not the logger's.
    try {
      sink?.(method, e)
    } catch {
      // Nothing to report it to; reporting is what just failed.
    }
    throw e
  }
}

export const listen = <T,>(channel: string, onEvent: (payload: T) => void) =>
  transport().listen<T>(channel, onEvent)
