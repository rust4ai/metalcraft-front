/**
 * Bare URLs in transcript text, found so they can be rendered as links.
 *
 * The agent writes links as prose — "Updated preview: https://x.livepreview.space/"
 * — not as markdown, so nothing in the reply marks them. Finding them is a
 * separate job from drawing them, and it is the half worth testing: what counts
 * as the end of a URL is all edge case.
 */
export type Segment = { text: string; href?: string; image?: boolean }

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

// Paths that end in a picture. Deliberately extension-based rather than
// host-based: a generated image can come from anywhere.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

/**
 * Whether a link is worth *showing* rather than only offering.
 *
 * Two shapes qualify. One is a path that ends in an image extension. The other is
 * a presigned object URL — the shape `mimg_share_image` returns — where the bytes
 * are an image but the key carries no extension, so the signature parameters are
 * the only tell.
 *
 * Being wrong here is cheap on purpose: the renderer hides an `<img>` that fails to
 * load, so a false positive is invisible rather than a broken-image icon. That is
 * what lets this stay a guess instead of becoming a registry of hosts.
 */
function looksLikeImage(href: string): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (IMAGE_EXT.test(url.pathname)) return true
  const presigned = url.searchParams.has('X-Amz-Signature') || url.searchParams.has('Signature')
  return presigned && /\/images?\//.test(url.pathname)
}

/**
 * Split text into runs of prose and runs that are a link. Prose comes back as
 * its own segment either way, so joining every `text` reproduces the input.
 *
 * A link that points at an image is marked `image` so the transcript can show it.
 * An agent that generates a picture and reports a URL has technically answered and
 * practically hasn't: the thing the person asked for is one click away, in a
 * different application.
 */
export function linkify(text: string): Segment[] {
  const segments: Segment[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_RE)) {
    const href = trimTrailing(match[0])
    // A scheme and nothing else (`https://.`) is punctuation, not a link.
    if (!/^https?:\/\/[^/?#]/.test(href)) continue
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index) })
    segments.push(looksLikeImage(href) ? { text: href, href, image: true } : { text: href, href })
    cursor = match.index + href.length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}
