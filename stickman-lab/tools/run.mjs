import { buildAndRun } from './_bundle.mjs';

// 用法：node tools/run.mjs verify-core
const name = (process.argv[2] || '').trim();
if (!name) {
  console.error('用法: node tools/run.mjs <verify-core|probe-motor|probe-fitness|probe-reset|probe-spike|probe-ball|probe-fight|probe-ground|probe-forces|probe-servo|probe-skin|probe-stability|probe-push|probe-posture>');
  process.exit(2);
}
// ★ 把剩余参数透传给探针。打包产物是独立文件、用 `import()` 加载，
//   所以 `process.argv` 里看到的只有【打包器】的参数。
//   历史：探针里用 process.env / process.argv 取参数、实测永远拿不到（三次重复浪费时间）。
const rest = process.argv.slice(3);
await buildAndRun(`${name}.ts`, rest);
