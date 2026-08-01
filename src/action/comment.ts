import { COMMENT_MARKER } from '../report/comment.js';

/** Minimal shape of a GitHub issue comment, so this stays testable without octokit. */
export interface ExistingComment {
  id: number;
  body?: string | undefined;
}

export type CommentAction =
  | { kind: 'create'; body: string }
  | { kind: 'update'; id: number; body: string }
  | { kind: 'none' };

/** Body used when a previously-reported problem has since been resolved. */
export const RESOLVED_BODY = [
  COMMENT_MARKER,
  '',
  '✅ No unexplained test failures.',
  '',
  '<sub>flakesieve — previously reported failures are resolved.</sub>',
].join('\n');

/**
 * Decide what to do with the PR comment.
 *
 * Pure so the policy can be tested without touching the API. The policy itself
 * is the important part:
 *
 *  - Never create a comment when there is nothing wrong. A bot that comments on
 *    every green PR gets muted, and then it is not there on the day it matters.
 *  - Always update in place. One comment per PR, never one per push.
 *  - Do update an existing comment when things go green, because leaving a stale
 *    "1 real failure" comment on a now-passing PR is actively misleading.
 */
export function decideComment(
  rendered: string | null,
  existing: ExistingComment[],
): CommentAction {
  const mine = existing.find((c) => c.body?.includes(COMMENT_MARKER));

  if (rendered === null) {
    if (!mine) return { kind: 'none' };
    // Already showing the resolved state — do not churn the comment.
    if (mine.body === RESOLVED_BODY) return { kind: 'none' };
    return { kind: 'update', id: mine.id, body: RESOLVED_BODY };
  }

  if (!mine) return { kind: 'create', body: rendered };
  if (mine.body === rendered) return { kind: 'none' };
  return { kind: 'update', id: mine.id, body: rendered };
}
