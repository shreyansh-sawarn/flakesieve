import { describe, expect, it } from 'vitest';
import {
  analyze,
  appendRun,
  classify,
  computeStats,
  emptyHistory,
  migrateV1,
} from '../src/core/flake.js';
import {
  DEFAULT_CONFIG,
  testId,
  type HistoryFile,
  type TestCase,
  type TestRun,
  type TestStatus,
} from '../src/core/types.js';

const FLAKY = testId('auth', 'refreshes token');
const SOLID = testId('auth', 'rejects bad password');

/**
 * Build a history from a compact spec: one string of P/F/S/C per test.
 *
 * Since v2 the stored format is itself a positional string, so the spec now maps
 * one character to one stored character.
 */
function historyFrom(spec: Record<string, string>, shas?: string[]): HistoryFile {
  const length = Math.max(...Object.values(spec).map((s) => s.length));
  const tests = Object.keys(spec);
  const history = emptyHistory();
  history.tests = tests;

  for (let i = 0; i < length; i++) {
    const results = tests
      .map((id) => {
        switch (spec[id]?.[i]) {
          case 'P':
            return 'p';
          case 'F':
            return 'f';
          case 'S':
            return 's';
          case 'C':
            return 'c';
          default:
            return '-';
        }
      })
      .join('');

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

function runWith(
  statuses: Record<string, TestStatus>,
  contradicted: string[] = [],
): TestRun {
  return {
    runId: 'current',
    commitSha: 'head',
    branch: 'pr',
    timestamp: new Date().toISOString(),
    tests: Object.entries(statuses).map(([id, status]): TestCase => ({
      id,
      suite: id.split(' › ')[0] ?? '',
      name: id.split(' › ')[1] ?? '',
      status,
      durationMs: 1,
      contradictedInRun: contradicted.includes(id) || undefined,
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

  it('counts a within-run contradiction as a failure but not a streak', () => {
    // 'C' is a test that failed and passed inside one run. It caused trouble, so
    // it counts against the rate, but it cannot be "broken" — it still passes.
    const s = computeStats(historyFrom({ [FLAKY]: 'PPCCCCC' })).get(FLAKY)!;

    expect(s.withinRunContradictions).toBe(5);
    expect(s.failures).toBe(5);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.recentOutcomes).toBe('PPCCCCC');
    expect(classify(s)).toBe('flaky');
  });

  it('stops counting contradictions once they fall outside the window', () => {
    // A contradiction on the first two runs, then a long clean stretch.
    const history = historyFrom({ [FLAKY]: 'PFPPPPPP' }, [
      'dup', 'dup', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7',
    ]);
    const config = { ...DEFAULT_CONFIG, contradictionWindow: 3 };

    expect(computeStats(history).get(FLAKY)!.sameShaContradictions).toBe(1);
    expect(computeStats(history, config).get(FLAKY)!.sameShaContradictions).toBe(0);
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

  it('does not call a test flaky on the strength of one failure ever', () => {
    // The rate check alone is degenerate here: 1/12 is 8%, far above the 1%
    // threshold, so without minFailures this test would be excused as a known
    // flake — and the next failure, possibly a real regression, filed as noise.
    const s = computeStats(historyFrom({ [FLAKY]: 'PPFPPPPPPPPP' })).get(FLAKY)!;

    expect(s.failures).toBe(1);
    expect(s.failureRate).toBeGreaterThan(DEFAULT_CONFIG.flakeThreshold);
    expect(classify(s)).toBe('healthy');
  });

  it('surfaces that single-failure test as a real failure, not suppressed noise', () => {
    const history = historyFrom({ [FLAKY]: 'PPFPPPPPPPPP' });
    const report = analyze(runWith({ [FLAKY]: 'failed' }), history);

    expect(report.likelyReal.map((f) => f.stats.id)).toEqual([FLAKY]);
    expect(report.knownFlakes).toHaveLength(0);
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

  it('stops excusing failures once the contradiction ages out of the window', () => {
    // A flake that was fixed long ago must not go on absorbing new failures.
    // One failure only, so the contradiction is the sole reason for the flaky
    // verdict — otherwise the rate rule would carry it and prove nothing.
    const history = historyFrom(
      { [FLAKY]: 'PFPPPPPPPPPP' },
      ['dup', 'dup', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11'],
    );
    const config = { ...DEFAULT_CONFIG, contradictionWindow: 4 };

    expect(classify(computeStats(history).get(FLAKY)!)).toBe('flaky');
    expect(classify(computeStats(history, config).get(FLAKY)!, config)).toBe('healthy');
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

  it('calls a within-run contradiction flaky on the very first run', () => {
    // The cold-start case. With no history at all, a test that failed and passed
    // inside this single run is still proven non-deterministic — same commit,
    // same machine, same execution. Waiting for dozens of runs to say so is the
    // difference between useful on day one and useless for a month.
    const report = analyze(
      runWith({ [FLAKY]: 'failed' }, [FLAKY]),
      emptyHistory(),
    );

    expect(report.knownFlakes.map((f) => f.stats.id)).toEqual([FLAKY]);
    expect(report.insufficientHistory).toHaveLength(0);
    expect(report.likelyReal).toHaveLength(0);
  });

  it('lets a within-run contradiction outrank a clean history', () => {
    // Otherwise a test with a spotless record that visibly flakes right now
    // would be reported as a real regression.
    const report = analyze(
      runWith({ [SOLID]: 'failed' }, [SOLID]),
      historyFrom({ [SOLID]: 'PPPPPPPPPPPP' }),
    );

    expect(report.knownFlakes.map((f) => f.stats.id)).toEqual([SOLID]);
    expect(report.likelyReal).toHaveLength(0);
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
      [rare]: 'PPPPPFPPPPPF',
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

  it('stores outcomes positionally against the interned id table', () => {
    const history = appendRun(emptyHistory(), {
      runId: 'r1',
      commitSha: 'sha',
      branch: 'main',
      timestamp: new Date().toISOString(),
      tests: [
        { id: SOLID, suite: 'auth', name: 'a', status: 'passed', durationMs: 1 },
        { id: FLAKY, suite: 'auth', name: 'b', status: 'failed', durationMs: 1 },
      ],
    });

    expect(history.tests).toEqual([SOLID, FLAKY]);
    expect(history.runs[0]!.results).toBe('pf');
  });

  it('records a contradicted test as c, not as a plain failure', () => {
    const history = appendRun(emptyHistory(), {
      runId: 'r1',
      commitSha: 'sha',
      branch: 'main',
      timestamp: new Date().toISOString(),
      tests: [
        {
          id: FLAKY,
          suite: 'auth',
          name: 'b',
          status: 'failed',
          durationMs: 1,
          contradictedInRun: true,
        },
      ],
    });

    expect(history.runs[0]!.results).toBe('c');
  });

  it('drops ids that no retained run mentions', () => {
    // Otherwise the id table grows forever: every test ever renamed or deleted
    // would keep costing bytes in a file fetched and pushed on every CI run.
    const gone = testId('old', 'deleted test');
    let history = emptyHistory(2);

    history = appendRun(history, {
      runId: 'r0',
      commitSha: 's0',
      branch: 'main',
      timestamp: new Date().toISOString(),
      tests: [{ id: gone, suite: 'old', name: 'deleted test', status: 'passed', durationMs: 1 }],
    });
    expect(history.tests).toContain(gone);

    for (const runId of ['r1', 'r2']) {
      history = appendRun(history, {
        runId,
        commitSha: runId,
        branch: 'main',
        timestamp: new Date().toISOString(),
        tests: [{ id: SOLID, suite: 'auth', name: 'x', status: 'passed', durationMs: 1 }],
      });
    }

    expect(history.tests).toEqual([SOLID]);
    expect(history.runs.every((r) => r.results.length === 1)).toBe(true);
  });

  it('keeps surviving ids in place so the diff stays small', () => {
    let history = emptyHistory();
    history = appendRun(history, {
      runId: 'r0',
      commitSha: 's0',
      branch: 'main',
      timestamp: new Date().toISOString(),
      tests: [
        { id: SOLID, suite: 'a', name: 'x', status: 'passed', durationMs: 1 },
        { id: FLAKY, suite: 'a', name: 'y', status: 'passed', durationMs: 1 },
      ],
    });

    history = appendRun(history, {
      runId: 'r1',
      commitSha: 's1',
      branch: 'main',
      timestamp: new Date().toISOString(),
      tests: [
        { id: FLAKY, suite: 'a', name: 'y', status: 'passed', durationMs: 1 },
        { id: SOLID, suite: 'a', name: 'x', status: 'passed', durationMs: 1 },
        { id: 'a › new', suite: 'a', name: 'new', status: 'passed', durationMs: 1 },
      ],
    });

    expect(history.tests).toEqual([SOLID, FLAKY, 'a › new']);
  });
});

describe('migrateV1', () => {
  it('preserves every outcome while switching to the positional encoding', () => {
    const upgraded = migrateV1({
      updatedAt: '2026-01-01T00:00:00.000Z',
      maxRuns: 50,
      runs: [
        {
          runId: 'r0',
          commitSha: 'abc',
          branch: 'main',
          timestamp: '2026-01-01T00:00:00.000Z',
          results: { [SOLID]: 'p', [FLAKY]: 'f' },
        },
        {
          runId: 'r1',
          commitSha: 'abc',
          branch: 'main',
          timestamp: '2026-01-01T00:01:00.000Z',
          results: { [SOLID]: 'p', [FLAKY]: 'p' },
        },
      ],
    });

    expect(upgraded.version).toBe(2);
    expect(upgraded.maxRuns).toBe(50);
    expect(upgraded.tests).toEqual([SOLID, FLAKY]);
    expect(upgraded.runs.map((r) => r.results)).toEqual(['pf', 'pp']);

    // The whole point: verdicts computed from the upgraded file are unchanged.
    const s = computeStats(upgraded).get(FLAKY)!;
    expect(s.sameShaContradictions).toBe(1);
    expect(classify(s)).toBe('flaky');
  });

  it('marks a test absent in runs that predate it', () => {
    const upgraded = migrateV1({
      runs: [
        {
          runId: 'r0',
          commitSha: 'a',
          branch: 'main',
          timestamp: '2026-01-01T00:00:00.000Z',
          results: { [SOLID]: 'p' },
        },
        {
          runId: 'r1',
          commitSha: 'b',
          branch: 'main',
          timestamp: '2026-01-01T00:01:00.000Z',
          results: { [SOLID]: 'p', [FLAKY]: 'f' },
        },
      ],
    });

    expect(upgraded.runs.map((r) => r.results)).toEqual(['p-', 'pf']);
  });
});
