# PR comment format

The PR comment is the product. Almost everyone who ever hears about flakesieve will
see a screenshot of this comment before they see the README, and most will never read
the code. It gets designed first and changed carefully.

## Design rules

1. **Answer the only question the reader has, in the first line: _is this my fault?_**
   Everything else is supporting evidence.
2. **Never bury a real failure under flake noise.** Likely-real failures always render
   first, even when there is exactly one and forty known flakes.
3. **Show the evidence, not just the verdict.** `fails 37% of 184 runs` earns trust.
   `probably flaky` does not.
4. **One comment per PR, updated in place.** Never a new comment per push — that is the
   fastest way to get a bot muted.
5. **Collapse everything non-essential.** The default view fits on a phone screen.
6. **Say nothing when there is nothing to say.** If every test passed and no flake was
   suppressed, post no comment at all.

## Anatomy

````markdown
<!-- flakesieve:pr-comment -->
### 🔴 1 likely real failure

`checkout/CartTotals › applies bulk discount over 10 units`
First time this test has ever failed in 184 runs. This one is probably yours.

<details>
<summary>🟡 2 known flakes suppressed · ⚫ 1 already broken on main</summary>

| Test | Verdict | Failure rate | Same-commit contradictions | Recent |
|---|---|---|---|---|
| `auth/SessionSpec › refreshes token near expiry` | 🟡 flaky | 37% of 184 | 12 | `PPFPPPFPFPPP` |
| `search/IndexerSpec › reindexes within timeout` | 🟡 flaky | 8% of 184 | 3 | `PPPPPPPFPPPP` |
| `billing/InvoiceSpec › emits EU VAT line` | ⚫ broken | 100% of 23 | 0 | `FFFFFFFFFFFF` |

`billing/InvoiceSpec › emits EU VAT line` has been failing on `main` since a1b2c3d — it
did not start with this PR.

</details>

<sub>flakesieve · 184 runs analyzed · history at <code>flakesieve-history</code></sub>
````

The HTML comment marker on line 1 is how the action finds and updates its own comment.
Do not remove it, and do not change its text.

## The four verdicts

| Verdict | Marker | Meaning | Rule |
|---|---|---|---|
| Likely real | 🔴 | Failing now, no history of failing | `failures == 0` before this run |
| Flaky | 🟡 | Fails intermittently, independent of the change | same-SHA contradiction, or failure rate in `[flakeThreshold, brokenThreshold)` with passes present |
| Broken | ⚫ | Consistently failing, predates this PR | failure rate `>= brokenThreshold` |
| Unknown | ⚪ | Not enough history to judge | `totalRuns < minRuns` |

`unknown` is deliberately **not** rendered as reassuring. A test with 3 runs of history
gets reported as a plain failure with a note that history is thin. Under-claiming is
much cheaper than telling someone to ignore a real bug.

## The sparkline

`recentOutcomes` is the last N results, oldest → newest, one character each:

| Char | Meaning |
|---|---|
| `P` | passed |
| `F` | failed |
| `S` | skipped |
| `·` | test not present in that run |

Rendered in backticks so it stays monospaced and column-aligned. Twelve characters by
default — enough to see a pattern, short enough for mobile.

## Tone

Neutral and factual. The reader is already annoyed that CI is red; do not be cheerful
at them, and do not editorialize about their test suite.

- ✅ `First time this test has ever failed in 184 runs.`
- ❌ `Uh oh! Looks like you might have broken something! 😬`
- ❌ `This test is terribly written and should be rewritten.`

## Empty state

If there are no failures and no flakes were suppressed, post nothing. A bot that
comments "✅ all good" on every PR gets muted within a week, and then it is not there
on the day it matters.
