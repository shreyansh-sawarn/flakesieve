# Competitive landscape

Last surveyed: **2026-08-02**.

Everything here was verified by reading source, not READMEs. Where a claim is
about behaviour, the file and line that proves it is cited. When you re-survey,
update the date above and note what changed.

The rule for this document: **a README claim is a marketing claim until you have
read the function that implements it.** Three of the tools below describe
themselves as flaky-test detectors and do not detect flaky tests.

---

## The one-line summary

Nobody else classifies an individual PR failure as *yours* vs *not yours*, and
nobody else does it without a server. The five detection mechanisms in the wild
are:

| Mechanism | Who uses it | Cold start | Needs a backend |
|---|---|---|---|
| Framework retry flag (`test.flaky`, rerun elements) | ctrf-io, mikepenz, flexport | Instant | No |
| Hand-curated allowlist | rwx captain (local mode) | n/a | No |
| Single-snapshot diff (failed now, passed last time) | ollieb89 | 1 run | No |
| Server-side history + ML/stats | Trunk, BuildPulse, Datadog, anchorpipe, FlakeGuard | ~dozens of runs | **Yes** |
| **Commit-level contradiction + main-branch history** | **flakesieve** | ~dozens of runs | **No** |

The last row is the product. It is also, as of this survey, unique — and small
enough to be copied in a weekend, which is why shipping and distribution matter
more than more algorithm work right now.

---

## Tier 1 — direct competitors

### ctrf-io/github-test-reporter

367★ · 41 forks · TypeScript · MIT · actively maintained (pushed 2026-08-01) ·
backed by an org with a docs site and a format standard (CTRF)

**The one that shows up when someone searches for our problem.** Enormous surface
area: 25+ report blocks, Handlebars custom templates, Slack/Teams delivery, AI
failure summaries, status checks, annotations, issue creation.

What its flake detection actually is:

```ts
// src/ctrf/core/src/methods/run-insights.ts:24
export function isTestFlaky(test: Test): boolean {
  return test.flaky || (test.retries && test.retries > 0 && test.status === "passed") || false;
}
```

A test is flaky if **the runner retried it and it passed**. It is reading a field
Playwright/Jest already set. It does not infer flakiness.

The historical reports (`flaky-rate-report`, `fail-rate-report`) are real but
have three structural limits:

- **Cost.** `src/ctrf/metrics.ts:55-140` walks up to 400 workflow runs and
  downloads up to 100 artifact ZIPs — one HTTP round-trip each — on every PR run.
  Those are the defaults (`src/core/inputs.ts:80-89`). GitHub artifacts also
  expire (90 days by default), so the history has a hard horizon.
- **Wrong baseline.** `isMatchingWorkflowRun` (`src/github/helpers.ts:41-62`)
  matches prior runs of *the same PR or branch*. On a PR it compares the PR
  against itself, not against the default branch.
- **No commit awareness.** `grep -i "commit\|sha"` over the entire insights
  engine returns nothing. No same-SHA reasoning, no `consecutive`, no concept of
  a test that is simply broken.

Test identity is `test.name` alone in the aggregation map
(`aggregateTestMetricsAcrossReports`); suite prefixing is opt-in.

**Net:** it is a reporting surface that shows you a flaky-rate column. It never
says "this failure is not your fault." That gap is our product — and they have
every piece of plumbing needed to close it. 100 reports are already in memory;
they'd need commit SHAs in the aggregate and a classifier. Call it 200 lines.

**Watch for:** any commit into `run-insights.ts` that adds a SHA field, or a new
report type with "verdict", "attribution", or "baseline" in the name.

### rwx-research/captain

99★ · Go · MIT · active (pushed 2026-07-29) · `homepage: rwx.com/captain`

README says it "can detect and quarantine flaky tests." The open-source local
backend does not detect anything:

```go
// internal/backend/local/run_configuration.go
func makeRunConfiguration(flakes, quarantines []yaml.Node, modTime time.Time) ...
```

It reads hand-maintained `flakes.yaml` / `quarantines.yaml`, populated by
`captain add flake --file ... --description ...` (`cmd/captain/addAndRemove.go:57`).
Actual detection lives behind `internal/backend/remote/client.go`, which bearer-
tokens into RWX's API. **The OSS CLI is the client for a paid SaaS.**

On our axis, Captain-without-cloud is weaker than flakesieve. On every other
axis it is well ahead, and these are things our roadmap treats as future work:

- **18 native framework parsers** (`internal/parsing/`) — RSpec, Jest,
  Playwright, Cypress, pytest, xUnit, ExUnit, Ginkgo, PHPUnit, minitest,
  Cucumber, Karma, Mocha, Vitest, unittest… We have JUnit XML only.
- **Targeted retries** (`internal/targetedretries/`, 17 substitution files) —
  regenerates a framework-specific command that re-runs only the failed tests.
- **Quarantine that changes the exit code** — shipped; ours is a roadmap item.
- **5 CI providers** (`internal/providers/`) — GitHub, GitLab, Buildkite,
  CircleCI, Mint. Ours is a roadmap item.
- **Test partitioning** for parallel execution.

It does not post PR comments. It emits markdown for `$GITHUB_STEP_SUMMARY`.
Different delivery, CLI-first audience — so it competes for the same budget line
but not the same slot in a workflow file.

