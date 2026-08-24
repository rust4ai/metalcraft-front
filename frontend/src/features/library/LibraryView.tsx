import { useEffect } from 'react'
import { ChevronRight, Library } from 'lucide-react'
import { useLibrary } from '@/stores/library'
import { cn } from '@/lib/cn'
import { KIND_LABEL, refKey, type Ref } from './refs'
import { KindIcon } from './parts'
import { LibraryIndex } from './LibraryIndex'
import { PresetShow } from './PresetShow'
import { PersonaShow } from './PersonaShow'
import { SkillShow } from './SkillShow'
import { IntegrationShow } from './IntegrationShow'
import { RawShow } from './RawShow'

/**
 * The Book, beside the gear and the error log.
 *
 * One tab, with a trail inside it. Sub-linking is the point of this surface — a
 * preset names personas, a persona names skills, a skill was shipped by a pack —
 * and every one of those hops opening a tab would leave a fifteen-tab strip
 * after two minutes of reading. So the tab's identity stays `library` and the
 * breadcrumb is the history.
 *
 * The trail lives in the store rather than in component state so it survives the
 * tab losing focus: the shell swaps the centre column's body, and a `useState`
 * here would drop you back at the index every time you glanced at an agent.
 */
export function LibraryView() {
  const { trail, load, loaded, loading, back } = useLibrary()

  // Once per connection, not once per visit: an artifact list changes when
  // something is installed, which is rare and happens on another screen.
  //
  // Gated on `loaded`, not on whether a snapshot came back. A pod too old to
  // have the endpoint answers `null` successfully, and re-asking because the
  // answer was empty is a loop with no exit.
  useEffect(() => {
    if (!loaded && !loading) void load()
  }, [loaded, loading, load])

  const here = trail[trail.length - 1]

  return (
    <div className="flex h-full flex-col">
      {trail.length > 0 && <Breadcrumb trail={trail} onBack={back} />}
      <div className="min-h-0 flex-1">{here ? <Show refTo={here} /> : <LibraryIndex />}</div>
    </div>
  )
}

/** Which page one ref opens. The three untyped kinds share a renderer, because
 *  what they have in common is exactly that this app does not own their shape. */
function Show({ refTo }: { refTo: Ref }) {
  switch (refTo.kind) {
    case 'preset':
      return <PresetShow slug={refTo.id} />
    case 'persona':
      return <PersonaShow slug={refTo.id} />
    case 'skill':
      return <SkillShow slug={refTo.id} />
    case 'integration':
      return <IntegrationShow id={refTo.id} />
    default:
      return <RawShow refTo={refTo} />
  }
}

/**
 * The trail, as a row of crumbs.
 *
 * Every crumb is pressable including the last, which is deliberate: the last one
 * is where you already are, so pressing it does nothing — and a breadcrumb whose
 * final segment is styled as plain text reads as a title rather than as a
 * position, which is the one thing a breadcrumb is for.
 */
function Breadcrumb({ trail, onBack }: { trail: Ref[]; onBack: (depth: number) => void }) {
  return (
    <nav
      aria-label="Library trail"
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-6 py-2"
    >
      <button
        type="button"
        onClick={() => onBack(0)}
        className="flex shrink-0 items-center gap-1.5 rounded-chip px-2 py-1 text-[11.5px] text-ink-2 hover:bg-hover hover:text-ink"
      >
        <Library className="h-3.5 w-3.5" />
        Library
      </button>
      {trail.map((ref, i) => {
        const last = i === trail.length - 1
        return (
          <span key={refKey(ref)} className="flex shrink-0 items-center gap-0.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
            <button
              type="button"
              // `depth` is the length to keep, so crumb `i` keeps `i + 1`.
              onClick={() => onBack(i + 1)}
              aria-current={last ? 'page' : undefined}
              title={KIND_LABEL[ref.kind].one}
              className={cn(
                'flex items-center gap-1.5 rounded-chip px-2 py-1 text-[11.5px]',
                last ? 'text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
              )}
            >
              <KindIcon kind={ref.kind} className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              <span className="max-w-[14rem] truncate font-mono text-[11px]">{ref.id}</span>
            </button>
          </span>
        )
      })}
    </nav>
  )
}
