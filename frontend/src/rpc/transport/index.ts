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

export const call = <T,>(method: string, args?: Record<string, unknown>) =>
  transport().call<T>(method, args)

export const listen = <T,>(channel: string, onEvent: (payload: T) => void) =>
  transport().listen<T>(channel, onEvent)
