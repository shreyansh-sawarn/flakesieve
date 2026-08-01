import { describe, expect, it } from 'vitest';
import { analyze, appendRun, classify, computeStats, emptyHistory } from '../src/core/flake.js';
import { testId, type HistoryFile, type TestRun, type TestStatus } from '../src/core/types.js';

const FLAKY = testId('auth', 'refreshes token');
const SOLID = testId('auth', 'rejects bad password');

/** Build a history from a compact spec: one string of P/F per test. */
function historyFrom(spec: Record<string, string>, shas?: string[]): HistoryFile {
  const length = Math.max(...Object.values(spec).map((s) => s.length));
  const history = emptyHistory();

  for (let i = 0; i < length; i++) {
    const results: Record<string, 'p' | 'f' | 's'> = {};
    for (const [id, outcomes] of Object.entries(spec)) {
      const c = outcomes[i];
      if (c === 'P') results[id] = 'p';
      else if (c === 'F') results[id] = 'f';
      else if (c === 'S') results[id] = 's';
    }
    history.runs.push({
      runId: `run-${i}`,
      commitSha: shas?.[i] ?? `sha-${i}`,
      branch: 'main',
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      results,
    });
  }

  return history;
}

function runWith(statuses: Record<string, TestStatus>): TestRun {
  return {
    runId: 'current',
    commitSha: 'head',
    branch: 'pr',
    timestamp: new Date().toISOString(),
    tests: Object.entries(statuses).map(([id, status]) => ({
      id,
      suite: id.split(' › ')[0] ?? '',
      name: id.split(' › ')[1] ?? '',
      status,
      durationMs: 1,
    })),
  };
}

describe('computeStats', () => {
  it('counts passes and failures, excluding skips from the rate', () => {
    const stats = computeStats(historyFrom({ [FLAKY]: 'PPFPPSPF' }));
    const s = stats.get(FLAKY)!;

    expect(s.passes).toBe(5);
    expect(s.failures).toBe(2);
    expect(s.skips).toBe(1);
    expect(s.totalRuns).toBe(7); // skip excluded
    expect(s.failureRate).toBeCloseTo(2 / 7);
  });

  it('detects same-commit contradictions as proof of non-determinism', () => {
    // Same SHA twice, passing once and failing once.
    const history = historyFrom({ [FLAKY]: 'PF' }, ['abc', 'abc']);
    const s = computeStats(history).get(FLAKY)!;

    expect(s.sameShaContradictions).toBe(1);
  });

  it('does not count differing outcomes across different commits', () => {
    const history = historyFrom({ [FLAKY]: 'PF' }, ['abc', 'def']);
    expect(computeStats(history).get(FLAKY)!.sameShaContradictions).toBe(0);
  });

  it('tracks the trailing failure streak', () => {
    const s = computeStats(historyFrom({ [FLAKY]: 'PPPFFF' })).get(FLAKY)!;
    expect(s.consecutiveFailures).toBe(3);
  });

  it('marks runs where the test was absent', () => {
    const history = historyFrom({ [FLAKY]: 'PP', [SOLID]: 'PPPP' });
    expect(computeStats(history).get(FLAKY)!.recentOutcomes).toBe('PP··');
  });
});

