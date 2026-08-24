import { Bot, Check, ExternalLink, Sparkles } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { AgentPresetDetail, PresetDetail, RosterPersona } from '@/types'
import {
  Badge,
  DetailState,
  Fact,
  Facts,
  Note,
  Provenance,
  RefChip,
  RefChips,
  Section,
  ShowHeader,
} from './parts'

/**
 * What an agent *is*, before anyone has spawned one.
 *
 * The richest page in the library, because a preset is the only artifact on the
 * pod that references every other kind: it names personas, which name skills and
 * grant integrations, which provide api tools; it declares what it needs in the
 * key store; and it came from a pack. Reading one is how you find out why an
 * agent behaves the way it does, and every one of those references is a link
 * rather than a string.
 *
 * Two facts get more room than their size suggests:
 *
 * **The roster is rendered from both halves.** The preset declares three
 * personas; the pod resolved two. Showing only the resolved ones would make the
 * preset look smaller than it is and hide the actual problem, so a persona the
 * pod could not find gets a row with the pod's own reason on it.
 *
 * **`requires_env` is checked, not listed.** A key this pod does not hold is the
 * difference between an agent that works and one that fails on its first tool
 * call, and the pod already told us which keys it has.
 */
export function PresetShow({ slug }: { slug: string }) {
  const detail = useLibrary((s) => s.presetDetails[slug])
  if (!detail) return <DetailState refTo={{ kind: 'preset', id: slug }} />
  return <Body slug={slug} detail={detail} />
}

function Body({ slug, detail }: { slug: string; detail: PresetDetail }) {
  const snapshot = useLibrary((s) => s.snapshot)
  const podKeys = useLibrary((s) => s.podKeys)
  const instances = useFleet((s) => s.instances)
  const spawn = useFleet((s) => s.spawn)
  const go = useUi((s) => s.go)

  // The summary is the fallback for a pod too old to return the declaration:
  // the name and description still come from somewhere, and a page that showed
  // only a slug because one field was missing would be worse than a thin one.
  const summary = snapshot?.agent_presets.find((p) => p.slug === slug)
  const preset = detail.preset
  const name = preset?.name || summary?.name || slug
  const roster = detail.personas
  const live = instances.filter((i) => i.agent_preset === slug)
  const isDefault = snapshot?.default_agent_preset === slug

  return (
    <div className="h-full overflow-y-auto px-8 pb-12 pt-6">
      <div className="mx-auto max-w-3xl">
        <ShowHeader
          kind="preset"
          title={name}
          subtitle={preset?.tagline || summary?.tagline}
          badges={
            <>
              <span className="font-mono text-[11px] text-ink-3">{slug}</span>
              {preset?.version && <Badge>v{preset.version}</Badge>}
              {isDefault && <Badge tone="accent">this pod&rsquo;s default agent</Badge>}
              {(summary?.read_only ?? false) && <Badge>read-only</Badge>}
            </>
          }
        >
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Provenance packId={summary?.pack_id} readOnly={summary?.read_only} />
            {/* The one action on this page, and it belongs here: reading what an
                agent is made of is exactly when someone decides to have one. */}
            <Button size="sm" className="ml-auto" onClick={() => void spawn(slug)}>
              <Sparkles className="h-3.5 w-3.5" />
              Spawn an agent
            </Button>
          </div>
        </ShowHeader>

        {(preset?.description || summary?.description) && (
          <p className="mt-5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">
            {preset?.description || summary?.description}
          </p>
        )}

        {!preset && (
          <div className="mt-5">
            <Note tone="warn">
              This pod returned the persona roster but not the preset&rsquo;s own declaration, so
              its skills, integrations and requirements are not shown. That is a pod older than the
              typed response, not a preset missing them.
            </Note>
          </div>
        )}

        <div className="mt-5">
          <Facts>
            <Fact label="Default persona">
              {preset?.default_persona || summary?.default_persona ? (
                <RefChip
                  to={{
                    kind: 'persona',
                    id: (preset?.default_persona || summary?.default_persona)!,
                  }}
                />
              ) : (
                <span className="text-ink-3">none</span>
              )}
            </Fact>
            <Fact label="Personas">
              <span className="tnum">
                {roster.filter((p) => p.installed).length}
                <span className="text-ink-3">/{roster.length} on this pod</span>
              </span>
            </Fact>
            {live.length > 0 && (
              <Fact label="Live agents">
                <span className="tnum">{live.length}</span>
              </Fact>
            )}
            {preset && (
              <Fact label="Manifest">
                <span className="tnum">v{preset.manifest_version}</span>
              </Fact>
            )}
          </Facts>
        </div>

        <Roster roster={roster} apiTools={new Set(snapshot?.api_tools.map((t) => t.name))} preset={preset} />

        <RefChips
          kind="skill"
          ids={preset?.skills}
          hint="loaded on demand, not held in the prompt"
        />
        <RefChips
          kind="integration"
          ids={preset?.integrations}
          hint="every tool these provide is in scope"
        />

        <Requirements env={preset?.requires_env ?? []} podKeys={podKeys} />
        <Model model={preset?.model} />
        <Memories memories={preset?.memories} />
        <LiveAgents live={live} onOpen={(id) => go({ kind: 'session', instanceId: id })} />
      </div>
    </div>
  )
}

