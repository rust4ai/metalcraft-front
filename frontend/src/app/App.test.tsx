import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

afterEach(cleanup)
import type { Transport } from '@/rpc/transport'

/**
 * Boot test. Proves the shell renders against a stubbed core rather than only
 * that the binary starts — a Tauri window that came up blank would look
 * identical from the outside.
 */
function stub(responses: Record<string, unknown>): Transport {
  return {
    call: vi.fn(async (method: string) => {
      if (!(method in responses)) throw new Error(`unstubbed command: ${method}`)
      return responses[method] as never
    }),
    listen: vi.fn(async () => () => {}),
  }
}

async function mount(responses: Record<string, unknown>) {
  // Reset the module graph so each case gets its own zustand stores; they are
  // module singletons and would otherwise carry state between tests.
  vi.resetModules()
  const transport = await import('@/rpc/transport')
  transport.setTransport(stub(responses))
  const { App } = await import('./App')
  render(<App />)
}

describe('App', () => {
  it('shows the sign-in screen when there is no session', async () => {
    await mount({ session: null })
    await waitFor(() => expect(screen.getByText('Sign in with Metalcraft ID')).toBeTruthy())
  })

  it('goes to pod connection once signed in', async () => {
    await mount({
      session: { email: 'a@b.com', premium: true },
      list_pods: [{ id: 'p1', slug: 'amy', url: 'https://amy.metalcraftai.com' }],
      connect_pod: { name: 'metalcraft-agent', version: '0.30.0' },
      active_pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
      list_instances: [],
      list_presets: [],
      list_keys: [{ name: 'OPENAI_API_KEY', masked: 'sk-…1234' }],
    })
    await waitFor(() => expect(screen.getByText('a@b.com')).toBeTruthy())
    // Auto-connects when the account has exactly one pod, and lands on the fleet.
    await waitFor(() => expect(screen.getByText('Fleet')).toBeTruthy())
  })

  it('sends a pod with no provider key to the interface source step', async () => {
    // The agent cannot think without one, so a fleet view would be a dead end.
    await mount({
      session: { email: 'a@b.com', premium: true },
      list_pods: [{ id: 'p1', slug: 'amy', url: 'https://amy.metalcraftai.com' }],
      connect_pod: { name: 'metalcraft-agent', version: '0.30.0' },
      active_pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
      list_instances: [],
      list_presets: [],
      list_keys: [],
    })
    await waitFor(() => expect(screen.getByText('Interface source')).toBeTruthy())
    expect(screen.getByText('Metalcraft Inference')).toBeTruthy()
  })

  it('explains itself when the account has no pod', async () => {
    await mount({ session: { email: 'a@b.com', premium: false }, list_pods: [] })
    await waitFor(() => expect(screen.getByText('No pod on this account')).toBeTruthy())
  })
})
