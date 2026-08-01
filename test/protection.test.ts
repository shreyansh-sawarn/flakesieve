import { describe, expect, it, vi } from 'vitest';
import {
  checkProtection,
  missingProtections,
  protectionWarning,
} from '../src/action/protection.js';

describe('missingProtections', () => {
  it('reports nothing when both rules are active', () => {
    expect(missingProtections(['deletion', 'non_fast_forward'])).toEqual([]);
  });

  it('ignores unrelated rules', () => {
    expect(
      missingProtections(['deletion', 'non_fast_forward', 'pull_request']),
    ).toEqual([]);
  });

  it('reports each missing rule', () => {
    expect(missingProtections(['deletion'])).toEqual(['non_fast_forward']);
    expect(missingProtections(['non_fast_forward'])).toEqual(['deletion']);
    expect(missingProtections([])).toEqual(['deletion', 'non_fast_forward']);
  });
});

describe('protectionWarning', () => {
  const warning = protectionWarning('acme/app', 'flakesieve-history', [
    'deletion',
    'non_fast_forward',
  ]);

  it('names the branch and the repo in the fix command', () => {
    expect(warning).toContain('flakesieve-history');
    expect(warning).toContain('repos/acme/app/rulesets');
  });

  it('includes a runnable command, not just prose', () => {
    // A warning without a fix becomes noise people learn to scroll past.
    expect(warning).toContain('gh api -X POST');
  });

  it('warns against adding a pull-request rule to the history branch', () => {
    // Doing so would break flakesieve's own writes.
    expect(warning).toMatch(/not add a pull-request rule/i);
  });

  it('says how to silence it', () => {
    expect(warning).toContain('protection-check: false');
  });

  it('describes force-push in human terms rather than the API rule name', () => {
    expect(protectionWarning('a/b', 'h', ['non_fast_forward'])).toContain(
      'force-push',
    );
  });
});

describe('checkProtection', () => {
  const read = (rules: string[] | null) => vi.fn().mockResolvedValue(rules);

  it('returns null when the branch is fully protected', async () => {
    const r = read(['deletion', 'non_fast_forward']);
    expect(await checkProtection(r, 'acme', 'app', 'h')).toBeNull();
  });

  it('returns a warning when protection is missing', async () => {
    const r = read([]);
    const out = await checkProtection(r, 'acme', 'app', 'h');
    expect(out).toContain('is not protected');
  });

  it('stays silent when rules cannot be read', async () => {
    // Missing scope or an unsupported plan must not produce a scary warning
    // about a problem that may not exist.
    const r = read(null);
    expect(await checkProtection(r, 'acme', 'app', 'h')).toBeNull();
  });

  it('passes the branch through to the reader', async () => {
    const r = read(['deletion', 'non_fast_forward']);
    await checkProtection(r, 'acme', 'app', 'custom-branch');
    expect(r).toHaveBeenCalledWith('acme', 'app', 'custom-branch');
  });
});
