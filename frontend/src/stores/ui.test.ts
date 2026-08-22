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
