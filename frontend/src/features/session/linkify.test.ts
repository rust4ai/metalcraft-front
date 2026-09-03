import { describe, expect, it } from 'vitest'
import { linkify } from './linkify'

const links = (text: string) => linkify(text).filter((s) => s.href).map((s) => s.href)

describe('linkify', () => {
  it('finds the bare URL the agent wrote as prose', () => {
    // The line that started this: a preview URL in a sentence, with no markdown
    // around it, was rendering as text nobody could click.
    const segments = linkify('Updated preview: https://2rycrfq356gm.livepreview.space/')
    expect(segments).toEqual([
      { text: 'Updated preview: ' },
      { text: 'https://2rycrfq356gm.livepreview.space/', href: 'https://2rycrfq356gm.livepreview.space/' },
    ])
  })

  it('never loses or invents text', () => {
    const text = 'a https://x.dev/one b https://y.dev/two. c'
    expect(linkify(text).map((s) => s.text).join('')).toBe(text)
  })

  it('leaves the sentence its punctuation', () => {
    expect(links('see https://x.dev/page.')).toEqual(['https://x.dev/page'])
    expect(links('(https://x.dev/page)')).toEqual(['https://x.dev/page'])
    expect(links('ok: https://x.dev/a, https://x.dev/b!')).toEqual(['https://x.dev/a', 'https://x.dev/b'])
  })

  it('keeps a parenthesis the URL opened itself', () => {
    const url = 'https://en.wikipedia.org/wiki/Rust_(programming_language)'
    expect(links(`read ${url}`)).toEqual([url])
  })

  it('links nothing that is not an http(s) URL', () => {
    // Bare hostnames and other schemes stay prose: a false positive turns
    // ordinary text into a link, and `file:`/`javascript:` are refused by the
    // core anyway.
    expect(links('run npm i, visit example.com, open file:///etc/passwd')).toEqual([])
    expect(links('https://.')).toEqual([])
  })

  it('handles a URL that is the whole message', () => {
    expect(linkify('https://x.dev/')).toEqual([{ text: 'https://x.dev/', href: 'https://x.dev/' }])
    expect(linkify('')).toEqual([])
  })
})

describe('linkify — images', () => {
  const image = (text: string) => linkify(text).filter((s) => s.image).map((s) => s.href)

  it('marks a link whose path is a picture', () => {
    expect(image('here: https://cdn.dev/a/b/cat.png')).toEqual(['https://cdn.dev/a/b/cat.png'])
    expect(image('https://x.dev/x.JPEG and https://x.dev/y.webp')).toEqual([
      'https://x.dev/x.JPEG',
      'https://x.dev/y.webp',
    ])
  })

  it('marks a presigned object URL, which has no extension to go on', () => {
    // The shape `mimg_share_image` returns: the key is `images/<owner>/<gen>/<i>`
    // and the signature parameters are the only evidence it is a picture.
    const url =
      'https://acct.r2.cloudflarestorage.com/bucket/images/u1/g1/0?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc'
    expect(image(`your image: ${url}`)).toEqual([url])
  })

  it('leaves an ordinary link alone', () => {
    // Marking a page as an image would draw a broken box under every URL an
    // agent mentions. The extension (or a signature) has to be there.
    expect(image('see https://x.dev/page and https://x.dev/images/gallery')).toEqual([])
    expect(image('https://x.dev/report.pdf')).toEqual([])
  })

  it('still links what it draws', () => {
    // The image is additional, never a replacement: the URL stays clickable and
    // the text stays intact.
    const segments = linkify('made you https://x.dev/a.png')
    expect(segments.map((s) => s.text).join('')).toBe('made you https://x.dev/a.png')
    expect(segments[1]).toEqual({
      text: 'https://x.dev/a.png',
      href: 'https://x.dev/a.png',
      image: true,
    })
  })
})
