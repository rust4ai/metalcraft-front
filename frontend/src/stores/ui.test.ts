import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { View } from './ui'

/** Fresh module graph per case: the store is a singleton that reads localStorage
 *  at construction, so restore behaviour is only testable by re-importing. */
async function fresh() {
  vi.resetModules()
  return (await import('./ui')).useUi
}

const session = (id: string): View => ({ kind: 'session', instanceId: id })

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('tabs', () => {
  it('starts with the fleet tab pinned and focused', async () => {
    const ui = await fresh()
    expect(ui.getState().tabs.map((t) => t.key)).toEqual(['fleet'])
    expect(ui.getState().activeKey).toBe('fleet')
  })

  it('focuses an already-open view instead of opening it twice', async () => {
    const ui = await fresh()
    ui.getState().go(session('a'))
    ui.getState().go({ kind: 'packs' })
    expect(ui.getState().activeKey).toBe('packs')

    ui.getState().go(session('a'))
    expect(ui.getState().tabs.map((t) => t.key)).toEqual(['fleet', 'session:a', 'packs'])
    expect(ui.getState().activeKey).toBe('session:a')
  })

  it('refuses to close the pinned fleet tab', async () => {
    const ui = await fresh()
    ui.getState().close('fleet')
    expect(ui.getState().tabs.map((t) => t.key)).toEqual(['fleet'])
  })

  it('lands on the right-hand neighbour when the focused tab closes', async () => {
    const ui = await fresh()
    ui.getState().go(session('a'))
    ui.getState().go(session('b'))
    ui.getState().select('session:a')

    ui.getState().close('session:a')
    expect(ui.getState().activeKey).toBe('session:b')
  })

  it('falls back leftwards when the closed tab was last', async () => {
    const ui = await fresh()
    ui.getState().go(session('a'))
    ui.getState().go(session('b'))

    ui.getState().close('session:b')
    expect(ui.getState().activeKey).toBe('session:a')
  })

  it('keeps focus put when some other tab closes', async () => {
    const ui = await fresh()
    ui.getState().go(session('a'))
    ui.getState().go(session('b'))

    ui.getState().close('session:a')
    expect(ui.getState().activeKey).toBe('session:b')
  })

  it('wraps when stepping past either end', async () => {
    const ui = await fresh()
    ui.getState().go(session('a'))
    ui.getState().select('fleet')

    ui.getState().step(-1)
    expect(ui.getState().activeKey).toBe('session:a')
    ui.getState().step(1)
    expect(ui.getState().activeKey).toBe('fleet')
  })

  it('drops session tabs whose agent is gone, and rescues focus', async () => {
    const ui = await fresh()
    ui.getState().go({ kind: 'packs' })
    ui.getState().go(session('a'))

    ui.getState().prune(['b'])
    expect(ui.getState().tabs.map((t) => t.key)).toEqual(['fleet', 'packs'])
    expect(ui.getState().activeKey).toBe('fleet')
  })

  it('restores tabs and focus across a relaunch', async () => {
    const first = await fresh()
    first.getState().go(session('a'))
    first.getState().go({ kind: 'packs' })
    first.getState().select('session:a')

    const second = await fresh()
    expect(second.getState().tabs.map((t) => t.key)).toEqual(['fleet', 'session:a', 'packs'])
    expect(second.getState().activeKey).toBe('session:a')
  })

  it('rebuilds around the pinned tab when the stored payload is junk', async () => {
    // A payload from an older build, or a hand-edited one, must not leave the
    // app with no home tab and nothing to render.
    localStorage.setItem(
      'mc.tabs',
      JSON.stringify({ tabs: [{ key: 'wrong-key', view: { kind: 'packs' } }], activeKey: 'gone' }),
    )
    const ui = await fresh()
    expect(ui.getState().tabs.map((t) => t.key)).toEqual(['fleet'])
    expect(ui.getState().activeKey).toBe('fleet')
  })
})

