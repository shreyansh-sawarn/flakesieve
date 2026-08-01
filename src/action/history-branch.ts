import { getExecOutput } from '@actions/exec';

/**
 * Read and write the history file on its own orphan branch.
 *
 * Everything here uses git plumbing (`hash-object`, `mktree`, `commit-tree`)
 * rather than `checkout` or `add`. That is deliberate: the runner's working tree
 * holds the user's actual code, and a tool that stashes, checks out a branch, or
 * leaves the tree dirty on failure would be unacceptable in someone's CI. These
 * commands write objects straight into the object database and touch nothing else.
 */

async function git(
  args: string[],
  options: { input?: string; ignoreFailure?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const res = await getExecOutput('git', args, {
    silent: true,
    ignoreReturnCode: true,
    ...(options.input ? { input: Buffer.from(options.input) } : {}),
  });

  if (res.exitCode !== 0 && !options.ignoreFailure) {
    throw new Error(
      `git ${args.join(' ')} failed (${res.exitCode}): ${res.stderr.trim()}`,
    );
  }

  return { code: res.exitCode, stdout: res.stdout, stderr: res.stderr };
}

/**
 * Fetch the history branch and return the file contents, or null if either the
 * branch or the file does not exist yet.
 *
 * The branch is fetched at full depth rather than `--depth=1`. It holds a single
 * small JSON file, so the cost is negligible, and a shallow fetch would make the
 * resulting commit unpushable ("shallow update not allowed").
 */
export async function readHistoryFile(
  branch: string,
  path: string,
): Promise<{ content: string | null; parent: string | null }> {
  const fetched = await git(
    ['fetch', 'origin', `+refs/heads/${branch}:refs/flakesieve/${branch}`],
    { ignoreFailure: true },
  );

  // A missing branch is the normal first-run state, not an error.
  if (fetched.code !== 0) return { content: null, parent: null };

  const tip = await git(['rev-parse', `refs/flakesieve/${branch}`], {
    ignoreFailure: true,
  });
  const parent = tip.code === 0 ? tip.stdout.trim() : null;
  if (!parent) return { content: null, parent: null };

  const show = await git(['show', `${parent}:${path}`], { ignoreFailure: true });
  return {
    content: show.code === 0 ? show.stdout : null,
    parent,
  };
}

/**
 * Commit `content` to the history branch and push it.
 *
 * Returns false if the push was rejected because another run updated the branch
 * first. That is a benign race: each run appends independently, so the loser's
 * run is simply not recorded. Dropping one run out of a 200-run window does not
 * meaningfully change any failure rate, and the alternative (locking) is far more
 * machinery than the problem warrants.
 */
export async function writeHistoryFile(options: {
  branch: string;
  path: string;
  content: string;
  parent: string | null;
  message: string;
}): Promise<boolean> {
  const { branch, path, content, parent, message } = options;

  if (path.includes('/')) {
    throw new Error(
      `history-path must be a top-level filename, got '${path}'. ` +
        'Nested paths would require building intermediate trees.',
    );
  }

  const blob = (
    await git(['hash-object', '-w', '--stdin'], { input: content })
  ).stdout.trim();

  const tree = (
    await git(['mktree'], { input: `100644 blob ${blob}\t${path}\n` })
  ).stdout.trim();

  const commitArgs = ['commit-tree', tree, '-m', message];
  if (parent) commitArgs.push('-p', parent);

  // commit-tree needs an identity, and the runner has no git config by default.
  const identity = {
    GIT_AUTHOR_NAME: 'flakesieve',
    GIT_AUTHOR_EMAIL: 'flakesieve@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'flakesieve',
    GIT_COMMITTER_EMAIL: 'flakesieve@users.noreply.github.com',
  };
  const prevEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(identity)) {
    prevEnv[k] = process.env[k];
    process.env[k] = v;
  }

  let commit: string;
  try {
    commit = (await git(commitArgs)).stdout.trim();
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  // Deliberately not --force. A rejected push means someone else won the race,
  // which the caller handles; force would silently discard their run.
  const push = await git(
    ['push', 'origin', `${commit}:refs/heads/${branch}`],
    { ignoreFailure: true },
  );

  return push.code === 0;
}
