# AGENTS.md

Instructions for AI coding agents working in this repository. Human contributors
should read [CONTRIBUTING.md](CONTRIBUTING.md) first — this file assumes it.

## What this project is

flakesieve answers one question on a pull request: **is this red X your bug, or a
known flake?** It parses test reports, compares each failure against history
accumulated on the default branch, and sorts failures into `likely real` /
`known flake` / `already broken`.

The product thesis is that this needs **no server, no account, and no database**.
History is a single JSON file on an orphan branch in the user's own repo. Every
competitor in this space requires a SaaS backend or a Postgres container — see
[docs/competitive-landscape.md](docs/competitive-landscape.md). Any change that
introduces a hosted dependency contradicts the reason this project exists.

## Commands

```bash
npm install
npm test              # vitest run
npm run test:watch
npm run typecheck     # tsc --noEmit
npm run build         # tsc -> dist/ (the CLI and library)
npm run build:action  # esbuild -> action-dist/index.cjs (the GitHub Action)
```

End-to-end check against synthetic data:

```bash
node scripts/seed-demo.mjs .flakesieve/history.json
node dist/cli.js analyze --report "test/fixtures/demo-run.xml" --history .flakesieve/history.json
```

Node 22+. `npm test` and `npm run typecheck` must both pass before any commit.

## Layout

| Path | Role |
|---|---|
| `src/core/flake.ts` | The classification engine. `computeStats`, `classify`, `analyze`, `appendRun`. |
| `src/core/types.ts` | All shared types, `DEFAULT_CONFIG` thresholds, and `testId()`. |
| `src/core/collect.ts` | Glob report paths → a single `TestRun`. |
| `src/core/history.ts` | Read/write the history JSON on the local filesystem (CLI path). |
| `src/parsers/` | One file per report format. `junit.ts` is the reference implementation. |
| `src/report/comment.ts`, `terminal.ts` | Renderers. No analysis logic belongs here. |
| `src/action/main.ts` | GitHub Action entry point — orchestration only. |
| `src/action/history-branch.ts` | Orphan-branch read/write via plumbing git commands. |
| `src/action/comment.ts` | Decides create / update / no-op for the PR comment. |
| `src/action/protection.ts` | Advisory branch-protection warning. |
| `src/cli.ts` | `flakesieve analyze` / `stats`. Also where CI env vars are read. |
| `action-dist/index.cjs` | Committed esbuild bundle. Regenerate, never hand-edit. |

## Invariants

These are load-bearing. Breaking one is a correctness or trust bug, not a style
disagreement.

1. **Under-claim, never over-claim.** When evidence is thin the verdict is
   `unknown`, not `flaky`. Telling someone to ignore a real bug costs far more
   than making them look at a flake. Every default in `DEFAULT_CONFIG` is tuned
   in that direction.
2. **Current state outranks history.** A test on a long unbroken failure streak
   is `broken` now, whatever it did months ago. This check runs *before* the
   same-SHA rule in `classify()` — do not reorder it.
3. **Contradictions are proof, not a heuristic.** The same test passing and
   failing — on one commit across runs, or inside a single run — is the strongest
   signal available and the one thing no competitor implements. It outranks the
   rate rules and the `minRuns` floor. Within-run contradictions are what make
   the tool useful on a user's first run; never discard one to simplify a merge.
   Both are counted only inside `contradictionWindow`, because a flake that was
   fixed long ago must stop excusing new failures.
4. **Record only on the default branch, and enforce it in code.** Recording PR
   runs teaches the tool that a genuinely broken test "fails sometimes" and turns
   real regressions into reported flakes. `record:` defaults to `false`, and
   `src/action/record-guard.ts` refuses regardless of what the workflow asks for.
   The history file cannot be regenerated, so it does not get protected by
   documentation alone.
5. **Never fail the user's build for our own reasons.** An unreadable history
   file, a failed comment post, a missing branch — all warn and continue. The
   only thing allowed to fail a job is `fail-on-real: true` finding a real
   failure.
6. **Never ask for permissions we don't strictly need.** In particular, never
   request `administration: write`, even to apply the branch protection we
   recommend. `protection.ts` warns; it does not act.
7. **Recompute stats from raw runs.** `computeStats` deliberately re-folds the
   whole history on every call rather than keeping running counters, so rule
   changes apply retroactively and nothing can drift out of sync. Do not
   "optimize" this into incremental counters without a very good reason.
8. **`action-dist/` must match source.** CI fails if the committed bundle is
   stale. Run `npm run build:action` and commit the result in the same PR as any
   `src/` change that reaches the action.

## Conventions

- **ESM.** `"type": "module"`, and relative imports carry the `.js` extension
  even in TypeScript source (`import { analyze } from '../core/flake.js'`).
- **Comments explain why, not what.** This codebase has an unusually high density
  of comments justifying non-obvious decisions — see the fetch-depth note in
  `history-branch.ts` or the `INPUT_JOB-SUMMARY` note in `ci.yml`. Match that.
  If you make a choice a future reader would second-guess, write down why.
- **Dependencies are close to frozen.** Four runtime deps, all first-party GitHub
  or a JUnit-shaped XML parser. Adding one needs justification in the PR.
- **Every rule change in `flake.ts` needs a test that fails without it.** The
  engine's entire value is that people trust its verdict.
- **Parsers and CI adapters are the designed extension points.** They are
  self-contained by intent so contributors can add one without reading the
  engine. Keep them that way — do not leak analysis logic into a parser.

## Working agreements

- Read [docs/roadmap.md](docs/roadmap.md) before proposing work. It is the living
  plan; tick items off there when they land rather than opening new tracking.
- Read [docs/prior-art.md](docs/prior-art.md) before building a parser, the
  cold-start signal, quarantine, or anything UI-shaped. It says where the
  existing implementations and test corpora are, and carries licence rules that
  bind — one of the referenced repos is AGPL while this project is MIT.
- Findings about competitors go in
  [docs/competitive-landscape.md](docs/competitive-landscape.md), with the
  evidence (file and line) that supports them. Claims about what a competitor
  does must come from reading their code, not their README.
- Never paste third-party code into this repo, whatever its licence.
- Don't commit or push unless asked.
- The repo is dogfooded: `.github/workflows/ci.yml` runs flakesieve on
  flakesieve's own results via `uses: ./`. Changes to the action are exercised
  there, so check that job when something action-shaped breaks.
