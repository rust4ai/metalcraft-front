import { useLibrary } from '@/stores/library'
import { Badge, DetailState, Fact, Facts, Provenance, RefChip, RefChips, Section, ShowHeader } from './parts'

/**
 * A persona: the voice, and the reach.
 *
 * The layout follows the one distinction that matters here and is easy to get
 * wrong. `tools` is an explicit list of names. `integrations` is a *grant* — every
 * HTTP tool that integration provides joins this persona's tool set without
 * appearing in `tools` at all. Folding the two together would render a persona
 * with two tools when it has thirty-two, so they stay two sections with the
 * grant said out loud.
 *
 * The system prompt is shown in full rather than truncated. It is the artifact:
 * everything else on this page is scope, and the prompt is the behaviour.
 */
export function PersonaShow({ slug }: { slug: string }) {
  const detail = useLibrary((s) => s.personaDetails[slug])
  const summary = useLibrary((s) => s.snapshot?.personas.find((p) => p.slug === slug))
  const apiTools = useLibrary((s) => s.snapshot?.api_tools)

  if (!detail) return <DetailState refTo={{ kind: 'persona', id: slug }} />

  const known = new Set(apiTools?.map((t) => t.name))
  const native = detail.tools.filter((t) => !known.has(t))
  const provided = detail.tools.filter((t) => known.has(t))

  return (
    <div className="h-full overflow-y-auto px-8 pb-12 pt-6">
      <div className="mx-auto max-w-3xl">
        <ShowHeader
          kind="persona"
          title={detail.name || slug}
          subtitle={detail.description}
          badges={
            <>
              <span className="font-mono text-[11px] text-ink-3">{slug}</span>
              {detail.version && <Badge>v{detail.version}</Badge>}
            </>
          }
        >
          <div className="mt-2">
            <Provenance packId={summary?.pack_id} readOnly={summary?.read_only} />
          </div>
        </ShowHeader>

        <div className="mt-5">
          <Facts>
            <Fact label="Skills">
              <span className="tnum">{detail.skills.length}</span>
            </Fact>
            <Fact label="Named tools">
              <span className="tnum">{detail.tools.length}</span>
            </Fact>
            <Fact label="Integration grants">
              <span className="tnum">{detail.integrations.length}</span>
            </Fact>
          </Facts>
        </div>

        <RefChips
          kind="skill"
          ids={detail.skills}
          hint="loaded on demand"
          empty="This persona loads no skills."
        />

        {provided.length > 0 && (
          <Section title="API tools" count={provided.length}>
            <div className="flex flex-wrap gap-1.5">
              {provided.map((t) => (
                <RefChip key={t} to={{ kind: 'tool', id: t }} />
              ))}
            </div>
          </Section>
        )}

        {native.length > 0 && (
          <Section title="Native tools" count={native.length} hint="built into the agent">
            <div className="flex flex-wrap gap-1.5">
              {native.map((t) => (
                <span
                  key={t}
                  className="rounded-chip bg-inset px-2 py-1 font-mono text-[11px] text-ink-3"
                >
                  {t}
                </span>
              ))}
            </div>
          </Section>
        )}

        <RefChips
          kind="integration"
          title="Integration grants"
          ids={detail.integrations}
          hint="every tool these provide is in scope, unnamed"
        />

        {detail.system_prompt && (
          <Section title="System prompt" hint={`${detail.system_prompt.length.toLocaleString()} chars`}>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-card bg-inset px-4 py-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
              {detail.system_prompt}
            </pre>
          </Section>
        )}
      </div>
    </div>
  )
}
