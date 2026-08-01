# Roadmap

The living plan. Tick items off here when they land — this file, not a separate
tracker, is where the state lives.

**Conventions**
- `- [ ]` not started · `- [~]` in progress · `- [x]` done (add the PR or commit)
- Each item says *why*, and cites the competitive finding driving it where there
  is one. Evidence lives in
  [competitive-landscape.md](competitive-landscape.md); where to read an existing
  implementation before building one is in [prior-art.md](prior-art.md).
- Reorder freely. The ordering below reflects the 2026-08-02 landscape survey:
  our classification advantage is real but copyable, so distribution and
  cold-start beat further algorithm work.

---

## P0 — Ship it

Nothing else matters if the tool cannot be installed. The algorithm advantage is
~120 lines and reproducible by any competent team in a weekend; the window is
open now.

- [ ] **Publish to npm.** `npx flakesieve` is in the README and does not work.
- [ ] **Publish to the GitHub Actions Marketplace.** Until then the README's
      `@v1` is a lie and users must pin a SHA.
- [ ] **Tag `v1` and set up the moving major tag** (`v1` → latest `v1.x`), the
      convention every action in Tier 2 follows.
- [ ] **Record the demo GIF.** `README.md:7` still has the TODO. Highest-leverage
      single asset in the README: red X → comment → "known flake, 37% over 200
      runs" → merge.
- [ ] **Repo metadata for discoverability** — topics (`flaky-tests`,
      `github-actions`, `test-analytics`), description, social preview. Search is
      how the Tier 3 projects get found at all.

## P1 — Close the structural gaps

### Cold start

Our worst structural weakness. Retry-based tools (ctrf, mikepenz, flexport) flag
a flake on run #1 with zero history; we report `unknown` for a few dozen runs and
a first-time user sees nothing useful.

- [ ] **Consume JUnit rerun elements as a supplementary signal.** `flakyFailure`
      and `rerunFailure` (surefire) and equivalent retry markers mean the runner
      already proved non-determinism within one run. Treat as evidence
      equivalent to a same-SHA contradiction — it is the same proof, observed
      within a run instead of across runs.
      **Constraint:** must not weaken the historical verdict or let a
      framework's retry setting override invariant 2 (current state outranks
      history). Needs its own tests.
- [ ] **Make the empty-history experience honest and useful.** On run 1, say what
      is happening and when it becomes useful, rather than a wall of `unknown`.
- [ ] **Bootstrap from existing artifacts (investigate).** ctrf backfills by
      walking prior workflow runs (`src/ctrf/metrics.ts:55-140`). A one-shot
      `flakesieve backfill` that does this *once* to seed the history branch
      would collapse cold start from weeks to minutes, without adopting their
      per-run cost. Scope first — the API budget is the risk.

### Format coverage

Captain ships 18 parsers (`internal/parsing/`); we ship one. `src/parsers/` is
designed for exactly this and is the documented good-first-issue.

- [ ] TRX (.NET)
- [ ] Playwright JSON
- [ ] Go `test2json`
- [ ] pytest JSON (`pytest-json-report`)
- [ ] Jest JSON
- [ ] TAP
- [ ] Cucumber JSON
- [ ] Allure
- [ ] **Consider reading CTRF.** ctrf-io is trying to make it the standard format
      and has adapters for most runners. Supporting it as an input is cheap
      coverage and costs us nothing strategically — the format is not the moat.

### Quarantine

Table stakes: Captain, Trunk, BuildPulse and flexport all have it. It is what
turns "nice report" into "saved me a re-run."

- [ ] **Auto-quarantine via exit code** — known flakes never fail the build.
      Already on the README roadmap. Design note: this is the first feature where
      being wrong actively hides a real bug, so invariant 1 (under-claim) binds
      harder here than anywhere else. Consider requiring a same-SHA contradiction
      — not just a rate — before a test is allowed to not fail the build.
- [ ] **Emit the quarantine list in a re-runnable form** so a follow-up job can
      run quarantined tests separately as a non-blocking check.

## P2 — Reach

- [ ] **CI adapters.** Run identity (SHA, branch, run id) is read from GitHub
      env vars in `src/cli.ts`; mapping other providers is small and
      self-contained. Captain supports 5 (`internal/providers/`).
  - [ ] GitLab CI
  - [ ] Buildkite
  - [ ] CircleCI
  - [ ] Jenkins
- [ ] **Non-GitHub history storage.** The orphan branch is git-native and works
      anywhere; only the *push* path is GitHub-shaped. Worth confirming it works
      on GitLab before claiming it.

