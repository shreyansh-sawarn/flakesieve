import {
  CODE_TO_STATUS,
  DEFAULT_CONFIG,
  STATUS_TO_CODE,
  type FlakeConfig,
  type Finding,
  type HistoryFile,
  type Report,
  type StoredRun,
  type TestRun,
  type TestStats,
  type Verdict,
} from './types.js';

/** Split a test id back into its suite and name halves for display. */
function splitId(id: string): { suite: string; name: string } {
  const idx = id.indexOf(' › ');
  if (idx === -1) return { suite: '', name: id };
  return { suite: id.slice(0, idx), name: id.slice(idx + 3) };
}

/**
 * Fold the stored runs into per-test aggregates.
 *
 * Everything is recomputed from raw runs on each invocation rather than kept as
 * running totals. It costs a pass over the history but means a change to the
 * classification rules applies retroactively to all existing data, and there is
 * no incremental counter that can silently drift out of sync.
 */
export function computeStats(
  history: HistoryFile,
  config: FlakeConfig = DEFAULT_CONFIG,
): Map<string, TestStats> {
  const runs = history.runs;
  const ids = new Set<string>();
  for (const run of runs) {
    for (const id of Object.keys(run.results)) ids.add(id);
  }

  // commitSha -> testId -> set of outcomes seen on that commit
  const byCommit = new Map<string, Map<string, Set<string>>>();
  for (const run of runs) {
    let commit = byCommit.get(run.commitSha);
    if (!commit) {
      commit = new Map();
      byCommit.set(run.commitSha, commit);
    }
    for (const [id, code] of Object.entries(run.results)) {
      if (code === 's') continue; // a skip is not evidence either way
      let outcomes = commit.get(id);
      if (!outcomes) {
        outcomes = new Set();
        commit.set(id, outcomes);
      }
      outcomes.add(code);
    }
  }

  const stats = new Map<string, TestStats>();

  for (const id of ids) {
    const { suite, name } = splitId(id);
    let passes = 0;
    let failures = 0;
    let skips = 0;
    let firstSeenAt: string | undefined;
    let lastFailureAt: string | undefined;
    let consecutiveFailures = 0;
    const sparkChars: string[] = [];

    for (const run of runs) {
      const code = run.results[id];
      if (code === undefined) {
        sparkChars.push('·');
        continue;
      }
      firstSeenAt ??= run.timestamp;
      const status = CODE_TO_STATUS[code];
      if (status === 'passed') {
        passes++;
        consecutiveFailures = 0;
        sparkChars.push('P');
      } else if (status === 'failed') {
        failures++;
        consecutiveFailures++;
        lastFailureAt = run.timestamp;
        sparkChars.push('F');
      } else {
        skips++;
        sparkChars.push('S');
      }
    }

    let sameShaContradictions = 0;
    for (const commit of byCommit.values()) {
      const outcomes = commit.get(id);
      if (outcomes && outcomes.has('p') && outcomes.has('f')) {
        sameShaContradictions++;
      }
    }

    // Skips are excluded from the denominator: a test that did not execute is
    // not evidence of stability.
    const observed = passes + failures;

    stats.set(id, {
      id,
      suite,
      name,
      totalRuns: observed,
      passes,
      failures,
      skips,
      sameShaContradictions,
      failureRate: observed === 0 ? 0 : failures / observed,
      consecutiveFailures,
      firstSeenAt,
      lastFailureAt,
      recentOutcomes: sparkChars.slice(-config.sparklineLength).join(''),
    });
  }

  return stats;
}

/**
 * Assign a verdict to a test from its accumulated history.
 *
 * Deliberately conservative: when the evidence is thin the answer is `unknown`,
 * never `flaky`. Telling someone to ignore a real bug is far more expensive than
 * making them look at a flake.
 */
