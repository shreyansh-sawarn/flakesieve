/** Outcome of a single test in a single run. */
export type TestStatus = 'passed' | 'failed' | 'skipped';

/** Compact single-character encoding used in the stored history file. */
export type StatusCode = 'p' | 'f' | 's';

export const STATUS_TO_CODE: Record<TestStatus, StatusCode> = {
  passed: 'p',
  failed: 'f',
  skipped: 's',
};

export const CODE_TO_STATUS: Record<StatusCode, TestStatus> = {
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
 * A run as persisted in the history file. Only identity and outcome are kept —
 * durations and failure messages are dropped so the file stays small enough to
 * live in the repo.
 */
export interface StoredRun {
  runId: string;
  commitSha: string;
  branch: string;
  timestamp: string;
  results: Record<string, StatusCode>;
}

export interface HistoryFile {
  version: 1;
  updatedAt: string;
  /** Runs are ordered oldest → newest and trimmed to this length. */
  maxRuns: number;
  runs: StoredRun[];
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
   * Number of commits where this test both passed and failed. Direct proof of
   * non-determinism — the single strongest flake signal available.
   */
  sameShaContradictions: number;
  failureRate: number;
  /** Trailing failures, used to detect a test that is simply broken. */
  consecutiveFailures: number;
  firstSeenAt?: string;
  lastFailureAt?: string;
  /** Oldest → newest, one char per run: P / F / S / · (absent). */
  recentOutcomes: string;
}

export interface Finding {
  stats: TestStats;
  verdict: Verdict;
  /** Failed in the run currently being analyzed. */
  failedNow: boolean;
  failureMessage?: string;
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
  /** Failure rate at or above which an intermittent test counts as flaky. */
  flakeThreshold: number;
  /** Failure rate at or above which a test counts as broken rather than flaky. */
  brokenThreshold: number;
  /** Trailing failures that mark a test broken regardless of overall rate. */
  brokenStreak: number;
  /** Characters of sparkline to render. */
  sparklineLength: number;
}

export const DEFAULT_CONFIG: FlakeConfig = {
  minRuns: 10,
  flakeThreshold: 0.01,
  brokenThreshold: 0.95,
  brokenStreak: 5,
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
