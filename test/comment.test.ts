import { describe, expect, it } from 'vitest';
import { decideComment, RESOLVED_BODY } from '../src/action/comment.js';
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
