import { useState } from 'react'
import { Trace } from '@/features/session/Trace'
import { Composer } from '@/features/session/Composer'
import { LoadingState } from '@/components/ui/LoadingState'
import { Card } from '@/components/ui/Card'
import { StatusDot, type Status } from '@/components/ui/StatusDot'
import { Button } from '@/components/ui/Button'
import type { ToolCard } from '@/features/session/transcript'

/**
 * A dev-only harness for the primitives (`?gallery`, `import.meta.env.DEV` only).
 *
 * Design work needs the states you cannot easily produce on demand — a failed
 * tool call, a trace mid-run, a turn that ran out of credits. Waiting for a live
 * pod to misbehave is not a workflow, so they are fabricated here.
 */
export function Gallery() {
  // Start from what the OS is actually showing, or the button lies about which
  // theme you are looking at.
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'light' ||
    document.documentElement.dataset.theme === 'dark'
      ? (document.documentElement.dataset.theme as 'light' | 'dark')
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light',
  )

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setTheme(next)
  }

  const running: ToolCard[] = [
    { kind: 'tool', id: '1', name: 'read_file', args: { path: 'src/runtime.rs' }, status: 'done', durationMs: 12, result: 'fn main() {}' },
    { kind: 'tool', id: '2', name: 'grep', args: { pattern: 'OPENAI', path: 'src/' }, status: 'done', durationMs: 41, result: 'src/runtime.rs:426' },
    { kind: 'tool', id: '3', name: 'edit_file', args: { path: 'src/components/session/ChurnSchedule.tsx' }, status: 'running' },
  ]
  const failed: ToolCard[] = [
    { kind: 'tool', id: '4', name: 'bash', args: { command: 'cargo test --workspace' }, status: 'done', durationMs: 2130, result: 'error: could not compile front-core' },
  ]

  return (
    <div className="h-full overflow-y-auto bg-page">
      <div className="mx-auto max-w-3xl space-y-8 px-8 py-10">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Primitives</h1>
            <p className="text-[13px] text-ink-2">Dev gallery — states that are hard to produce on demand.</p>
          </div>
          <Button variant="outline" size="sm" onClick={toggle}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </Button>
        </header>

        <Section title="Loading state">
          <LoadingState label="Thinking" />
        </Section>

        <Section title="Trace — running">
          <Trace cards={running} />
        </Section>

        <Section title="Trace — settled with a failure">
          <Trace cards={failed} />
        </Section>

        <Section title="Transcript">
          <div className="flex flex-col gap-4">
            <div className="animate-fade-up max-w-[85%] self-end whitespace-pre-wrap rounded-card rounded-br-sm bg-accent px-3.5 py-2 text-[13.5px] text-accent-ink">
              bind the interface source and run the tests
            </div>
            <div className="text-[13.5px] leading-relaxed">
              Bound Metalcraft Inference and ran the suite — 294 tests pass. The key store now
              resolves before the environment, so it applies on the next turn.
            </div>
            <div className="flex gap-2.5 rounded-card bg-red-tint px-3.5 py-3 text-[13px]">
              <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-red" />
              <div>
                <p className="text-ink">You are out of credits.</p>
                <p className="mt-1 font-mono text-[11px] text-ink-3">out_of_credits</p>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Fleet cards">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
            {(['idle', 'thinking', 'error'] as Status[]).map((status, i) => (
              <Card key={status} className="animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="flex items-center gap-2">
                  <StatusDot status={status} />
                  <span className="font-medium">Amy</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-ink-2">amy_kitchen · chef</p>
                <div className="mt-3 flex justify-between text-[11.5px] text-ink-3">
                  <span>persistent · 4 conversations</span>
                  <span className="tnum">2h ago</span>
                </div>
              </Card>
            ))}
          </div>
        </Section>

        <Section title="Composer">
          <div className="overflow-hidden rounded-card">
            <Composer busy={false} onSend={() => {}} />
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 text-[11px] uppercase tracking-wide text-ink-3">{title}</h2>
      {children}
    </section>
  )
}
