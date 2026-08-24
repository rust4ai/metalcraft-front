import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'
import type { GatewayStatus } from '@/types'

afterEach(cleanup)

const base: GatewayStatus = {
  configured: true,
  registered: false,
  verified: false,
  connected: false,
  streaming: false,
  active_number: null,
  channel: null,
  has_public_url: true,
  webhook_stale: false,
  error: null,
}

const registered = { ...base, registered: true, active_number: '+15550199', channel: 'whatsapp' }
const verified = { ...registered, verified: true }
const connected = { ...verified, connected: true, streaming: true }

/**
 * `gateway_status` is a *sequence* in the interesting cases — unverified, then
 * unverified again, then verified — so an override may be an array consumed one
 * call at a time. The last entry sticks, which is what a phone that never texts
 * back looks like.
 */
async function mount(overrides: Record<string, unknown> = {}, pollMs = 5) {
  vi.resetModules()
  const calls: { method: string; args: unknown }[] = []
  const queues = new Map<string, unknown[]>()

  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string, args: unknown) => {
      calls.push({ method, args })
      if (method in overrides) {
        const spec = overrides[method]
        let r = spec
        if (Array.isArray(spec)) {
          const q = queues.get(method) ?? [...spec]
          queues.set(method, q)
          r = q.length > 1 ? q.shift() : q[0]
        }
        if (r instanceof Error) throw r
        return r as never
      }
      if (method === 'gateway_status') return base as never
      return undefined as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)

  const { GatewayCard } = await import('./GatewayCard')
  render(<GatewayCard pollMs={pollMs} />)
  return { calls }
}

const type = async (n: string) => {
  await userEvent.type(screen.getByLabelText('Your phone number'), n)
}

