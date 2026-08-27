/**
 * Bare URLs in transcript text, found so they can be rendered as links.
 *
 * The agent writes links as prose — "Updated preview: https://x.livepreview.space/"
 * — not as markdown, so nothing in the reply marks them. Finding them is a
 * separate job from drawing them, and it is the half worth testing: what counts
 * as the end of a URL is all edge case.
 */
export type Segment = { text: string; href?: string }

// `http(s)://` and then everything that is not whitespace or a delimiter a URL
// cannot contain. Deliberately no bare `www.` or `example.com` — a false
// positive turns ordinary prose into a link, which is worse than missing one.
const URL_RE = /https?:\/\/[^\s<>"'`]+/g

// Punctuation that ends a sentence rather than a URL.
const TRAILING = `.,;:!?]}'`

/**
 * Trailing punctuation belongs to the sentence, not to the URL.
 *
 * "see https://x.dev/." ends in a full stop, and "(https://x.dev/)" is a URL in
 * brackets — but "https://en.wikipedia.org/wiki/Rust_(programming_language)"
 * ends in a parenthesis that is genuinely part of it. So a closing paren is kept
 * only when the URL opened one of its own.
 */
function trimTrailing(url: string): string {
  let end = url.length
  while (end > 0) {
    const c = url.charAt(end - 1)
    if (c === ')') {
      const inner = url.slice(0, end)
      if ((inner.match(/\(/g) ?? []).length >= (inner.match(/\)/g) ?? []).length) break
    } else if (!TRAILING.includes(c)) {
      break
    }
    end -= 1
  }
  return url.slice(0, end)
}

/**
 * Split text into runs of prose and runs that are a link. Prose comes back as
 * its own segment either way, so joining every `text` reproduces the input.
 */
export function linkify(text: string): Segment[] {
  const segments: Segment[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_RE)) {
    const href = trimTrailing(match[0])
    // A scheme and nothing else (`https://.`) is punctuation, not a link.
    if (!/^https?:\/\/[^/?#]/.test(href)) continue
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index) })
    segments.push({ text: href, href })
    cursor = match.index + href.length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}
