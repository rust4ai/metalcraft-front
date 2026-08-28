import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const stored = [
  { name: 'OPENAI_API_KEY', masked: 'sk-…1234', scope: 'global', managed: false },
  { name: 'POD_INTERNAL', masked: '••••', scope: 'global', managed: true },
]

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
      if (method === 'list_keys') return stored as never
      if (method === 'recommended_keys') return [] as never
      return undefined as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)
  const { KeysCard } = await import('./KeysCard')
  render(<KeysCard />)
  return calls
}

describe('KeysCard', () => {
  it('lists what the pod holds, masked', async () => {
    await mount()
    await waitFor(() => expect(screen.getByText('OPENAI_API_KEY')).toBeTruthy())
    expect(screen.getByText('sk-…1234')).toBeTruthy()
  })

  it('writes a new key and reloads', async () => {
    const calls = await mount()
    await waitFor(() => expect(screen.getByText('OPENAI_API_KEY')).toBeTruthy())
    await userEvent.type(screen.getByLabelText('Key name'), 'octaweave_api_key')
    await userEvent.type(screen.getByLabelText('Key value'), 'owk_live_x')
    await userEvent.click(screen.getByRole('button', { name: /Add/ }))

    const save = calls.find((c) => c.method === 'save_key')
    // Upper-cased on the way in: packs read keys by name, and `requires_env`
    // names are upper-case, so a lower-case entry would silently never match.
    expect(save?.args).toEqual({ name: 'OCTAWEAVE_API_KEY', value: 'owk_live_x' })
  })

  it('will not delete a key the pod manages for itself', async () => {
    await mount()
    await waitFor(() => expect(screen.getByText('POD_INTERNAL')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Delete POD_INTERNAL' })).toBeNull()
    expect(screen.getByText('managed')).toBeTruthy()
  })

  it('asks before deleting', async () => {
    const calls = await mount()
    await waitFor(() => expect(screen.getByText('OPENAI_API_KEY')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Delete OPENAI_API_KEY' }))
    // Nothing has happened yet — the first click only arms it.
    expect(calls.some((c) => c.method === 'delete_key')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(calls.some((c) => c.method === 'delete_key')).toBe(true)
  })

  it('reports a refused write instead of clearing the form', async () => {
    await mount({ save_key: new Error('pod refused') })
    await waitFor(() => expect(screen.getByText('OPENAI_API_KEY')).toBeTruthy())
    await userEvent.type(screen.getByLabelText('Key name'), 'A')
    await userEvent.type(screen.getByLabelText('Key value'), 'b')
    await userEvent.click(screen.getByRole('button', { name: /Add/ }))

    await waitFor(() => expect(screen.getByText(/pod refused/)).toBeTruthy())
    expect((screen.getByLabelText('Key value') as HTMLInputElement).value).toBe('b')
  })
})

describe('keys these packs still need', () => {
  const wanted = [
    { name: 'RESEND_API_KEY', configured: false, packs: ['email'], managed: false },
    { name: 'OPENAI_API_KEY', configured: true, packs: ['core'], managed: false },
    { name: 'METALCRAFT_TOKEN', configured: false, packs: ['metalcraft'], managed: true },
  ]

  it('lists only what is wanted and missing, and says who wants it', async () => {
    await mount({ recommended_keys: wanted })
    await waitFor(() => expect(screen.getByText('Keys these packs still need')).toBeTruthy())
    // A satisfied requirement has nothing to do about it.
    expect(screen.queryByRole('button', { name: 'Add OPENAI_API_KEY' })).toBeNull()
    // And a platform-injected one cannot be pasted in by the user at all, so
    // prompting for it would be worse than saying nothing.
    expect(screen.queryByRole('button', { name: 'Add METALCRAFT_TOKEN' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add RESEND_API_KEY' })).toBeTruthy()
    expect(screen.getByText('email')).toBeTruthy()
  })

  it('says nothing at all when every wanted key is filled in', async () => {
    await mount({ recommended_keys: [wanted[1]] })
    await waitFor(() => expect(screen.getByText('OPENAI_API_KEY')).toBeTruthy())
    expect(screen.queryByText('Keys these packs still need')).toBeNull()
  })

  it('survives a pod with nothing to say about recommendations', async () => {
    // A pod older than the route answers nothing. The key store is the point of
    // this screen and must still render.
    await mount({ recommended_keys: undefined })
    await waitFor(() => expect(screen.getByText('OPENAI_API_KEY')).toBeTruthy())
    expect(screen.queryByText('Keys these packs still need')).toBeNull()
  })
})
