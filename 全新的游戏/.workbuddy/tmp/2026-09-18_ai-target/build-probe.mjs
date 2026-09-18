import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'ai-probe.ts');
const out = path.join(here, 'ai-probe.mjs');

await esbuild.build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'info',
});
console.log('bundled ->', out);
