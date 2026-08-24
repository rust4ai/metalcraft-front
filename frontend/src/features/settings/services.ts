import type { ServiceId } from '@/types'

/**
 * What one connectable service is *called*, everywhere the card says its name.
 *
 * The flow is identical for both (PLAN §9.3) — mint a key with the Metalcraft
 * account already signed in, prove it, store it on the pod, install the pack —
 * so what differs between them is words, and words belong in a table rather than
 * in a second copy of the markup.
 *
 * Every string here is one a person reads. "Connect" alone on a button would be
 * ambiguous in a column of cards, and "Workspace" is the right label for one
 * service and the wrong one for the other, which is why neither is hardcoded in
 * the card.
 */
export interface ServiceSpec {
  id: ServiceId
  name: string
  /** What the agent gets out of it, in one line. */
  blurb: string
  /** The connect button, named for the service it connects. */
  connect: string
  /** What the connection's `label` is: a workspace, or an account. */
  identity: string
  /** The button that opens the service in a browser. */
  open: string
  /** Under the connect button, before anything exists — what is about to
   *  happen to a credential, since the user never sees the credential. */
  footnote: string
  /** The picker's question. Only Octaweave can ask one. */
  choose?: string
}

export const SERVICES: Record<ServiceId, ServiceSpec> = {
  octaweave: {
    id: 'octaweave',
    name: 'Octaweave',
    blurb:
      'Notes, board, drive, calendar, blog and studio — the workspace your agent can work in too.',
    connect: 'Connect Octaweave',
    identity: 'Workspace',
    open: 'Open workspace',
    footnote:
      'Connects with the Metalcraft account you are signed in to. The key is created for one workspace and stored on your pod — it never enters this window.',
    choose: 'Which workspace should your agent work in?',
  },
  buildr: {
    id: 'buildr',
    name: 'buildr.space',
    blurb:
      'A remote box that clones your repo, runs it, and pushes — where your agent writes code.',
    connect: 'Connect buildr.space',
    identity: 'Account',
    open: 'Open buildr.space',
    footnote:
      'Connects with the Metalcraft account you are signed in to. The key is created for your buildr.space account and stored on your pod — it never enters this window, and it does not expire until you disconnect.',
  },
}