describe('canThink', () => {
  const load = async () => {
    vi.resetModules()
    return (await import('./ui')).canThink
  }
  const gateway = { ready: true, credential: 'pod_token', gateway: true } as const
  const own = { ready: true, credential: 'stored', gateway: false } as const
  const nothing = { ready: false, credential: 'none', gateway: false } as const

  it('takes the pod at its word about having a credential', async () => {
    const canThink = await load()
    // The load-bearing case: `credential: "environment"` is what a provisioned pod
    // reports, and it is invisible in the key store — an empty `keys.json` on a pod
    // that thinks perfectly well. Only the pod can say this.
    const injected = { ready: true, credential: 'environment', gateway: true } as const
    expect(canThink({ inference: injected, ownSource: false }, true)).toBe(true)
    expect(canThink({ inference: nothing, ownSource: false }, true)).toBe(false)
  })

  it('still asks the account whether it may spend, at the gateway', async () => {
    const canThink = await load()
    // A resolving credential is not permission to use it: the gateway bills the
    // account and refuses a non-premium one, however good the pod's token is.
    expect(canThink({ inference: gateway, ownSource: false }, true)).toBe(true)
    expect(canThink({ inference: gateway, ownSource: false }, false)).toBe(false)
    // Off the gateway the user pays their own provider, so premium is irrelevant.
    expect(canThink({ inference: own, ownSource: true }, false)).toBe(true)
  })

  it('falls back to premium on a pod too old to answer', async () => {
    const canThink = await load()
    expect(canThink({ inference: null, ownSource: false }, true)).toBe(true)
    expect(canThink({ inference: null, ownSource: true }, false)).toBe(true)
    expect(canThink({ inference: null, ownSource: false }, false)).toBe(false)
    // Unknown is not "no": never claim a pod is dead before anything has answered.
    expect(canThink({ inference: null, ownSource: null }, false)).toBeNull()
  })
})

describe('checkOwnSource', () => {
  /** `inference: undefined` stands for a pod too old to have the endpoint. */
  async function run(opts: {
    stored?: string[]
    premium?: boolean
    inference?: { ready: boolean; credential: string; gateway: boolean } | null
  }) {
    vi.resetModules()
    vi.doMock('@/rpc', () => ({
      keys: {
        list: async () => (opts.stored ?? []).map((name) => ({ name })),
        inference: async () => opts.inference ?? null,
      },
    }))
    const { useConnection } = await import('./connection')
    useConnection.setState({ session: { email: 'a@b.c', premium: opts.premium ?? false } })
    const ui = (await import('./ui')).useUi
    await ui.getState().checkOwnSource()
    return ui
  }

  afterEach(() => vi.doUnmock('@/rpc'))

  const injected = { ready: true, credential: 'environment', gateway: true }

  it('leaves a premium account on the fleet with an empty key store', async () => {
    // What a provisioned pod actually looks like: nothing in keys.json, and a
    // credential the pod reports because only the pod can see it.
    const ui = await run({ stored: [], premium: true, inference: injected })
    expect(ui.getState().ownSource).toBe(false)
    expect(ui.getState().activeKey).toBe('fleet')
  })

  it('routes to setup only when nothing can pay for a turn', async () => {
    const ui = await run({ stored: [], premium: false, inference: injected })
    expect(ui.getState().activeKey).toBe('source')
  })

  it('routes to setup when the pod says it has no credential at all', async () => {
    const ui = await run({
      stored: [],
      premium: true,
      inference: { ready: false, credential: 'none', gateway: false },
    })
    expect(ui.getState().activeKey).toBe('source')
  })

  it('leaves a pod with its own key alone', async () => {
    const ui = await run({
      stored: ['OPENAI_API_KEY'],
      premium: false,
      inference: { ready: true, credential: 'stored', gateway: false },
    })
    expect(ui.getState().ownSource).toBe(true)
    expect(ui.getState().activeKey).toBe('fleet')
  })

  it('falls back to the key store on a pod too old to answer', async () => {
    const old = await run({ stored: ['OPENAI_API_KEY'], premium: false, inference: null })
    expect(old.getState().inference).toBeNull()
    expect(old.getState().ownSource).toBe(true)
    expect(old.getState().activeKey).toBe('fleet')

    const bare = await run({ stored: [], premium: false, inference: null })
    expect(bare.getState().activeKey).toBe('source')
  })
})
