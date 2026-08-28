import { useLibrary } from '@/stores/library'
import { KeyNeeds } from '@/components/KeyNeeds'
import { Badge, DetailState, Fact, Facts, Note, RefChips, ShowHeader } from './parts'

/**
 * An integration pack: HTTP tools, and the personas and skills that came with
 * them.
 *
 * Distinct from an *agent pack*, which is the other thing on this pod called a
 * pack — different registry, different route, different contents. The page says
 * so in the subtitle rather than leaving a reader to work out why there are two
 * kinds of pack in one library.
 *
 * Two states get called out rather than rendered flat. **Disabled** means the
 * tools are installed and none of them will ever fire, which looks identical to
 * healthy from every count on the page. **A missing key** means they will fire
 * and fail, which looks identical to healthy until an agent tries.
 */
export function IntegrationShow({ id }: { id: string }) {
  const detail = useLibrary((s) => s.integrationDetails[id])
  const reload = useLibrary((s) => s.load)

  if (!detail) return <DetailState refTo={{ kind: 'integration', id }} />

  return (
    <div className="h-full overflow-y-auto px-8 pb-12 pt-6">
      <div className="mx-auto max-w-3xl">
        <ShowHeader
          kind="integration"
          title={detail.name || id}
          subtitle={detail.description || 'An integration pack — HTTP tools installed on this pod.'}
          badges={
            <>
              <span className="font-mono text-[11px] text-ink-3">{id}</span>
              {detail.version && <Badge>v{detail.version}</Badge>}
              {detail.enabled ? (
                <Badge tone="good">enabled</Badge>
              ) : (
                <Badge tone="warn">disabled</Badge>
              )}
            </>
          }
        />

        {!detail.enabled && (
          <div className="mt-4">
            <Note tone="warn">
              This pack is installed but switched off. Every tool below exists and none of them
              will fire.
            </Note>
          </div>
        )}

        <div className="mt-5">
          <Facts>
            <Fact label="API tools">
              <span className="tnum">{detail.api_tools.length}</span>
            </Fact>
            <Fact label="Personas">
              <span className="tnum">{detail.personas.length}</span>
            </Fact>
            <Fact label="Skills">
              <span className="tnum">{detail.skills.length}</span>
            </Fact>
            <Fact label="Automation templates">
              <span className="tnum">{detail.flow_templates.length}</span>
            </Fact>
          </Facts>
        </div>

        <KeyNeeds
          env={detail.requires_env}
          subject="this pack"
          onSaved={() => void reload()}
        />

        <RefChips kind="tool" ids={detail.api_tools} />
        <RefChips kind="persona" ids={detail.personas} />
        <RefChips kind="skill" ids={detail.skills} />
        <RefChips kind="template" ids={detail.flow_templates} />

      </div>
    </div>
  )
}
