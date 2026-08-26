import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InferenceStatus } from '@/types'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

/** Fresh module graph per case: the stores are singletons and `useNudges` reads
 *  localStorage at construction. */
async function mount(state: {
  info?: unknown
  presets?: unknown[]
  instances?: unknown[]
  ownSource?: boolean | null
  premium?: boolean
  inference?: InferenceStatus | null
  loading?: boolean
  /** The pod this window is on, and what the account owns — the pair that says
   *  whether somebody is self-hosting. */
  pod?: { slug: string; url: string } | null
  pods?: { id: string; slug: string; url: string }[]
  /** Whether that list has been answered. An unanswered one is an empty array
   *  that means nothing, which is what the mid-boot case is about. */
  podsLoaded?: boolean
}) {
  vi.resetModules()
  const { useConnection } = await import('@/stores/connection')
  const { useFleet } = await import('@/stores/fleet')
  const { useUi } = await import('@/stores/ui')
  const { useNudges } = await import('@/stores/nudges')
  const { Nudges } = await import('./Nudges')

  useConnection.setState({
    info: (state.info ?? { name: 'agent', version: '1' }) as never,
    session: { email: 'a@b.c', premium: state.premium ?? false },
    ready: true,
    pod: (state.pod ?? null) as never,
    pods: (state.pods ?? []) as never,
    podsLoaded: state.podsLoaded ?? true,
  })
  useFleet.setState({
    presets: (state.presets ?? []) as never,
    instances: (state.instances ?? []) as never,
    loading: state.loading ?? false,
  })
  useUi.setState({ ownSource: state.ownSource ?? true, inference: state.inference ?? null })
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
    await mount({ ownSource: false })
    expect(screen.getByText('This pod cannot think yet')).toBeTruthy()
  })

  it('never claims a premium account\'s pod cannot think', async () => {
    // An empty key store is the *normal* state of a provisioned pod: it thinks on
    // the injected platform credential, which this app cannot see. Reading that as
    // "cannot think" told people with a working pod it was dead.
    await mount({ ownSource: false, premium: true, presets: [{ slug: 'p' }], instances: [{ id: 'i' }] })
    expect(screen.queryByText('This pod cannot think yet')).toBeNull()
  })

  it('names the right cause when the pod has a credential but no plan', async () => {
    // Ready, but routed at the gateway on an account that cannot pay: telling this
    // person to paste an API key without saying why would be a non-sequitur.
    await mount({
      ownSource: false,
      premium: false,
      inference: { ready: true, credential: 'pod_token', gateway: true },
    })
    expect(screen.getByText(/needs premium on this account/)).toBeTruthy()
  })

  it('names the right cause when the pod has no credential at all', async () => {
    await mount({
      ownSource: false,
      premium: true,
      inference: { ready: false, credential: 'none', gateway: false },
    })
    expect(screen.getByText(/no provider credential at all/)).toBeTruthy()
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
    await mount({ ownSource: false, presets: [] })
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

  it('stays inside the sidebar, where it cannot cover the composer', async () => {
    // The regression this exists for: the card was `absolute bottom-10 left-4`
    // on the *shell*, so a 320px card landed on top of the session composer. The
    // textarea was still rendered and still focusable — just underneath — which
    // reads exactly like "there is no input box".
    //
    // Bounded to the sidebar column, it cannot reach the centre pane at all.
    await mount({ presets: [] })
    const card = screen.getByText('No agents to spawn from').closest('.shadow-overlay')
    expect(card).toBeTruthy()
    // Spans the sidebar's own width rather than being placed from the window's
    // left edge, so its right edge cannot cross into the centre column.
    expect(card?.className).toContain('inset-x-2')
    expect(card?.className).not.toContain('left-4')
  })

  it('opens the source step from the card', async () => {
    const { useUi } = await mount({ ownSource: false })
    await userEvent.click(screen.getByRole('button', { name: 'Bind a source' }))
    expect(useUi.getState().activeKey).toBe('source')
  })

  it('tells a self-hoster what premium adds, once nothing else needs doing', async () => {
    // The reader a paywall insults: they run the product daily, on their own
    // hardware. So it is last, it is dismissible, and it names two things they
    // can check from inside this app rather than a page of benefits.
    await mount({
      presets: [{ slug: 'p' }],
      instances: [{ id: 'i' }],
      premium: false,
      pod: { slug: 'mine', url: 'https://pod.example.com' },
      pods: [],
    })
    expect(screen.getByText('Premium adds two things to this pod')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'See what it costs' })).toBeTruthy()
  })

  it('does not sell to somebody already on a pod from their account', async () => {
    await mount({
      presets: [{ slug: 'p' }],
      instances: [{ id: 'i' }],
      premium: false,
      pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
      pods: [{ id: 'amy', slug: 'amy', url: 'https://amy.metalcraftai.com' }],
    })
    expect(screen.queryByText('Premium adds two things to this pod')).toBeNull()
  })

  it('waits for the pod list before deciding somebody is self-hosting', async () => {
    // Mid-boot the account's pods are an empty array, which is indistinguishable
    // from having none — and nudging on that would flash a sales pitch at a
    // paying customer on every launch. `ready` is *true* here on purpose: the
    // window knows who you are well before it knows what you own, and it was the
    // first of those it used to wait for.
    await mount({
      presets: [{ slug: 'p' }],
      instances: [{ id: 'i' }],
      premium: false,
      pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
      pods: [],
      podsLoaded: false,
    })
    expect(screen.queryByText('Premium adds two things to this pod')).toBeNull()
  })

  it('never speaks over a blocker', async () => {
    // A pod that cannot think is a problem; premium is an offer. The offer waits.
    await mount({
      presets: [{ slug: 'p' }],
      instances: [{ id: 'i' }],
      premium: false,
      ownSource: false,
      inference: { ready: false, credential: 'none', gateway: false } as InferenceStatus,
      pod: { slug: 'mine', url: 'https://pod.example.com' },
      pods: [],
    })
    expect(screen.getByText('This pod cannot think yet')).toBeTruthy()
    expect(screen.queryByText('Premium adds two things to this pod')).toBeNull()
  })
})
