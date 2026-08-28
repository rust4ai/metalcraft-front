import { AlertTriangle, ArrowUpCircle, BadgeCheck, Check, Download, ExternalLink, Loader2, X } from 'lucide-react'
import { usePacks } from '@/stores/packs'
import { isInstalled, updateAvailable } from './registryState'
import { Button } from '@/components/ui/Button'
import { KeyNeeds } from '@/components/KeyNeeds'
import { cn } from '@/lib/cn'
import type { AgentPackPreview, PackManifest, SearchHit } from '@/types'

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
  const { viewing, manifests, manifestError, packIds, previews, installing, installed, error: installError, view, apply } =
    usePacks()
  if (!viewing) return null

  const manifest = manifests[viewing.reference]
  const error = manifestError[viewing.reference]
  const busy = !!installing[viewing.reference]
  // The same judgement the card behind this sheet makes. Comparing `p.id` to the
  // hit's id alone was wrong for any pack whose handle on the host differs from
  // the id in its own manifest — this sheet would offer Install forever, and each
  // press would quietly reinstall a pack that was already there.
  const already = isInstalled(viewing, installed, packIds)
  // This sheet used to end at "✓ Installed" — which made it the one screen that
  // showed you what a new version contains and the one screen you could not act
  // from. The card behind it said "Update"; opening it to find out what changed
  // took the button away.
  const upgrade = updateAvailable(viewing, installed, packIds)

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
            <Body manifest={manifest} preview={previews[viewing.reference]} />
          )}
        </div>

        {/* An install that failed while this sheet is open has nowhere else to be
            seen: the list's error line is behind the overlay. Silence here reads
            as "nothing happened", which is the one thing that did not happen. */}
        {installError && !busy && (
          <div className="border-t border-line px-5 pt-3">
            <Note tone="bad" text={installError} />
          </div>
        )}

        <footer className="flex items-center gap-3 border-t border-line px-5 py-3">
          <span className="tnum text-[11.5px] text-ink-3">
            {upgrade ? `v${upgrade.from} → v${upgrade.to}` : viewing.version ? `v${viewing.version}` : ''}
            {viewing.install_count ? ` · ${viewing.install_count.toLocaleString()} installs` : ''}
          </span>
          {already && !upgrade ? (
            <span className="ml-auto flex items-center gap-1 text-[12.5px] text-green">
              <Check className="h-4 w-4" /> Installed
            </span>
          ) : (
            <Button
              className="ml-auto"
              size="sm"
              disabled={busy}
              onClick={() => void apply(viewing, !viewing.verified)}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : upgrade ? (
                <ArrowUpCircle className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {upgrade ? `Update to ${upgrade.to}` : 'Install'}
            </Button>
          )}
        </footer>
      </aside>
    </>
  )
}

function Body({ manifest, preview }: { manifest: PackManifest; preview?: AgentPackPreview }) {
  return (
    <>
      {manifest.description && <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{manifest.description}</p>}

      <Collisions preview={preview} />
      {/* Settable before the install, not only after it: the key store belongs
          to the pod rather than to the pack, so a credential typed here is
          already in place the moment the pack lands. */}
      <KeyNeeds env={manifest.requires_env ?? []} title="Needs" subject="this pack" />

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
 * A preset this pack provides that something already installed also provides.
 *
 * The one thing on this sheet that only the *pod* can know. The registry
 * describes a pack in isolation; whether its presets collide depends on what
 * else is on this particular pod, and the answer arrives from
 * `POST /agent-packs/inspect` — the pod opening the archive it would install.
 *
 * Renders nothing when the pod could not be asked, which is a pod that declined
 * to inspect rather than a pod reporting no collisions.
 */
function Collisions({ preview }: { preview?: AgentPackPreview }) {
  if (!preview || preview.preset_collisions.length === 0) return null
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-card bg-orange-tint px-3 py-2 text-[12px] text-orange">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>
        Another installed pack already provides{' '}
        <span className="font-mono">{preview.preset_collisions.join(', ')}</span>.
      </span>
    </p>
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
