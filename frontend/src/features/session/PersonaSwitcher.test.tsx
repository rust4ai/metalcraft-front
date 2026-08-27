import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentInstance } from '@/types'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const instance = {
  id: 'i1',
  agent_preset: 'kitchen',
  name: 'Amy',
  persona: 'chef',
  origin: { kind: 'workshop' },
  created_at: '',
  last_active_at: '',
} as AgentInstance

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
  const { PersonaSwitcher } = await import('./PersonaSwitcher')
  render(<PersonaSwitcher instance={instance} />)
}

const roster = [
  { slug: 'chef', installed: true, name: 'Chef', description: 'cooks', tools: [], skills: [] },
  { slug: 'baker', installed: true, name: 'Baker', description: 'bakes', tools: [], skills: [] },
  { slug: 'gone', installed: false, name: 'gone', description: '', tools: [], skills: [], error: 'missing' },
]

describe('PersonaSwitcher', () => {
  it('stays plain text when the roster offers no alternative', async () => {
    // A dropdown that can only pick what is already picked is furniture.
    await mount({ list_preset_personas: [roster[0]] })
    await waitFor(() => expect(screen.getByText('chef')).toBeTruthy())
    expect(screen.queryByRole('button', { expanded: false })).toBeNull()
  })

  it('offers the roster and switches', async () => {
    await mount({
      list_preset_personas: roster,
      set_instance_persona: { ...instance, persona: 'baker' },
    })
    await userEvent.click(await screen.findByRole('button', { name: /chef/ }))
    await userEvent.click(screen.getByRole('option', { name: /Baker/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  it('keeps an uninstalled persona visible but unselectable', async () => {
    // Dropping the row would turn "the pack names a voice this pod lacks" into a
    // mystery; showing it disabled is the explanation.
    await mount({ list_preset_personas: roster })
    await userEvent.click(await screen.findByRole('button', { name: /chef/ }))
    const missing = screen.getByRole('option', { name: /not installed/ })
    expect(missing.hasAttribute('disabled')).toBe(true)
  })

  it('shows the pod refusal verbatim — it names the roster', async () => {
    await mount({
      list_preset_personas: roster,
      set_instance_persona: new Error("persona 'baker' is not in agent 'kitchen' (roster: chef)"),
    })
    await userEvent.click(await screen.findByRole('button', { name: /chef/ }))
    await userEvent.click(screen.getByRole('option', { name: /Baker/ }))
    await waitFor(() => expect(screen.getByText(/roster: chef/)).toBeTruthy())
  })
})
