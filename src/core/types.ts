/** Outcome of a single test in a single run. */
export type TestStatus = 'passed' | 'failed' | 'skipped';

/**
 * Compact single-character encoding used in the stored history file.
 *
 * `c` is not a status a parser can report — it means the test both failed and
 * passed within one run, which is proof of non-determinism observed on a single
 * machine at a single commit. See `TestCase.contradictedInRun`.
 *
 * `-` means the test did not appear in that run at all, which is different from
 * having been skipped: an absent test says nothing, a skipped one was chosen.
 */
export type StatusCode = 'p' | 'f' | 's' | 'c' | '-';

// Deliberately `as const` rather than `: StatusCode` — the literal type is what
// lets `if (code === ABSENT) continue` narrow the union for the compiler.
export const ABSENT = '-' as const;

export const STATUS_TO_CODE: Record<TestStatus, StatusCode> = {
  passed: 'p',
  failed: 'f',
  skipped: 's',
};

export const CODE_TO_STATUS: Record<'p' | 'f' | 's', TestStatus> = {
  p: 'passed',
  f: 'failed',
  s: 'skipped',
};

/** A single test case as parsed out of a report file. */
export interface TestCase {
  /** Stable identity across runs. See `testId()`. */
  id: string;
  suite: string;
  name: string;
  status: TestStatus;
  durationMs: number;
  failureMessage?: string;
  /**
   * The test both failed and passed inside this one run — via a runner retry, or
   * because two report files disagreed about it.
   *
   * This is the strongest flake evidence available: same commit, same machine,
   * same execution, two different answers. It is strictly better than the
   * cross-run same-SHA signal, and unlike that one it is available on the very
   * first run, which is the only thing that helps a brand-new user.
   */
  contradictedInRun?: boolean;
}

/** One complete execution of the test suite. */
export interface TestRun {
  runId: string;
  commitSha: string;
  branch: string;
  timestamp: string;
  tests: TestCase[];
}

/**
 * A run as persisted in the history file.
 *
 * `results` is positional: character *i* is the outcome of `HistoryFile.tests[i]`.
 * Storing the ids once and referring to them by position is what keeps the file
 * small enough to live in the repo — see docs/history-storage.md.
 */
export interface StoredRun {
  runId: string;
  commitSha: string;
  branch: string;
  timestamp: string;
  results: string;
}

export interface HistoryFile {
  version: 2;
  updatedAt: string;
  /** Runs are ordered oldest → newest and trimmed to this length. */
  maxRuns: number;
  /**
   * Interned test ids, indexed by the characters of each run's `results`.
   *
   * Order is arbitrary but must stay in step with every run string in the file;
   * only `appendRun` may rewrite it, and it rewrites every run at the same time.
   */
  tests: string[];
  runs: StoredRun[];
}

/** The pre-interning layout. Read for migration, never written. */
export interface HistoryFileV1 {
  version: 1;
  updatedAt: string;
  maxRuns: number;
  runs: {
    runId: string;
    commitSha: string;
    branch: string;
    timestamp: string;
    results: Record<string, string>;
  }[];
}

export type Verdict = 'real' | 'flaky' | 'broken' | 'unknown' | 'healthy';

/** Aggregate history for one test, derived from the stored runs. */
export interface TestStats {
  id: string;
  suite: string;
  name: string;
  totalRuns: number;
  passes: number;
  failures: number;
  skips: number;
  /**
   * Commits where this test both passed and failed across separate runs. Direct
   * proof of non-determinism.
   *
   * Counted only within the recent window (`FlakeConfig.contradictionWindow`).
   * A flake that was fixed a hundred runs ago must stop vouching for the test,
   * or it would go on absorbing genuine regressions forever.
   */
  sameShaContradictions: number;
  /**
   * Runs in which the test failed and passed within that single run. Same proof,
   * observed without needing two runs — see `TestCase.contradictedInRun`.
   *
   * Also windowed.
   */
  withinRunContradictions: number;
  failureRate: number;
  /** Trailing failures, used to detect a test that is simply broken. */
  consecutiveFailures: number;
  firstSeenAt?: string;
  lastFailureAt?: string;
  /** Oldest → newest, one char per run: P / F / S / C / · (absent). */
  recentOutcomes: string;
}

/** Any proof of non-determinism, from either source, inside the window. */
export function contradictions(stats: TestStats): number {
  return stats.sameShaContradictions + stats.withinRunContradictions;
}

export interface Finding {
  stats: TestStats;
  verdict: Verdict;
  /** Failed in the run currently being analyzed. */
  failedNow: boolean;
  failureMessage?: string;
  /** The run being analyzed caught the test contradicting itself. */
  contradictedInRun?: boolean;
}

export interface Report {
  /** Failing now with no history of failure — most likely a genuine regression. */
  likelyReal: Finding[];
  /** Failing now, but demonstrably non-deterministic. */
  knownFlakes: Finding[];
  /** Failing now, and already failing on the default branch beforehand. */
  alreadyBroken: Finding[];
  /** Failing now with too little history to judge. */
  insufficientHistory: Finding[];
  /** Flaky tests ranked by failure rate, regardless of the current run. */
  topFlaky: Finding[];
  runsAnalyzed: number;
  testsTracked: number;
}

export interface FlakeConfig {
  /** Below this many observations a test is `unknown`, never `flaky`. */
  minRuns: number;
  /**
   * Failures needed before an intermittent test may be called flaky.
   *
   * Without this the rate check alone is degenerate: at `minRuns` observations a
   * single failure is already 10%, far above `flakeThreshold`, so every test
   * that has ever failed once would be labelled flaky and its next failure
   * folded away as known noise. Two failures is the smallest number that can
   * distinguish "intermittent" from "happened once".
   */
  minFailures: number;
  /** Failure rate at or above which an intermittent test counts as flaky. */
  flakeThreshold: number;
  /** Failure rate at or above which a test counts as broken rather than flaky. */
  brokenThreshold: number;
  /** Trailing failures that mark a test broken regardless of overall rate. */
  brokenStreak: number;
  /**
   * How many of the most recent runs contradictions are counted over.
   *
   * Proof of non-determinism does not expire on its own, but its relevance does:
   * the test may since have been fixed. Bounding the window means a repaired
   * flake eventually stops excusing new failures.
   */
  contradictionWindow: number;
  /** Characters of sparkline to render. */
  sparklineLength: number;
}

export const DEFAULT_CONFIG: FlakeConfig = {
  minRuns: 10,
  minFailures: 2,
  flakeThreshold: 0.01,
  brokenThreshold: 0.95,
  brokenStreak: 5,
  contradictionWindow: 100,
  sparklineLength: 12,
};

/**
 * Build a stable test identifier.
 *
 * Identity must survive reordering and reruns but change when the test is
 * genuinely renamed — a renamed test legitimately has no history.
 */
export function testId(suite: string, name: string): string {
  return `${suite.trim()} › ${name.trim()}`;
}
