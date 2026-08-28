import { useEffect, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { collectInputs, declaredInputs, initialText, unfilled, type FlowInput } from './flowInputs'
import type { SavedFlow } from '@/types'

/**
 * What to run a flow *with*.
 *
 * Only for a flow whose entry node declares inputs — everything else runs on the
 * click, because a dialog that asks nothing is a step that means nothing. The
 * caller decides which case it is (`declaredInputs`) and only mounts this one.
 *
 * Not a validation gate: a required field left empty still runs. The pod treats
 * an unsupplied input as a warning rather than a refusal, and this screen should
 * not be stricter than the thing it is a front end for — seeing what a flow does
 * with a field missing is a legitimate way to find out what the field is for.
 * The button says so instead of blocking.
 */
export function RunDialog({
  flow,
  running,
  onRun,
  onClose,
}: {
  /** The flow document, or `null` when nothing is being started. */
  flow: SavedFlow | null
  running: boolean
  onRun: (inputs: Record<string, unknown>) => void
  onClose: () => void
}) {
  const inputs: FlowInput[] = flow ? declaredInputs(flow) : []
  const [text, setText] = useState<Record<string, string>>({})

  // Start each opening at the flow's own defaults. Held as text because that is
  // what a field edits; `collectInputs` puts the types back on the way out.
  useEffect(() => {
    if (!flow) return
    setText(Object.fromEntries(declaredInputs(flow).map((i) => [i.name, initialText(i)])))
  }, [flow])

  if (!flow) return null
  const missing = unfilled(inputs, text)

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !running) onClose()
      }}
      title={`Run ${flow.name}`}
      description="This flow takes parameters. They seed its state before the first step."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onRun(collectInputs(inputs, text))
        }}
      >
        <div className="space-y-3">
          {inputs.map((input) => (
            <label key={input.name} className="block">
              <span className="flex items-baseline gap-1.5">
                <span className="font-mono text-[12.5px] text-ink">{input.name}</span>
                <span className="text-[11px] text-ink-3">{input.type}</span>
                {input.required && input.default === undefined && (
                  <span className="text-[11px] text-ink-3">· required</span>
                )}
              </span>
              <input
                value={text[input.name] ?? ''}
                onChange={(e) => setText((prev) => ({ ...prev, [input.name]: e.target.value }))}
                // Autofocus the first thing someone has to type, which for a
                // flow with defaults is not necessarily the first field.
                autoFocus={input.name === (missing[0] ?? inputs[0]?.name)}
                className="mt-1 w-full rounded-md border border-line bg-inset px-2 py-1.5 text-[13px] outline-none focus:border-accent"
              />
            </label>
          ))}
        </div>

        {missing.length > 0 && (
          <p className="mt-3 text-[11.5px] text-ink-3">
            {missing.join(', ')} {missing.length === 1 ? 'is' : 'are'} required and unset. The run
            will go ahead and read {missing.length === 1 ? 'it' : 'them'} as empty.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={running} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Running…' : 'Run now'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
