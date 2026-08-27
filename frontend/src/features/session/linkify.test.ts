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