describe('GatewayCard', () => {
  it('asks for a number when nothing is set up', async () => {
    await mount()
    await waitFor(() => expect(screen.getByText('Not set up')).toBeTruthy())
    expect(screen.getByLabelText('Your phone number')).toBeTruthy()
  })

  it('refuses to send a number the gateway would reject', async () => {
    // E.164 or a 400 — checking here turns a round trip into a disabled button.
    const { calls } = await mount()
    await waitFor(() => expect(screen.getByLabelText('Your phone number')).toBeTruthy())
    await type('555 0100')
    expect(screen.getByRole('button', { name: 'Register' }).getAttribute('disabled')).not.toBeNull()
    expect(calls.some((c) => c.method === 'gateway_register')).toBe(false)
  })

  it('shows the code to text back, and finishes on its own when it lands', async () => {
    const { calls } = await mount({
      gateway_register: {
        personal_number: '+15550100',
        active_number: '+15550199',
        channel: 'whatsapp',
        verified: false,
        verify_code: '424242',
      },
      // Registered and unverified until the phone answers, then verified.
      gateway_status: [base, registered, registered, verified],
    })
    await waitFor(() => expect(screen.getByLabelText('Your phone number')).toBeTruthy())
    await type('+15550100')
    await userEvent.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(screen.getByText('424242')).toBeTruthy())
    expect(screen.getByText('Unverified')).toBeTruthy()

    // Nobody presses anything for this — the poll is the only thing that can
    // notice a text message.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy())
    expect(calls.filter((c) => c.method === 'gateway_status').length).toBeGreaterThan(2)
    expect(calls.filter((c) => c.method === 'gateway_register').length).toBe(1)
  })

  it('does not offer Connect until the number is verified', async () => {
    // The pod 409s a connect before verification, so an enabled button here
    // would be an invitation to fail.
    await mount({ gateway_status: registered })
    await waitFor(() => expect(screen.getByText('Unverified')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('treats a verified but unwired number as unfinished, not as connected', async () => {
    // The step nobody would guess at: the number is proved and messages still
    // reach nothing until the channel is wired.
    const { calls } = await mount({ gateway_status: [verified, connected] })
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy())
    expect(screen.getByText('+15550199')).toBeTruthy()
    expect(calls.some((c) => c.method === 'gateway_connect')).toBe(true)
  })

  it('says a connected pod is not receiving when its webhook went stale', async () => {
    // Green light, dead pipe: `connected` is config on disk and says nothing
    // about whether the gateway can still reach this pod.
    await mount({ gateway_status: { ...connected, webhook_stale: true, streaming: false } })
    await waitFor(() => expect(screen.getByText('Not receiving')).toBeTruthy())
    expect(screen.getByText(/messages are being lost/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Re-register the webhook/ })).toBeTruthy()
  })

  it('offers nothing on a pod too old to answer', async () => {
    // `null` is not "not connected": a button here would 404.
    await mount({ gateway_status: null })
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy())
    expect(screen.queryByLabelText('Your phone number')).toBeNull()
  })

  it('says so when the pod has no account token, instead of offering a number field', async () => {
    await mount({ gateway_status: { ...base, configured: false } })
    await waitFor(() => expect(screen.getByText(/not linked to a Metalcraft account/)).toBeTruthy())
    expect(screen.queryByLabelText('Your phone number')).toBeNull()
  })

  it('keeps the local half when the pod could not reach the gateway', async () => {
    // The pod answers with what it knows plus an error. Rendering that as
    // "not connected" would be a claim we cannot support.
    await mount({
      gateway_status: { ...connected, error: 'gateway phone request failed: timed out' },
    })
    await waitFor(() => expect(screen.getByText(/gateway phone request failed/)).toBeTruthy())
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('surfaces a refusal rather than changing state', async () => {
    await mount({
      gateway_status: verified,
      gateway_connect: new Error('register and verify your number before connecting'),
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByText(/register and verify your number/)).toBeTruthy())
    expect(screen.getByText('Not connected')).toBeTruthy()
  })

  it('disconnects without asking for the number again', async () => {
    // Disconnecting is local to the pod; the registration survives, so
    // reconnecting must not walk somebody back through verification.
    const { calls } = await mount({ gateway_status: [connected, verified] })
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: /Disconnect/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy())
    expect(screen.queryByLabelText('Your phone number')).toBeNull()
    expect(calls.some((c) => c.method === 'gateway_disconnect')).toBe(true)
  })

  it('gives back the number field when asked, and keeps it when the new number is refused', async () => {
    // The pod goes on reporting "registered, unverified" until a *new*
    // registration replaces the old one — so this button has to override that
    // locally, or it is the one control on the card that does nothing.
    await mount({
      gateway_status: registered,
      gateway_register: new Error('phone_number must be E.164, e.g. +15551234567'),
    })
    await waitFor(() => expect(screen.getByText('Unverified')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Use a different number' }))

    const field = await screen.findByLabelText('Your phone number')
    await userEvent.type(field, '+15550111')
    await userEvent.click(screen.getByRole('button', { name: 'Register' }))

    // Refused: the reason is on screen and the number is still in the field to
    // be fixed, rather than the card snapping back to waiting on the old one.
    await waitFor(() => expect(screen.getByText(/must be E.164/)).toBeTruthy())
    expect(screen.getByLabelText('Your phone number')).toBeTruthy()
  })

  it('offers to give the number back, asks first, and takes the pending code with it', async () => {
    // Distinct from Disconnect: this one ends the account's registration, and
    // nothing here undoes it.
    const { calls } = await mount({
      gateway_status: [connected, base],
      gateway_unregister: true,
    })
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Give the number back' }))

    // Asked, not done.
    expect(screen.getByText(/Release \+15550199 at the gateway\?/)).toBeTruthy()
    expect(calls.some((c) => c.method === 'gateway_unregister')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Release it' }))
    await waitFor(() => expect(screen.getByText('Not set up')).toBeTruthy())
    expect(calls.some((c) => c.method === 'gateway_unregister')).toBe(true)
    // And it is the *other* call — disconnect leaves the registration standing.
    expect(calls.some((c) => c.method === 'gateway_disconnect')).toBe(false)
  })

  it('offers it while merely registered too, not only while connected', async () => {
    // The state where somebody believes they have already left: this pod is not
    // connected, and the account still holds their number.
    await mount({ gateway_status: verified })
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Give the number back' })).toBeTruthy()
  })

  it('says so when the pod is too old to release the number', async () => {
    // `false` is not success. Silence here would leave someone believing they
    // had given a number back that the gateway still holds.
    await mount({ gateway_status: connected, gateway_unregister: false })
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Give the number back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Release it' }))

    await waitFor(() => expect(screen.getByText(/too old to release the number/)).toBeTruthy())
  })

  it('keeps the number when the confirmation is declined', async () => {
    const { calls } = await mount({ gateway_status: connected })
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Give the number back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(calls.some((c) => c.method === 'gateway_unregister')).toBe(false)
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('warns that a pod with no public URL will receive by long-poll', async () => {
    await mount({ gateway_status: { ...verified, has_public_url: false } })
    await waitFor(() => expect(screen.getByText(/receive by long-poll/)).toBeTruthy())
  })
})
