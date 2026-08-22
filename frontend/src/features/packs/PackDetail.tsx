import { AlertTriangle, BadgeCheck, Check, Download, ExternalLink, Loader2, X } from 'lucide-react'
import { usePacks } from '@/stores/packs'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { PackManifest, SearchHit } from '@/types'

/**
 * What a pack is, before you install it (PLAN §9.4).
 *
 * The card behind this sheet can offer an Install button because the reference
 * is enough to install. It is not enough to *decide*, which is what the registry
 * protocol's `/manifest` exists for: the presets you would be able to spawn, the
 * personas and skills that come with them, the hosts it will reach out to, and
 * the environment it needs.
 *
 * The requirements checklist is the reason this screen is worth building. An
 * unmet key is a pre-install fact — it is checked against the pod's own key
 * store and shown as a checklist item now, rather than discovered as a runtime
 * failure the first time someone talks to the agent and it cannot reach the
 * service it was built around.
 */
export function PackDetail() {
  const { viewing, manifests, manifestError, podKeys, installing, installed, view, install } = usePacks()
  if (!viewing) return null

  const manifest = manifests[viewing.reference]
  const error = manifestError[viewing.reference]
  const busy = !!installing[viewing.reference]
  const already = installed.some((p) => p.id === viewing.id)

  return (
    <>
      {/* eslint-disable-next-line */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        onClick={() => void view(null)}
        role="presentation"
      />
      <aside
        role="dialog"
        aria-label={viewing.name}
        // A side sheet rather than a centred modal: the list stays put behind it,
        // so comparing two packs is a click each way instead of a re-search.
        className="animate-fade-up fixed inset-y-0 right-0 z-50 flex w-[min(30rem,100vw)] flex-col border-l border-line bg-page shadow-overlay"
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          {viewing.avatar_url ? (
            <img src={viewing.avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-chip object-cover" />
          ) : (
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-chip bg-inset font-semibold text-ink-2">
              {viewing.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate font-semibold">{viewing.name}</h2>
              {viewing.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-accent" />}
            </div>
            <p className="truncate font-mono text-[11px] text-ink-3">{viewing.reference}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => void view(null)}
            className="rounded-chip p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {viewing.tagline && <p className="text-[13px] text-ink-2">{viewing.tagline}</p>}

          {error ? (
            <Note tone="bad" text={error} />
          ) : !manifest ? (
            <p className="flex items-center gap-2 py-8 text-[13px] text-ink-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the manifest…
            </p>
          ) : (
            <Body manifest={manifest} podKeys={podKeys} />
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-line px-5 py-3">
          <span className="tnum text-[11.5px] text-ink-3">
            {viewing.version ? `v${viewing.version}` : ''}
            {viewing.install_count ? ` · ${viewing.install_count.toLocaleString()} installs` : ''}
          </span>
          {already ? (
            <span className="ml-auto flex items-center gap-1 text-[12.5px] text-green">
              <Check className="h-4 w-4" /> Installed
            </span>
          ) : (
            <Button
              className="ml-auto"
              size="sm"
              disabled={busy}
              onClick={() => void install(viewing, !viewing.verified)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Install
            </Button>
          )}
        </footer>
      </aside>
    </>
  )
}

function Body({ manifest, podKeys }: { manifest: PackManifest; podKeys: string[] }) {
  const env = manifest.requires_env ?? []
  return (
    <>
      {manifest.description && <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{manifest.description}</p>}

      <Requirements env={env} podKeys={podKeys} />

      <List title="Agents" items={manifest.presets} mono />
      <List title="Personas" items={manifest.provides?.personas} mono />
      <List title="Skills" items={manifest.provides?.skills} mono />
      <List title="Integrations" items={manifest.provides?.integrations?.map((i) => `${i.id} v${i.version}`)} mono />

      {/* Where it will reach. Worth stating plainly rather than burying: a pack
          that talks to a host you did not expect is the thing to notice before
          installing, not after. */}
      <List title="Reaches out to" items={manifest.domains} mono />

      {manifest.content_sha256 && (
        <Section title="Integrity">
          <p className="break-all font-mono text-[10.5px] text-ink-3">{manifest.content_sha256}</p>
        </Section>
      )}
    </>
  )
}

/**
 * The pre-install checklist.
 *
 * Optional env is listed but never marked missing — a pack that works better
 * with a key it does not require should not look broken for lacking one.
 */
function Requirements({
  env,
  podKeys,
}: {
  env: NonNullable<PackManifest['requires_env']>
  podKeys: string[]
}) {
  if (env.length === 0) return null
  const unmet = env.filter((e) => e.required && !podKeys.includes(e.name))

  return (
    <Section title="Needs">
      {unmet.length > 0 && (
        <Note
          tone="warn"
          text={`${unmet.length} required ${unmet.length === 1 ? 'key is' : 'keys are'} not in this pod's key store yet. It will install, but the agent cannot use ${unmet.length === 1 ? 'that' : 'those'} until you add ${unmet.length === 1 ? 'it' : 'them'}.`}
        />
      )}
      <ul className="mt-1">
        {env.map((e) => {
          const met = podKeys.includes(e.name)
          return (
            <li key={e.name} className="flex items-baseline gap-2 py-1">
              {met ? (
                <Check className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-green" />
              ) : (
                <span
                  className={cn(
                    'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    e.required ? 'bg-orange' : 'bg-ink-3',
                  )}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="font-mono text-[11.5px] text-ink">{e.name}</span>
                {!e.required && <span className="ml-1.5 text-[11px] text-ink-3">optional</span>}
                {e.needed_by.length > 0 && (
                  <span className="block truncate text-[11px] text-ink-3">for {e.needed_by.join(', ')}</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function List({ title, items, mono }: { title: string; items?: string[]; mono?: boolean }) {
  if (!items || items.length === 0) return null
  return (
    <Section title={title}>
      <div className="flex flex-wrap gap-1">
        {items.map((i) => (
          <span
            key={i}
            className={cn('rounded-chip bg-inset px-1.5 py-0.5 text-[11px] text-ink-2', mono && 'font-mono text-[10.5px]')}
          >
            {i}
          </span>
        ))}
      </div>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-4">
      <h3 className="pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  )
}

function Note({ tone, text }: { tone: 'warn' | 'bad'; text: string }) {
  return (
    <div
      className={cn(
        'mt-3 flex gap-2 rounded-chip px-2.5 py-2 text-[11.5px] text-ink-2',
        tone === 'warn' ? 'bg-orange-tint' : 'bg-red-tint',
      )}
    >
      <AlertTriangle className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone === 'warn' ? 'text-orange' : 'text-red')} />
      <span>{text}</span>
    </div>
  )
}

/** Re-exported so PacksView can link out to the pack's profile page on the host. */
export function HostLink({ hit, base }: { hit: SearchHit; base?: string }) {
  if (!base) return null
  return (
    <a
      href={`${base.replace(/\/$/, '')}/@${hit.id}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1 text-[11.5px] text-accent hover:underline"
    >
      Profile <ExternalLink className="h-3 w-3" />
    </a>
  )
}
