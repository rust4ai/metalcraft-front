import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Transport } from '@/rpc/transport'
import type { Flow } from '@/types'

afterEach(cleanup)

const flow: Flow = {
  id: 'morning-brief',
  name: 'Morning brief',
  node_count: 3,
  v2: true,
} as Flow

const binding = {
  flow_id: 'morning-brief',
  preset: 'briefer',
  bound: false,
  personas: [],
  armed: [],
  consent: {
    preset_name: 'Briefer',
    domains: [],
    requires_env: [],
    missing_env: [],
    mutating_tools: [],
    tool_count: 4,
    base_memories: 0,
  },
}

async function mount(overrides: Record<string, unknown> = {}) {
  vi.resetModules()
  const t = await import('@/rpc/transport')
  t.setTransport({
    call: async (method: string) => {
      if (method in overrides) return overrides[method] as never
      if (method === 'flow_binding') return binding as never
      if (method === 'list_instances') return { instances: [] } as never
      return undefined as never
    },
    listen: vi.fn(async () => () => {}),
  } as unknown as Transport)
  const { ArmDialog } = await import('./ArmDialog')
  render(<ArmDialog flow={flow} onClose={() => {}} />)
}

describe('ArmDialog', () => {
  it('says a trigger the pod cannot read would never fire', async () => {
    // The failure this exists for. A five-field POSIX cron saves happily and
    // then does nothing, and the only symptom used to arrive at 8am on a
    // morning when nothing happened. An empty `next_runs` is the pod saying so
    // before anything is armed.
    await mount({
      preview_schedule: { description: 'Cron `0 8 * * *`', next_runs: [] },
    })
    await waitFor(() => expect(screen.getByText(/would never fire/)).toBeTruthy(), {
      timeout: 2000,
    })
  })

  it('shows when a readable trigger would fire', async () => {
    await mount({
      preview_schedule: {
        description: 'Cron `0 0 8 * * *` (America/Detroit)',
        next_runs: ['2026-08-28T12:00:00Z', '2026-08-29T12:00:00Z'],
      },
    })
    await waitFor(() => expect(screen.getByText(/^Next:/)).toBeTruthy(), { timeout: 2000 })
    // The warning and the projection are alternatives, never both.
    expect(screen.queryByText(/cannot read that trigger/)).toBeNull()
  })

  it('warns about a pack the flow reaches and this pod does not have', async () => {
    // `binding` covers credentials and personas and is silent about packs, so
    // without this the dialog would present a flow that cannot work as fine.
    await mount({
      flow_dependencies: {
        flow: 'morning-brief',
        packs: [
          { pack: 'email', status: 'skipped' },
          { pack: 'calendar', status: 'already-satisfied' },
        ],
      },
    })
    await waitFor(() => expect(screen.getByText(/does not have email/)).toBeTruthy())
    // A satisfied pack is not a warning.
    expect(screen.queryByText(/calendar/)).toBeNull()
  })

  it('stays quiet when a pod cannot answer about dependencies at all', async () => {
    // An older pod, or one that refuses the route. The other half of the consent
    // screen loaded fine and must still be readable.
    await mount({ flow_dependencies: undefined })
    await waitFor(() => expect(screen.getAllByText('Briefer').length).toBeGreaterThan(0))
    expect(screen.queryByText('Needs packs')).toBeNull()
  })
})
