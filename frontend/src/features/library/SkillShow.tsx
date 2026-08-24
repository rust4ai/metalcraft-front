import { useLibrary } from '@/stores/library'
import { DetailState, Provenance, Section, ShowHeader } from './parts'

/**
 * A skill: a description the agent sees, and a body it does not — until it
 * decides to.
 *
 * That split is the whole design of skills and it is what this page is laid out
 * around. The description is always in context, so it is what the model chooses
 * on; the body is loaded by `load_skill` only once the model has chosen. Showing
 * the body verbatim, in full, is the point — a skill is prose, and summarising
 * prose is how you end up unable to answer "why did it do that".
 */
export function SkillShow({ slug }: { slug: string }) {
  const detail = useLibrary((s) => s.skillDetails[slug])
  if (!detail) return <DetailState refTo={{ kind: 'skill', id: slug }} />

  return (
    <div className="h-full overflow-y-auto px-8 pb-12 pt-6">
      <div className="mx-auto max-w-3xl">
        <ShowHeader kind="skill" title={detail.slug || slug}>
          <div className="mt-2">
            <Provenance packId={detail.pack_id} readOnly={detail.read_only} />
          </div>
        </ShowHeader>

        <Section title="Description" hint="always in context — this is what the agent chooses on">
          <p className="text-[13px] leading-relaxed text-ink-2">
            {detail.description || <span className="text-ink-3">No description.</span>}
          </p>
        </Section>

        <Section
          title="Body"
          hint={
            detail.body
              ? `${detail.body.length.toLocaleString()} chars · loaded on demand`
              : undefined
          }
        >
          {detail.body ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-card bg-inset px-4 py-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
              {detail.body}
            </pre>
          ) : (
            <p className="text-[12.5px] text-ink-3">This skill has no body.</p>
          )}
        </Section>
      </div>
    </div>
  )
}
