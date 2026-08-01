# Releasing

Cutting a release is one command. Everything else is automated by
[.github/workflows/release.yml](../.github/workflows/release.yml).

```bash
npm version patch && git push --follow-tags
```

`npm version` bumps `package.json`, commits it, and creates the matching tag.
Pushing the tag triggers the release workflow, which:

1. checks the tag matches `package.json` — a mismatch publishes the wrong version
   to npm under a right-looking git tag, and the two can never be reconciled;
2. runs typecheck, tests and the build;
3. rebuilds `action-dist/` and fails if the committed bundle is stale, because
   users consume that bundle straight from the tag;
4. packs the tarball, installs it into an empty project and runs the binary, so a
   missing shebang or an unbuilt `dist/` is caught before publishing;
5. publishes to npm with provenance;
6. moves the major tag (`v0`) to the new release;
7. creates the GitHub release with generated notes.

Use `minor` or `major` instead of `patch` as appropriate. Pre-1.0, a breaking
change is a `minor` bump.

## One-time setup

### npm

The workflow needs an npm automation token in `NPM_TOKEN`.

1. On npmjs.com: **Access Tokens → Generate New Token → Granular Access Token**.
   Scope it to the `flakesieve` package with **Read and write**, and set an
   expiry. A classic *Automation* token also works.
2. Add it as a repository secret named `NPM_TOKEN`
   (**Settings → Secrets and variables → Actions**).

The first publish has to create the package, so the token needs account-level
write until `flakesieve` exists; narrow it to the package afterwards.

### The Actions Marketplace

Listing is a manual step in the GitHub UI and cannot be automated. Do it once,
after the first release exists:

1. Open the release created by the workflow.
2. **Edit release** → tick **Publish this Action to the GitHub Marketplace**.
3. Accept the terms, pick categories — *Continuous integration* and *Testing* —
   and save.

Later releases are listed automatically once the action is on the Marketplace.

Requirements GitHub enforces, all currently satisfied: `action.yml` at the
repository root, a unique `name`, a `description`, `branding.icon` and
`branding.color`, and a README.

## The major tag

Users pin `uses: shreyansh-sawarn/flakesieve@v0`, which is a tag that moves to
the newest release in that major. The workflow force-pushes it on every release.

This is the standard convention for actions, and the reason it exists is that
nobody bumps a patch pin by hand — an action that requires it simply stays on the
version people first installed.

**Moving to `v1`** means the interfaces are stable enough that a breaking change
warrants a major bump. Until then `v0` is the honest pin, and the README says so.

## Version policy before 1.0

- `patch` — bug fixes, doc changes, new parsers.
- `minor` — new inputs or outputs, changed defaults, changed verdict rules.
  Anything that alters what a user sees in a PR comment belongs here, because it
  changes what they have learned to trust.
- The history file has its own schema version, independent of the package
  version. It is upgraded automatically on read and never resets a user's data.

## What is deliberately not automated

- **Publishing on merge to `main`.** Releases should be a decision, not a side
  effect of merging.
- **The Marketplace listing itself.** GitHub gates it behind an interactive
  checkbox, and pretending otherwise in a script would just fail confusingly.
