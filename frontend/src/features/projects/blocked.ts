import { useProjects } from '@/stores/projects'

/**
 * How many projects are waiting on a person.
 *
 * A badge rather than a notification because a blocked project is not urgent — it
 * is *stalled*, and it will stay stalled quietly. Its heartbeat has stopped, so
 * nothing else in the app will ever raise it again; the sidebar count is the
 * only standing reminder that one is sitting there.
 *
 * Reads what the projects store already loaded. Nothing here fetches: the count
 * appearing a beat after the list is right, and a sidebar that polls on its own
 * would be a second, slightly different answer to the same question.
 */
export function useBlockedProjectCount(): number {
  return useProjects((s) => s.projects.filter((g) => g.status === 'blocked').length)
}
