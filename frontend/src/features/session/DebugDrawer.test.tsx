import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DebugDrawer } from './DebugDrawer'
import { useTurnDebug } from '@/stores/turnDebug'
import type { TurnTrace } from './turnTrace'

afterEach(cleanup)

/** The shape the six-minute turn has: almost all of it before the model. */
const SLOW_TURN: TurnTrace = {
  id: 'a',
  index: 1,
  message: 'clone the repo into a workspace',
  durationMs: 366_000,
  preludeMs: 348_000,
  failed: false,
  steps: [
    {
      id: 'b',
      kind: 'model',
      label: 'gpt-5.4',
      offsetMs: 348_000,
      durationMs: 12_400,
      tokens: { input: 48_210, output: 120, cached: 44_000 },
      failed: false,
    },
    {
      id: 'c',
      kind: 'tool',
      label: 'buildr_clone_repo',
      offsetMs: 360_400,
      durationMs: 5_600,
      detail: '{"repo":"metalcraft-front"}',
      failed: false,
    },
  ],
}

function open(partial: Partial<ReturnType<typeof useTurnDebug.getState>> = {}) {
  useTurnDebug.setState({
    open: true,
    loading: false,
    sessionId: '2026-08-26T14-44-13',
    turns: [SLOW_TURN],
    detail: null,
    notice: null,
    ...partial,
  })
  render(<DebugDrawer />)
}

describe('DebugDrawer', () => {
  it('names the untraced wait instead of burying it in the turn total', () => {
    // The whole reason this view exists: six minutes of "Thinking" was mostly
    // work that has no span of its own, and the timeline has to say so.
    open()
    expect(screen.getByText('Before the first model call')).toBeTruthy()
    expect(screen.getByText('compaction, memory recall, building the prompt')).toBeTruthy()
    expect(screen.getByText('5m 48s')).toBeTruthy() // the prelude
    expect(screen.getByText('6m 06s')).toBeTruthy() // the turn
  })

  it('shows what each model call cost', () => {
    open()
    expect(screen.getByText('gpt-5.4')).toBeTruthy()
    expect(screen.getByText('48.2k in · 120 out · 44.0k cached')).toBeTruthy()
  })

  it('keeps a tool payload behind a disclosure, verbatim', () => {
    open()
    const tool = screen.getByText('buildr_clone_repo')
    expect(screen.queryByText('{"repo":"metalcraft-front"}')).toBeNull()
    fireEvent.click(tool)
    expect(screen.getByText('{"repo":"metalcraft-front"}')).toBeTruthy()
  })

  it('explains an empty panel rather than showing one', () => {
    open({ turns: null, notice: 'This pod has no recorded runs for this agent' })
    expect(screen.getByText(/no recorded runs/)).toBeTruthy()
  })

  it('offers the raw files when the durations are not enough', () => {
    open({
      detail: {
        id: 'r',
        session_info: { model_name: 'gpt-5.4' },
        timeline: [{ kind: 'llm_request', file: 'llm_request_001.json', data: { tools: 26 } }],
      },
    })
    fireEvent.click(screen.getByText('What was sent'))
    fireEvent.click(screen.getByText('llm_request_001.json'))
    expect(screen.getByText(/"tools": 26/)).toBeTruthy()
  })
})
