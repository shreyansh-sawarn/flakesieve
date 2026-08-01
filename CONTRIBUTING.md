# Contributing to flakesieve

Contributions are genuinely welcome, including your first ever open source PR.

## Getting set up

```bash
npm install
npm test
npm run build
```

To see the tool working end to end against synthetic data:

```bash
node scripts/seed-demo.mjs .flakesieve/history.json
node dist/cli.js analyze --report "test/fixtures/demo-run.xml" --history .flakesieve/history.json
```

Requires Node 22 or newer.

## The easiest places to help

Two parts of the codebase are deliberately built so you can contribute to them without
understanding anything else.

### Report parsers

`src/parsers/` — each file turns one test-runner output format into `TestCase[]`.

To add one: copy `junit.ts`, implement the `Parser` interface, register it in
`src/parsers/index.ts`, and add a fixture plus tests. That is the whole task. You never
need to touch the analysis engine.

Wanted: TRX (.NET), TAP, Go's `test2json`, Cucumber JSON, Playwright JSON, Allure.

### CI adapters

Right now the run identity (commit SHA, branch, run id) is read from GitHub Actions
environment variables in `src/cli.ts`. Adding GitLab CI, Buildkite, CircleCI or Jenkins
means mapping their equivalents. Small, self-contained, high value.

## Ground rules for the analysis engine

The classification logic in `src/core/flake.ts` is the part that has to be right, so it
changes more carefully than the rest.

1. **Under-claim rather than over-claim.** When evidence is thin, return `unknown`, not
   `flaky`. Telling someone to ignore a real bug is far more expensive than making them
   look at a flake. Every default is tuned in that direction.
2. **Current state outranks history.** A test failing on a long unbroken streak is
   `broken` now, whatever it did months ago.
3. **Every rule change needs a test that fails without it.** The engine's whole value
   is that people trust its verdict.

## Pull requests

- Branch from `main`, one logical change per PR.
- `npm test` and `npm run typecheck` must pass. CI runs both on forks.
- Add tests for behaviour changes. Bug fixes need a regression test that fails before
  the fix.
- Match the surrounding style. Comments explain *why*, not *what*.
- Draft PRs are fine — open one early if you want feedback on direction.

## Reporting bugs

A real-world report file that flakesieve mishandles is the single most useful bug
report. Attach it (scrubbed if needed) and say what you expected.

## Code of conduct

Be decent to each other. Harassment of any kind is not tolerated, and maintainers will
act on it.
