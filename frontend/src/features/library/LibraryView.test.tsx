import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const SNAPSHOT = {
  agent_presets: [
    {
      slug: 'amy',
      name: 'Amy',
      description: 'Plans meals.',
      tagline: 'Knows every flavour.',
      pack_id: 'amy_kitchen',
      default_persona: 'amy-host',
      persona_count: 3,
      read_only: true,
    },
  ],
  personas: [
    { slug: 'amy-host', name: 'Amy — host', description: 'Warm.', pack_id: 'amy_kitchen', read_only: true },
  ],
  skills: [{ slug: 'plan-a-menu', description: 'Build a menu.', pack_id: 'amy_kitchen', read_only: true }],
  api_tools: [
    { name: 'octaweave_create_note', description: 'Write a note.', pack_id: 'octaweave', read_only: true },
  ],
  default_agent_preset: 'amy',
}

const PRESET = {
  preset: {
    slug: 'amy',
    name: 'Amy',
    tagline: 'Knows every flavour.',
    description: 'Plans meals.',
    version: '1.2.0',
    default_persona: 'amy-host',
    personas: [
      { slug: 'amy-host', role: 'primary' },
      { slug: 'amy-sommelier', role: 'specialist' },
    ],
    skills: ['plan-a-menu'],
    integrations: ['octaweave'],
    requires_env: ['OCTAWEAVE_API_KEY', 'MISSING_KEY'],
    model: { tier: 'reasoning', prefer: 'gpt-5.4', min_context: 128000, needs: ['tools'] },
    memories: { file: 'memories.jsonl', count: 412, dims: 1536, embed_model: 'text-embedding-3-small' },
    manifest_version: 2,
  },
  personas: [
    {
      slug: 'amy-host',
      installed: true,
      name: 'Amy — host',
      description: 'Warm.',
      tools: ['load_skill', 'octaweave_create_note'],
      skills: ['plan-a-menu'],
    },
    {
      slug: 'amy-sommelier',
      installed: false,
      name: 'amy-sommelier',
      description: '',
      tools: [],
      skills: [],
      error: "persona 'amy-sommelier' is not installed on this pod",
    },
  ],
}

