#!/usr/bin/env node
/**
 * Generate a synthetic history file for demos, screenshots and the README GIF.
 *
 * Produces the three cases the tool exists to distinguish:
 *   - a genuinely flaky test (intermittent, with same-commit contradictions)
 *   - a rock-solid test that is about to fail for the first time
 *   - a test already broken on main before the PR
 *
 *   node scripts/seed-demo.mjs .flakesieve/history.json
 */
import { appendRun, emptyHistory } from '../dist/core/flake.js';
import { saveHistory } from '../dist/core/history.js';

const out = process.argv[2] ?? '.flakesieve/history.json';
const RUNS = 184;

const tests = [
  // id, behaviour
  ['auth/SessionSpec › refreshes token near expiry', 'flaky', 0.37],
  ['search/IndexerSpec › reindexes within timeout', 'flaky', 0.08],
  ['auth/SessionSpec › rejects bad password', 'solid'],
  ['billing/InvoiceSpec › emits EU VAT line', 'broken-late'],
  ['checkout/CartTotals › applies bulk discount over 10 units', 'solid'],
  ['checkout/CartTotals › splits shipping across vendors', 'solid'],
];

// Deterministic PRNG so demo output is reproducible across machines.
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

let history = emptyHistory(RUNS);

for (let i = 0; i < RUNS; i++) {
  // Retries on the same commit are what create same-SHA contradictions.
  const sha = `c${String(Math.floor(i / 2)).padStart(6, '0')}`;

  const cases = tests.map(([id, kind, rate]) => {
    const [suite, name] = id.split(' › ');
    let status = 'passed';

    if (kind === 'flaky') status = rand() < rate ? 'failed' : 'passed';
    if (kind === 'broken-late') status = i >= RUNS - 23 ? 'failed' : 'passed';

    return { id, suite, name, status, durationMs: Math.round(rand() * 2000) };
  });

  history = appendRun(history, {
    runId: `run-${i}`,
    commitSha: sha,
    branch: 'main',
    timestamp: new Date(Date.now() - (RUNS - i) * 36e5).toISOString(),
    tests: cases,
  });
}

await saveHistory(out, history);
console.log(`seeded ${RUNS} runs across ${tests.length} tests → ${out}`);
