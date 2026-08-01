# History storage

Flake detection needs to know what a test did across many runs. That requirement is
why every competing tool is a hosted service with a database, and it is the one design
decision that determines whether flakesieve can exist without a server.

## The approach: an orphan branch

History lives as a single JSON file on a dedicated orphan branch, by default
`flakesieve-history`. After each run on the default branch, CI appends the run and
force-pushes the branch.

An orphan branch has no shared ancestry with `main`, so:

- it never appears in normal `git log`, blame, or diffs;
- it does not bloat working-tree checkouts (`--depth=1` fetches only the tip);
- force-pushing it can never rewrite real project history;
- deleting the branch is a complete uninstall.

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
  "version": 1,
  "updatedAt": "2026-08-01T12:00:00.000Z",
  "maxRuns": 200,
  "runs": [
    {
      "runId": "17293847",
      "commitSha": "a1b2c3d",
      "branch": "main",
      "timestamp": "2026-08-01T11:58:00.000Z",
      "results": { "auth/SessionSpec › refreshes token": "f" }
    }
  ]
}
```

Only identity and outcome are stored. Durations and failure messages are dropped —
they are large, and nothing in the analysis reads them.

Status codes are single characters (`p` / `f` / `s`) purely for size. At 2,000 tests
and 200 runs that is roughly 12 MB of JSON, which git compresses well but is not
nothing. Compaction is a known open problem — see
[good-first-issues.md](good-first-issues.md).

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

## Retention

`maxRuns` (default 200) caps the file. Once exceeded, the oldest runs are dropped.

200 runs is enough to measure a 1% flake rate with reasonable confidence and keeps the
file small. Teams merging hundreds of times a day may want more; teams merging weekly
should probably lower it, since a year-old run says little about today's test suite.