export function classify(
  stats: TestStats,
  config: FlakeConfig = DEFAULT_CONFIG,
): Verdict {
  // Current state outranks history. A test failing on a long unbroken streak is
  // broken *now*, even if it was flaky months ago — a single old same-commit
  // contradiction must not get a genuinely broken test waved through as noise.
  if (
    stats.consecutiveFailures >= config.brokenStreak ||
    (stats.totalRuns >= config.minRuns &&
      stats.failureRate >= config.brokenThreshold)
  ) {
    return 'broken';
  }

  // Otherwise a same-commit contradiction is proof of non-determinism and
  // outranks the rate-based rules, including the minimum-runs floor.
  if (stats.sameShaContradictions > 0) return 'flaky';

  if (stats.totalRuns < config.minRuns) return 'unknown';
  if (stats.failures === 0) return 'healthy';

  if (stats.passes > 0 && stats.failureRate >= config.flakeThreshold) {
    return 'flaky';
  }

  return 'healthy';
}

/**
 * Analyze the current run against accumulated history.
 *
 * The history passed in should NOT already include `current` — findings are
 * about what the past says about the present.
 */
export function analyze(
  current: TestRun,
  history: HistoryFile,
  config: FlakeConfig = DEFAULT_CONFIG,
): Report {
  const stats = computeStats(history, config);

  const report: Report = {
    likelyReal: [],
    knownFlakes: [],
    alreadyBroken: [],
    insufficientHistory: [],
    topFlaky: [],
    runsAnalyzed: history.runs.length,
    testsTracked: stats.size,
  };

  for (const test of current.tests) {
    if (test.status !== 'failed') continue;

    const prior = stats.get(test.id);

    // No history at all: a brand-new or newly renamed test that is failing.
    if (!prior || prior.totalRuns === 0) {
      report.insufficientHistory.push({
        stats: prior ?? emptyStats(test.id, test.suite, test.name),
        verdict: 'unknown',
        failedNow: true,
        failureMessage: test.failureMessage,
      });
      continue;
    }

    const verdict = classify(prior, config);
    const finding: Finding = {
      stats: prior,
      verdict,
      failedNow: true,
      failureMessage: test.failureMessage,
    };

    switch (verdict) {
      case 'flaky':
        report.knownFlakes.push(finding);
        break;
      case 'broken':
        report.alreadyBroken.push(finding);
        break;
      case 'unknown':
        report.insufficientHistory.push(finding);
        break;
      default:
        // Clean history, failing now — the case worth waking someone for.
        report.likelyReal.push({ ...finding, verdict: 'real' });
    }
  }

  for (const s of stats.values()) {
    if (classify(s, config) === 'flaky') {
      report.topFlaky.push({ stats: s, verdict: 'flaky', failedNow: false });
    }
  }
  report.topFlaky.sort((a, b) => b.stats.failureRate - a.stats.failureRate);

  const byRate = (a: Finding, b: Finding) =>
    b.stats.failureRate - a.stats.failureRate;
  report.knownFlakes.sort(byRate);
  report.alreadyBroken.sort(byRate);

  return report;
}

function emptyStats(id: string, suite: string, name: string): TestStats {
  return {
    id,
    suite,
    name,
    totalRuns: 0,
    passes: 0,
    failures: 0,
    skips: 0,
    sameShaContradictions: 0,
    failureRate: 0,
    consecutiveFailures: 0,
    recentOutcomes: '',
  };
}

/** Append a run to the history, trimming the oldest entries past `maxRuns`. */
export function appendRun(history: HistoryFile, run: TestRun): HistoryFile {
  const results: StoredRun['results'] = {};
  for (const test of run.tests) {
    results[test.id] = STATUS_TO_CODE[test.status];
  }

  const runs = [
    ...history.runs,
    {
      runId: run.runId,
      commitSha: run.commitSha,
      branch: run.branch,
      timestamp: run.timestamp,
      results,
    },
  ];

  return {
    ...history,
    updatedAt: new Date().toISOString(),
    runs: runs.slice(-history.maxRuns),
  };
}

export function emptyHistory(maxRuns = 200): HistoryFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    maxRuns,
    runs: [],
  };
}