**Steal from them:** the parser-per-framework layout and, eventually, targeted
retries. Their `internal/parsing/` directory is a good model for what our
`src/parsers/` should grow into.

---

## Tier 2 — owns the slot we want, doesn't do our job

These are the incumbents in "test results appear in my PR." None of them do
history or flake attribution, but they are what a team already has installed, so
they are the thing we have to be *added alongside* or *replace*.

| Repo | ★ | What it does | Flake support |
|---|---|---|---|
| `dorny/test-reporter` | 1174 | Test results as checks | None. No history at all. |
| `EnricoMi/publish-unit-test-result-action` | 748 | Results as PR comment + checks | None in README. |
| `test-summary/action` | 440 | Compact summary block | None. |
| `mikepenz/action-junit-report` | 424 | JUnit → PR check | `flaky_summary` input — reads JUnit `flakyFailure`/`rerunFailure` elements, i.e. surefire reruns within one run. Retry-based, no history. |
| `daun/playwright-report-summary` | 80 | Playwright → PR comment | None. |

**Implication:** our comment competes for space with one of these. Being
*complementary* ("keep dorny for the results table, add flakesieve for the
verdict") is an easier sell than replacement, and worth saying explicitly in the
README.

---

## Tier 3 — same idea, needs a server

Every one of these validates the demand and confirms the positioning. All of them
require infrastructure we deliberately don't.

- **anchorpipe/anchorpipe** (3★, AGPL-3.0 + commercial licence, active) —
  "flaky test management platform," ML-based heuristics, PR-native feedback.
  Requires Docker Compose, PostgreSQL, Redis, RabbitMQ. Open-core.
- **thc1006/flakeguard** (0★, Apache-2.0) — GitHub App, Fastify + Prisma +
  Postgres 16 + BullMQ/Redis. Quarantine suggestions, flakiness scoring.
- **aliuyar1234/flakeguard** (1★, Go, MIT) — detects flakes from Actions reruns;
  action uploads to a self-hosted server with an API key.
- **Absence0760/project-flakey** (3★, MIT) — self-hosted CI-agnostic dashboard,
  multi-tenant Postgres with row-level security, flip-count flake detection.
- **buildpulse/buildpulse-action** (7★) — thin uploader for the BuildPulse SaaS.
- **Pritahi/falsky-action** (1★) — uploads JUnit XML to a hosted "Trust Engine"
  API, posts Bayesian trust scores as a PR comment. Closest *framing* to ours;
  entirely dependent on their endpoint.
- **flexport/quarantine** (64★, Ruby, still maintained) — RSpec + rspec-retry,
  stores test statuses in **DynamoDB**. Notably, its config is
  `quarantine_record_tests = ENV["CI"] && ENV["BRANCH"] == "master"` — the exact
  "record only on the default branch" insight we built in. Independent
  confirmation that the invariant is right.

**Commercial:** Trunk Flaky Tests (free for OSS and ≤5 committers — the most
serious threat to adoption, since "free" removes the usual objection), BuildPulse,
Datadog Test Optimization, Gradle Develocity, Launchable.

## Tier 4 — not competitors

- **ollieb89/test-results-reporter** (1★, 737 LOC, last pushed 2026-04-15) —
  flake detection is 18 lines (`src/index.ts:98-116`): failed now, passed in one
  user-persisted snapshot. No rates, no runs, no commits. Also `core.setFailed`
  on any failure, so no quarantine path.
- **Staffbase/github-action-find-flaky-tests** (1★, Python, single file) —
  scrapes check-run annotations over a date range on one branch, posts to Slack
  weekly. No PR verdicts, no per-test history.
- Assorted <5★ projects: `semisse/subcat` (re-runs a workflow 5× to hunt flakes),
  `smartcontractkit/quarantine`, `Tesorio/pytest-xflaky`,
  `DeploySentinel/cypress-quarantine`. Framework- or workflow-specific.

Also worth knowing: **tenki.cloud published a blog post describing our exact
same-SHA algorithm as a DIY recipe** — parse results, check whether a test that
failed also passed on the same commit SHA, keep a JSON registry in the repo,
promote to quarantine after N hits. The idea is discoverable. What isn't
available anywhere is a packaged, zero-setup implementation of it. Packaging is
the moat, not the insight.

---

## What we should take from this

Feeding [docs/roadmap.md](docs/roadmap.md):

1. **Cold start is our biggest structural weakness.** Retry-based tools flag a
   flake on run #1 with zero history. We need "a few dozen runs." Reading
   JUnit's `flakyFailure`/`rerunFailure` elements as a *supplementary* signal
   would give day-one output without weakening the historical verdict.
2. **Format coverage is our biggest surface-area weakness.** Captain has 18
   parsers; we have one.
3. **Distribution is the most urgent item.** The algorithm advantage is
   copyable; not being installable is fatal. npm + Marketplace beats any feature.
4. **Position as complementary to the Tier 2 reporters**, not as a replacement.
5. **Quarantine (exit-code control) is table stakes** — Captain, Trunk,
   BuildPulse and flexport all have it. It is the thing that converts "nice
   report" into "saves me a re-run."
6. **Don't chase ctrf on reporting.** 25 report types and AI summaries is a lost
   fight. The one sentence they cannot say is the whole pitch: *flakesieve tells
   you whether the red X is your bug.*
