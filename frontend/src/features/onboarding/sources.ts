/**
 * Interface sources — where completions come from (PLAN §9.2).
 *
 * One hard constraint the UI has to be honest about: the agent builds an
 * **OpenAI Responses API** client for every source and POSTs to `{base}/responses`.
 * That is not a preference — the chat/completions surface rejects the agent's
 * parallel-tool-call message layout with a 400, so a source that only speaks
 * chat/completions cannot work. Metalcraft Inference proxies `/responses` and so
 * passes by construction; anything else has to be verified.
 */
export interface Source {
  id: string
  name: string
  blurb: string
  /** Written to OPENAI_BASE_URL. `null` means OpenAI proper (agent default). */
  baseUrl: string | null
  keyHint: string
  /** Whether `/responses` support is known-good or needs a verification turn. */
  responsesApi: 'known' | 'verify'
  models: string[]
}

export const SOURCES: Source[] = [
  {
    id: 'metalcraft',
    name: 'Metalcraft Inference',
    blurb: 'Billed in your hub credits. Nothing else to set up.',
    baseUrl: 'https://inference.metalcraftai.com/v1',
    keyHint: 'Your Metalcraft API key',
    responsesApi: 'known',
    models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    blurb: 'Direct, billed by OpenAI.',
    baseUrl: null,
    keyHint: 'sk-…',
    responsesApi: 'known',
    models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    blurb: 'A wide catalogue — check it answers on /responses.',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyHint: 'sk-or-…',
    responsesApi: 'verify',
    models: [],
  },
  {
    id: 'custom',
    name: 'Custom',
    blurb: 'Self-hosted or another gateway.',
    baseUrl: '',
    keyHint: 'Bearer token',
    responsesApi: 'verify',
    models: [],
  },
]

/** Which source a pod's stored base URL corresponds to, for showing current state. */
export function sourceForBaseUrl(baseUrl: string | undefined | null): Source | undefined {
  if (baseUrl === undefined) return undefined
  if (!baseUrl) return SOURCES.find((s) => s.id === 'openai')
  return SOURCES.find((s) => s.baseUrl && baseUrl.startsWith(s.baseUrl)) ?? SOURCES.find((s) => s.id === 'custom')
}
