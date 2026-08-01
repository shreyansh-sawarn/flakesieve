export interface RecordContext {
  /** GitHub event name, e.g. `push` or `pull_request`. */
  eventName: string;
  /** Branch the run is against, already stripped of `refs/heads/`. */
  branch: string;
  /** The repository's default branch, when the event payload carries it. */
  defaultBranch?: string;
}

/**
 * Decide whether this run may be appended to the history baseline.
 *
 * Recording a pull request poisons the baseline: a PR that legitimately breaks a
 * test teaches flakesieve that the test "fails sometimes", and from then on it
 * reports genuine regressions in that test as known flakes. The damage is silent,
 * cumulative, and only visible much later as verdicts that quietly stop being
 * trustworthy.
 *
 * Until now the only thing preventing it was a YAML expression in the README that
 * the user had to copy correctly — a footgun aimed squarely at the one file that
 * cannot be regenerated. A misconfiguration should cost a warning, not the
 * baseline.
 *
 * Returns the reason for refusing, or null when recording is allowed.
 */
export function recordRefusal(ctx: RecordContext): string | null {
  if (ctx.eventName.startsWith('pull_request')) {
    return (
      `refusing to record: this is a ${ctx.eventName} run. ` +
      'Recording pull requests poisons the baseline — a PR that legitimately ' +
      'breaks a test would teach flakesieve that the test fails intermittently, ' +
      'and real regressions in it would be reported as known flakes. ' +
      "Set record to github.ref == 'refs/heads/" +
      (ctx.defaultBranch ?? 'main') +
      "' so it is only true on the default branch."
    );
  }

  // No default branch in the payload (some event types omit the repository
  // object). We cannot tell, so we do not block — a false refusal would stop a
  // correctly configured repo from ever building history, which is worse than
  // the risk it guards against.
  if (!ctx.defaultBranch) return null;

  if (ctx.branch !== ctx.defaultBranch) {
    return (
      `refusing to record: this run is on '${ctx.branch}', not the default ` +
      `branch '${ctx.defaultBranch}'. History is the baseline that PR failures ` +
      'are judged against, so it must only ever describe the default branch. ' +
      `Set record to github.ref == 'refs/heads/${ctx.defaultBranch}'.`
    );
  }

  return null;
}
