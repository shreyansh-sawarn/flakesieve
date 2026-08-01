import { describe, expect, it } from 'vitest';
import { recordRefusal } from '../src/action/record-guard.js';

describe('recordRefusal', () => {
  it('allows a push to the default branch', () => {
    expect(
      recordRefusal({ eventName: 'push', branch: 'main', defaultBranch: 'main' }),
    ).toBeNull();
  });

  it('refuses a pull request even when the workflow asked to record', () => {
    // The whole point: `record: true` on a PR silently poisons the baseline, and
    // the damage only shows up much later as verdicts nobody can trust.
    const refusal = recordRefusal({
      eventName: 'pull_request',
      branch: 'feature',
      defaultBranch: 'main',
    });

    expect(refusal).toContain('refusing to record');
    expect(refusal).toContain('pull_request');
  });

  it('refuses pull_request_target too', () => {
    expect(
      recordRefusal({
        eventName: 'pull_request_target',
        branch: 'feature',
        defaultBranch: 'main',
      }),
    ).toContain('refusing to record');
  });

  it('refuses a push to any branch that is not the default', () => {
    const refusal = recordRefusal({
      eventName: 'push',
      branch: 'release/2.0',
      defaultBranch: 'main',
    });

    expect(refusal).toContain("'release/2.0'");
    expect(refusal).toContain("'main'");
  });

  it('names the repository default branch in the suggested fix', () => {
    const refusal = recordRefusal({
      eventName: 'push',
      branch: 'other',
      defaultBranch: 'trunk',
    });
    expect(refusal).toContain("refs/heads/trunk");
  });

  it('allows the run when the default branch is unknown', () => {
    // Some event payloads omit the repository object. A false refusal would stop
    // a correctly configured repo from ever building history, which is worse
    // than the risk being guarded against.
    expect(recordRefusal({ eventName: 'push', branch: 'main' })).toBeNull();
    expect(recordRefusal({ eventName: 'schedule', branch: 'anything' })).toBeNull();
  });

  it('still refuses a pull request when the default branch is unknown', () => {
    expect(
      recordRefusal({ eventName: 'pull_request', branch: 'feature' }),
    ).toContain('refusing to record');
  });
});
