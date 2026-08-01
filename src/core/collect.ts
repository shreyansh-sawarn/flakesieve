import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { parserFor } from '../parsers/index.js';
import type { TestCase, TestRun } from './types.js';

export interface CollectOptions {
  /** Glob patterns for report files. */
  patterns: string[];
  runId: string;
  commitSha: string;
  branch: string;
  /** Called for files no parser recognized. */
  onSkip?: (file: string) => void;
}

/**
 * Read every file matching the globs and merge them into a single run.
 *
 * Shared by the CLI and the GitHub Action so both interpret reports identically —
 * a discrepancy between them would produce different verdicts locally and in CI,
 * which is exactly the kind of thing that destroys trust in the tool.
 */
export async function collectRun(options: CollectOptions): Promise<TestRun> {
  const files: string[] = [];
  for (const pattern of options.patterns) {
    for await (const f of glob(pattern)) files.push(f);
  }

  if (files.length === 0) {
    throw new Error(
      `no report files matched ${options.patterns.join(', ')}\n` +
        'Check that your test runner emitted JUnit XML and that the glob is correct.',
    );
  }

  const byId = new Map<string, TestCase>();

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const parser = parserFor(content, file);
    if (!parser) {
      options.onSkip?.(file);
      continue;
    }
    for (const test of parser.parse(content, file)) {
      const existing = byId.get(test.id);
      if (!existing) {
        byId.set(test.id, test);
        continue;
      }

      // The same test appearing twice with different answers — a runner retry,
      // or two report files disagreeing — is the strongest flake evidence there
      // is: one commit, one machine, one execution, two outcomes. Collapsing it
      // to a plain failure, as this used to, threw away the single signal that
      // works on a user's first ever run.
      const disagree =
        (existing.status === 'failed') !== (test.status === 'failed') &&
        existing.status !== 'skipped' &&
        test.status !== 'skipped';

      const contradicted =
        disagree || existing.contradictedInRun || test.contradictedInRun;

      // Failure still wins the reported status. Announcing a pass because a
      // retry succeeded would hide a failure the user may want to see; the
      // contradiction flag is what stops it being blamed on their change.
      // Below that, an execution beats a skip — a test skipped on one shard and
      // run on another did run.
      const rank = (c: TestCase) =>
        c.status === 'failed' ? 2 : c.status === 'passed' ? 1 : 0;
      const winner = rank(test) > rank(existing) ? test : existing;
      byId.set(test.id, { ...winner, contradictedInRun: contradicted || undefined });
    }
  }

  return {
    runId: options.runId,
    commitSha: options.commitSha,
    branch: options.branch,
    timestamp: new Date().toISOString(),
    tests: [...byId.values()],
  };
}