## P3 — Depth

### A UI, without a server

A dashboard is the single most common thing every competitor has and we don't.
It does **not** require a backend: we already hold the full history as JSON in
the repo, so a generated static page is a complete solution. This is the version
of "have a UI" that is consistent with the invariants — nothing to host, nothing
to sign up for, no data leaving the repo.

- [ ] **`flakesieve report --html`** — render the history to a single
      self-contained HTML file: worst offenders, failure-rate trend, per-test
      pass/fail timeline, filter by suite. No external assets, no network calls.
- [ ] **Publish it to GitHub Pages from the history branch** as an opt-in step,
      so a team gets a real dashboard URL with zero infrastructure. This is the
      answer to "but Trunk has a dashboard."
- [ ] **Link the dashboard from the PR comment** so the comment stays terse and
      the depth is one click away.

For what such a dashboard chooses to surface, see [prior-art.md](prior-art.md) —
and read its licence rules first. **Look at what it displays, never at how it
renders. Write our own from scratch.**

### Signal quality

Ideas noted from a competitor's data model (see [prior-art.md](prior-art.md)) —
a schema, not an implementation, since theirs is unimplemented. To be built
independently from the descriptions below, not from their code.

- [ ] **Environment-aware flake detection.** Hash the CI environment (runner OS,
      shard index, node version, matrix key) alongside each result. A test that
      only fails on one shard or one OS is a different, more actionable finding
      than one that fails everywhere — and today we'd average the two together
      into a mushy rate. Likely the highest-value idea in this section.
- [ ] **Decompose the verdict into sub-signals** rather than one failure rate:
      volatility (how often it flips), recency (are the failures recent), and
      clustering (are they bunched in time). Would sharpen the flaky/broken
      boundary that `classify()` currently draws with a rate and a streak.
      **Constraint:** must not turn the verdict into an unexplainable score. The
      output has to stay something a developer can argue with — invariant 1
      still binds, and "score: 73" is not a reason to ignore a failing test.

### Other

- [ ] **`flakesieve stats` as a real report** — worst offenders, trend over time,
      something a team lead can act on. Currently thin next to ctrf's insights.
- [ ] **Failure-message clustering.** Group a flake's failures by message so
      "always times out" is distinguishable from "fails five different ways."
      Trunk sells this as "unique failure reasons"; it is genuinely useful and
      needs no server.
- [ ] **Configurable thresholds** — `DEFAULT_CONFIG` is not currently reachable
      from action inputs. Expose carefully; every knob is a way for a user to
      make the tool lie to them.
- [ ] **History compaction / size guard.** `maxRuns` trims to 200 runs. Confirm
      the file stays sane for a 10k-test monorepo and document the ceiling.
- [ ] **Coverage-based test selection** (README roadmap). Large, and Captain's
      partitioning is the prior art. Deliberately last.

## Not doing

Recorded so it doesn't get re-proposed.

- **A database, a hosted service, or any backend.** It is the reason the project
  exists. See AGENTS.md invariants. Note this rules out a *hosted* dashboard, not
  a UI — a generated static report is in P3 and is fully consistent with it.
- **Copying code from any AGPL prior art.** Ideas and architecture only. The
  rules are in [prior-art.md](prior-art.md) and they bind.
- **Competing with ctrf on report surface area.** 25 report types, Handlebars
  templates, AI summaries, Slack/Teams. Lost fight, and not our pitch.
- **Requesting `administration: write`** to apply branch protection ourselves.
- **Auto-filing issues / tickets for flakes.** Trunk's territory, needs
  integrations, dilutes the one-sentence pitch.

---

## Done

- [x] JUnit XML parsing — `src/parsers/junit.ts`
- [x] Flake classification: same-SHA contradictions + rate + broken streak —
      `src/core/flake.ts`
- [x] PR comment and terminal renderers — `src/report/`
- [x] GitHub Action that posts and updates the PR comment — `src/action/`
- [x] Orphan-branch history store, with lost-race handling instead of `--force` —
      `src/action/history-branch.ts:124`
- [x] Advisory branch-protection warning — `src/action/protection.ts`
- [x] Never fail the build when the PR comment cannot be posted (fork PRs get a
      read-only token) — commit `7c5c39a`
- [x] Dogfooding in CI via `uses: ./` — `.github/workflows/ci.yml`
- [x] Stale-bundle check so `action-dist/` cannot drift from source
- [x] Competitive survey of the space — [competitive-landscape.md](competitive-landscape.md)
- [x] `AGENTS.md` + `CLAUDE.md`
