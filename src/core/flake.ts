import {
  ABSENT,
  CODE_TO_STATUS,
  DEFAULT_CONFIG,
  STATUS_TO_CODE,
  contradictions,
  type FlakeConfig,
  type Finding,
  type HistoryFile,
  type Report,
  type StatusCode,
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

/** The outcome of `tests[i]` in this run, tolerating a short or ragged string. */
function codeAt(run: StoredRun, i: number): StatusCode {
  return (run.results[i] as StatusCode | undefined) ?? ABSENT;
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
  const ids = history.tests;

  // Contradictions are evidence about the test as it is now, so they are counted
  // only over recent runs. Everything else spans the whole history.
  const recent = runs.slice(-config.contradictionWindow);

  // commitSha -> test index -> outcomes seen on that commit, recent runs only.
  const byCommit = new Map<string, Map<number, Set<StatusCode>>>();
  for (const run of recent) {
    let commit = byCommit.get(run.commitSha);
    if (!commit) {
      commit = new Map();
      byCommit.set(run.commitSha, commit);
    }
    for (let i = 0; i < ids.length; i++) {
      const code = codeAt(run, i);
      // A skip is not evidence either way, and an absent test even less so.
      if (code === 's' || code === ABSENT) continue;
      let outcomes = commit.get(i);
      if (!outcomes) {
        outcomes = new Set();
        commit.set(i, outcomes);
      }
      outcomes.add(code);
    }
  }

  const stats = new Map<string, TestStats>();

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === undefined) continue;
    const { suite, name } = splitId(id);
    let passes = 0;
    let failures = 0;
    let skips = 0;
    let firstSeenAt: string | undefined;
    let lastFailureAt: string | undefined;
    let consecutiveFailures = 0;
    const sparkChars: string[] = [];

    for (const run of runs) {
      const code = codeAt(run, i);
      if (code === ABSENT) {
        sparkChars.push('·');
        continue;
      }
      firstSeenAt ??= run.timestamp;

      if (code === 'c') {
        // Failed and passed inside one run. It counts as a failure — it did
        // fail, and the rate is meant to answer "how often does this test cause
        // trouble" — but it cannot contribute to a broken streak, because it
        // demonstrably still passes.
        failures++;
        consecutiveFailures = 0;
        lastFailureAt = run.timestamp;
        sparkChars.push('C');
        continue;
      }

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
      const outcomes = commit.get(i);
      if (!outcomes) continue;
      // 'c' already proves it on its own; a p/f split across runs proves it too.
      if (outcomes.has('p') && outcomes.has('f')) sameShaContradictions++;
    }

    let withinRunContradictions = 0;
    for (const run of recent) {
      if (codeAt(run, i) === 'c') withinRunContradictions++;
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
      withinRunContradictions,
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

  // Otherwise a contradiction — same commit across runs, or a pass and a fail
  // inside one run — is proof of non-determinism and outranks the rate-based
  // rules, including the minimum-runs floor.
  if (contradictions(stats) > 0) return 'flaky';

  if (stats.totalRuns < config.minRuns) return 'unknown';
  if (stats.failures === 0) return 'healthy';

  // Both conditions matter. The rate alone is degenerate near the minimum run
  // count: one failure in ten runs is 10%, already past `flakeThreshold`, so
  // without `minFailures` every test that has ever failed once would be excused
  // as a known flake — and its next failure, possibly a real regression, would
  // be filed away as noise.
  if (
    stats.passes > 0 &&
    stats.failures >= config.minFailures &&
    stats.failureRate >= config.flakeThreshold
  ) {
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
    const base = {
      failedNow: true as const,
      failureMessage: test.failureMessage,
      contradictedInRun: test.contradictedInRun,
    };

    // Proof beats inference, and this proof is about the run in hand rather than
    // the archive. A test that failed and passed within this very run is flaky
    // now, whatever the history says — including when there is no history at
    // all, which is the only case a first-time user ever sees.
    if (test.contradictedInRun) {
      report.knownFlakes.push({
        ...base,
        stats: prior ?? emptyStats(test.id, test.suite, test.name),
        verdict: 'flaky',
      });
      continue;
    }

    // No history at all: a brand-new or newly renamed test that is failing.
    if (!prior || prior.totalRuns === 0) {
      report.insufficientHistory.push({
        ...base,
        stats: prior ?? emptyStats(test.id, test.suite, test.name),
        verdict: 'unknown',
      });
      continue;
    }

    const verdict = classify(prior, config);
    const finding: Finding = { ...base, stats: prior, verdict };

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
    withinRunContradictions: 0,
    failureRate: 0,
    consecutiveFailures: 0,
    recentOutcomes: '',
  };
}

/** Expand a stored run back into id → outcome, dropping absences. */
function decodeRun(ids: string[], run: StoredRun): Map<string, StatusCode> {
  const out = new Map<string, StatusCode>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === undefined) continue;
    const code = codeAt(run, i);
    if (code !== ABSENT) out.set(id, code);
  }
  return out;
}

