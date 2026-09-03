import { useState } from 'react'
import { openExternal } from '@/lib/external'

/**
 * An image the agent produced, shown in the transcript.
 *
 * The agent cannot show you anything — it can only write a URL. Left as a link,
 * "here is your image: https://…" means the answer to *make me a picture* is
 * something you have to go and open somewhere else, and the transcript keeps no
 * record of what was made. Drawing it here is the difference between a receipt and
 * a result.
 *
 * **A failure to load is silent.** Whether a URL is an image is a guess
 * ([`looksLikeImage`]), and the guess is deliberately permissive; a wrong one must
 * cost nothing, so an `<img>` that errors removes itself and leaves the link that
 * was already there. Broken-image icons in a chat log would be worse than never
 * having tried.
 *
 * Clicking opens the real browser, like every other link out of a transcript —
 * the webview has nowhere to navigate back from.
 */
export function TranscriptImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <button
      type="button"
      onClick={() => void openExternal(src)}
      // `max-h` rather than a fixed box: an image is evidence, not decoration, so
      // it should be large enough to judge and small enough not to bury the reply
      // that came with it.
      className="mt-1.5 block overflow-hidden rounded-card border border-line bg-hover-2"
      title="Open in browser"
    >
      <img
        src={src}
        alt="Generated image"
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-72 w-auto max-w-full object-contain"
      />
    </button>
  )
}
