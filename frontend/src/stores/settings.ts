import { create } from 'zustand'
import { gateway, keys as keysRpc, services } from '@/rpc'
import type {
  ConnectionInfo,
  ConnectionStatus,
  GatewayRegistration,
  GatewayStatus,
  KeyEntry,
  OctaweaveWorkspace,
  ServiceId,
} from '@/types'

/**
 * The pod's key store, its service connections, and its gateway channel
 * (PLAN §10.6, §9.3).
 *
 * Values are never held here. `KeyEntry` carries a `masked` preview and nothing
 * more, and the one place a real secret exists in this app is the argument to
 * `save` — which goes straight through the transport into the core. Keeping a
 * written value in a store "so the form can show it" is how a credential ends up
 * in a devtools snapshot.
 */
/**
 * One service connection, whichever service it is (PLAN §9.3).
 *
 * Written once rather than twice because Octaweave and buildr.space differ in
 * one step out of five — Octaweave can ask which workspace — and everything
 * else, down to the three-minute browser poll and what a half-finished connect
 * leaves on screen, is the same behaviour. Two copies of it would be two places
 * for the polling to drift.
 */
export interface ServiceConnection {
  status: ConnectionStatus | null
  connection: ConnectionInfo | null
  busy: boolean
  error: string | null
  /** The browser is open on the service's link page and we are re-asking. */
  linking: boolean
  /** More than one workspace, so the choice is the user's. Octaweave only. */
  choices: OctaweaveWorkspace[] | null
}

const blank = (): ServiceConnection => ({
  status: null,
  connection: null,
  busy: false,
  error: null,
  linking: false,
  choices: null,
})

interface SettingsState {
  keys: KeyEntry[]
  loadingKeys: boolean
  keyError: string | null

  services: Record<ServiceId, ServiceConnection>

  /** `null` before the first read *and* on a pod too old to answer — the card
   *  tells those apart with `gatewayUnsupported`. */
  gatewayStatus: GatewayStatus | null
  /** The pod answered 404: it predates the endpoint, so there is nothing to
   *  offer and saying "not connected" would be a lie. */
  gatewayUnsupported: boolean
  /** The pending registration, held only until the number verifies. It carries
   *  the code the user has to text, which is the one thing they cannot look up
   *  again — the gateway re-issues a *new* one on every register. */
  gatewayPending: GatewayRegistration | null
  gatewayBusy: boolean
  gatewayError: string | null

  loadKeys: () => Promise<void>
  saveKey: (name: string, value: string) => Promise<string | null>
  deleteKey: (name: string) => Promise<void>

  loadService: (service: ServiceId) => Promise<void>
  /**
   * The whole connection, from a button press.
   *
   * Returns the *pack* error when the key stored but the tools did not — a
   * halfway state the card names separately. Anything that failed outright sets
   * the slice's `error` instead and returns null, so it is never shown twice.
   *
   * `pollMs` exists for tests. The waiting loop is the one part of this that is
   * measured in minutes, and a test should not be.
   */
  connectService: (service: ServiceId, choice?: string, pollMs?: number) => Promise<string | null>
  /** Stop waiting on the browser. The link itself may still land; the next
   *  Connect will find it. */
  cancelLink: (service: ServiceId) => void
  installServicePack: (service: ServiceId) => Promise<string | null>
  disconnectService: (service: ServiceId) => Promise<void>