/** Pack id → outcome into a positional string against `ids`. */
function encodeRun(ids: string[], results: Map<string, StatusCode>): string {
  const chars = new Array<string>(ids.length).fill(ABSENT);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === undefined) continue;
    const code = results.get(id);
    if (code) chars[i] = code;
  }
  return chars.join('');
}

/**
 * Append a run to the history, trimming the oldest entries past `maxRuns`.
 *
 * Rewrites the whole file rather than appending in place, because trimming can
 * retire the last run that mentioned a test and the id table must not keep
 * growing forever. Ids that survive keep their position so the diff stays small.
 */
export function appendRun(history: HistoryFile, run: TestRun): HistoryFile {
  const decoded = history.runs.map((r) => ({
    meta: r,
    results: decodeRun(history.tests, r),
  }));

  const incoming = new Map<string, StatusCode>();
  for (const test of run.tests) {
    incoming.set(
      test.id,
      test.contradictedInRun ? 'c' : STATUS_TO_CODE[test.status],
    );
  }

  decoded.push({
    meta: {
      runId: run.runId,
      commitSha: run.commitSha,
      branch: run.branch,
      timestamp: run.timestamp,
      results: '',
    },
    results: incoming,
  });

  const retained = decoded.slice(-history.maxRuns);

  const live = new Set<string>();
  for (const r of retained) for (const id of r.results.keys()) live.add(id);

  const tests: string[] = [];
  const seen = new Set<string>();
  // Survivors first, in their existing order, so positions barely move.
  for (const id of history.tests) {
    if (live.has(id) && !seen.has(id)) {
      seen.add(id);
      tests.push(id);
    }
  }
  // Then anything new, oldest run first.
  for (const r of retained) {
    for (const id of r.results.keys()) {
      if (!seen.has(id)) {
        seen.add(id);
        tests.push(id);
      }
    }
  }

  return {
    ...history,
    version: 2,
    updatedAt: new Date().toISOString(),
    tests,
    runs: retained.map((r) => ({
      runId: r.meta.runId,
      commitSha: r.meta.commitSha,
      branch: r.meta.branch,
      timestamp: r.meta.timestamp,
      results: encodeRun(tests, r.results),
    })),
  };
}

export function emptyHistory(maxRuns = 200): HistoryFile {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    maxRuns,
    tests: [],
    runs: [],
  };
}

/**
 * Upgrade a version 1 history in place.
 *
 * v1 stored `results` as an object keyed by full test id, repeated in every run.
 * At a couple of thousand tests that reached tens of megabytes, refetched and
 * rewritten on every CI run. The data is identical; only the encoding changed.
 */
export function migrateV1(v1: {
  updatedAt?: string;
  maxRuns?: number;
  runs: {
    runId: string;
    commitSha: string;
    branch: string;
    timestamp: string;
    results: Record<string, string>;
  }[];
}): HistoryFile {
  const tests: string[] = [];
  const seen = new Set<string>();
  for (const run of v1.runs) {
    for (const id of Object.keys(run.results)) {
      if (!seen.has(id)) {
        seen.add(id);
        tests.push(id);
      }
    }
  }

  return {
    version: 2,
    updatedAt: v1.updatedAt ?? new Date().toISOString(),
    maxRuns: v1.maxRuns ?? 200,
    tests,
    runs: v1.runs.map((run) => {
      const results = new Map<string, StatusCode>();
      for (const [id, code] of Object.entries(run.results)) {
        // Unknown codes are dropped rather than trusted; 'c' cannot occur in v1.
        if (code === 'p' || code === 'f' || code === 's') results.set(id, code);
      }
      return {
        runId: run.runId,
        commitSha: run.commitSha,
        branch: run.branch,
        timestamp: run.timestamp,
        results: encodeRun(tests, results),
      };
    }),
  };
}
