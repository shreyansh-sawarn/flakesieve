import type { Finding, Report } from '../core/types.js';

// Minimal ANSI helpers. Not worth a dependency, and colours are disabled
// wholesale when the stream is not a TTY or NO_COLOR is set.
const enabled =
  process.env.NO_COLOR === undefined && process.stdout.isTTY === true;

const wrap = (code: string) => (s: string) =>
  enabled ? `\x1b[${code}m${s}\x1b[0m` : s;

const dim = wrap('2');
const bold = wrap('1');
const red = wrap('31');
const yellow = wrap('33');
const gray = wrap('90');

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function line(f: Finding, colour: (s: string) => string): string[] {
  const s = f.stats;
  const detail: string[] = [];

  if (s.totalRuns > 0) {
    detail.push(`fails ${pct(s.failureRate)} of ${s.totalRuns} runs`);
  }
  if (s.sameShaContradictions > 0) {
    const n = s.sameShaContradictions;
    detail.push(`${n} same-commit contradiction${n === 1 ? '' : 's'}`);
  }
  if (s.recentOutcomes) {
    detail.push(s.recentOutcomes);
  }

  return [
    `     ${colour(s.id)}`,
    `        ${gray(detail.join(' · '))}`,
  ];
}

export function renderTerminal(report: Report): string {
  const out: string[] = [
    '',
    `  ${bold('flakesieve')}  ${gray(`·  ${report.runsAnalyzed} runs analyzed  ·  ${report.testsTracked} tests tracked`)}`,
    '',
  ];

  if (report.likelyReal.length > 0) {
    out.push(`  🔴 ${bold(`Likely real failures (${report.likelyReal.length})`)}`);
    for (const f of report.likelyReal) {
      out.push(`     ${red(f.stats.id)}`);
      out.push(
        `        ${gray(`first failure ever seen in ${f.stats.totalRuns} runs`)}`,
      );
    }
    out.push('');
  }

  if (report.insufficientHistory.length > 0) {
    out.push(
      `  ⚪ ${bold(`Failures with thin history (${report.insufficientHistory.length})`)}`,
    );
    for (const f of report.insufficientHistory) {
      out.push(`     ${f.stats.id}`);
      out.push(`        ${gray(`only ${f.stats.totalRuns} prior runs — treat as real`)}`);
    }
    out.push('');
  }

  if (report.knownFlakes.length > 0) {
    out.push(`  🟡 ${bold(`Known flakes (${report.knownFlakes.length})`)}`);
    for (const f of report.knownFlakes) out.push(...line(f, yellow));
    out.push('');
  }

  if (report.alreadyBroken.length > 0) {
    out.push(
      `  ⚫ ${bold(`Already broken on main (${report.alreadyBroken.length})`)}`,
    );
    for (const f of report.alreadyBroken) {
      out.push(`     ${f.stats.id}`);
      out.push(
        `        ${gray(`failing for ${f.stats.consecutiveFailures} consecutive runs`)}`,
      );
    }
    out.push('');
  }

  const failing =
    report.likelyReal.length +
    report.knownFlakes.length +
    report.alreadyBroken.length +
    report.insufficientHistory.length;

  if (failing === 0) {
    out.push(`  ${dim('No failures.')}`, '');
  }

  return out.join('\n');
}

/** Ranked flake leaderboard for `flakesieve stats`. */
export function renderStats(report: Report, top: number): string {
  const out: string[] = [
    '',
    `  ${bold('flakesieve')} ${gray(`· flakiest tests over ${report.runsAnalyzed} runs`)}`,
    '',
  ];

  if (report.topFlaky.length === 0) {
    out.push(`  ${dim('No flaky tests detected.')}`, '');
    return out.join('\n');
  }

  for (const f of report.topFlaky.slice(0, top)) {
    const s = f.stats;
    out.push(
      `  ${yellow(pct(s.failureRate).padStart(4))}  ${s.id}`,
      `        ${gray(`${s.failures}/${s.totalRuns} failed · ${s.sameShaContradictions} contradictions · ${s.recentOutcomes}`)}`,
    );
  }
  out.push('');

  return out.join('\n');
}
