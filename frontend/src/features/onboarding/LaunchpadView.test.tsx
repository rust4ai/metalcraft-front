import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'
import type { AgentInfo, Pod, Session } from '@/types'

afterEach(cleanup)

const info: AgentInfo = { name: 'metalcraft-agent', version: '0.31.0' }

/**
 * The Launchpad reads everything from the connection store, so a case is a
 * *store state* plus whatever the core would answer. `connected` is the switch
 * between the two situations it serves: no pod yet (a full-window takeover), and
 * a pod already connected (a normal tab, where it is a pod switcher).
 */
async function mount(state: {
  session?: Session | null
  pods?: Pod[]
  connected?: boolean
  overrides?: Record<string, unknown>
}) {
  vi.resetModules()
  const calls: string[] = []
  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string) => {
      calls.push(method)
      const overrides = state.overrides ?? {}
      if (method in overrides) return overrides[method] as never
      if (method === 'connect_pod' || method === 'connect_pod_url') return info as never
      if (method === 'active_pod') return { slug: 'amy', url: 'https://amy.metalcraftai.com' } as never
      if (method === 'list_pods') return (state.pods ?? []) as never
      return undefined as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)

  const { useConnection } = await import('@/stores/connection')
  useConnection.setState({
    ready: true,
    session: state.session ?? null,
    pods: state.pods ?? [],
    info: state.connected ? info : null,
    pod: state.connected ? { slug: 'amy', url: 'https://amy.metalcraftai.com' } : null,
  })

  const { LaunchpadView } = await import('./LaunchpadView')
  render(<LaunchpadView />)
  return { calls, useConnection }
}

const pod = (slug: string): Pod => ({ id: slug, slug, url: `https://${slug}.metalcraftai.com` })

describe('LaunchpadView', () => {
  it('offers the pod you run without an account in the way', async () => {
    // The door that needs no Metalcraft ID has to be reachable *before* signing
    // in, or the sign-in card is a gate wearing a card's clothes.
    const { calls } = await mount({ session: null })
    expect(screen.getByText('A pod you run')).toBeTruthy()
    expect(screen.getByText('Sign in with Metalcraft ID')).toBeTruthy()
    // Nothing to list without an account, and nothing to sell yet either.
    expect(screen.queryByText('On your account')).toBeNull()
    expect(calls).not.toContain('list_pods')
  })

  it('connects a pod you typed the address of', async () => {
    const { calls, useConnection } = await mount({ session: null })
    await userEvent.type(screen.getByLabelText('Pod URL'), 'https://pod.example.com')
    await userEvent.type(screen.getByLabelText('Pod key'), 'devkey')
    await userEvent.click(screen.getByText('Connect'))
    await waitFor(() => expect(useConnection.getState().info).toEqual(info))
    expect(calls).toContain('connect_pod_url')
    expect(calls).not.toContain('list_pods')
  })

  it('auto-connects a lone pod rather than showing a list of one', async () => {
    const { calls, useConnection } = await mount({
      session: { email: 'a@b.com', premium: true },
      pods: [pod('amy')],
    })
    await waitFor(() => expect(useConnection.getState().info).toEqual(info))
    expect(calls).toContain('connect_pod')
  })

  it('says a waking pod is waking rather than spinning silently', async () => {
    // A pod scheduled from suspend can take minutes before its ingress answers.
    // The state is real and worth naming — `connect_pod` here never resolves, so
    // this is what the wait actually looks like.
    await mount({
      session: { email: 'a@b.com', premium: true },
      pods: [pod('amy')],
      overrides: { connect_pod: new Promise(() => {}) },
    })
    await waitFor(() => expect(screen.getByText('Connecting to your pod')).toBeTruthy())
    expect(screen.getByText(/it has to be scheduled and start up/)).toBeTruthy()
  })

  it('leaves a choice of pods alone', async () => {
    const { calls } = await mount({
      session: { email: 'a@b.com', premium: true },
      pods: [pod('amy'), pod('bo')],
    })
    expect(screen.getByText('amy')).toBeTruthy()
    expect(screen.getByText('bo')).toBeTruthy()
    expect(calls).not.toContain('connect_pod')
  })

  it('is a pod switcher once one is connected, and never auto-connects there', async () => {
    // The same component inside the shell. Auto-connect here would yank the
    // window off the pod the user is working on, which is why `info` gates it.
    const { calls } = await mount({
      session: { email: 'a@b.com', premium: true },
      pods: [pod('amy')],
      connected: true,
    })
    expect(screen.getByRole('heading', { name: 'Pods' })).toBeTruthy()
    expect(screen.getByText('connected')).toBeTruthy()
    expect(calls).not.toContain('connect_pod')
  })

  it('sells a pod to an account without one, and not to one that has it', async () => {
    await mount({ session: { email: 'a@b.com', premium: false } })
    expect(screen.getByText('Get Metalcraft premium')).toBeTruthy()

    cleanup()
    await mount({ session: { email: 'a@b.com', premium: false }, pods: [pod('amy'), pod('bo')] })
    expect(screen.queryByText('Get Metalcraft premium')).toBeNull()
  })
})
