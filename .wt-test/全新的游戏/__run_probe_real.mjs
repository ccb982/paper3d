import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, '__probe_real.bundle.cjs');
await build({ entryPoints: [path.join(root, '__probe_real.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: out, logLevel: 'warning' });
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' });
process.exit(r.status ?? 1);