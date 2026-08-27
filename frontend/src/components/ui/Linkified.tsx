import { Fragment } from 'react'
import { linkify } from '@/features/session/linkify'
import { cn } from '@/lib/cn'
import { openExternal } from '@/lib/external'

/**
 * Text with its bare URLs made clickable.
 *
 * The click goes to the core rather than to the webview. An `<a href>` inside the
 * Tauri window has two behaviours and both are wrong: with `target="_blank"` it
 * does nothing (no window handler behind it), and without it the *app* navigates
 * to the page and there is no way back. `open_url` hands it to the real browser,
 * which is where a link out of a transcript belongs. `href` is still set so the
 * status bar, hover and "copy link" all work.
 *
 * `linkClassName` is there for the one place the accent is wrong: on the user's
 * own bubble the accent *is* the background, so the link rides the bubble's ink.
 */
export function Linkified({ text, linkClassName }: { text: string; linkClassName?: string }) {
  return (
    <>
      {linkify(text).map((segment, i) =>
        segment.href ? (
          <a
            key={i}
            href={segment.href}
            onClick={(e) => {
              e.preventDefault()
              void openExternal(segment.href!)
            }}
            className={cn('text-accent underline-offset-2 hover:underline', linkClassName)}
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}

