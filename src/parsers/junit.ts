import { XMLParser } from 'fast-xml-parser';
import { testId, type TestCase, type TestStatus } from '../core/types.js';
import type { Parser } from './types.js';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Suites and cases must stay arrays even when a file contains exactly one,
  // otherwise single-test reports take a different code path than the rest.
  isArray: (name) => name === 'testsuite' || name === 'testcase',
});

interface RawCase {
  '@name'?: string;
  '@classname'?: string;
  '@time'?: string;
  failure?: unknown;
  error?: unknown;
  skipped?: unknown;
  // Surefire and its imitators record retries as extra children rather than
  // extra <testcase> elements. `flaky*` means the test failed and then passed;
  // `rerun*` means it failed every time and the <failure> above is the verdict.
  flakyFailure?: unknown;
  flakyError?: unknown;
  rerunFailure?: unknown;
  rerunError?: unknown;
}

interface RawSuite {
  '@name'?: string;
  testcase?: RawCase[];
  testsuite?: RawSuite[];
}

/** Pull a human-readable message out of a <failure> node in any of its shapes. */
function messageOf(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string') return node.trim() || undefined;
  if (Array.isArray(node)) return messageOf(node[0]);
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const msg = obj['@message'] ?? obj['@type'] ?? obj['#text'];
    if (typeof msg === 'string') return msg.trim() || undefined;
  }
  return undefined;
}

function statusOf(raw: RawCase): TestStatus {
  // `error` and `failure` are distinct in the JUnit schema (thrown exception vs
  // failed assertion) but mean the same thing here: the test did not pass.
  if (raw.failure != null || raw.error != null) return 'failed';
  // A rerun failure without a <failure> sibling is malformed, but if a runner
  // emits it we should believe the failure rather than report a pass.
  if (raw.rerunFailure != null || raw.rerunError != null) return 'failed';
  if (raw.skipped != null) return 'skipped';
  return 'passed';
}

/**
 * Did the runner itself observe this test both failing and passing?
 *
 * `<flakyFailure>` is the runner saying so outright: it retried, and the retry
 * passed. That is the same proof as a same-commit contradiction, handed to us
 * for free on the very first run. Treating these testcases as ordinary passes,
 * as we used to, discarded a signal the test framework had already paid for.
 *
 * `<rerunFailure>` is deliberately not included: it means every attempt failed,
 * so nothing contradicts anything.
 */
function contradictedInRun(raw: RawCase): boolean {
  return raw.flakyFailure != null || raw.flakyError != null;
}

/**
 * Walk nested suites, accumulating the suite path.
 *
 * Gradle, Jest and pytest all nest differently; the joined path is what makes
 * ids stable across runners rather than each producing its own shape.
 */
function collect(suite: RawSuite, prefix: string[], out: TestCase[]): void {
  const suiteName = suite['@name']?.trim();
  const path = suiteName ? [...prefix, suiteName] : prefix;

  for (const raw of suite.testcase ?? []) {
    const name = raw['@name']?.trim();
    if (!name) continue;

    // classname is usually the most specific grouping the runner knows about.
    const classname = raw['@classname']?.trim();
    const suiteLabel = classname || path.join(' / ') || 'unknown';

    const status = statusOf(raw);
    const seconds = Number.parseFloat(raw['@time'] ?? '0');

    out.push({
      id: testId(suiteLabel, name),
      suite: suiteLabel,
      name,
      status,
      durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
      failureMessage:
        status === 'failed'
          ? messageOf(raw.failure ?? raw.error ?? raw.rerunFailure ?? raw.rerunError)
          : undefined,
      // Left undefined rather than false so the flag never appears in stored
      // output for the overwhelming majority of tests that did not retry.
      contradictedInRun: contradictedInRun(raw) || undefined,
    });
  }

  for (const nested of suite.testsuite ?? []) {
    collect(nested, path, out);
  }
}

export const junitParser: Parser = {
  name: 'junit',

  defaultGlobs: [
    '**/junit.xml',
    '**/junit*.xml',
    '**/TEST-*.xml',
    '**/test-results/**/*.xml',
  ],

  canParse(content) {
    return /<testsuites?[\s>]/.test(content);
  },

  parse(content, filename) {
    let doc: Record<string, unknown>;
    try {
      doc = xml.parse(content) as Record<string, unknown>;
    } catch (cause) {
      throw new Error(`failed to parse ${filename} as JUnit XML`, { cause });
    }

    const out: TestCase[] = [];

    // A file may be rooted at <testsuites> or at a bare <testsuite>.
    const root = doc.testsuites as RawSuite | undefined;
    if (root) {
      for (const suite of root.testsuite ?? []) collect(suite, [], out);
      // Some runners hang testcases directly off <testsuites>.
      if (root.testcase?.length) collect({ testcase: root.testcase }, [], out);
    }

    const bare = doc.testsuite as RawSuite[] | undefined;
    if (bare) {
      for (const suite of bare) collect(suite, [], out);
    }

    return out;
  },
};
