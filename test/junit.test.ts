import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { junitParser } from '../src/parsers/junit.js';
import type { TestCase } from '../src/core/types.js';

let cases: TestCase[];

beforeAll(async () => {
  const path = fileURLToPath(new URL('./fixtures/junit-sample.xml', import.meta.url));
  cases = junitParser.parse(await readFile(path, 'utf8'), 'junit-sample.xml');
});

const byName = (name: string) => cases.find((c) => c.name === name)!;

describe('junitParser.canParse', () => {
  it('accepts JUnit XML', () => {
    expect(junitParser.canParse('<testsuites><testsuite/></testsuites>', 'a.xml')).toBe(true);
    expect(junitParser.canParse('<testsuite name="x"/>', 'a.xml')).toBe(true);
  });

  it('rejects unrelated files without throwing', () => {
    expect(junitParser.canParse('{"not":"xml"}', 'a.json')).toBe(false);
    expect(junitParser.canParse('<html><body/></html>', 'a.html')).toBe(false);
  });
});

describe('junitParser.parse', () => {
  it('finds every test case including nested suites', () => {
    expect(cases).toHaveLength(5);
  });

  it('maps <failure> to failed and captures the message', () => {
    const t = byName('refreshes token near expiry');
    expect(t.status).toBe('failed');
    expect(t.failureMessage).toBe('expected 200, got 401');
  });

  it('treats <error> the same as <failure>', () => {
    const t = byName('emits EU VAT line');
    expect(t.status).toBe('failed');
    expect(t.failureMessage).toContain('TypeError');
  });

  it('maps <skipped> to skipped', () => {
    expect(byName('handles SSO callback').status).toBe('skipped');
  });

  it('treats a bare testcase as passed', () => {
    expect(byName('rejects bad password').status).toBe('passed');
  });

  it('prefers classname over the suite path for grouping', () => {
    expect(byName('rejects bad password').suite).toBe('auth/SessionSpec');
  });

  it('falls back to the nested suite path when classname is absent', () => {
    expect(byName('totals round half up').suite).toBe('billing / nested');
  });

  it('builds stable ids from suite and name', () => {
    expect(byName('rejects bad password').id).toBe('auth/SessionSpec › rejects bad password');
  });

  it('converts seconds to milliseconds', () => {
    expect(byName('refreshes token near expiry').durationMs).toBe(1204);
  });

  it('handles a single suite with a single case', () => {
    const out = junitParser.parse(
      '<testsuite name="solo"><testcase name="only one" time="0.5"/></testsuite>',
      'solo.xml',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.durationMs).toBe(500);
  });
});