  loadGateway: () => Promise<void>
  /** Register a number and keep the code to text back. Answers whether it took,
   *  so a card that swapped its own state to ask for the number can decide
   *  whether to swap back — a refusal has to leave the field where it is, with
   *  the number still in it. */
  registerGatewayNumber: (phoneNumber: string) => Promise<boolean>
  /** Forget the pending registration and go back to the number field, e.g. to
   *  fix a typo. Local only — the gateway keeps whatever was registered until
   *  the next register replaces it. */
  clearGatewayPending: () => void
  connectGateway: () => Promise<void>
  disconnectGateway: () => Promise<void>
  /** Give the number back. Answers `false` when the pod is too old to have the
   *  endpoint, which the card has to say out loud — there is no fallback from
   *  here, and a silent no-op would read as success. */
  unregisterGatewayNumber: () => Promise<boolean>
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

/**
 * Change one service's slice, leaving the other alone.
 *
 * Outside the store rather than inside it so the actions below stay at the
 * indentation they were written at — and because a two-service map has exactly
 * one way to be updated wrongly (`set({ services: { [id]: … } })`, which drops
 * the other service), which is worth having one function for.
 */
const patch = (service: ServiceId, next: Partial<ServiceConnection>) =>
  useSettings.setState((s) => ({
    services: { ...s.services, [service]: { ...s.services[service], ...next } },
  }))

export const useSettings = create<SettingsState>((set, get) => ({
  keys: [],
  loadingKeys: false,
  keyError: null,
  services: { octaweave: blank(), buildr: blank() },
  gatewayStatus: null,
  gatewayUnsupported: false,
  gatewayPending: null,
  gatewayBusy: false,
  gatewayError: null,

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
      // Writing a key by hand can be what completes a connection — and which
      // service it belongs to is not knowable from the name alone, so both cards
      // re-read rather than one guessing.
      void get().loadService('octaweave')
      void get().loadService('buildr')
      return null
    } catch (e) {
      return String(e)
    }
  },

  deleteKey: async (name) => {
    try {
      await keysRpc.remove(name)
      await get().loadKeys()
      void get().loadService('octaweave')
      void get().loadService('buildr')
    } catch (e) {
      set({ keyError: String(e) })
    }
  },

  loadService: async (service) => {
    try {
      patch(service, { status: await services[service].status() })
    } catch {
      // The card is cosmetic; a pod that will not answer is a connection problem
      // that the rest of the app is already reporting — so this still does not
      // interrupt anyone. It is not silent any more, though: the card keeps
      // whatever it last knew and goes on rendering it as current, and the error
      // log is where that shows up as a stale readout rather than a fresh one.
      //
      // Nothing is reported here by hand: the transport's sink already saw the
      // rejection on its way past.
    }
  },

  connectService: async (service, choice, pollMs = POLL_MS) => {
    const rpc = services[service]
    patch(service, { busy: true, error: null, choices: null })
    try {
      let outcome = await rpc.connect(choice)

      if (outcome.kind === 'needs_link') {
        // Opened exactly once. Connect is deliberately browser-free so that the
        // polling below cannot spray a tab per attempt across three minutes.
        await rpc.link()
        patch(service, { linking: true })
        for (let i = 0; i < Math.ceil(POLL_LIMIT_MS / POLL_MS); i++) {
          await sleep(pollMs)
          if (!get().services[service].linking) break
          outcome = await rpc.connect(choice)
          if (outcome.kind !== 'needs_link') break
        }
        patch(service, { linking: false })
      }

      if (outcome.kind === 'needs_link') {
        patch(service, { busy: false })
        return null
      }

      if (outcome.kind === 'choose_workspace') {
        patch(service, { busy: false, choices: outcome.workspaces })
        return null
      }

      const connection = outcome.connection
      patch(service, { connection, status: connection.status, busy: false })
      await get().loadKeys()
      // A stored key with a failed pack install is a real halfway state, and the
      // card says so rather than reporting a clean success.
      return connection.pack_error ?? null
    } catch (e) {
      patch(service, { busy: false, linking: false, error: String(e) })
      return null
    }
  },

  cancelLink: (service) => patch(service, { linking: false }),

  installServicePack: async (service) => {
    patch(service, { busy: true, error: null })
    try {
      patch(service, { status: await services[service].installPack(), busy: false })
      return null
    } catch (e) {
      patch(service, { busy: false, error: String(e) })
      return null
    }
  },

  disconnectService: async (service) => {
    patch(service, { busy: true, error: null })
    try {
      // What the key was pinned to goes with it, so the core can revoke the key
      // it minted. Forgetting it would leave a working credential nobody holds.
      const status = await services[service].disconnect(
        get().services[service].connection?.id,
      )
      patch(service, { status, connection: null, choices: null, busy: false })
      await get().loadKeys()
    } catch (e) {
      patch(service, { busy: false, error: String(e) })
    }
  },

  loadGateway: async () => {
    try {
      const status = await gateway.status()
      set({
        gatewayStatus: status,
        gatewayUnsupported: status === null,
        // Verification happens on a phone, not in this window, so this poll is
        // the only thing that can notice it. Dropping the code the moment it is
        // no longer needed keeps a stale instruction off the screen.
        gatewayPending: status?.verified ? null : get().gatewayPending,
      })
    } catch (e) {
      // Unlike the Octaweave card, this one does not degrade quietly: every
      // state it renders is a claim about whether messages are getting through,
      // and "we could not ask" must not read as "not connected".
      set({ gatewayError: String(e) })
    }
  },

  registerGatewayNumber: async (phoneNumber) => {
    set({ gatewayBusy: true, gatewayError: null })
    try {
      const pending = await gateway.register(phoneNumber)
      set({ gatewayBusy: false, gatewayPending: pending.verified ? null : pending })
      await get().loadGateway()
      return true
    } catch (e) {
      set({ gatewayBusy: false, gatewayError: String(e) })
      return false
    }
  },

  clearGatewayPending: () => set({ gatewayPending: null, gatewayError: null }),

  connectGateway: async () => {
    set({ gatewayBusy: true, gatewayError: null })
    try {
      await gateway.connect()
      set({ gatewayBusy: false })
      await get().loadGateway()
    } catch (e) {
      set({ gatewayBusy: false, gatewayError: String(e) })
    }
  },

  disconnectGateway: async () => {
    set({ gatewayBusy: true, gatewayError: null })
    try {
      await gateway.disconnect()
      set({ gatewayBusy: false })
      await get().loadGateway()
    } catch (e) {
      set({ gatewayBusy: false, gatewayError: String(e) })
    }
  },

  unregisterGatewayNumber: async () => {
    set({ gatewayBusy: true, gatewayError: null })
    try {
      const supported = await gateway.unregister()
      // The pending code goes with it: the registration it belonged to is gone,
      // so texting it would do nothing.
      set({ gatewayBusy: false, gatewayPending: supported ? null : get().gatewayPending })
      await get().loadGateway()
      return supported
    } catch (e) {
      set({ gatewayBusy: false, gatewayError: String(e) })
      return true
    }
  },
}))
