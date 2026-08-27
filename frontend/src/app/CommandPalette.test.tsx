import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

async function mount() {
  vi.resetModules()
  const { useFleet } = await import('@/stores/fleet')
  const { useUi } = await import('@/stores/ui')
  const { useLayout } = await import('@/stores/layout')
  const { CommandPalette } = await import('./CommandPalette')

  useFleet.setState({
    instances: [
      { id: 'i1', name: 'Amy', agent_preset: 'kitchen', persona: 'chef' },
      { id: 'i2', name: 'Bob', agent_preset: 'garage', persona: 'mechanic' },
    ] as never,
    presets: [{ slug: 'kitchen', name: 'Kitchen' }] as never,
    status: {},
  })
  const onOpenChange = vi.fn()
  render(<CommandPalette open onOpenChange={onOpenChange} />)
  return { useFleet, useUi, useLayout, onOpenChange }
}

describe('CommandPalette', () => {
  it('lists the fleet', async () => {
    await mount()
    expect(screen.getByText('Amy')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('opens an agent and closes itself', async () => {
    const { useUi, onOpenChange } = await mount()
    await userEvent.click(screen.getByText('Amy'))
    expect(useUi.getState().activeKey).toBe('session:i1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('finds an agent by its preset, not just its name', async () => {
    // Typing a pack name should surface every agent spawned from it — the
    // preset is in the item value for exactly this reason.
    await mount()
    await userEvent.type(screen.getByPlaceholderText(/Search agents/), 'garage')
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.queryByText('Amy')).toBeNull()
  })

  it('ranks opening an agent above spawning one', async () => {
    // "open Amy" is far more common than "spawn a second Amy", and a palette
    // that puts creation first is one that creates things by accident.
    await mount()
    const labels = screen.getAllByRole('option').map((el) => el.textContent ?? '')
    expect(labels.findIndex((l) => l.includes('Amy'))).toBeLessThan(
      labels.findIndex((l) => l.startsWith('Spawn')),
    )
  })

  it('navigates to the registry', async () => {
    const { useUi } = await mount()
    await userEvent.click(screen.getByText('Extensions'))
    expect(useUi.getState().activeKey).toBe('packs')
  })

  it('toggles the rail', async () => {
    const { useLayout } = await mount()
    const before = useLayout.getState().railOpen
    await userEvent.click(screen.getByText(before ? 'Hide details' : 'Show details'))
    expect(useLayout.getState().railOpen).toBe(!before)
  })

  it('says so when nothing matches', async () => {
    await mount()
    await userEvent.type(screen.getByPlaceholderText(/Search agents/), 'zzzzz')
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })
})
