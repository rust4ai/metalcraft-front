import { describe, expect, it } from 'vitest'
import { KIND_ORDER, matches, refKey, sameRef } from './refs'

describe('refs', () => {
  it('keys a reference by kind as well as id', () => {
    // `octaweave` is legitimately both an integration and an agent pack. A cache
    // keyed on the bare id would serve one of them the other's document, which
    // is a bug that looks like a rendering glitch rather than a cache collision.
    expect(refKey({ kind: 'integration', id: 'octaweave' })).not.toBe(
      refKey({ kind: 'pack', id: 'octaweave' }),
    )
    expect(sameRef({ kind: 'skill', id: 'a' }, { kind: 'skill', id: 'a' })).toBe(true)
    expect(sameRef({ kind: 'skill', id: 'a' }, { kind: 'persona', id: 'a' })).toBe(false)
  })

  it('treats an empty query as matching everything', () => {
    expect(matches('', 'anything')).toBe(true)
    expect(matches('   ', 'anything')).toBe(true)
  })

  it('never lets a null field match on the word "null"', () => {
    // `matches(q, ...fields)` is handed optional fields straight off the wire,
    // and stringifying them would make a search for "nu" return every artifact
    // with no pack.
    expect(matches('nu', null, undefined)).toBe(false)
    expect(matches('nu', 'nutrition')).toBe(true)
  })

  it('searches case-insensitively across every field it is given', () => {
    expect(matches('KITCHEN', 'Amy', 'plans meals', 'amy_kitchen')).toBe(true)
    expect(matches('sommelier', 'Amy', 'plans meals')).toBe(false)
  })

  it('puts agents first, because that is what someone came to look at', () => {
    expect(KIND_ORDER[0]).toBe('preset')
    expect(new Set(KIND_ORDER).size).toBe(KIND_ORDER.length)
  })
})