describe('classify', () => {
  it('returns unknown below the minimum run count', () => {
    const s = computeStats(historyFrom({ [FLAKY]: 'PPF' })).get(FLAKY)!;
    expect(classify(s)).toBe('unknown');
  });

  it('returns flaky on a same-commit contradiction even with thin history', () => {
    // Overrides the minRuns floor: a contradiction is proof, not an estimate.
    const history = historyFrom({ [FLAKY]: 'PF' }, ['abc', 'abc']);
    const s = computeStats(history).get(FLAKY)!;
    expect(classify(s)).toBe('flaky');
  });

  it('returns healthy for a test that never fails', () => {
    const s = computeStats(historyFrom({ [SOLID]: 'PPPPPPPPPPPP' })).get(SOLID)!;
    expect(classify(s)).toBe('healthy');
  });

  it('returns flaky for intermittent failures', () => {
    const s = computeStats(historyFrom({ [FLAKY]: 'PPFPPPPFPPPP' })).get(FLAKY)!;
    expect(classify(s)).toBe('flaky');
  });

  it('returns broken for a long trailing failure streak', () => {
    const s = computeStats(historyFrom({ [FLAKY]: 'PPPPPPPFFFFF' })).get(FLAKY)!;
    expect(classify(s)).toBe('broken');
  });

  it('returns broken for a test that always fails', () => {
    const s = computeStats(historyFrom({ [FLAKY]: 'FFFFFFFFFFFF' })).get(FLAKY)!;
    expect(classify(s)).toBe('broken');
  });

  it('prefers broken over flaky when a flaky test has since gone fully red', () => {
    // Regression: one old same-commit contradiction used to override the
    // failure streak, reporting a genuinely broken test as ignorable noise.
    const history = historyFrom(
      { [FLAKY]: 'PFPPPPPFFFFFFF' },
      // The first two runs share a SHA, manufacturing a contradiction.
      ['dup', 'dup', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12', 'c13'],
    );
    const s = computeStats(history).get(FLAKY)!;

    expect(s.sameShaContradictions).toBe(1);
    expect(s.consecutiveFailures).toBe(7);
    expect(classify(s)).toBe('broken');
  });
});

describe('analyze', () => {
  it('separates a real regression from a known flake', () => {
    const history = historyFrom({
      [FLAKY]: 'PPFPPPPFPPPP',
      [SOLID]: 'PPPPPPPPPPPP',
    });

    const report = analyze(
      runWith({ [FLAKY]: 'failed', [SOLID]: 'failed' }),
      history,
    );

    expect(report.likelyReal.map((f) => f.stats.id)).toEqual([SOLID]);
    expect(report.knownFlakes.map((f) => f.stats.id)).toEqual([FLAKY]);
  });

  it('ignores passing tests', () => {
    const history = historyFrom({ [FLAKY]: 'PPFPPPPFPPPP' });
    const report = analyze(runWith({ [FLAKY]: 'passed' }), history);

    expect(report.likelyReal).toHaveLength(0);
    expect(report.knownFlakes).toHaveLength(0);
  });

  it('routes a brand-new failing test to insufficientHistory, not likelyReal', () => {
    const report = analyze(
      runWith({ 'new › thing': 'failed' }),
      historyFrom({ [SOLID]: 'PPPPPPPPPPPP' }),
    );

    expect(report.likelyReal).toHaveLength(0);
    expect(report.insufficientHistory.map((f) => f.stats.id)).toEqual(['new › thing']);
  });

  it('reports a pre-existing breakage separately from the PR', () => {
    const history = historyFrom({ [FLAKY]: 'PPPPPPPFFFFF' });
    const report = analyze(runWith({ [FLAKY]: 'failed' }), history);

    expect(report.alreadyBroken.map((f) => f.stats.id)).toEqual([FLAKY]);
    expect(report.likelyReal).toHaveLength(0);
  });

  it('ranks the flake leaderboard by failure rate', () => {
    const rare = testId('a', 'rare');
    const often = testId('a', 'often');
    const history = historyFrom({
      [rare]: 'PPPPPPPPPPPF',
      [often]: 'PFPFPFPFPFPF',
    });

    const report = analyze(runWith({}), history);
    expect(report.topFlaky.map((f) => f.stats.id)).toEqual([often, rare]);
  });
});

describe('appendRun', () => {
  it('trims history to maxRuns, dropping the oldest', () => {
    let history = emptyHistory(3);
    for (let i = 0; i < 5; i++) {
      history = appendRun(history, {
        runId: `r${i}`,
        commitSha: `sha${i}`,
        branch: 'main',
        timestamp: new Date().toISOString(),
        tests: [{ id: SOLID, suite: 'auth', name: 'x', status: 'passed', durationMs: 1 }],
      });
    }

    expect(history.runs).toHaveLength(3);
    expect(history.runs.map((r) => r.runId)).toEqual(['r2', 'r3', 'r4']);
  });
});
