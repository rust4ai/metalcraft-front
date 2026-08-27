import { describe, expect, it } from 'vitest'
import type { AgentPreset } from '@/types'
import { startablePresets } from './fleet'

const preset = (slug: string, extra: Partial<AgentPreset> = {}): AgentPreset => ({
  slug,
  name: slug,
  description: '',
  ...extra,
})

describe('startablePresets', () => {
  it('drops a library preset', () => {
    // A pack ships one to carry its personas and skills onto the pod. Offering it
    // in a picker offers a button the pod answers 400 to.
    const got = startablePresets([
      preset('general-agent'),
      preset('metalcraft-packs', { library: true, pack_id: 'metalcraft-packs' }),
    ])
    expect(got.map((p) => p.slug)).toEqual(['general-agent'])
  })

  it('keeps a preset with no flag — an older pod omits the field', () => {
    // The field arrived with the flag. Reading its absence as "library" would
    // empty the picker on every pod that predates it.
    const got = startablePresets([preset('general-agent'), preset('amy-kitchen')])
    expect(got).toHaveLength(2)
  })

  it('does not mutate or reorder what it was given', () => {
    const all = [preset('a'), preset('lib', { library: true }), preset('b')]
    expect(startablePresets(all).map((p) => p.slug)).toEqual(['a', 'b'])
    expect(all).toHaveLength(3)
  })
})
