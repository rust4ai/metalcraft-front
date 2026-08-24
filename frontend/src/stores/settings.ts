import { create } from 'zustand'
import { keys as keysRpc, octaweave } from '@/rpc'
import type {
  KeyEntry,
  OctaweaveConnection,
  OctaweaveStatus,
  OctaweaveWorkspace,
} from '@/types'

/**
 * The pod's key store and its Octaweave connection (PLAN §10.6, §9.3).
 *
 * Values are never held here. `KeyEntry` carries a `masked` preview and nothing
 * more, and the one place a real secret exists in this app is the argument to
 * `save` — which goes straight through the transport into the core. Keeping a
 * written value in a store "so the form can show it" is how a credential ends up
 * in a devtools snapshot.
 */
interface SettingsState {
  keys: KeyEntry[]
  loadingKeys: boolean
  keyError: string | null

  octaweave: OctaweaveStatus | null
  connection: OctaweaveConnection | null
  octaweaveBusy: boolean
  octaweaveError: string | null
  /** The browser is open on Octaweave's link page and we are re-asking. */
  octaweaveLinking: boolean
  /** More than one workspace, so the choice is the user's. */
  octaweaveChoices: OctaweaveWorkspace[] | null

  loadKeys: () => Promise<void>
  saveKey: (name: string, value: string) => Promise<string | null>
  deleteKey: (name: string) => Promise<void>

  loadOctaweave: () => Promise<void>
  /**
   * The whole connection, from a button press.
   *
   * Returns the *pack* error when the key stored but the tools did not — a
   * halfway state the card names separately. Anything that failed outright sets
   * `octaweaveError` instead and returns null, so it is never shown twice.
   *
   * `pollMs` exists for tests. The waiting loop is the one part of this that is
   * measured in minutes, and a test should not be.
   */
  connectOctaweave: (workspace?: string, pollMs?: number) => Promise<string | null>
  /** Stop waiting on the browser. The link itself may still land; the next
   *  Connect will find it. */
  cancelOctaweaveLink: () => void
  installOctaweavePack: () => Promise<string | null>
  disconnectOctaweave: () => Promise<void>
}

/**
 * How often the app re-asks whether the link landed, and for how long.
 *
 * The user is over in a browser, so 2.5s is quick enough to feel immediate and
 * slow enough to be invisible traffic. Three minutes is roughly where "they got
 * distracted" becomes likelier than "it is about to work", and giving up there
 * beats a spinner that never ends — the link survives, and Connect picks it up.
 */
const POLL_MS = 2500
const POLL_LIMIT_MS = 180_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const useSettings = create<SettingsState>((set, get) => ({
  keys: [],
  loadingKeys: false,
  keyError: null,
  octaweave: null,
  connection: null,
  octaweaveBusy: false,
  octaweaveError: null,
  octaweaveLinking: false,
  octaweaveChoices: null,

  loadKeys: async () => {
    set({ loadingKeys: true, keyError: null })
    try {
      set({ keys: await keysRpc.list(), loadingKeys: false })
    } catch (e) {
      set({ loadingKeys: false, keyError: String(e) })
    }
  },

  saveKey: async (name, value) => {
    try {
      await keysRpc.save(name, value)
      await get().loadKeys()
      // Writing a key can be what completes an Octaweave connection, so the card
      // must not keep claiming otherwise.
      void get().loadOctaweave()
      return null
    } catch (e) {
      return String(e)
    }
  },

  deleteKey: async (name) => {
    try {
      await keysRpc.remove(name)
      await get().loadKeys()
      void get().loadOctaweave()
    } catch (e) {
      set({ keyError: String(e) })
    }
  },

  loadOctaweave: async () => {
    try {
      set({ octaweave: await octaweave.status() })
    } catch {
      // The card is cosmetic; a pod that will not answer is a connection problem
      // that the rest of the app is already reporting.
    }
  },

  connectOctaweave: async (workspace, pollMs = POLL_MS) => {
    set({ octaweaveBusy: true, octaweaveError: null, octaweaveChoices: null })
    try {
      let outcome = await octaweave.connect(workspace)

      if (outcome.kind === 'needs_link') {
        // Opened exactly once. Connect is deliberately browser-free so that the
        // polling below cannot spray a tab per attempt across three minutes.
        await octaweave.link()
        set({ octaweaveLinking: true })
        for (let i = 0; i < Math.ceil(POLL_LIMIT_MS / POLL_MS); i++) {
          await sleep(pollMs)
          if (!get().octaweaveLinking) break
          outcome = await octaweave.connect(workspace)
          if (outcome.kind !== 'needs_link') break
        }
        set({ octaweaveLinking: false })
      }

      if (outcome.kind === 'needs_link') {
        set({ octaweaveBusy: false })
        return null
      }

      if (outcome.kind === 'choose_workspace') {
        set({ octaweaveBusy: false, octaweaveChoices: outcome.workspaces })
        return null
      }

      const connection = outcome.connection
      set({ connection, octaweave: connection.status, octaweaveBusy: false })
      await get().loadKeys()
      // A stored key with a failed pack install is a real halfway state, and the
      // card says so rather than reporting a clean success.
      return connection.pack_error ?? null
    } catch (e) {
      set({ octaweaveBusy: false, octaweaveLinking: false, octaweaveError: String(e) })
      return null
    }
  },

  cancelOctaweaveLink: () => set({ octaweaveLinking: false }),

  installOctaweavePack: async () => {
    set({ octaweaveBusy: true, octaweaveError: null })
    try {
      set({ octaweave: await octaweave.installPack(), octaweaveBusy: false })
      return null
    } catch (e) {
      set({ octaweaveBusy: false, octaweaveError: String(e) })
      return null
    }
  },

  disconnectOctaweave: async () => {
    set({ octaweaveBusy: true, octaweaveError: null })
    try {
      // The workspace goes with it so the core can revoke the key it minted.
      // Forgetting it here would leave a working credential nobody holds.
      const status = await octaweave.disconnect(get().connection?.workspace_id)
      set({ octaweave: status, connection: null, octaweaveChoices: null, octaweaveBusy: false })
      await get().loadKeys()
    } catch (e) {
      set({ octaweaveBusy: false, octaweaveError: String(e) })
    }
  },
}))
