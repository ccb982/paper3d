import { buildAndRun } from './_bundle.mjs';

// 用法：node tools/run.mjs verify-core
const name = (process.argv[2] || '').trim();
if (!name) {
  console.error('用法: node tools/run.mjs <verify-core|probe-motor|probe-fitness|probe-reset|probe-spike|probe-ball|probe-fight|probe-ground|probe-forces>');
  process.exit(2);
}
await buildAndRun(`${name}.ts`);