/**
 * The persona roster, rendered from the declaration and the resolution at once.
 *
 * The `role` and the ordering come from the preset; the name, description,
 * tools and skills come from what the pod found. A row where the second half is
 * missing is the interesting one, and it keeps its place in the list rather than
 * being sorted to the bottom — where it sits in the roster is part of what the
 * preset was saying.
 */
function Roster({
  roster,
  preset,
  apiTools,
}: {
  roster: RosterPersona[]
  preset?: AgentPresetDetail | null
  apiTools: Set<string>
}) {
  if (roster.length === 0) return null
  const roleOf = new Map(preset?.personas.map((p) => [p.slug, p.role]) ?? [])
  const missing = roster.filter((p) => !p.installed).length

  return (
    <Section
      title="Persona roster"
      count={roster.length}
      hint={missing > 0 ? `${missing} not on this pod` : undefined}
    >
      <div className="flex flex-col gap-1.5">
        {roster.map((p) => (
          <div
            key={p.slug}
            className={cn(
              'rounded-card px-3.5 py-3',
              p.installed ? 'bg-surface shadow-card' : 'bg-orange-tint',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <RefChip to={{ kind: 'persona', id: p.slug }} missing={!p.installed} />
              {p.installed && p.name && p.name !== p.slug && (
                <span className="text-[13px] font-medium text-ink">{p.name}</span>
              )}
              {roleOf.get(p.slug) && <Badge>{roleOf.get(p.slug)}</Badge>}
              {p.slug === preset?.default_persona && <Badge tone="accent">default</Badge>}
            </div>

            {p.installed ? (
              <>
                {p.description && (
                  <p className="mt-1.5 text-[12.5px] text-ink-2">{p.description}</p>
                )}
                {(p.skills.length > 0 || p.tools.length > 0) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {p.skills.map((s) => (
                      <RefChip key={s} to={{ kind: 'skill', id: s }} />
                    ))}
                    {/* A tool name is only a link when it is an artifact. The
                        native ones (`load_skill`, `remember`) are the agent's own
                        and have no page — rendering them as chips that go nowhere
                        would teach that half the links here are dead. */}
                    {p.tools.map((t) =>
                      apiTools.has(t) ? (
                        <RefChip key={t} to={{ kind: 'tool', id: t }} />
                      ) : (
                        <span
                          key={t}
                          title="A native tool — built into the agent, not installed"
                          className="rounded-chip px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3"
                        >
                          {t}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="mt-1.5 text-[12px] text-ink-2">
                {p.error ?? 'This preset names it, but the pod could not resolve it.'}
              </p>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

/**
 * What the preset needs in the key store, checked against what this pod holds.
 *
 * The same idea as the pack browser's pre-install checklist, moved to the other
 * side of the install: there it prevents a surprise, here it explains one. An
 * agent whose tools fail on their first call usually fails for exactly this
 * reason, and the answer is one screen away in Settings.
 */
function Requirements({ env, podKeys }: { env: string[]; podKeys: string[] }) {
  const go = useUi((s) => s.go)
  if (env.length === 0) return null
  const unmet = env.filter((name) => !podKeys.includes(name))

  return (
    <Section title="Needs in the key store" count={env.length}>
      {unmet.length > 0 && (
        <div className="pb-2">
          <Note tone="warn">
            {unmet.length === 1 ? 'One key this agent needs is' : `${unmet.length} keys this agent needs are`}{' '}
            not on this pod. It will still spawn — the tools that use{' '}
            {unmet.length === 1 ? 'it' : 'them'} are what fail.{' '}
            <button
              type="button"
              onClick={() => go({ kind: 'settings' })}
              className="text-accent hover:underline"
            >
              Open Settings
            </button>
          </Note>
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {env.map((name) => {
          const met = podKeys.includes(name)
          return (
            <li key={name} className="flex items-center gap-2">
              {met ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-green" />
              ) : (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange" />
              )}
              <span className="font-mono text-[11.5px] text-ink">{name}</span>
              {!met && <span className="text-[11px] text-ink-3">not in this pod&rsquo;s key store</span>}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** The capability floor. Labelled as a floor rather than as "Model", because
 *  that is the distinction the field exists to make and the one a reader will
 *  otherwise get wrong. */
function Model({ model }: { model?: AgentPresetDetail['model'] }) {
  if (!model) return null
  const { tier, prefer, min_context, needs } = model
  if (!tier && !prefer && !min_context && (needs?.length ?? 0) === 0) return null

  return (
    <Section title="Model floor" hint="what it needs, not what it runs on">
      <Facts>
        {tier && <Fact label="Tier">{tier}</Fact>}
        {prefer && (
          <Fact label="Prefers">
            <span className="font-mono text-[11.5px]">{prefer}</span>
            <span className="ml-1.5 text-[11px] text-ink-3">a hint</span>
          </Fact>
        )}
        {!!min_context && (
          <Fact label="Min context">
            <span className="tnum">{min_context.toLocaleString()} tokens</span>
          </Fact>
        )}
        {needs?.length > 0 && <Fact label="Requires">{needs.join(' · ')}</Fact>}
      </Facts>
    </Section>
  )
}

/** What an agent spawned from this preset knows before its first turn. */
function Memories({ memories }: { memories?: AgentPresetDetail['memories'] }) {
  if (!memories) return null
  return (
    <Section title="Shipped memories" hint="what a new agent already knows">
      <Facts>
        <Fact label="Count">
          <span className="tnum">{memories.count.toLocaleString()}</span>
        </Fact>
        {memories.embed_model && (
          <Fact label="Embedded with">
            <span className="font-mono text-[11.5px]">{memories.embed_model}</span>
          </Fact>
        )}
        {!!memories.dims && (
          <Fact label="Dimensions">
            <span className="tnum">{memories.dims}</span>
          </Fact>
        )}
        <Fact label="File">
          <span className="font-mono text-[11.5px]">{memories.file}</span>
        </Fact>
      </Facts>
    </Section>
  )
}

/** The link out of the library and back into the app: agents running this
 *  preset right now, each one a session tab away. */
function LiveAgents({
  live,
  onOpen,
}: {
  live: { id: string; name: string; persona: string }[]
  onOpen: (id: string) => void
}) {
  if (live.length === 0) return null
  return (
    <Section title="Agents running this" count={live.length}>
      <div className="flex flex-wrap gap-1.5">
        {live.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => onOpen(i.id)}
            className="group inline-flex items-center gap-1.5 rounded-chip bg-inset px-2 py-1 text-[11.5px] text-ink-2 hover:bg-hover-2 hover:text-ink"
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-ink-3 group-hover:text-ink-2" />
            <span className="truncate">{i.name}</span>
            <span className="font-mono text-[10.5px] text-ink-3">{i.persona}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-ink-3" />
          </button>
        ))}
      </div>
    </Section>
  )
}
