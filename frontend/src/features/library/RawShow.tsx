import { useLibrary } from '@/stores/library'
import { refKey, type Ref } from './refs'
import {
  Badge,
  DetailState,
  Fact,
  Facts,
  Json,
  Note,
  RefChips,
  Section,
  ShowHeader,
} from './parts'

/**
 * The three artifacts whose shape this app does not own: an HTTP tool's request
 * template, an agent pack's manifest, a flow template's graph.
 *
 * Each is a document authored somewhere else — by a tool author, a pack author,
 * the pod's flow engine — and each grows fields on someone else's schedule. So
 * they are read leniently: the fields worth surfacing are pulled out by name and
 * rendered, and the whole document is kept underneath. A field this app has
 * never heard of shows up in the raw block rather than being dropped, which is
 * the difference between a viewer and a lossy re-serializer.
 */
export function RawShow({ refTo }: { refTo: Ref }) {
  const doc = useLibrary((s) => s.rawDetails[refKey(refTo)])
  if (!doc) return <DetailState refTo={refTo} />
  if (refTo.kind === 'tool') return <ApiTool name={refTo.id} doc={doc} />
  if (refTo.kind === 'pack') return <Pack id={refTo.id} doc={doc} />
  return <Template slug={refTo.id} doc={doc} />
}

/**
 * One HTTP tool, as the request it will make.
 *
 * Header values are masked unless they are plainly a reference to the key store
 * — `${OCTAWEAVE_API_KEY}` is the *name* of a secret and is the useful thing to
 * show, while anything else in an auth header may be the secret itself, and a
 * literal credential must not cross into the webview (PLAN §2). Masking the
 * value rather than hiding the header keeps the shape of the request honest.
 */
