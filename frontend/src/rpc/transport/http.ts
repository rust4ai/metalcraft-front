import type { Transport } from './index'

/**
 * The renderer, over HTTP.
 *
 * Talks to `front-tauri`'s dev bridge (`dev_rpc.rs`, behind the `dev-rpc`
 * feature and `MC_DEV_RPC`), which mirrors the same command names Tauri IPC
 * exposes. That makes `npm run dev` in a browser the **real UI on the real
 * core** — the app becomes scriptable, which is what let the automations work
 * get checked against a live pod at all.
 *
 * It is also the shape P11's web target needs: same interface, same method
 * names, a different server behind it.
 */
export function httpTransport(base: string): Transport {
  return {
    call: async <T,>(method: string, args?: Record<string, unknown>): Promise<T> => {
      const res = await fetch(`${base}/rpc/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args ?? {}),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        // The bridge answers `{ error }` with the core's own message, which is
        // the one worth showing — "session expired" beats "400".
        throw new Error(body?.error ?? `${res.status} ${method}`)
      }
      return body as T
    },

    listen: async <T,>(channel: string, onEvent: (payload: T) => void) => {
      const source = new EventSource(`${base}/sse?channel=${encodeURIComponent(channel)}`)
      source.onmessage = (e) => {
        try {
          onEvent(JSON.parse(e.data) as T)
        } catch {
          // A frame we cannot parse is one frame lost, not a dead stream.
        }
      }
      return () => source.close()
    },
  }
}
