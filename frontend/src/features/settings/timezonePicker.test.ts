import { describe, expect, it } from 'vitest'
import { filterZones } from './TimezonePicker'
import type { TimezoneRegion } from '@/types'

const regions: TimezoneRegion[] = [
  { region: 'UTC', zones: ['UTC'] },
  { region: 'America', zones: ['America/Detroit', 'America/New_York', 'America/Sao_Paulo'] },
  { region: 'Europe', zones: ['Europe/London'] },
]

describe('finding a timezone', () => {
  it('matches on the city, which is what people type', () => {
    // Nobody types "america/detroit" — they type "detroit".
    expect(filterZones(regions, 'detroit')).toEqual(['America/Detroit'])
  })

  it('is case-insensitive, because the names are not', () => {
    // `america/detroit` is a *rejected* zone on the pod. The picker exists so
    // nobody has to know that, which means it has to find the right one from
    // the wrong casing.
    expect(filterZones(regions, 'DETROIT')).toEqual(['America/Detroit'])
  })

  it('treats a space as the underscore IANA spells it with', () => {
    expect(filterZones(regions, 'new york')).toEqual(['America/New_York'])
    expect(filterZones(regions, 'sao paulo')).toEqual(['America/Sao_Paulo'])
  })

  it('offers everything when nothing is typed', () => {
    expect(filterZones(regions, '')).toHaveLength(5)
    expect(filterZones(regions, '   ')).toHaveLength(5)
  })

  it('says nothing rather than something wrong', () => {
    expect(filterZones(regions, 'atlantis')).toEqual([])
    expect(filterZones([], 'detroit')).toEqual([])
  })
})
