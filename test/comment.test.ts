import { describe, expect, it } from 'vitest';
import {
  commentFailureWarning,
  decideComment,
  RESOLVED_BODY,
} from '../src/action/comment.js';
import { COMMENT_MARKER, renderComment } from '../src/report/comment.js';
import type { Report } from '../src/core/types.js';

const MINE = { id: 1, body: `${COMMENT_MARKER}\n\n### 🔴 1 likely real failure` };
const THEIRS = { id: 2, body: 'looks good to me, shipping' };

function emptyReport(over: Partial<Report> = {}): Report {
  return {
    likelyReal: [],
    knownFlakes: [],
    alreadyBroken: [],
    insufficientHistory: [],
    topFlaky: [],
    runsAnalyzed: 100,
    testsTracked: 50,
    ...over,
  };
}

describe('decideComment', () => {
  it('creates a comment when there is a problem and none exists', () => {
    expect(decideComment('body', [])).toEqual({ kind: 'create', body: 'body' });
  });

  it('never creates a comment when everything is fine', () => {
    // A bot that comments on every green PR gets muted.
    expect(decideComment(null, [])).toEqual({ kind: 'none' });
    expect(decideComment(null, [THEIRS])).toEqual({ kind: 'none' });
  });

  it('updates its own comment in place rather than posting a new one', () => {
    expect(decideComment('new body', [THEIRS, MINE])).toEqual({
      kind: 'update',
      id: 1,
      body: 'new body',
    });
  });

  it('ignores comments from other authors when finding its own', () => {
    const action = decideComment('body', [THEIRS]);
    expect(action).toEqual({ kind: 'create', body: 'body' });
  });

  it('does nothing when the rendered body is unchanged', () => {
    expect(decideComment(MINE.body, [MINE])).toEqual({ kind: 'none' });
  });

  it('replaces a stale failure comment once the PR goes green', () => {
    // Leaving "1 real failure" on a now-passing PR is actively misleading.
    expect(decideComment(null, [MINE])).toEqual({
      kind: 'update',
      id: 1,
      body: RESOLVED_BODY,
    });
  });

  it('does not churn an already-resolved comment', () => {
    expect(decideComment(null, [{ id: 1, body: RESOLVED_BODY }])).toEqual({
      kind: 'none',
    });
  });

  it('handles comments with an undefined body', () => {
    expect(decideComment('body', [{ id: 3, body: undefined }])).toEqual({
      kind: 'create',
      body: 'body',
    });
  });
});

describe('commentFailureWarning', () => {
  /** What octokit throws when the token may not write to the PR. */
  function forbidden(): Error {
    return Object.assign(
      new Error('Resource not accessible by integration'),
      { status: 403 },
    );
  }

  it('names forks as the cause of a 403', () => {
    // The fork case is the one the PR author cannot fix and did not cause.
    const out = commentFailureWarning(forbidden());
    expect(out).toMatch(/fork/i);
    expect(out).toContain('read-only');
  });

  it('says the verdicts survived and how to silence it', () => {
    const out = commentFailureWarning(forbidden());
    expect(out).toContain('job summary');
    expect(out).toContain('comment: false');
  });

  it('does not blame forks for unrelated failures', () => {
    const out = commentFailureWarning(
      Object.assign(new Error('Bad gateway'), { status: 502 }),
    );
    expect(out).not.toMatch(/fork/i);
    expect(out).toContain('Bad gateway');
  });

  it('handles errors with no status and non-errors', () => {
    expect(commentFailureWarning(new Error('socket hang up'))).toContain(
      'socket hang up',
    );
    expect(commentFailureWarning('nope')).toContain('nope');
    expect(commentFailureWarning(undefined)).toContain('undefined');
  });

  it('ignores a non-numeric status rather than throwing', () => {
    const out = commentFailureWarning(
      Object.assign(new Error('weird'), { status: '403' }),
    );
    expect(out).toContain('weird');
  });
});

describe('renderComment / decideComment together', () => {
  it('posts nothing at all for a fully clean run', () => {
    const rendered = renderComment(emptyReport());
    expect(rendered).toBeNull();
    expect(decideComment(rendered, [])).toEqual({ kind: 'none' });
  });

  it('produces a body carrying the marker so it can be found again', () => {
    const rendered = renderComment(
      emptyReport({
        likelyReal: [
          {
            stats: {
              id: 'a › b',
              suite: 'a',
              name: 'b',
              totalRuns: 100,
              passes: 100,
              failures: 0,
              skips: 0,
              sameShaContradictions: 0,
              failureRate: 0,
              consecutiveFailures: 0,
              recentOutcomes: 'PPPPPPPPPPPP',
            },
            verdict: 'real',
            failedNow: true,
          },
        ],
      }),
    );

    expect(rendered).toContain(COMMENT_MARKER);
    expect(decideComment(rendered, [])).toMatchObject({ kind: 'create' });
  });
});
