import { create } from 'zustand'
import { keys as keysRpc, octaweave } from '@/rpc'
import type { KeyEntry, OctaweaveConnection, OctaweaveStatus } from '@/types'

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

  loadKeys: () => Promise<void>
  saveKey: (name: string, value: string) => Promise<string | null>
  deleteKey: (name: string) => Promise<void>

  loadOctaweave: () => Promise<void>
  /** Returns the *pack* error when the key stored but the tools did not — a
   *  halfway state the card names separately. A rejected key sets
   *  `octaweaveError` instead and returns null, so it is never shown twice. */
  connectOctaweave: (token: string) => Promise<string | null>
  installOctaweavePack: () => Promise<string | null>
  disconnectOctaweave: () => Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  keys: [],
  loadingKeys: false,
  keyError: null,
  octaweave: null,
  connection: null,
  octaweaveBusy: false,
  octaweaveError: null,

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

  connectOctaweave: async (token) => {
    set({ octaweaveBusy: true, octaweaveError: null })
    try {
      const connection = await octaweave.connect(token)
      set({ connection, octaweave: connection.status, octaweaveBusy: false })
      await get().loadKeys()
      // A stored key with a failed pack install is a real halfway state, and the
      // card says so rather than reporting a clean success.
      return connection.pack_error ?? null
    } catch (e) {
      set({ octaweaveBusy: false, octaweaveError: String(e) })
      return null
    }
  },

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
      set({ octaweave: await octaweave.disconnect(), connection: null, octaweaveBusy: false })
      await get().loadKeys()
    } catch (e) {
      set({ octaweaveBusy: false, octaweaveError: String(e) })
    }
  },
}))
