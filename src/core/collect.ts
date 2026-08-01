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
      // Within a single run a test can appear twice via retries. A failure
      // anywhere in the run is what matters, so failure wins the merge.
      const existing = byId.get(test.id);
      if (!existing || test.status === 'failed') byId.set(test.id, test);
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
