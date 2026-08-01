import { describe, expect, it } from 'vitest';
import { collectRun } from '../src/core/collect.js';
import { testId, type TestCase } from '../src/core/types.js';

const FLIPS = testId('checkout/CartSpec', 'flips under load');
const STABLE = testId('checkout/CartSpec', 'always passes');
const BROKEN = testId('checkout/CartSpec', 'always fails');

async function collectMergeFixtures(): Promise<Map<string, TestCase>> {
  const run = await collectRun({
    patterns: ['test/fixtures/merge/*.xml'],
    runId: 'r1',
    commitSha: 'sha',
    branch: 'main',
  });
  return new Map(run.tests.map((t) => [t.id, t]));
}

describe('collectRun', () => {
  it('flags a test that failed in one report and passed in another', async () => {
    // One commit, one machine, one execution, two answers. This is stronger
    // evidence than the cross-run same-SHA signal, and it used to be discarded:
    // the merge collapsed it to a plain failure indistinguishable from a real
    // regression.
    const byId = await collectMergeFixtures();
    expect(byId.get(FLIPS)!.contradictedInRun).toBe(true);
  });

  it('still reports the failure rather than letting the retry hide it', async () => {
    // Announcing a pass because some shard succeeded would conceal a failure the
    // user may want to see. The flag, not the status, is what stops it being
    // blamed on their change.
    const byId = await collectMergeFixtures();
    expect(byId.get(FLIPS)!.status).toBe('failed');
    expect(byId.get(FLIPS)!.failureMessage).toBe('timeout after 2000ms');
  });

  it('leaves consistent tests unflagged', async () => {
    const byId = await collectMergeFixtures();

    expect(byId.get(STABLE)!.status).toBe('passed');
    expect(byId.get(STABLE)!.contradictedInRun).toBeUndefined();

    // Failing in both reports is not a contradiction — it is just broken.
    expect(byId.get(BROKEN)!.status).toBe('failed');
    expect(byId.get(BROKEN)!.contradictedInRun).toBeUndefined();
  });

  it('merges every report into one run', async () => {
    const byId = await collectMergeFixtures();
    expect([...byId.keys()].sort()).toEqual([BROKEN, STABLE, FLIPS].sort());
  });

  it('explains itself when no report file matches', async () => {
    await expect(
      collectRun({
        patterns: ['test/fixtures/nothing-here/*.xml'],
        runId: 'r1',
        commitSha: 'sha',
        branch: 'main',
      }),
    ).rejects.toThrow(/no report files matched/);
  });
});
