import { contradictions, type Finding, type Report } from '../core/types.js';

/**
 * Marker used to find and update flakesieve's own comment instead of posting a
 * new one on every push. Changing this string orphans every existing comment.
 */
export const COMMENT_MARKER = '<!-- flakesieve:pr-comment -->';

const MARKERS = {
  real: '🔴',
  flaky: '🟡',
  broken: '⚫',
  unknown: '⚪',
  healthy: '🟢',
} as const;

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function sparkline(outcomes: string): string {
  return outcomes ? `\`${outcomes}\`` : '—';
}

function row(f: Finding): string {
  const s = f.stats;
  const verdict = `${MARKERS[f.verdict]} ${f.verdict}`;
  const rate =
    s.totalRuns === 0 ? '—' : `${pct(s.failureRate)} of ${s.totalRuns}`;
  // A contradiction in the run being analyzed is not in `stats` yet — it is the
  // reason for the verdict on a test with no history at all, so a bare 0 here
  // would make the verdict look unsupported.
  const proof = f.contradictedInRun
    ? `${contradictions(s) + 1} (1 this run)`
    : String(contradictions(s));
  return `| \`${s.id}\` | ${verdict} | ${rate} | ${proof} | ${sparkline(s.recentOutcomes)} |`;
}

/**
 * Render the PR comment.
 *
 * Returns `null` when there is nothing worth saying — the action then skips
 * posting entirely. See docs/pr-comment-format.md for why the empty state
 * stays silent.
 */
export function renderComment(report: Report): string | null {
  const { likelyReal, knownFlakes, alreadyBroken, insufficientHistory } = report;

  const failing =
    likelyReal.length +
    knownFlakes.length +
    alreadyBroken.length +
    insufficientHistory.length;

  if (failing === 0) return null;

  const out: string[] = [COMMENT_MARKER, ''];

  // Real failures always lead, however few — burying one under forty flakes is
  // the failure mode this whole tool exists to prevent.
  if (likelyReal.length > 0) {
    out.push(
      `### 🔴 ${likelyReal.length} likely real ${plural(likelyReal.length, 'failure')}`,
      '',
    );
    for (const f of likelyReal) {
      out.push(`\`${f.stats.id}\``);
      out.push(
        `First time this test has failed in ${f.stats.totalRuns} runs. This one is probably yours.`,
      );
      if (f.failureMessage) {
        out.push('', '```', f.failureMessage.slice(0, 500), '```');
      }
      out.push('');
    }
  }

  if (insufficientHistory.length > 0) {
    out.push(
      `### ⚪ ${insufficientHistory.length} ${plural(insufficientHistory.length, 'failure')} with thin history`,
      '',
      'Not enough past runs to say whether these are flaky. Treat as real for now.',
      '',
    );
    for (const f of insufficientHistory) {
      out.push(`- \`${f.stats.id}\` — seen in ${f.stats.totalRuns} prior runs`);
    }
    out.push('');
  }

  const suppressed = knownFlakes.length + alreadyBroken.length;
  if (suppressed > 0) {
    const summary = [
      knownFlakes.length > 0
        ? `🟡 ${knownFlakes.length} known ${plural(knownFlakes.length, 'flake')} suppressed`
        : null,
      alreadyBroken.length > 0
        ? `⚫ ${alreadyBroken.length} already broken on main`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

    out.push(
      '<details>',
      `<summary>${summary}</summary>`,
      '',
      '| Test | Verdict | Failure rate | Contradictions | Recent |',
      '|---|---|---|---|---|',
      ...[...knownFlakes, ...alreadyBroken].map(row),
      '',
    );

    for (const f of alreadyBroken) {
      out.push(
        `\`${f.stats.id}\` has been failing for ${f.stats.consecutiveFailures} consecutive runs — it did not start with this PR.`,
        '',
      );
    }

    out.push('</details>', '');
  }

  out.push(
    `<sub>flakesieve · ${report.runsAnalyzed} runs analyzed · ${report.testsTracked} tests tracked</sub>`,
  );

  return out.join('\n');
}
