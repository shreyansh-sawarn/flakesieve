# History storage

Flake detection needs to know what a test did across many runs. That requirement is
why every competing tool is a hosted service with a database, and it is the one design
decision that determines whether flakesieve can exist without a server.

## The approach: an orphan branch

History lives as a single JSON file on a dedicated orphan branch, by default
`flakesieve-history`. After each run on the default branch, CI appends the run and
pushes the branch.

An orphan branch has no shared ancestry with `main`, so:

- it never appears in normal `git log`, blame, or diffs;
- it does not bloat working-tree checkouts — nothing on it is ever checked out
  alongside your code;
- it is invisible to everything except the tool that writes it;
- deleting the branch is a complete uninstall.

### The push is not a force-push

Two runs on the default branch can finish at once. Both read the same tip, both
build a commit on it, and one of them loses the race. flakesieve does **not**
pass `--force` (`src/action/history-branch.ts`): the loser's push is rejected, it
says so, and that single run goes unrecorded. Overwriting would silently discard
the winner's run instead, which is strictly worse — and it is the one thing that
would make the branch protection recommended below impossible to satisfy.

### The fetch is not shallow

The history branch is fetched at full depth. A `--depth=1` fetch leaves the local
repository shallow, and a commit built on a shallow base is rejected with
`shallow update not allowed`. The branch holds one small file and its whole
history is a chain of one-file commits, so the full fetch costs almost nothing.

## Why not the alternatives

| Option | Why not |
|---|---|
| Commit to `main` | A commit on every CI run. Pollutes history and triggers CI recursively. |
| GitHub Actions cache | Evicted after 7 days of no access, and capped at 10 GB per repo. History would silently vanish. |
| Workflow artifacts | Expire (90 days default), and listing across runs needs extra API calls. |
| Release assets | Not versioned, awkward to diff, wrong semantic tool. |
| A database | The thing we are specifically avoiding. |

The orphan branch is the only option that is durable, free, self-hosted, and diffable.

## Protect the branch

**Do this once, on any repo using flakesieve.**

The history branch holds accumulated run data that cannot be regenerated. Delete it
and every recorded run is gone, taking every verdict with it — you restart from zero
and get no useful output for weeks. It is also the branch nobody ever looks at, which
makes it exactly the kind of thing that gets swept up in a "clean up old branches"
pass.

```bash
gh api -X POST repos/OWNER/REPO/rulesets \
  -f name='flakesieve history' -f target=branch -f enforcement=active \
  -F 'conditions[ref_name][include][]=refs/heads/flakesieve-history' \
  -F 'rules[][type]=deletion' -F 'rules[][type]=non_fast_forward'
```

That blocks deletion and force-pushes while still allowing the normal pushes
flakesieve makes on every default-branch run.

> **Do not add a pull-request rule to this branch.** flakesieve writes to it directly
> with `GITHUB_TOKEN`; requiring a PR would break recording entirely.

The action checks this after each successful record and warns if protection is
missing. It only ever reports — applying protection would require
`administration: write`, the permission to change repository settings, which is far
more than a test-analytics tool should ask for and far more than you should hand to a
third-party action that runs on every build. Silence the check with
`protection-check: false`.

Note the check reads *rulesets*. If you protect the branch with classic branch
protection instead, the warning may still appear; that is a false positive, and
`protection-check: false` is the right response.

## File format

```json
{
  "version": 2,
  "updatedAt": "2026-08-01T12:00:00.000Z",
  "maxRuns": 200,
  "tests": [
    "auth/SessionSpec › refreshes token",
    "auth/SessionSpec › rejects bad password"
  ],
  "runs": [
    {
      "runId": "17293847",
      "commitSha": "a1b2c3d",
      "branch": "main",
      "timestamp": "2026-08-01T11:58:00.000Z",
      "results": "fp"
    }
  ]
}
```

Only identity and outcome are stored. Durations and failure messages are dropped —
they are large, and nothing in the analysis reads them.

Test ids are interned once into `tests`, and each run's `results` is a positional
string: character *i* is the outcome of `tests[i]`. Codes are

| Code | Meaning |
|---|---|
| `p` | passed |
| `f` | failed |
| `s` | skipped |
| `c` | failed **and** passed within this one run — see [why that matters](#within-run-contradictions) |
| `-` | the test did not appear in this run at all |

### Why not repeat the ids

Version 1 stored `results` as an object keyed by the full test id, in every run.
Test ids are long, and 200 runs meant 200 copies of every one of them. Measured on
a generated fixture of 2,000 tests × 200 runs with realistic ids:

| | Raw JSON | gzipped |
|---|---|---|
| v1 — id repeated per run | 34.99 MB | 1.20 MB |
| v2 — interned + positional | 0.57 MB | 0.02 MB |

**61× smaller**, and that file is fetched and pushed on every recorded CI run.

Version 1 files are read and upgraded automatically; the next recorded run writes
version 2. Nobody loses accumulated history to the change.

### Within-run contradictions

The `c` code exists because a test that fails and then passes *inside a single
run* — a runner retry, or two shards disagreeing — has proved it is
non-deterministic without needing a second run at all. Same commit, same machine,
same execution, two answers.

That matters most on day one. The cross-run same-commit signal needs dozens of
runs before it can say anything; this one works immediately, which is the
difference between a tool that is useful on install and one that is useless for a
month. `c` counts against the failure rate, but never toward a "broken" streak: a
test that still passes sometimes is not broken.

## Retention

`maxRuns` (default 200) caps the file. Once exceeded, the oldest runs are dropped —
and with them, any test id no longer mentioned by a surviving run. Without that,
every test ever renamed or deleted would keep costing bytes forever. Ids that
survive keep their position, so the diff between two versions of the file stays
small.

200 runs is enough to measure a 1% flake rate with reasonable confidence and keeps the
file small. Teams merging hundreds of times a day may want more; teams merging weekly
should probably lower it, since a year-old run says little about today's test suite.

Contradictions are counted over a shorter window still — the most recent 100 runs.
Proof of non-determinism does not expire on its own, but its relevance does: a flake
that was fixed a hundred runs ago must stop excusing new failures, or it would go on
absorbing genuine regressions in that test forever.

## Why raw runs instead of running totals

Aggregates are recomputed from raw runs on every invocation rather than maintained
incrementally. It costs a pass over the history, but:

- changing a classification rule applies retroactively to all existing data;
- there is no counter that can silently drift out of sync with reality;
- the stored file stays a plain, auditable log rather than derived state.

If the recompute ever becomes the bottleneck, the fix is a cached aggregate keyed on
the tip commit of the history branch — not incremental counters.

## Only record on the default branch

Recording PR runs would poison the baseline: a PR that legitimately breaks a test
would teach flakesieve that the test fails sometimes, and it would start reporting a
genuine regression as a flake.

The `record` input therefore defaults to `false`, and the recommended workflow enables
it only on pushes to the default branch.

**This is also enforced in code.** The action refuses to record on a
`pull_request` event, and on a push to any branch that is not the repository
default, warning instead of writing. Leaving it to a YAML expression the user has
to copy correctly was a footgun aimed at the one file that cannot be regenerated:
the damage is silent, cumulative, and only shows up much later as verdicts that
quietly stopped being trustworthy. See `src/action/record-guard.ts`.