async function mount(over: Record<string, unknown> = {}) {
  vi.resetModules()
  const calls: { method: string; args?: Record<string, unknown> }[] = []
  const responses: Record<string, unknown> = {
    pod_snapshot: SNAPSHOT,
    list_integrations: [
      { id: 'octaweave', name: 'Octaweave', description: 'Notes and board.', version: '1.0.0', enabled: true, personas: 0, skills: 0, api_tools: 32, flow_templates: 0, requires_env: [] },
    ],
    list_installed_packs: [
      { id: 'amy_kitchen', name: "Amy's Kitchen", version: '1.2.0', description: 'A cook.', presets: ['amy'] },
    ],
    list_flow_templates: [{ slug: 'weekly-menu', name: 'Plan next week', pack_id: 'amy_kitchen' }],
    list_keys: [{ name: 'OCTAWEAVE_API_KEY', masked: '…1234', scope: 'global', managed: false }],
    list_instances: [],
    preset_detail: PRESET,
    persona_detail: {
      name: 'Amy — host',
      description: 'Warm.',
      tools: ['load_skill', 'octaweave_create_note'],
      skills: ['plan-a-menu'],
      integrations: ['octaweave'],
      system_prompt: 'You are Amy.',
      version: '1.1.0',
    },
    skill_detail: {
      slug: 'plan-a-menu',
      description: 'Build a menu.',
      body: '# Plan a menu\n\nAsk who is eating.',
      pack_id: 'amy_kitchen',
      read_only: true,
    },
    integration_detail: {
      id: 'octaweave',
      name: 'Octaweave',
      description: 'Notes and board.',
      version: '1.0.0',
      enabled: true,
      personas: [],
      skills: [],
      api_tools: ['octaweave_create_note'],
      flow_templates: [],
      requires_env: ['OCTAWEAVE_API_KEY'],
    },
    agent_pack_detail: {
      id: 'amy_kitchen',
      name: "Amy's Kitchen",
      version: '1.2.0',
      description: 'A cook.',
      presets: ['amy'],
      provides: { personas: ['amy-host'], skills: ['plan-a-menu'] },
    },
    api_tool_detail: {
      name: 'octaweave_create_note',
      description: 'Write a note.',
      method: 'POST',
      url: 'https://octaweave.com/api/v1/notes',
      headers: { Authorization: 'Bearer ${OCTAWEAVE_API_KEY}' },
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
    ...over,
  }
  const transport: Transport = {
    call: vi.fn(async (method: string, args?: Record<string, unknown>) => {
      calls.push({ method, args })
      if (!(method in responses)) throw new Error(`unstubbed: ${method}`)
      const value = responses[method]
      if (value instanceof Error) throw value
      return value as never
    }),
    listen: vi.fn(async () => () => {}),
  }
  const t = await import('@/rpc/transport')
  t.setTransport(transport)
  const { LibraryView } = await import('./LibraryView')
  render(<LibraryView />)
  return { calls }
}

describe('LibraryView', () => {
  it('lists every kind of artifact the pod holds, not just the ones with a tab', async () => {
    await mount()
    // The point of the surface: personas, skills and api tools have no other
    // screen in this app at all, and no listing route on the pod either — they
    // exist here or nowhere.
    expect(await screen.findByText('Amy')).toBeTruthy()
    expect(await screen.findByText('Amy — host')).toBeTruthy()
    expect(await screen.findByText('plan-a-menu')).toBeTruthy()
    expect(await screen.findByText('octaweave_create_note')).toBeTruthy()
    expect(await screen.findByText('Octaweave')).toBeTruthy()
    expect(await screen.findByText("Amy's Kitchen")).toBeTruthy()
    expect(await screen.findByText('Plan next week')).toBeTruthy()
  })

  it('marks the pod default, because that is a fact about the pod', async () => {
    await mount()
    expect(await screen.findByText(/this pod.s default agent|pod default/i)).toBeTruthy()
  })

  it('opens a show page in the same tab, with a trail back', async () => {
    await mount()
    await userEvent.click(await screen.findByText('Amy'))

    // The preset's own declaration, not just the summary the index had.
    expect(await screen.findByText('Model floor')).toBeTruthy()
    expect(screen.getByText('Persona roster')).toBeTruthy()

    const trail = screen.getByRole('navigation', { name: /library trail/i })
    expect(within(trail).getByText('amy')).toBeTruthy()

    await userEvent.click(within(trail).getByRole('button', { name: /^Library$/ }))
    // Back at the index — the whole library, not a filtered remnant of it.
    expect(await screen.findByLabelText(/search the library/i)).toBeTruthy()
    expect(screen.getByText("Amy's Kitchen")).toBeTruthy()
  })

  it('follows a reference from one artifact into another', async () => {
    // This is the feature. A preset's `skills` is a list of strings on the wire;
    // what makes this a library rather than a listing is that pressing one
    // arrives at the skill.
    const { calls } = await mount()
    await userEvent.click(await screen.findByText('Amy'))
    // The preset reaches this skill twice — once directly, once through the
    // persona that loads it. Both chips are correct and both go to the same
    // page; the first is the preset's own.
    const chips = await screen.findAllByRole('button', { name: /Skill · plan-a-menu/ })
    await userEvent.click(chips[0]!)

    expect(await screen.findByText(/Ask who is eating/)).toBeTruthy()
    expect(calls.some((c) => c.method === 'skill_detail' && c.args?.slug === 'plan-a-menu')).toBe(true)

    // And the trail records how you got here, so the way back is one press.
    const trail = screen.getByRole('navigation', { name: /library trail/i })
    expect(within(trail).getByText('amy')).toBeTruthy()
    expect(within(trail).getByText('plan-a-menu')).toBeTruthy()
  })

  it('shows a persona the preset names but the pod does not have', async () => {
    // Omitting it would make the preset look smaller than it is, and would hide
    // the one thing worth knowing: which reference is dangling, and why.
    await mount()
    await userEvent.click(await screen.findByText('Amy'))
    expect(await screen.findByText(/is not installed on this pod/)).toBeTruthy()
    expect(screen.getByText(/1 not on this pod/)).toBeTruthy()
  })

  it('checks what a preset needs against what the pod actually holds', async () => {
    await mount()
    await userEvent.click(await screen.findByText('Amy'))
    expect(await screen.findByText('MISSING_KEY')).toBeTruthy()
    expect(screen.getByText(/not in this pod.s key store/)).toBeTruthy()
    // An agent that will spawn and then fail on its first tool call is worth a
    // warning, not a silent row in a list.
    expect(screen.getByText(/One key this agent needs is/)).toBeTruthy()
  })

  it('links a tool name only when it names an artifact', async () => {
    await mount()
    await userEvent.click(await screen.findByText('Amy'))
    // `octaweave_create_note` is an installed api tool, so it opens.
    expect(screen.getByRole('button', { name: /API tool · octaweave_create_note/ })).toBeTruthy()
    // `load_skill` is native to the agent and has no page — rendering it as a
    // chip that goes nowhere would teach that half these links are dead.
    expect(screen.queryByRole('button', { name: /· load_skill/ })).toBeNull()
  })

  it('masks a credential in a tool header but keeps a reference to one', async () => {
    await mount({
      api_tool_detail: {
        name: 'leaky',
        method: 'GET',
        url: 'https://example.com',
        headers: { Authorization: 'Bearer sk-live-0123456789abcdefghij', 'X-Trace': 'on' },
        parameters: { type: 'object', properties: {} },
      },
    })
    await userEvent.click(await screen.findByText('octaweave_create_note'))
    // A literal secret must not cross into the webview…
    expect(await screen.findByText('••••••••')).toBeTruthy()
    expect(screen.queryByText(/sk-live-0123456789abcdefghij/)).toBeNull()
    // …while a header that is not a credential stays readable.
    expect(screen.getByText('on')).toBeTruthy()
  })

  it('says a pod is too old to answer rather than showing it as empty', async () => {
    // `null` is the pod declining the question. Rendering that as an empty
    // library would tell someone their pod is bare when it is merely old.
    await mount({ pod_snapshot: null })
    expect(await screen.findByText(/older than the endpoint the library reads/)).toBeTruthy()
    expect(screen.queryByText(/nothing installed yet/)).toBeNull()
  })

  it('still shows the library when one of the side lists fails', async () => {
    // Only the snapshot is load-bearing. Losing the flow templates must not
    // blank the presets, personas and skills behind them.
    await mount({ list_flow_templates: new Error('503') })
    expect(await screen.findByText('Amy')).toBeTruthy()
    expect(screen.queryByText('Plan next week')).toBeNull()
  })

  it('searches across every kind at once', async () => {
    await mount()
    await screen.findByText('Amy')
    await userEvent.type(screen.getByLabelText(/search the library/i), 'menu')
    await waitFor(() => expect(screen.queryByText('Amy — host')).toBeNull())
    expect(screen.getByText('plan-a-menu')).toBeTruthy()
    expect(screen.getByText('Plan next week')).toBeTruthy()
  })

  it('says when an installed pack has a newer version, without going shopping', async () => {
    // The Library is where someone looks at what a pod holds with no intention of
    // opening a registry. Before this it showed the version and stopped, so the
    // one screen that answers "what is on this pod" could not answer "and is it
    // current".
    await mount()
    const { usePacks } = await import('@/stores/packs')
    usePacks.setState({
      installed: [{ id: 'amy_kitchen', version: '1.2.0', presets: ['amy'] }],
      results: [
        {
          reference: 'axoniac:@amy_kitchen',
          id: 'amy_kitchen',
          name: "Amy's Kitchen",
          version: '1.4.0',
          tags: [],
          verified: true,
        },
      ],
    })
    await waitFor(() => expect(screen.getByText(/v1\.2\.0 → 1\.4\.0/)).toBeTruthy())
  })

  it('updates a pack from its own page, through the update endpoint', async () => {
    // A second path that quietly installed instead would be the original bug
    // growing back in a different tab.
    const { calls } = await mount({
      update_pack: {
        id: 'amy_kitchen',
        from_version: '1.2.0',
        to_version: '1.4.0',
        personas_fell_back: [],
        orphaned: [],
        memory_bases_repointed: [],
      },
    })
    const { usePacks } = await import('@/stores/packs')
    usePacks.setState({
      installed: [{ id: 'amy_kitchen', version: '1.2.0', presets: ['amy'] }],
      results: [
        {
          reference: 'axoniac:@amy_kitchen',
          id: 'amy_kitchen',
          name: "Amy's Kitchen",
          version: '1.4.0',
          tags: [],
          verified: true,
        },
      ],
    })

    await userEvent.click(await screen.findByText("Amy's Kitchen"))
    await waitFor(() => expect(screen.getByText(/Version 1\.4\.0 is available/)).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'update_pack')).toBe(true))
    expect(calls.some((c) => c.method === 'install_pack')).toBe(false)
  })
})
