import { afterEach, describe, expect, it, vi } from 'vitest'
// `act` from the library, not from React: this one sets the act environment flag
// the warning asks for. Both are the same function underneath.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
  /** Whether the pod list has come back. Cases are about a list that *has* been
   *  answered unless they say otherwise — the exception is the point of the
   *  "still looking" case below. */
  podsLoaded?: boolean
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
      if (method in overrides) {
        // An `Error` is thrown rather than returned, so a case can state a core
        // that refuses without leaving a rejected promise lying around waiting
        // for someone to await it.
        const answer = overrides[method]
        if (answer instanceof Error) throw answer
        return answer as never
      }
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
    podsLoaded: state.podsLoaded ?? true,
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
    // No price from the hub yet, so the button says what it does and no more.
    expect(await screen.findByText(/Get Metalcraft premium/)).toBeTruthy()

    cleanup()
    await mount({ session: { email: 'a@b.com', premium: false }, pods: [pod('amy'), pod('bo')] })
    expect(screen.queryByText(/Get Metalcraft premium/)).toBeNull()
  })

  it('keeps asking for a pod that is being provisioned behind the scenes', async () => {
    // The one state here whose answer changes with nobody touching anything: a
    // Stripe webhook this app never sees hands a control plane a job it retries
    // on its own schedule. The card said "your pod is started for you" and then
    // never looked again.
    vi.useFakeTimers()
    try {
      const { calls } = await mount({ session: { email: 'a@b.com', premium: true }, pods: [] })
      expect(screen.getByText('Premium is on this account')).toBeTruthy()
      const before = calls.filter((c) => c === 'list_pods').length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(21_000)
      })
      expect(calls.filter((c) => c === 'list_pods').length).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('quotes the hub price, and the first month only to an account that can have it', async () => {
    // The figure on this button is the figure on the invoice: it comes from the
    // hub, which reads it from Stripe. Nothing here remembers a price.
    const plan = {
      amount: 800,
      currency: 'usd',
      interval: 'month',
      promo: { offered: true, eligible: true, first_month_amount: 100 },
    }
    await mount({
      session: { email: 'a@b.com', premium: false },
      overrides: { billing_plan: plan },
    })
    expect(await screen.findByText(/\$1 first month, then \$8\/month/)).toBeTruthy()

    // Same offer running, but this email has taken it before.
    cleanup()
    await mount({
      session: { email: 'a@b.com', premium: false },
      overrides: { billing_plan: { ...plan, promo: { ...plan.promo, eligible: false } } },
    })
    expect(await screen.findByText(/Get premium — \$8\/month/)).toBeTruthy()
    expect(screen.queryByText(/first month/)).toBeNull()
  })

  it('says it stopped watching rather than quietly re-offering what was bought', async () => {
    // Five minutes of watching used to end in silence — the card simply went
    // back to selling premium, with no account of the wait, to somebody who may
    // well have completed checkout thirty seconds after it gave up.
    vi.useFakeTimers()
    try {
      await mount({
        session: { email: 'a@b.com', premium: false },
        overrides: { open_checkout: 'https://id.metalcraftai.com/billing/checkout' },
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      screen.getByText(/Get Metalcraft premium/).click()
      // Past the limit: the account never went premium and no pod appeared.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(310_000)
      })
      expect(screen.getByText(/did not see an upgrade land/)).toBeTruthy()
      // The offer is still there — giving up on watching is not giving up on the sale.
      expect(screen.getByText(/Get Metalcraft premium/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('watches for the upgrade instead of asking the user to come back', async () => {
    const { calls } = await mount({
      session: { email: 'a@b.com', premium: false },
      overrides: { open_checkout: 'https://id.metalcraftai.com/billing/checkout' },
    })
    await userEvent.click(await screen.findByText(/Get Metalcraft premium/))

    await waitFor(() => expect(screen.getByText(/Finish in your browser/)).toBeTruthy())
    expect(calls).toContain('open_checkout')
    // The URL is shown as well as opened, so a hand-off that silently failed is
    // still a link rather than a spinner over nothing.
    expect(screen.getByText('https://id.metalcraftai.com/billing/checkout')).toBeTruthy()
  })

  it('says it is still looking rather than reporting a pod nobody asked about', async () => {
    // The empty array here is not an answer — it is the value the store holds
    // before `list_pods` returns. Reading it as "no pod on this account" is how
    // a working account got told it had nothing, for as long as the network took.
    await mount({ session: { email: 'a@b.com', premium: true }, pods: [], podsLoaded: false })
    expect(screen.getByText('Checking this account for pods…')).toBeTruthy()
    expect(screen.queryByText('No pod on this account yet.')).toBeNull()
    // And nothing is sold or diagnosed on the strength of a list nobody has read.
    expect(screen.queryByText('Premium is on this account')).toBeNull()
    expect(screen.queryByText(/Get Metalcraft premium/)).toBeNull()
    // The door that needs none of this is open the whole time.
    expect(screen.getByText('A pod you run')).toBeTruthy()
  })

  it('shows the wait, not the list, when a lone pod is about to be connected', async () => {
    // `connect_pod` never resolves, so this is the frame in between: the effect
    // has decided and the list of one would otherwise paint and be snatched away.
    await mount({
      session: { email: 'a@b.com', premium: true },
      pods: [pod('amy')],
      overrides: { connect_pod: new Promise(() => {}) },
    })
    expect(screen.getByText('Connecting to your pod')).toBeTruthy()
    expect(screen.queryByText('On your account')).toBeNull()
  })

  it('says a list it could not read is unknown, not empty', async () => {
    // A refusal from the hub is not an account without pods, and the two used to
    // render identically — under a sales pitch for something already owned.
    const { useConnection } = await mount({
      session: { email: 'a@b.com', premium: true },
      podsLoaded: false,
      overrides: { list_pods: new Error('hub said 503') },
    })
    await useConnection.getState().refreshPods()
    await waitFor(() => expect(screen.getByText(/Could not read the pod list/)).toBeTruthy())
    expect(screen.getByText(/hub said 503/)).toBeTruthy()
    expect(screen.queryByText('No pod on this account yet.')).toBeNull()
  })

  it('tells somebody with no account that signing in makes one', async () => {
    // "Sign in with Metalcraft ID" is a wall to a reader who knows they do not
    // have one — and there is nothing to sign up *for*: the hub creates the
    // account on the first Google callback. The only thing missing was saying so.
    await mount({ session: null })
    expect(screen.getByText(/No account yet\? Signing in with Google makes one/)).toBeTruthy()
  })

  it('re-reads the account, not just its pods, when asked to check again', async () => {
    // The button a person presses after paying in a browser. Listing pods against
    // a `premium` flag snapshotted at sign-in would answer the wrong question and
    // keep selling them what they just bought.
    const { calls } = await mount({ session: { email: 'a@b.com', premium: false } })
    await userEvent.click(screen.getByRole('button', { name: /Check again/ }))
    await waitFor(() => expect(calls).toContain('refresh_session'))
    expect(calls).toContain('list_pods')
  })

  it('tells a paid account with no pod that one is coming, and offers to ask', async () => {
    // Not a sale. Offering an upgrade here would be the app failing to notice it
    // had already been paid.
    const { calls } = await mount({ session: { email: 'a@b.com', premium: true }, pods: [] })
    expect(screen.getByText('Premium is on this account')).toBeTruthy()
    expect(screen.queryByText(/Get Metalcraft premium/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Provision my pod/ }))
    await waitFor(() => expect(calls).toContain('provision_pod'))
  })
})
