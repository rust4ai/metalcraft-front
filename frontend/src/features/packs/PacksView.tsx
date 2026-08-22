import { useEffect } from 'react'
import { BadgeCheck, Check, Download, ExternalLink, Loader2, Search } from 'lucide-react'
import { usePacks } from '@/stores/packs'
import { useFleet } from '@/stores/fleet'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { blockedByTrust, canConnect, describeConnection, isInstalled, updateAvailable } from './registryState'
import { PackDetail } from './PackDetail'
import type { SearchHit } from '@/types'

/**
 * PLAN §9.4 — browse agent packs and install them onto the pod.
 *
 * A registry is a protocol, not a host, so this is written against the contract
 * and shows every host the **pod** is willing to fetch from. Axoniac Prime is the
 * social discovery host; packs.metalcraftai.com is a peer, not an upstream.
 */
export function PacksView() {
  const { registries, active, connection, results, installed, query, loading, installing, error, load, select, search, connect, install, view } =
    usePacks()
  const loadFleet = useFleet((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  const status = connection ? describeConnection(connection) : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Agents</div>
          <div className="text-[11.5px] text-ink-2">Install an agent from a registry</div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {registries?.registries.map((r) => (
            <button
              key={r.name}
              type="button"
              onClick={() => void select(r.name)}
              className={cn(
                'rounded-chip px-2 py-1 text-[11.5px] transition-colors duration-150',
                active === r.name ? 'bg-accent-tint text-ink' : 'text-ink-2 hover:bg-hover',
              )}
            >
              {r.name}
            </button>
          ))}
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" />
        <input
          value={query}
          onChange={(e) => void search(e.target.value)}
          placeholder="Search this registry…"
          className="flex-1 bg-transparent text-[13px] caret-accent outline-none placeholder:text-ink-3"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-3" />}
      </div>

      {status && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-[11.5px]">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              status.tone === 'good' && 'bg-green',
              status.tone === 'action' && 'bg-orange',
              status.tone === 'bad' && 'bg-red',
              status.tone === 'neutral' && 'bg-ink-3',
            )}
          />
          <span className="text-ink-2">{status.label}</span>
          {status.hint && <span className="text-ink-3">· {status.hint}</span>}

          {connection?.state === 'unlinked' && connection.link_url && (
            <a
              href={connection.link_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 text-accent hover:underline"
            >
              Finish linking <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {connection && canConnect(connection.state) && (
            <button type="button" onClick={() => void connect()} className="ml-auto text-accent hover:underline">
              Connect this pod
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error && <p className="mb-3 text-[13px] text-red">{error}</p>}
        {results.length === 0 && !loading ? (
          <p className="py-16 text-center text-[13px] text-ink-3">
            {query ? `Nothing on ${active} matches “${query}”.` : 'This registry has nothing to show yet.'}
          </p>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
            {results.map((hit, i) => (
              <PackCard
                key={hit.reference}
                hit={hit}
                index={i}
                onOpen={() => void view(hit)}
                installed={isInstalled(hit, installed)}
                previousVersion={updateAvailable(hit, installed)}
                blocked={blockedByTrust(connection?.trust, hit.verified)}
                busy={!!installing[hit.reference]}
                onInstall={async (allowUnverified) => {
                  // A pack's presets only become spawnable once the pod has it,
                  // so the fleet's roster is refreshed on success.
                  if (await install(hit, allowUnverified)) void loadFleet()
                }}
              />
            ))}
          </div>
        )}
      </div>

      <PackDetail />
    </div>
  )
}

function PackCard({
  hit,
  index,
  installed,
  previousVersion,
  blocked,
  busy,
  onOpen,
  onInstall,
}: {
  hit: SearchHit
  index: number
  installed: boolean
  previousVersion: string | null
  blocked: boolean
  busy: boolean
  onOpen: () => void
  onInstall: (allowUnverified: boolean) => void
}) {
  return (
    // The card opens the manifest; only the button installs. A reference is
    // enough to install but not enough to *decide*, so the detail sheet is the
    // default action and installing blind stays possible rather than required.
    <Card
      className="animate-fade-up flex cursor-pointer flex-col"
      style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
      onClick={onOpen}
    >
      <div className="flex items-start gap-3">
        {hit.avatar_url ? (
          <img src={hit.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-chip object-cover" />
        ) : (
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-inset text-[13px] font-semibold text-ink-2">
            {hit.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{hit.name}</span>
            {hit.verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-accent" />}
          </div>
          <p className="truncate font-mono text-[11px] text-ink-3">{hit.reference}</p>
        </div>
      </div>

      {hit.tagline && <p className="mt-2 line-clamp-2 text-[12.5px] text-ink-2">{hit.tagline}</p>}

      {hit.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {hit.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded-chip bg-inset px-1.5 py-0.5 text-[10px] text-ink-3">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div
        className="mt-3 flex items-center justify-between gap-2 pt-1"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <span className="tnum text-[11px] text-ink-3">
          {hit.version ? `v${hit.version}` : ''}
          {hit.install_count ? ` · ${hit.install_count.toLocaleString()} installs` : ''}
        </span>

        {installed && !previousVersion ? (
          <span className="flex items-center gap-1 text-[11.5px] text-green">
            <Check className="h-3.5 w-3.5" /> Installed
          </span>
        ) : blocked ? (
          // Say it before the button is pressed: this pod takes only packs its
          // host vouches for, and installing anyway is a deliberate override.
          <Button size="sm" variant="outline" onClick={() => onInstall(true)} disabled={busy}>
            Install unverified
          </Button>
        ) : (
          <Button size="sm" onClick={() => onInstall(false)} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {previousVersion ? `Update from ${previousVersion}` : 'Install'}
          </Button>
        )}
      </div>
    </Card>
  )
}
