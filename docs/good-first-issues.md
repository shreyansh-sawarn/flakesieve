# Good first issues

Pre-written, genuinely small, genuinely useful. Copy any of these into a GitHub issue
and label it `good first issue`.

Each says what to change, which files to touch, and how to know it worked.

---

### 1. Add a TRX parser (.NET test results)

`dotnet test --logger trx` emits TRX, not JUnit, so .NET users cannot use flakesieve.

**Files:** new `src/parsers/trx.ts`, register in `src/parsers/index.ts`, fixture in
`test/fixtures/`, tests in `test/`.
**Done when:** a real TRX file parses into correct `TestCase[]` with pass/fail/skip
mapped and ids stable across runs.
**Reference:** `src/parsers/junit.ts` is the template.

---

### 2. Add a TAP parser

TAP is the output format for many Perl, Node and C test runners.

**Files:** new `src/parsers/tap.ts` + registration + fixture + tests.
**Done when:** `ok` / `not ok` / `# SKIP` lines map to passed / failed / skipped, and
subtests nest into the suite path.

---

### 3. Read run identity from GitLab CI

`src/cli.ts` reads `GITHUB_SHA`, `GITHUB_REF_NAME` and `GITHUB_RUN_ID`. On GitLab all
three are unset, so every run is labelled `unknown` — which silently breaks same-commit
contradiction detection, since every run looks like the same commit.

**Files:** `src/cli.ts` (extract a small `detectCI()` helper).
**Done when:** `CI_COMMIT_SHA`, `CI_COMMIT_REF_NAME` and `CI_PIPELINE_ID` are used when
present, with GitHub still taking precedence on GitHub, and unit tests cover both.

---

### 4. Post and update the PR comment in the action

`action.yml` renders the comment to a file but never posts it. It should find an
existing comment by `COMMENT_MARKER` and update it in place, creating one only if none
exists — never a new comment per push.

**Files:** `action.yml`, likely a small `src/action.ts`.
**Done when:** pushing twice to a PR leaves exactly one flakesieve comment, updated.

---

### 5. Push history back to the orphan branch

The `record` input exists but does nothing. It should commit the updated history file
to the history branch and force-push.

**Files:** `action.yml`.
**Done when:** consecutive default-branch runs accumulate history, and the first run on
a repo with no history branch creates it.
**Careful:** must only ever touch the history branch. See
[history-storage.md](history-storage.md).

---

### 6. Warn when test ids churn between runs

A renamed test loses its history, which is correct. But a *runner config change* can
rename every id at once, silently resetting all history with no warning.

**Files:** `src/core/flake.ts`.
**Done when:** if more than ~50% of ids in the current run are unseen, the report
carries a warning that ids may have changed shape, and the renderers surface it.

---

### 7. Compact the history file

At ~2,000 tests × 200 runs the JSON reaches roughly 12 MB. Every run rewrites it.

**Files:** `src/core/history.ts`, `docs/history-storage.md`.
**Done when:** the format stores a test-id dictionary once and references tests by
integer index, `loadHistory` still reads version 1 files, and a stated size reduction is
measured on a generated fixture.
**Note:** this is the largest of these — take it if you want something meatier.

---

### 8. `--json-schema` flag

Emit the JSON schema for the `--format json` report so people can build on it safely.

**Files:** `src/cli.ts`, new `src/report/schema.ts`.
**Done when:** `flakesieve --json-schema` prints valid JSON Schema matching `Report`.

---

### 9. Record the demo GIF

The README points at `docs/media/demo.gif`, which does not exist yet. This is the
highest-leverage non-code contribution available.

**Done when:** a short GIF shows a red PR → flakesieve comment → "known flake" →
merge. Use `scripts/seed-demo.mjs` for realistic data.
