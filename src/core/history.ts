import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyHistory, migrateV1 } from './flake.js';
import type { HistoryFile } from './types.js';

/**
 * Read a history file, returning an empty history when it does not exist yet.
 *
 * A missing file is the normal first-run state, not an error — the tool has to
 * work on a repo that has never run it before.
 */
export async function loadHistory(path: string): Promise<HistoryFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyHistory();
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`history file at ${path} is not valid JSON`, { cause });
  }

  return migrate(parsed, path);
}

export async function saveHistory(
  path: string,
  history: HistoryFile,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Two-space indent keeps the file diffable — the point of storing it in git
  // is that a human can see what changed.
  await writeFile(path, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
}

/**
 * Validate and upgrade a history file to the current schema.
 *
 * Version 1 files are read and upgraded rather than rejected. Someone who has
 * been running flakesieve for weeks has data that cannot be regenerated, and an
 * upgrade that silently resets them to zero would be worse than no upgrade.
 * The migration is one-way: the next recorded run writes version 2.
 */
function migrate(parsed: unknown, path: string): HistoryFile {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`history file at ${path} is malformed: expected an object`);
  }

  const obj = parsed as { version?: unknown; runs?: unknown; tests?: unknown } & Record<
    string,
    unknown
  >;

  if (!Array.isArray(obj.runs)) {
    throw new Error(`history file at ${path} is malformed: 'runs' is not an array`);
  }

  if (obj.version === 1) {
    return migrateV1(obj as unknown as Parameters<typeof migrateV1>[0]);
  }

  if (obj.version !== 2) {
    throw new Error(
      `history file at ${path} has unsupported version ${String(obj.version)}; ` +
        'this flakesieve build understands versions 1 and 2',
    );
  }

  if (!Array.isArray(obj.tests)) {
    throw new Error(`history file at ${path} is malformed: 'tests' is not an array`);
  }

  return {
    version: 2,
    updatedAt: (obj.updatedAt as string | undefined) ?? new Date().toISOString(),
    maxRuns: (obj.maxRuns as number | undefined) ?? 200,
    tests: obj.tests as string[],
    runs: obj.runs as HistoryFile['runs'],
  };
}
