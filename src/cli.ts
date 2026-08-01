#!/usr/bin/env node
import { analyze, appendRun, emptyHistory } from './core/flake.js';
import { collectRun as collect } from './core/collect.js';
import { loadHistory, saveHistory } from './core/history.js';
import { renderComment } from './report/comment.js';
import { renderStats, renderTerminal } from './report/terminal.js';
import type { TestRun } from './core/types.js';

interface Args {
  command: string;
  report: string[];
  history: string;
  commit: string;
  branch: string;
  runId: string;
  top: number;
  record: boolean;
  failOnReal: boolean;
  format: 'terminal' | 'markdown' | 'json';
}

const USAGE = `
flakesieve — know which CI failures are real

Usage:
  flakesieve analyze [options]    Classify the current run's failures
  flakesieve stats   [options]    Rank the flakiest tests
  flakesieve record  [options]    Append the current run to history

Options:
  --report <glob>     Test report glob (repeatable)   [default: **/junit.xml]
  --history <path>    History file  [default: .flakesieve/history.json]
  --commit <sha>      Commit SHA for this run         [default: $GITHUB_SHA]
  --branch <name>     Branch for this run             [default: $GITHUB_REF_NAME]
  --run-id <id>       Unique id for this run          [default: $GITHUB_RUN_ID]
  --format <fmt>      terminal | markdown | json      [default: terminal]
  --top <n>           Rows for 'stats'                [default: 20]
  --fail-on-real      Exit 1 only when a likely-real failure is found
  -h, --help          Show this help
`.trim();

function parseArgs(argv: string[]): Args {
  // A leading flag means no command was given; default to `analyze` and start
  // option parsing at position 0 rather than treating `--help` as a command.
  const hasCommand = argv[0] !== undefined && !argv[0].startsWith('-');
  const start = hasCommand ? 1 : 0;

  const args: Args = {
    command: hasCommand ? argv[0]! : 'analyze',
    report: [],
    history: '.flakesieve/history.json',
    commit: process.env.GITHUB_SHA ?? 'unknown',
    branch: process.env.GITHUB_REF_NAME ?? 'unknown',
    runId: process.env.GITHUB_RUN_ID ?? String(Date.now()),
    top: 20,
    record: false,
    failOnReal: false,
    format: 'terminal',
  };

  for (let i = start; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} requires a value`);
      return v;
    };

    switch (flag) {
      case '--report': args.report.push(next()); break;
      case '--history': args.history = next(); break;
      case '--commit': args.commit = next(); break;
      case '--branch': args.branch = next(); break;
      case '--run-id': args.runId = next(); break;
      case '--top': args.top = Number.parseInt(next(), 10); break;
      case '--fail-on-real': args.failOnReal = true; break;
      case '--format': {
        const v = next();
        if (v !== 'terminal' && v !== 'markdown' && v !== 'json') {
          throw new Error(`unknown format '${v}'`);
        }
        args.format = v;
        break;
      }
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option '${flag}'`);
    }
  }

  if (args.report.length === 0) args.report.push('**/junit.xml');
  return args;
}

/** Collect the current run, using the same code path the GitHub Action uses. */
function collectRun(args: Args): Promise<TestRun> {
  return collect({
    patterns: args.report,
    runId: args.runId,
    commitSha: args.commit,
    branch: args.branch,
    onSkip: (file) =>
      console.warn(`  skipped ${file}: no parser recognized this format`),
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'record') {
    const run = await collectRun(args);
    const history = await loadHistory(args.history);
    await saveHistory(args.history, appendRun(history, run));
    console.log(
      `recorded ${run.tests.length} tests for ${run.commitSha.slice(0, 7)} → ${args.history}`,
    );
    return 0;
  }

  if (args.command === 'stats') {
    const history = await loadHistory(args.history);
    const report = analyze(
      { runId: '', commitSha: '', branch: '', timestamp: '', tests: [] },
      history,
    );
    console.log(renderStats(report, args.top));
    return 0;
  }

  if (args.command !== 'analyze') {
    console.error(`unknown command '${args.command}'\n\n${USAGE}`);
    return 2;
  }

  const run = await collectRun(args);
  const history = await loadHistory(args.history);
  const report = analyze(run, history);

  if (args.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else if (args.format === 'markdown') {
    console.log(renderComment(report) ?? '');
  } else {
    console.log(renderTerminal(report));
  }

  // With --fail-on-real, known flakes no longer break the build. That is the
  // whole point: only unexplained failures should stop a merge.
  if (args.failOnReal) {
    const unexplained =
      report.likelyReal.length + report.insufficientHistory.length;
    return unexplained > 0 ? 1 : 0;
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`flakesieve: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);

export { emptyHistory };
