#!/usr/bin/env node
/**
 * Bundle the action into a single committed file.
 *
 * GitHub Actions runs `action-dist/index.js` directly with no install step, so
 * every dependency has to be inlined and the result has to be committed. That is
 * why `action-dist/` is deliberately NOT gitignored, unlike `dist/`.
 */
import { build } from 'esbuild';
import { stat } from 'node:fs/promises';

// .cjs, not .js: package.json sets "type": "module", so a CommonJS bundle named
// .js would be loaded as ESM and crash on `module.exports`. CJS is the safer
// bundle format here because octokit's dependency tree contains dynamic requires
// that do not survive conversion to ESM cleanly.
const outfile = 'action-dist/index.cjs';

await build({
  entryPoints: ['src/action/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile,
  minify: false, // keep it reviewable — people do audit committed action bundles
  sourcemap: false,
  legalComments: 'none',
});

const { size } = await stat(outfile);
console.log(`bundled → ${outfile} (${(size / 1024).toFixed(0)} KB)`);
