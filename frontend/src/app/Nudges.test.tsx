import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

/** Fresh module graph per case: the stores are singletons and `useNudges` reads
 *  localStorage at construction. */
async function mount(state: {
  info?: unknown
  presets?: unknown[]
  instances?: unknown[]
  sourceBound?: boolean | null
  loading?: boolean
}) {
  vi.resetModules()
  const { useConnection } = await import('@/stores/connection')
  const { useFleet } = await import('@/stores/fleet')
  const { useUi } = await import('@/stores/ui')
  const { useNudges } = await import('@/stores/nudges')
  const { Nudges } = await import('./Nudges')

  useConnection.setState({ info: (state.info ?? { name: 'agent', version: '1' }) as never })
  useFleet.setState({
    presets: (state.presets ?? []) as never,
    instances: (state.instances ?? []) as never,
    loading: state.loading ?? false,
  })
  useUi.setState({ sourceBound: state.sourceBound ?? true })
  render(<Nudges />)
  return { useNudges, useUi }
}

describe('Nudges', () => {
  it('says nothing when the pod is set up', async () => {
    await mount({ presets: [{ slug: 'p' }], instances: [{ id: 'i' }] })
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  it('stays quiet while the fleet is still loading', async () => {
    // Every condition here is "you have none of X", and an empty list mid-fetch
    // is indistinguishable from an empty pod — nudging would flash a wrong card
    // on every launch.
    await mount({ loading: true })
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  it('leads with the source when the pod cannot think', async () => {
    // Ranked above "no agents": spawning something you cannot talk to is worse
    // than having nothing to spawn.
    await mount({ sourceBound: false })
    expect(screen.getByText('This pod cannot think yet')).toBeTruthy()
  })

  it('offers the registry when there is nothing to spawn from', async () => {
    await mount({ presets: [] })
    expect(screen.getByText('No agents to spawn from')).toBeTruthy()
  })

  it('offers a first agent once presets exist', async () => {
    await mount({ presets: [{ slug: 'p' }], instances: [] })
    expect(screen.getByText('Spawn your first agent')).toBeTruthy()
  })

  it('shows one card, never a stack', async () => {
    // Both conditions hold; a queue of setup nags in the corner is noise.
    await mount({ sourceBound: false, presets: [] })
    expect(screen.getAllByRole('button', { name: 'Dismiss' }).length).toBe(1)
  })

  it('stays dismissed across a remount', async () => {
    const { useNudges } = await mount({ presets: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('No agents to spawn from')).toBeNull()
    expect(useNudges.getState().dismissed).toContain('no-presets')

    cleanup()
    await mount({ presets: [] })
    expect(screen.queryByText('No agents to spawn from')).toBeNull()
  })

  it('forgets the dismissal once the condition resolves, so it can recur', async () => {
    await mount({ presets: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    cleanup()

    // Packs installed: the condition is gone, and so is the memory of waving it
    // away. The store must be re-read from the *second* mount — `mount` resets
    // the module graph, so the first call's handle points at a dead singleton.
    const { useNudges } = await mount({ presets: [{ slug: 'p' }], instances: [{ id: 'i' }] })
    expect(useNudges.getState().dismissed).not.toContain('no-presets')

    // And having forgotten, it speaks again if every pack later goes away.
    cleanup()
    const again = await mount({ presets: [] })
    expect(again.useNudges.getState().dismissed).toEqual([])
    expect(screen.getByText('No agents to spawn from')).toBeTruthy()
  })

  it('opens the source step from the card', async () => {
    const { useUi } = await mount({ sourceBound: false })
    await userEvent.click(screen.getByRole('button', { name: 'Bind a source' }))
    expect(useUi.getState().activeKey).toBe('source')
  })
})
