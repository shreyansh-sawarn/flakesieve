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

/** HTTP status carried by an octokit request error, if there is one. */
function errorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { status } = err as { status?: unknown };
  return typeof status === 'number' ? status : undefined;
}

/**
 * Explain a comment that could not be posted.
 *
 * Posting is the one thing flakesieve does that needs write access, and the
 * commonest way to be denied it is the one case nobody can fix: a pull request
 * from a fork, where GitHub issues a read-only GITHUB_TOKEN regardless of the
 * workflow's `permissions:` block. Failing the run there would put a red X on a
 * contributor's PR for something they did not cause — on exactly the public
 * repos this action is meant for.
 *
 * So every comment failure is advisory. The verdicts are already in the log and
 * the job summary; the comment is the delivery mechanism, not the analysis.
 */
export function commentFailureWarning(err: unknown): string {
  if (errorStatus(err) === 403) {
    return [
      'Could not post the flakesieve comment: the token is not allowed to write',
      'to this pull request.',
      '',
      'This is expected on pull requests from forks. GitHub issues a read-only',
      'GITHUB_TOKEN there, and no `permissions:` block can widen it.',
      '',
      'The verdicts are unaffected — they are in the job summary and the step log',
      'above. Set `comment: false` to silence this.',
    ].join('\n');
  }

  return `Could not post the flakesieve comment: ${
    err instanceof Error ? err.message : String(err)
  }`;
}
