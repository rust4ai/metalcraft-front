import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const hit = {
  reference: 'axoniac:@amy_kitchen',
  id: 'amy_kitchen',
  name: 'Amy Kitchen',
  version: '1.2.0',
  tagline: 'cooks',
  tags: [],
  verified: true,
  install_count: 12,
}

const manifest = {
  id: 'amy_kitchen',
  name: 'Amy Kitchen',
  version: '1.2.0',
  description: 'A kitchen agent.',
  presets: ['chef'],
  provides: { personas: ['chef', 'baker'], skills: ['recipe'] },
  requires_env: [
    { name: 'OPENAI_API_KEY', needed_by: ['chef'], required: true },
    { name: 'SPOON_API_KEY', needed_by: ['recipe'], required: true },
    { name: 'NICE_TO_HAVE', needed_by: ['chef'], required: false },
  ],
  domains: ['api.spoonacular.com'],
}

async function mount(responses: Record<string, unknown>) {
  vi.resetModules()
  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string) => {
      if (!(method in responses)) throw new Error(`unstubbed: ${method}`)
      const r = responses[method]
      if (r instanceof Error) throw r
      return r as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)
  const { usePacks } = await import('@/stores/packs')
  const { PackDetail } = await import('./PackDetail')
  usePacks.setState({ active: 'axoniac' })
  render(<PackDetail />)
  await usePacks.getState().view(hit as never)
  return usePacks
}

describe('PackDetail', () => {
  it('shows what the pack provides before it is installed', async () => {
    await mount({ registry_manifest: manifest, list_keys: [] })
    await waitFor(() => expect(screen.getByText('A kitchen agent.')).toBeTruthy())
    // "chef" is both a preset and a persona, so it legitimately appears twice.
    expect(screen.getAllByText('chef').length).toBe(2)
    expect(screen.getByText('baker')).toBeTruthy()
    expect(screen.getByText('recipe')).toBeTruthy()
    // Where it will reach is a pre-install fact, not a footnote.
    expect(screen.getByText('api.spoonacular.com')).toBeTruthy()
  })

  it('marks a required key the pod already has as met', async () => {
    await mount({
      registry_manifest: manifest,
      list_keys: [{ name: 'OPENAI_API_KEY', masked: 'sk-…', scope: 'global', managed: false }],
    })
    // One of the two required keys is still missing, so the warning counts one.
    await waitFor(() => expect(screen.getByText(/1 required key is not in this pod/)).toBeTruthy())
  })

  it('warns about every unmet required key before installing', async () => {
    // PLAN §9.4: an unmet requirement is a checklist item now, not a runtime
    // failure the first time someone talks to the agent.
    await mount({ registry_manifest: manifest, list_keys: [] })
    await waitFor(() => expect(screen.getByText(/2 required keys are not in this pod/)).toBeTruthy())
  })

  it('never counts an optional key as missing', async () => {
    // A pack that works better with a key it does not require must not look broken.
    await mount({ registry_manifest: manifest, list_keys: [] })
    await waitFor(() => expect(screen.getByText('NICE_TO_HAVE')).toBeTruthy())
    expect(screen.getByText('optional')).toBeTruthy()
    expect(screen.queryByText(/3 required/)).toBeNull()
  })

  it('reports a manifest the host will not serve', async () => {
    const store = await mount({ registry_manifest: new Error('boom'), list_keys: [] })
    await waitFor(() => expect(store.getState().manifestError[hit.reference]).toBeTruthy())
  })

  it('closes without installing', async () => {
    const store = await mount({ registry_manifest: manifest, list_keys: [] })
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(store.getState().viewing).toBeNull()
  })
})
