import { buildAndRun } from './_bundle.mjs';

// 离屏验收：不开浏览器，用 node 直跑真实物理/进化模块，做确定性断言。
// 用法：node tools/verify-core.mjs
await buildAndRun('verify-core.ts');
