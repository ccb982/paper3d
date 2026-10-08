import { buildAndRun } from './_bundle.mjs';

// 用法：node tools/run.mjs probe-idle [frames]
const name = (process.argv[2] || '').trim();
if (!name) {
  console.error('用法: node tools/run.mjs <probe-idle|probe-authority|probe-stand|diag-keys> [args…]');
  process.exit(2);
}
const rest = process.argv.slice(3);
await buildAndRun(`${name}.ts`, rest);