function ApiTool({ name, doc }: { name: string; doc: Record<string, unknown> }) {
  const summary = useLibrary((s) => s.snapshot?.api_tools.find((t) => t.name === name))
  const method = str(doc.method) || 'GET'
  const url = str(doc.url)
  const headers = obj(doc.headers)
  const params = obj(obj(doc.parameters)?.properties)
  const required = new Set(strArray(obj(doc.parameters)?.required))
  const masked = Object.entries(headers ?? {}).some(([k, v]) => isSecret(k, String(v)))

  return (
    <Page>
      <ShowHeader
        kind="tool"
        title={name}
        subtitle={str(doc.description) || summary?.description}
        badges={<Badge tone="accent">{method.toUpperCase()}</Badge>}
      />

      {url && (
        <Section title="Request">
          <p className="overflow-x-auto rounded-card bg-inset px-4 py-3 font-mono text-[11.5px] text-ink-2">
            <span className="text-ink">{method.toUpperCase()}</span> {url}
          </p>
        </Section>
      )}

      {headers && Object.keys(headers).length > 0 && (
        <Section
          title="Headers"
          hint={masked ? 'credential values masked' : undefined}
        >
          <dl className="flex flex-col gap-1">
            {Object.entries(headers).map(([k, v]) => (
              <div key={k} className="flex flex-wrap items-baseline gap-2">
                <dt className="font-mono text-[11.5px] text-ink">{k}</dt>
                <dd className="min-w-0 font-mono text-[11px] text-ink-3">
                  {isSecret(k, String(v)) ? '••••••••' : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {params && Object.keys(params).length > 0 && (
        <Section title="Parameters" count={Object.keys(params).length}>
          <ul className="flex flex-col gap-1.5">
            {Object.entries(params).map(([key, spec]) => {
              const s = obj(spec)
              return (
                <li key={key} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11.5px] text-ink">{key}</span>
                  <span className="text-[11px] text-ink-3">{str(s?.type) || 'any'}</span>
                  {required.has(key) && <Badge tone="warn">required</Badge>}
                  {str(s?.description) && (
                    <span className="min-w-0 basis-full text-[11.5px] text-ink-2">
                      {str(s?.description)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      <Section
        title="Config"
        hint={masked ? 'as the pod stores it, credentials masked' : 'as the pod stores it'}
      >
        {/* Redacted, not raw. The headers table above masks a literal
            credential and this block would print the same string underneath it
            — which is not a weaker version of the rule, it is the rule not
            holding at all. */}
        <Json value={redact(doc)} />
      </Section>
    </Page>
  )
}

/**
 * An agent pack's manifest — the delivery mechanism, not the thing delivered.
 *
 * Everything it lists is already elsewhere in this library as an artifact of its
 * own, so the page is mostly links: this is the one screen that answers "what
 * did installing this actually put on my pod".
 */
function Pack({ id, doc }: { id: string; doc: Record<string, unknown> }) {
  const provides = obj(doc.provides)
  const domains = strArray(doc.domains)
  const env = doc.requires_env

  return (
    <Page>
      <ShowHeader
        kind="pack"
        title={str(doc.name) || id}
        subtitle={str(doc.description)}
        badges={
          <>
            <span className="font-mono text-[11px] text-ink-3">{str(doc.id) || id}</span>
            {str(doc.version) && <Badge>v{str(doc.version)}</Badge>}
          </>
        }
      />

      <RefChips kind="preset" title="Agents it provides" ids={strArray(doc.presets)} />
      <RefChips kind="persona" ids={strArray(provides?.personas)} />
      <RefChips kind="skill" ids={strArray(provides?.skills)} />
      <RefChips
        kind="integration"
        ids={integrationIds(provides?.integrations)}
      />

      {domains.length > 0 && (
        <Section title="Reaches out to" count={domains.length}>
          <div className="flex flex-wrap gap-1.5">
            {domains.map((d) => (
              <span key={d} className="rounded-chip bg-inset px-2 py-1 font-mono text-[11px] text-ink-2">
                {d}
              </span>
            ))}
          </div>
        </Section>
      )}

      {Array.isArray(env) && env.length > 0 && (
        <Section title="Needs in the key store">
          <Json value={env} />
        </Section>
      )}

      {str(doc.content_sha256) && (
        <Section title="Integrity">
          <p className="break-all font-mono text-[10.5px] text-ink-3">{str(doc.content_sha256)}</p>
        </Section>
      )}

      <Section title="Manifest" hint="as the pack wrote it">
        <Json value={doc} />
      </Section>
    </Page>
  )
}

/**
 * An automation a pack shipped, before anyone installed it as a flow.
 *
 * A template is not running and is not armed — it is a shape someone can clone.
 * Saying that plainly matters, because the Automations tab beside this one
 * shows flows that *do* fire, and the two look alike at a glance.
 */
function Template({ slug, doc }: { slug: string; doc: Record<string, unknown> }) {
  const flow = obj(doc.flow)
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : []

  return (
    <Page>
      <ShowHeader
        kind="template"
        title={str(doc.name) || slug}
        badges={<span className="font-mono text-[11px] text-ink-3">{slug}</span>}
      />

      <div className="mt-4">
        <Note tone="info">
          A template, not a running automation. Nothing here fires until it is installed as a flow
          and armed.
        </Note>
      </div>

      <div className="mt-5">
        <Facts>
          <Fact label="Nodes">
            <span className="tnum">{nodes.length}</span>
          </Fact>
          {str(doc.pack_id) && <Fact label="From pack">{str(doc.pack_id)}</Fact>}
        </Facts>
      </div>

      {nodes.length > 0 && (
        <Section title="Steps" count={nodes.length}>
          <ol className="flex flex-col gap-1">
            {nodes.map((n, i) => {
              const node = obj(n)
              return (
                <li
                  key={str(node?.id) || i}
                  className="flex flex-wrap items-baseline gap-2 rounded-card bg-surface px-3 py-2 shadow-card"
                >
                  <span className="tnum text-[11px] text-ink-3">{i + 1}</span>
                  <span className="font-mono text-[11.5px] text-ink">{str(node?.id) || '—'}</span>
                  {str(node?.type) && <Badge>{str(node?.type)}</Badge>}
                  {str(node?.tool) && (
                    <span className="font-mono text-[11px] text-ink-3">{str(node?.tool)}</span>
                  )}
                  {str(node?.persona) && (
                    <span className="font-mono text-[11px] text-ink-3">as {str(node?.persona)}</span>
                  )}
                </li>
              )
            })}
          </ol>
        </Section>
      )}

      <Section title="Graph" hint="as the pod stores it">
        <Json value={doc.flow ?? doc} />
      </Section>
    </Page>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto px-8 pb-12 pt-6">
      <div className="mx-auto max-w-3xl">{children}</div>
    </div>
  )
}

// ── lenient readers ─────────────────────────────────────────────────────────
//
// These take `unknown` and return something safe rather than narrowing with a
// cast. A manifest is written by someone else; a field that is a number where a
// string was expected must render as nothing, not throw inside a component and
// take the whole library down with it.

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** A pack's `provides.integrations` is a list of objects, not strings — each
 *  carries its own version and hash. Only the id is a link. */
function integrationIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((i) => str(obj(i)?.id)).filter(Boolean)
}

/**
 * A copy of a tool config with its credential-bearing header values replaced.
 *
 * Shallow by design: `headers` is the only place the pod puts a raw credential,
 * and a deep scrub over an arbitrary document would have to guess at every
 * author-defined field — quietly mangling a `body_template` that merely looked
 * secret-ish, while still missing whatever the next schema adds. One known
 * place, handled exactly.
 */
function redact(doc: Record<string, unknown>): Record<string, unknown> {
  const headers = obj(doc.headers)
  if (!headers) return doc
  return {
    ...doc,
    headers: Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, isSecret(k, String(v)) ? '••••••••' : v]),
    ),
  }
}

/**
 * Whether a header's value should be hidden.
 *
 * True for an auth-shaped header whose value is not *entirely* a reference to
 * the key store. `Bearer ${KEY}` names a secret; `Bearer sk-live-…` is one.
 */
function isSecret(name: string, value: string): boolean {
  const auth = /authorization|api[-_]?key|token|secret|password/i.test(name)
  if (!auth) return false
  return !/^[^$]*\$\{[A-Z0-9_]+\}[^$]*$/.test(value) || /[A-Za-z0-9_-]{20,}/.test(value)
}
