import { KeyRound } from 'lucide-react'
import { useConnection } from '@/stores/connection'
import { useUi } from '@/stores/ui'
import { StatusDot } from '@/components/ui/StatusDot'

/**
 * A draggable overlay title bar (the window is frameless on macOS).
 *
 * The connected pod lives here rather than in a switcher: an account has one pod,
 * so a picker would be chrome for a list of one (PLAN §14.1).
 */
export function TitleBar() {
  const { session, info, pod } = useConnection()
  const go = useUi((s) => s.go)
  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface px-4 pl-20 text-xs"
    >
      <div className="flex items-center gap-2 text-ink-dim" data-tauri-drag-region>
        {info && <StatusDot status="idle" />}
        <span className="font-medium text-ink">{info?.name ?? 'Metalcraft'}</span>
        {info?.version && <span className="text-ink-faint">v{info.version}</span>}
        {pod && <span className="text-ink-faint">· {pod.slug}</span>}
      </div>
      <div className="flex items-center gap-3">
        {session && <span className="text-ink-faint">{session.email}</span>}
        {info && (
          <button
            type="button"
            aria-label="Interface source"
            onClick={() => go({ kind: 'source' })}
            className="text-ink-faint hover:text-ink"
          >
            <KeyRound className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </header>
  )
}
