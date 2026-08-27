import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'
import type { ResetReport } from '@/types'

afterEach(cleanup)

const clean: ResetReport = {
  scope: 'full',
  data_dir: '/data',
  removed: ['chats', 'keys.json', 'memory'],
  kept: [],
  failed: [],
  restart: 'supervised',
}

async function mount(overrides: Record<string, unknown> = {}) {
  vi.resetModules()
  const calls: { method: string; args: unknown }[] = []

  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string, args: unknown) => {
      calls.push({ method, args })
      if (method in overrides) {
        const r = overrides[method]
        if (r instanceof Error) throw r
        return r as never
      }
      return undefined as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)

  const { DangerZoneCard } = await import('./DangerZoneCard')
  render(<DangerZoneCard />)
  return { calls }
}

/** Open the dialog and fill the phrase, which is the state most tests start from.
 *
 *  `fireEvent.change` rather than `userEvent.type`: this is a controlled input
 *  and the per-keystroke path costs seconds per test without exercising
 *  anything the component does differently. */
async function arm(phrase = 'FACTORY RESET') {
  await userEvent.click(screen.getByRole('button', { name: 'Reset…' }))
  await waitFor(() => expect(screen.getByLabelText(/Type FACTORY RESET/)).toBeTruthy())
  fireEvent.change(screen.getByLabelText(/Type FACTORY RESET/), { target: { value: phrase } })
}

const eraseButton = () => screen.getByRole('button', { name: 'Erase this pod' })

describe('DangerZoneCard', () => {
  it('does not reset without the phrase typed exactly', async () => {
    const { calls } = await mount({ factory_reset: clean })
    await arm('factory reset')

    // Case matters. The phrase is the whole gate, and a gate that accepts a
    // near-miss is one someone gets through without reading it.
    //
    // Asserted as disabled rather than clicked: the button carries
    // `pointer-events-none` when disabled, so a click here would be testing
    // whether userEvent can reach it, not whether the gate holds.
    expect(eraseButton().getAttribute('disabled')).not.toBeNull()
    expect(calls.some((c) => c.method === 'factory_reset')).toBe(false)
  })

  it('resets everything by default', async () => {
    const { calls } = await mount({ factory_reset: clean })
    await arm()
    await userEvent.click(eraseButton())

    await waitFor(() => expect(calls.some((c) => c.method === 'factory_reset')).toBe(true))
    // Full, without anyone choosing it — the weaker scope must never be what a
    // person gets by not looking.
    expect(calls.find((c) => c.method === 'factory_reset')?.args).toEqual({ scope: 'full' })
  })

  it('sends the narrower scope when it is chosen', async () => {
    const { calls } = await mount({ factory_reset: { ...clean, scope: 'keep_keys' } })
    await userEvent.click(screen.getByRole('button', { name: 'Reset…' }))
    await userEvent.click(screen.getByRole('radio', { name: /Everything except my keys/ }))
    fireEvent.change(screen.getByLabelText(/Type FACTORY RESET/), {
      target: { value: 'FACTORY RESET' },
    })
    await userEvent.click(eraseButton())

    await waitFor(() => expect(calls.some((c) => c.method === 'factory_reset')).toBe(true))
    expect(calls.find((c) => c.method === 'factory_reset')?.args).toEqual({ scope: 'keep_keys' })
  })

  /**
   * The report is the last thing the pod ever says — it exits a beat later. A
   * dialog that closed on success would throw away the only account of what was
   * removed.
   */
  it('keeps the report on screen after the pod answers', async () => {
    await mount({ factory_reset: clean })
    await arm()
    await userEvent.click(eraseButton())

    await waitFor(() => expect(screen.getByText('The pod is restarting')).toBeTruthy())
    expect(screen.getByText(/Removed 3 items/)).toBeTruthy()
  })

  /**
   * The case worth failing loudly on: the pod restarts anyway, so it comes back
   * *looking* new while still holding some of what it held. Reported as success,
   * an operator would then test onboarding against a dirty pod.
   */
  it('says the pod is not fresh when the wipe left things behind', async () => {
    await mount({
      factory_reset: {
        ...clean,
        failed: [{ name: 'memory', error: 'Device or resource busy' }],
      },
    })
    await arm()
    await userEvent.click(eraseButton())

    await waitFor(() => expect(screen.getByText(/This pod is not factory-fresh/)).toBeTruthy())
    expect(screen.getByText(/Device or resource busy/)).toBeTruthy()
    // And no invitation to treat it as a fresh pod.
    expect(screen.queryByText(/Removed 3 items/)).toBeNull()
  })

  /** An unsupervised pod stays down. Offering "Reconnect" would be a lie. */
  it('offers no reconnect for a pod nothing will restart', async () => {
    await mount({ factory_reset: { ...clean, restart: 'manual' } })
    await arm()
    await userEvent.click(eraseButton())

    await waitFor(() => expect(screen.getByText(/will stay down/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull()
  })

  it('offers reconnect for a supervised pod', async () => {
    await mount({ factory_reset: clean })
    await arm()
    await userEvent.click(eraseButton())

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy())
  })

  /** `null` from the RPC is a pod older than the endpoint, not a failure. */
  it('explains a pod too old to reset itself', async () => {
    await mount({ factory_reset: null })
    await arm()
    await userEvent.click(eraseButton())

    await waitFor(() => expect(screen.getByText(/too old to reset itself/)).toBeTruthy())
  })

  /**
   * A dead connection after the request is genuinely ambiguous — the pod may
   * have wiped and exited before answering. Saying "it failed" is what gets a
   * pod wiped twice.
   */
  it('does not claim the reset failed when the pod simply stopped answering', async () => {
    await mount({ factory_reset: new Error('connection closed') })
    await arm()
    await userEvent.click(eraseButton())

    await waitFor(() => expect(screen.getByText(/did not answer/)).toBeTruthy())
    expect(screen.getByText(/may still have reset/)).toBeTruthy()
  })

  it('names the key store only in the scope that takes it', async () => {
    await mount()
    await userEvent.click(screen.getByRole('button', { name: 'Reset…' }))
    expect(screen.getByText('the key store')).toBeTruthy()

    await userEvent.click(screen.getByRole('radio', { name: /Everything except my keys/ }))
    expect(screen.queryByText('the key store')).toBeNull()
  })
})
