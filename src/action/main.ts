import * as core from '@actions/core';
import * as github from '@actions/github';
import { analyze, appendRun, emptyHistory } from '../core/flake.js';
import { collectRun } from '../core/collect.js';
import { renderComment } from '../report/comment.js';
import { renderTerminal } from '../report/terminal.js';
import { decideComment, type ExistingComment } from './comment.js';
import { readHistoryFile, writeHistoryFile } from './history-branch.js';
import type { HistoryFile } from '../core/types.js';

function parseHistory(raw: string | null): HistoryFile {
  if (raw === null) return emptyHistory();
  try {
    const parsed = JSON.parse(raw) as HistoryFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) {
      throw new Error('unexpected shape');
    }
    return parsed;
  } catch (err) {
    // Refusing to continue would block the user's CI over our own data file.
    core.warning(
      `history file is unreadable (${err instanceof Error ? err.message : String(err)}); ` +
        'starting fresh. Previous history will be overwritten on the next record.',
    );
    return emptyHistory();
  }
}

async function upsertComment(body: string | null): Promise<void> {
  const token = core.getInput('token');
  const pr = github.context.payload.pull_request;

  if (!pr) {
    core.info('not a pull_request event — skipping comment');
    return;
  }
  if (!token) {
    core.warning('no token provided — skipping comment');
    return;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const issue_number = pr.number;

  const existing: ExistingComment[] = await octokit.paginate(
    octokit.rest.issues.listComments,
    { owner, repo, issue_number, per_page: 100 },
    (res) => res.data.map((c) => ({ id: c.id, body: c.body })),
  );

  const action = decideComment(body, existing);

  switch (action.kind) {
    case 'create':
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number,
        body: action.body,
      });
      core.info('posted flakesieve comment');
      break;
    case 'update':
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: action.id,
        body: action.body,
      });
      core.info('updated flakesieve comment');
      break;
    case 'none':
      core.info('comment already up to date — nothing to post');
      break;
  }
}

export async function run(): Promise<void> {
  const patterns = core
    .getInput('report-paths')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const branch = core.getInput('history-branch') || 'flakesieve-history';
  const path = core.getInput('history-path') || 'history.json';
  const shouldComment = core.getBooleanInput('comment');
  const shouldRecord = core.getBooleanInput('record');
  const failOnReal = core.getBooleanInput('fail-on-real');

  const { content, parent } = await readHistoryFile(branch, path);
  const history = parseHistory(content);
  core.info(`loaded ${history.runs.length} runs from ${branch}:${path}`);

  const run = await collectRun({
    patterns: patterns.length > 0 ? patterns : ['**/junit.xml'],
    runId: process.env.GITHUB_RUN_ID ?? String(Date.now()),
    // For pull_request events GITHUB_SHA is the synthetic merge commit, which
    // differs on every push and would break same-commit contradiction detection.
    // The head SHA is the one that identifies the code under test.
    commitSha:
      (github.context.payload.pull_request?.head?.sha as string | undefined) ??
      github.context.sha,
    branch: github.context.ref.replace(/^refs\/heads\//, ''),
    onSkip: (file) => core.warning(`skipped ${file}: no parser recognized it`),
  });

  core.info(`parsed ${run.tests.length} tests from this run`);

  const report = analyze(run, history);
  core.info(renderTerminal(report));

  core.setOutput('likely-real', report.likelyReal.length);
  core.setOutput('known-flakes', report.knownFlakes.length);
  core.setOutput('already-broken', report.alreadyBroken.length);
  core.setOutput('runs-analyzed', report.runsAnalyzed);

  // Opt-out has to live here rather than in the workflow: the runner re-injects
  // its own GITHUB_* variables for every step, so pointing GITHUB_STEP_SUMMARY
  // at /dev/null from a step `env:` block is silently ignored.
  if (core.getBooleanInput('job-summary')) {
    // The summary is a nicety. If the runner has not provided a writable file,
    // that must not take down someone's CI run.
    try {
      await core.summary
        .addRaw(renderComment(report) ?? '✅ No unexplained test failures.')
        .write();
    } catch (err) {
      core.debug(
        `could not write job summary: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (shouldComment) {
    await upsertComment(renderComment(report));
  }

  if (shouldRecord) {
    const updated = appendRun(history, run);
    const pushed = await writeHistoryFile({
      branch,
      path,
      content: `${JSON.stringify(updated, null, 2)}\n`,
      parent,
      message: `flakesieve: record ${run.commitSha.slice(0, 7)} (${run.tests.length} tests)`,
    });

    if (pushed) {
      core.info(`recorded run to ${branch} (${updated.runs.length} runs stored)`);
    } else {
      core.warning(
        `could not push to ${branch} — another run updated it first. ` +
          'This run was not recorded, which is harmless.',
      );
    }
  }

  if (failOnReal) {
    const unexplained =
      report.likelyReal.length + report.insufficientHistory.length;
    if (unexplained > 0) {
      core.setFailed(
        `${unexplained} unexplained test ${unexplained === 1 ? 'failure' : 'failures'}`,
      );
    }
  }
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
