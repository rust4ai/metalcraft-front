import { useMemo, useState } from 'react'
import { Loader2, RotateCw, Search } from 'lucide-react'
import { useLibrary } from '@/stores/library'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { KIND_LABEL, KIND_ORDER, matches, type ArtifactKind, type Ref } from './refs'
import { Badge, KindIcon, Note } from './parts'

/** One row in the index, flattened out of whichever list it came from so the
 *  search and the grouping are written once instead of seven times. */
interface Entry {
  ref: Ref
  title: string
  description: string
  packId?: string | null
  badge?: string | null
}

/**
 * Everything on this pod, in one column of groups.
 *
 * Grouped by kind rather than by pack, which is the choice worth explaining.
 * A pack is how artifacts *arrived*; a kind is what they *are*, and the question
 * someone opens this screen with is almost always "what skills does this pod
 * have" rather than "what did amy_kitchen bring". The pack view exists anyway —
 * it is one click into any artifact's provenance line.
 *
 * The search reaches every group at once and the counts follow it, so a query
 * that matches nothing in five kinds and two things in a sixth reads as two
 * results rather than as five empty headings.
 */
export function LibraryIndex() {
  const { snapshot, unsupported, integrations, installedPacks, templates, loading, error, load, open } =
    useLibrary()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all')

  const entries = useMemo(
    () => collect({ snapshot, integrations, installedPacks, templates }),
    [snapshot, integrations, installedPacks, templates],
  )

  const hits = useMemo(
    () => entries.filter((e) => matches(query, e.title, e.description, e.ref.id, e.packId)),
    [entries, query],
  )

  const groups = KIND_ORDER.map((k) => ({ kind: k, rows: hits.filter((e) => e.ref.kind === k) }))
    .filter((g) => g.rows.length > 0)
    .filter((g) => kind === 'all' || g.kind === kind)

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-baseline gap-3 px-8 pb-4 pt-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Library</h1>
          <p className="text-sm text-ink-2">
            Everything installed on this pod, and what each piece is made of.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
          <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </header>

      <div className="shrink-0 px-8">
        <div className="flex items-center gap-2 rounded-control bg-field px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search everything on this pod…"
            aria-label="Search the library"
            className="h-9 flex-1 bg-transparent text-[13px] text-ink caret-accent outline-none placeholder:text-ink-3"
          />
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-3" />}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-3">
          <Filter label="All" count={hits.length} on={kind === 'all'} onClick={() => setKind('all')} />
          {KIND_ORDER.map((k) => {
            const count = hits.filter((e) => e.ref.kind === k).length
            return (
              <Filter
                key={k}
                label={KIND_LABEL[k].many}
                count={count}
                on={kind === k}
                // A kind with nothing in it is still worth naming: "this pod has
                // no skills" is information, and a filter that vanishes when
                // empty makes the reader wonder whether it was ever there.
                dim={count === 0}
                onClick={() => setKind(kind === k ? 'all' : k)}
              />
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-2">
        {error ? (
          <div className="mx-auto max-w-3xl pt-6">
            <Note tone="bad">
              This pod would not say what it has installed. {error}
            </Note>
          </div>
        ) : unsupported ? (
          <div className="mx-auto max-w-3xl pt-6">
            <Note tone="warn">
              This pod is older than the endpoint the library reads. It is not empty — it simply
              cannot list what it holds. Personas and skills have no listing route of their own, so
              there is nothing to fall back to.
            </Note>
          </div>
        ) : groups.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-ink-3">
            {query
              ? `Nothing on this pod matches “${query}”.`
              : loading
                ? 'Reading the pod…'
                : 'This pod has nothing installed yet.'}
          </p>
        ) : (
          <div className="mx-auto max-w-4xl">
            {groups.map((g) => (
              <section key={g.kind} className="pt-6 first:pt-2">
                <div className="flex items-baseline gap-2 pb-2">
                  <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                    {KIND_LABEL[g.kind].many}
                  </h2>
                  <span className="tnum text-[11px] text-ink-3">{g.rows.length}</span>
                </div>
                <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
                  {g.rows.map((e, i) => (
                    <Row key={`${e.ref.kind}:${e.ref.id}`} entry={e} index={i} onOpen={() => void open(e.ref)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ entry, index, onOpen }: { entry: Entry; index: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
      className="animate-fade-up flex min-w-0 items-start gap-2.5 rounded-card bg-surface px-3 py-2.5 text-left shadow-card transition-shadow duration-150 hover:shadow-raised"
    >
      <KindIcon kind={entry.ref.kind} className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{entry.title}</span>
          {entry.badge && <Badge tone="accent">{entry.badge}</Badge>}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[11.5px] text-ink-2">
          {entry.description || <span className="text-ink-3">No description</span>}
        </span>
        <span className="mt-1 block truncate font-mono text-[10.5px] text-ink-3">
          {entry.ref.id}
          {entry.packId ? ` · ${entry.packId}` : ''}
        </span>
      </span>
    </button>
  )
}

function Filter({
  label,
  count,
  on,
  dim,
  onClick,
}: {
  label: string
  count: number
  on: boolean
  dim?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'rounded-chip px-2 py-1 text-[11.5px] transition-colors duration-150',
        on ? 'bg-accent-tint text-ink' : 'text-ink-2 hover:bg-hover',
        dim && !on && 'text-ink-3',
      )}
    >
      {label} <span className="tnum text-ink-3">{count}</span>
    </button>
  )
}

/** Flatten every list the store holds into one shape the index can sort, search
 *  and group without knowing where any of it came from. */
function collect({
  snapshot,
  integrations,
  installedPacks,
  templates,
}: Pick<
  ReturnType<typeof useLibrary.getState>,
  'snapshot' | 'integrations' | 'installedPacks' | 'templates'
>): Entry[] {
  const rows: Entry[] = []

  for (const p of snapshot?.agent_presets ?? []) {
    rows.push({
      ref: { kind: 'preset', id: p.slug },
      title: p.name || p.slug,
      description: p.tagline || p.description,
      packId: p.pack_id,
      // The pod's default agent is worth marking here and nowhere else: it is
      // the one preset whose identity is a fact about the pod rather than about
      // itself.
      badge: p.slug === snapshot?.default_agent_preset ? 'pod default' : null,
    })
  }
  for (const p of snapshot?.personas ?? []) {
    rows.push({
      ref: { kind: 'persona', id: p.slug },
      title: p.name || p.slug,
      description: p.description,
      packId: p.pack_id,
    })
  }
  for (const s of snapshot?.skills ?? []) {
    rows.push({
      ref: { kind: 'skill', id: s.slug },
      title: s.slug,
      description: s.description,
      packId: s.pack_id,
    })
  }
  for (const t of snapshot?.api_tools ?? []) {
    rows.push({
      ref: { kind: 'tool', id: t.name },
      title: t.name,
      description: t.description,
      packId: t.pack_id,
    })
  }
  for (const i of integrations) {
    rows.push({
      ref: { kind: 'integration', id: i.id },
      title: i.name || i.id,
      description: i.description,
      // Switched off is the state most worth seeing from the index: the tools
      // exist, and none of them will ever fire.
      badge: i.enabled ? null : 'disabled',
    })
  }
  for (const p of installedPacks) {
    rows.push({
      ref: { kind: 'pack', id: p.id },
      title: p.name || p.id,
      description: p.description ?? '',
      badge: p.version ? `v${p.version}` : null,
    })
  }
  for (const t of templates) {
    rows.push({
      ref: { kind: 'template', id: t.slug },
      title: t.name || t.slug,
      description: '',
      packId: t.pack_id,
    })
  }
  return rows
}
