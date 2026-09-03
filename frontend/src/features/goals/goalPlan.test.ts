import { describe, expect, it } from 'vitest'
import { isEmptySection, planSteps, section } from './goalPlan'

const PAD = `## Goal
Ship Stripe billing

## Plan
- [x] 1. Schema + migration
- [ ] 2. Checkout endpoint
Some note that is not a step

## State
Branch \`goal/billing\`, tests green.

## Blockers
(none)
`

describe('reading a scratchpad', () => {
  it('takes a section body and stops at the next heading', () => {
    expect(section(PAD, 'State')).toBe('Branch `goal/billing`, tests green.')
    expect(section(PAD, 'Goal')).toBe('Ship Stripe billing')
  })

  it('returns nothing for a section the document does not have', () => {
    expect(section(PAD, 'Questions for the human')).toBe('')
  })

  it('counts only checkbox lines as steps', () => {
    const steps = planSteps(PAD)
    expect(steps).toHaveLength(2)
    expect(steps[0]).toEqual({ done: true, text: '1. Schema + migration' })
    expect(steps[1]).toEqual({ done: false, text: '2. Checkout endpoint' })
  })

  it('has no steps for a goal that has not planned yet', () => {
    expect(planSteps('## Plan\n_No plan yet._\n')).toEqual([])
  })

  it('reads the agent placeholders as empty', () => {
    expect(isEmptySection(section(PAD, 'Blockers'))).toBe(true)
    expect(isEmptySection(section(PAD, 'State'))).toBe(false)
  })
})
