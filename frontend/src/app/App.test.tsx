import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

afterEach(() => {
  cleanup()
  // Tabs and layout persist to localStorage, which outlives vi.resetModules() —
  // without this, the keyless-pod case leaves a source tab open for the next one.
  localStorage.clear()
})
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
  // Defaults for the calls every boot makes, so a case only states them when they
  // are its point: the account re-read returns what the cached one did, and a pod
  // that does not answer `inference_status` is one too old to have the endpoint.
  const withDefaults = {
    refresh_session: responses.session ?? null,
    inference_status: null,
    // Boot asks the core what it is already connected to before asking who we
    // are, so a window reload does not drop a live pod.
    active_pod: null,
    ...responses,
  }
  // Reset the module graph so each case gets its own zustand stores; they are
  // module singletons and would otherwise carry state between tests.
  vi.resetModules()
  const transport = await import('@/rpc/transport')
  transport.setTransport(stub(withDefaults))
  const { App } = await import('./App')
  render(<App />)
}

describe('App', () => {
  it('shows the sign-in screen when there is no session', async () => {
    await mount({ session: null })
    await waitFor(() => expect(screen.getByText('Sign in with Metalcraft ID')).toBeTruthy())
  })

  it('lets a pod you run in without a Metalcraft account', async () => {
    // The screen used to be a wall: a self-hosted pod needs no account, but the
    // app demanded one before showing anything, so a self-hoster could not reach
    // their own agent.
    const calls: string[] = []
    vi.resetModules()
    const transport = await import('@/rpc/transport')
    const responses: Record<string, unknown> = {
      session: null,
      refresh_session: null,
      inference_status: null,
      connect_pod_url: { name: 'metalcraft-agent', version: '0.31.0' },
      active_pod: { slug: 'localhost:3999', url: 'http://localhost:3999' },
      list_instances: [],
      list_presets: [],
      list_keys: [{ name: 'OPENAI_API_KEY', masked: 'sk-…1234', scope: 'global', managed: false }],
    }
    transport.setTransport({
      call: vi.fn(async (method: string) => {
        calls.push(method)
        if (!(method in responses)) throw new Error(`unstubbed command: ${method}`)
        return responses[method] as never
      }),
      listen: vi.fn(async () => () => {}),
    })
    const { App } = await import('./App')
    render(<App />)

    await waitFor(() => expect(screen.getByText('Or connect to a pod you run')).toBeTruthy())
    await userEvent.click(screen.getByText('Or connect to a pod you run'))
    await userEvent.type(screen.getByLabelText('Pod key'), 'devkey')
    await userEvent.click(screen.getByText('Connect'))

    // Straight into the shell, with no session and no pod list.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fleet' })).toBeTruthy())
    expect(calls).toContain('connect_pod_url')
    expect(calls).not.toContain('list_pods')
  })

  it('goes to pod connection once signed in', async () => {
    await mount({
      session: { email: 'a@b.com', premium: true },
      list_pods: [{ id: 'p1', slug: 'amy', url: 'https://amy.metalcraftai.com' }],
      connect_pod: { name: 'metalcraft-agent', version: '0.30.0' },
      active_pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
      list_instances: [],
      list_presets: [],
      list_keys: [{ name: 'OPENAI_API_KEY', masked: 'sk-…1234', scope: 'global', managed: false }],
    })
    await waitFor(() => expect(screen.getByText('a@b.com')).toBeTruthy())
    // Auto-connects when the account has exactly one pod, and lands on the fleet.
    // By role: the shell also names the tab "Fleet".
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fleet' })).toBeTruthy())
  })

  it('leaves a premium account on the fleet with an empty key store', async () => {
    // An empty key store is what a provisioned pod normally looks like: it is
    // given `OPENAI_API_KEY` (its own METALCRAFT_TOKEN) and `OPENAI_BASE_URL` as
    // container env, and the pod lists keys.json only — so the credential that
    // makes it think is invisible here. Marching a premium user into setup told
    // them their working pod was dead.
    await mount({
      session: { email: 'a@b.com', premium: true },
      list_pods: [{ id: 'p1', slug: 'amy', url: 'https://amy.metalcraftai.com' }],
      connect_pod: { name: 'metalcraft-agent', version: '0.30.0' },
      active_pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
      list_instances: [],
      list_presets: [],
      list_keys: [],
      // What a provisioned pod reports: a credential the key store cannot show.
      inference_status: { ready: true, credential: 'environment', gateway: true },
    })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fleet' })).toBeTruthy())
    expect(screen.queryByText('This pod cannot think yet')).toBeNull()
  })

  it('offers the error log beside the gear, and opens it', async () => {
    // The pair is the point: both answer "why is the app behaving like this",
    // and the log is only findable because it sits where someone already goes
    // looking. A degradation changes nothing else on screen.
    await mount({
      session: { email: 'a@b.com', premium: true },
      list_pods: [{ id: 'p1', slug: 'amy', url: 'https://amy.metalcraftai.com' }],
      connect_pod: { name: 'metalcraft-agent', version: '0.30.0' },
      active_pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
      list_instances: [],
      list_presets: [],
      list_keys: [],
      inference_status: { ready: true, credential: 'environment', gateway: true },
      list_diagnostics: [
        {
          id: 1,
          at: Date.now(),
          level: 'warn',
          source: 'octaweave_status',
          message: 'the pod would not list its integrations',
          detail: 'connection refused',
          count: 1,
        },
      ],
    })

    const log = await screen.findByRole('button', { name: /^Error log/ })
    const gear = screen.getByRole('button', { name: 'Settings' })
    expect(gear.parentElement).toBe(log.parentElement)

    await userEvent.click(log)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Error log' })).toBeTruthy())
    expect(screen.getByText(/would not list its integrations/)).toBeTruthy()
  })

  it('survives a core that cannot answer the error log at all', async () => {
    // `list_diagnostics` is unstubbed here, so it throws. A log that takes the
    // shell down with it would be worse than no log.
    await mount({
      session: { email: 'a@b.com', premium: true },
      list_pods: [{ id: 'p1', slug: 'amy', url: 'https://amy.metalcraftai.com' }],
      connect_pod: { name: 'metalcraft-agent', version: '0.30.0' },
      active_pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
      list_instances: [],
      list_presets: [],
      list_keys: [],
      inference_status: { ready: true, credential: 'environment', gateway: true },
    })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fleet' })).toBeTruthy())
    expect(screen.getByRole('button', { name: /^Error log/ })).toBeTruthy()
  })

  it('sends a pod to setup when nothing can pay for a turn', async () => {
    // No key of its own and no premium to bill the gateway to: the turn would
    // fail with `not_premium`, so a fleet view really is a dead end.
    await mount({
      session: { email: 'a@b.com', premium: false },
      list_pods: [{ id: 'p1', slug: 'amy', url: 'https://amy.metalcraftai.com' }],
      connect_pod: { name: 'metalcraft-agent', version: '0.30.0' },
      active_pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
      list_instances: [],
      list_presets: [],
      list_keys: [],
      inference_status: { ready: true, credential: 'pod_token', gateway: true },
    })
    await waitFor(() => expect(screen.getByText('Interface source')).toBeTruthy())
    expect(screen.getByText('Metalcraft Inference')).toBeTruthy()
  })

  it('explains itself when the account has no pod', async () => {
    await mount({ session: { email: 'a@b.com', premium: false }, list_pods: [] })
    await waitFor(() => expect(screen.getByText('No pod on this account')).toBeTruthy())
  })
})
