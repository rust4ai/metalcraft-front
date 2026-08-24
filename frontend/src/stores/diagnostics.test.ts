import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transport } from '@/rpc/transport'

/**
 * The store is module state, so every test gets a fresh module graph and its own
 * stub transport. `core` is what `list_diagnostics` answers with.
 */
async function fresh(core: unknown[] = [], failing = new Set<string>()) {
  vi.resetModules()
  const calls: string[] = []
  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string) => {
      calls.push(method)
      if (failing.has(method)) throw new Error(`${method} refused`)
      if (method === 'list_diagnostics') return core as never
      return undefined as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)

  const mod = await import('./diagnostics')
  return { ...mod, calls, rpc: t }
}

const coreEntry = (over: Record<string, unknown> = {}) => ({
  id: 1,
  at: 1000,
  level: 'warn',
  source: 'octaweave_status',
  message: 'the pod would not list its integrations',
  detail: 'connection refused',
  count: 1,
  ...over,
})

afterEach(() => vi.useRealTimers())

describe('the error log', () => {
  it('records a failed command without the caller doing anything', async () => {
    // The whole premise: a store that catches its own error still leaves a trace,
    // because the trace is taken on the way past rather than by the handler.
    const { useDiagnostics, captureDiagnostics } = await fresh([], new Set(['list_flows']))
    captureDiagnostics(new EventTarget() as unknown as Window)

    const { call } = await import('@/rpc/transport')
    await expect(call('list_flows')).rejects.toThrow()

    const [entry] = useDiagnostics.getState().entries
    expect(entry?.source).toBe('list_flows')
    expect(entry?.origin).toBe('app')
  })

  it('rethrows unchanged, so existing handling keeps working', async () => {
    const { captureDiagnostics } = await fresh([], new Set(['list_flows']))
    captureDiagnostics(new EventTarget() as unknown as Window)
    const { call } = await import('@/rpc/transport')
    // Not swallowed, not wrapped — the caller's catch sees exactly what it saw
    // before the log existed.
    await expect(call('list_flows')).rejects.toThrow('list_flows refused')
  })

  it('collapses repeats instead of burying everything under a poll', async () => {
    const { useDiagnostics } = await fresh()
    const { report } = useDiagnostics.getState()
    report('other', 'something else')
    for (let i = 0; i < 40; i++) report('octaweave_status', 'the pod would not answer')

    const { entries } = useDiagnostics.getState()
    expect(entries.length).toBe(2)
    expect(entries[0]?.count).toBe(40)
    expect(entries[0]?.message).toBe('the pod would not answer')
  })

  it('never reports its own failure through itself', async () => {
    // A log that logs "the log could not be read" writes a line per attempt and
    // becomes the noise it exists to prevent.
    const { useDiagnostics, captureDiagnostics } = await fresh([], new Set(['list_diagnostics']))
    captureDiagnostics(new EventTarget() as unknown as Window)

    await useDiagnostics.getState().load()
    expect(useDiagnostics.getState().entries).toEqual([])
    expect(useDiagnostics.getState().loading).toBe(false)
  })

  it('carries what the core swallowed, labelled as the core', async () => {
    const { useDiagnostics } = await fresh([coreEntry()])
    await useDiagnostics.getState().load()

    const [entry] = useDiagnostics.getState().entries
    expect(entry?.origin).toBe('core')
    expect(entry?.message).toMatch(/would not list its integrations/)
    // The exception is kept apart from the sentence, so the line stays readable.
    expect(entry?.detail).toBe('connection refused')
  })

  it('interleaves both halves by time rather than grouping them', async () => {
    // Cause and effect: the core degraded, then the app noticed something wrong.
    // Two lists would hide the sequence that explains it.
    const { useDiagnostics } = await fresh([coreEntry({ at: 2000 })])
    vi.spyOn(Date, 'now').mockReturnValue(1500)
    useDiagnostics.getState().report('list_keys', 'the pod would not answer')
    vi.spyOn(Date, 'now').mockReturnValue(3000)
    useDiagnostics.getState().report('renderer', 'later still')

    await useDiagnostics.getState().load()
    expect(useDiagnostics.getState().entries.map((d) => d.at)).toEqual([3000, 2000, 1500])
  })

  it('does not duplicate the core half on every load', async () => {
    const { useDiagnostics } = await fresh([coreEntry()])
    await useDiagnostics.getState().load()
    await useDiagnostics.getState().load()
    expect(useDiagnostics.getState().entries.length).toBe(1)
  })

  it('keeps the app half when a load replaces the core half', async () => {
    const { useDiagnostics } = await fresh([coreEntry()])
    useDiagnostics.getState().report('list_keys', 'mine')
    await useDiagnostics.getState().load()
    expect(useDiagnostics.getState().entries.some((d) => d.message === 'mine')).toBe(true)
  })

  it('counts only what has arrived since the last look', async () => {
    const { useDiagnostics, unseen } = await fresh()
    useDiagnostics.getState().report('a', 'one')
    expect(unseen(useDiagnostics.getState()).count).toBe(1)

    useDiagnostics.getState().markSeen()
    expect(unseen(useDiagnostics.getState()).count).toBe(0)

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000)
    useDiagnostics.getState().report('b', 'two')
    expect(unseen(useDiagnostics.getState()).count).toBe(1)
  })

  it('separates a real failure from a workaround that held', async () => {
    // The badge goes red on the first and orange on the second. Marking every
    // degradation red is how a badge becomes something people learn to ignore.
    const { useDiagnostics, unseen } = await fresh()
    useDiagnostics.getState().report('octaweave_status', 'degraded', undefined, 'warn')
    expect(unseen(useDiagnostics.getState())).toEqual({ count: 1, failed: 0 })

    useDiagnostics.getState().report('list_keys', 'no pod connected')
    expect(unseen(useDiagnostics.getState())).toEqual({ count: 2, failed: 1 })
  })

  it('clears the app half even when the core will not clear its own', async () => {
    // The truthful outcome: what this window holds is gone, and the core's
    // entries come back on the next load because they are genuinely still there.
    const { useDiagnostics } = await fresh([coreEntry()], new Set(['clear_diagnostics']))
    useDiagnostics.getState().report('a', 'one')
    await useDiagnostics.getState().clear()
    expect(useDiagnostics.getState().entries).toEqual([])

    await useDiagnostics.getState().load()
    expect(useDiagnostics.getState().entries.length).toBe(1)
  })

  it('catches a rejection nobody awaited', async () => {
    const { useDiagnostics, captureDiagnostics } = await fresh()
    const target = new EventTarget()
    captureDiagnostics(target as unknown as Window)

    const ev = new Event('unhandledrejection') as Event & { reason: unknown }
    ev.reason = new Error('nobody caught this')
    target.dispatchEvent(ev)

    expect(useDiagnostics.getState().entries[0]?.message).toMatch(/nobody caught this/)
  })

  it('strips the Error prefix that would repeat on every line', async () => {
    const { describe: say } = await fresh()
    expect(say(new Error('the pod would not answer'))).toBe('the pod would not answer')
    // Tauri rejects with a bare string; the http transport with an Error.
    expect(say('session expired')).toBe('session expired')
  })
})
