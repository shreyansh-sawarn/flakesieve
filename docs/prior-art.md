# Prior art

Where to look before building something, and the rules for looking.

Most of what flakesieve needs has been solved before somewhere — usually badly
for our purposes, but well enough that reading it saves a day. This is the index.
The verdicts drawn from these projects live in
[competitive-landscape.md](competitive-landscape.md); the work they feed lives in
[roadmap.md](roadmap.md).

## Look here before you build

| Task | Where | Why |
|---|---|---|
| A new **report parser** | [dorny/test-reporter](https://github.com/dorny/test-reporter) → `src/parsers/` | 12 formats: dotnet-trx, golang-json, rspec-json, mocha-json, dart-json, phpunit, python-xunit, swift-xunit and more. |
| **Parser test fixtures** | same repo → `__tests__/fixtures/` (46 files), and [EnricoMi/publish-unit-test-result-action](https://github.com/EnricoMi/publish-unit-test-result-action) → `python/test/files/` (371 files) | The hard part of a JUnit parser is malformed real-world input, not the happy path. Between them these are the cheapest way to get that right. |
| The **cold-start rerun signal** | [mikepenz/action-junit-report](https://github.com/mikepenz/action-junit-report) → `src/testParser.ts:668-700` | The only action that reads JUnit `flakyFailure` / `rerunFailure` elements. |
| **Framework parser architecture** | [rwx-research/captain](https://github.com/rwx-research/captain) → `internal/parsing/` | 18 frameworks, one self-contained file each. The shape `src/parsers/` should grow into. |
| **Targeted retries** | same repo → `internal/targetedretries/` | Re-running only what failed, per framework. |
| **Quarantine semantics** | same repo, and [flexport/quarantine](https://github.com/flexport/quarantine) | Exit-code control. flexport's config is also independent confirmation that recording only on the default branch is correct. |
| The **closest competitor's internals** | [ctrf-io/github-test-reporter](https://github.com/ctrf-io/github-test-reporter) | `src/ctrf/core/src/methods/run-insights.ts`, `src/ctrf/metrics.ts`, `src/github/helpers.ts`. |
| The **CTRF schema** | [ctrf-io/ctrf](https://github.com/ctrf-io/ctrf) | If we support it as an input format. |
| **Product shape and UI** | [anchorpipe/anchorpipe](https://github.com/anchorpipe/anchorpipe) | ⚠️ AGPL-3.0 — read the rules below before opening it. |

Everything above is MIT or Apache-2.0 and safe to read closely, **except
anchorpipe**.

Maintainers keep clones of these in a `_reference/` directory beside the repo,
indexed by its own README. That is a local convenience, not a requirement — the
upstream links above are the same thing.

## Rules

**Never paste third-party code into this repo, whatever its licence.** Reading
prior art is normal engineering; copying it is not, and attribution does not make
it not-copying. Everything we ship should be ours.

### anchorpipe is AGPL-3.0. flakesieve is MIT.

Those are incompatible in one direction: AGPL code cannot flow into an MIT
project. We read it deliberately, as a **design and product-shape reference
only**.

1. **Never copy code from it.** Not a function, not a type, not a schema model,
   not a chunk of JSX. Not "with the names changed" — copyright covers
   expression, and renaming variables does not launder it.
2. **Ideas and architecture are fair game.** Algorithms and system designs are
   not copyrightable. "Score flakiness from four weighted sub-signals" is an
   idea; their implementation of it is expression. Take the first, never the
   second.
3. **Don't write flakesieve code with their file open.** Read it, close it, write
   the idea down in your own words in [roadmap.md](roadmap.md), then implement
   from that description. That is what makes independent derivation defensible.
4. **Cite the idea, not the code.** Say so plainly in the commit or PR —
   "independently implemented; concept noted from anchorpipe's schema". Silence
   looks worse than attribution if anyone ever asks.
5. **AGPL §13 is why this is stricter than GPL.** If AGPL code reaches users over
   a network, the whole work must be offered under AGPL. flakesieve runs inside
   other people's CI; contamination would not be theoretical.
6. **Never vendor, submodule, or `npm install` it.**

If you are unsure whether something crosses the line: it crosses the line. Write
the idea down and implement it from scratch.

Two ideas have been taken this way so far, and exist as roadmap items rather than
code: environment-hashed results, and decomposing the verdict into volatility /
recency / clustering sub-signals. Worth knowing that anchorpipe's detection
engine is **unimplemented upstream** — the value there is the data model and the
app shell, not working code.
