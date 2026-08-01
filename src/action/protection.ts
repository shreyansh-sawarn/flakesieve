/**
 * Warn when the history branch is unprotected.
 *
 * The history branch holds accumulated run data that cannot be regenerated:
 * delete it and every recorded run is gone, taking every verdict with it. It is
 * also the one branch a user never looks at, so an accidental cleanup of "that
 * weird orphan branch" is a realistic way to lose months of data silently.
 *
 * This deliberately only *reports*. Applying protection would require
 * `administration: write` — the permission to change repository settings — which
 * is far too much for a test-analytics tool to ask for, and far too much to hand
 * a third-party action that runs on every build.
 */

/** Ruleset rule types that meaningfully protect the history branch. */
const REQUIRED_RULES = ['deletion', 'non_fast_forward'] as const;

export type ProtectionRule = (typeof REQUIRED_RULES)[number];

/** Which of the rules we care about are absent from the effective rule list. */
export function missingProtections(activeRuleTypes: string[]): ProtectionRule[] {
  const active = new Set(activeRuleTypes);
  return REQUIRED_RULES.filter((r) => !active.has(r));
}

const LABELS: Record<ProtectionRule, string> = {
  deletion: 'deletion',
  non_fast_forward: 'force-push',
};

/**
 * Build the warning shown when protection is missing.
 *
 * Includes a runnable command rather than prose. A warning that tells someone
 * they have a problem without telling them how to fix it just becomes noise
 * they learn to scroll past.
 */
export function protectionWarning(
  repo: string,
  branch: string,
  missing: ProtectionRule[],
): string {
  const what = missing.map((m) => LABELS[m]).join(' and ');

  return [
    `The history branch '${branch}' is not protected against ${what}.`,
    '',
    'It holds every recorded run. If it is deleted, all flakesieve history is',
    'lost permanently and verdicts restart from zero.',
    '',
    'To protect it:',
    '',
    `  gh api -X POST repos/${repo}/rulesets \\`,
    `    -f name='flakesieve history' -f target=branch -f enforcement=active \\`,
    `    -F 'conditions[ref_name][include][]=refs/heads/${branch}' \\`,
    `    -F 'rules[][type]=deletion' -F 'rules[][type]=non_fast_forward'`,
    '',
    'Do not add a pull-request rule to this branch — flakesieve pushes to it',
    'directly on every default-branch run, and a PR requirement would break it.',
    '',
    'Set `protection-check: false` to silence this.',
  ].join('\n');
}

export interface RulesReader {
  (owner: string, repo: string, branch: string): Promise<string[] | null>;
}

/**
 * Check the branch and return a warning string, or null if all is well.
 *
 * `readRules` returning null means "could not determine" — a missing token
 * scope, a private repo, or a plan without rulesets. In that case we say
 * nothing at all rather than warn about a problem that may not exist.
 */
export async function checkProtection(
  readRules: RulesReader,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  const rules = await readRules(owner, repo, branch);
  if (rules === null) return null;

  const missing = missingProtections(rules);
  if (missing.length === 0) return null;

  return protectionWarning(`${owner}/${repo}`, branch, missing);
}
