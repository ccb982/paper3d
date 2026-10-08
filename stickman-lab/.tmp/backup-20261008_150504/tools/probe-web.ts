/**
 * ★ **同源收据**（sync receipt）—— 网页与探针对不对得上，看这一个串。
 *
 * 用法：
 *   1. `node tools/run.mjs probe-web` → 打印配置指纹 + 一条 URL
 *   2. 把那条 URL 粘进浏览器
 *   3. 比对网页左下角状态栏显示的指纹
 *   指纹一致 ⇒ 网页跑的就是探针刚测的那份配置（同一份 `DEFAULT_CONTROLLER`、
 *   同一个 `LabState`、同一个 `DEFAULT_SIM`）；不一致 ⇒ 两边漂了，当场可见。
 *
 * ★ 修这个之前根本做不到这件事，因为失同步有三个来源：
 *   ① 网页只渲染 ES 大脑输出，`balanceHold` / `stepSystem` 只被 `tools/` 引用
 *      ⇒ 你在网页上调平衡维持系统，网页上根本没有那个系统
 *   ② UI 相位滑块是二值的（walk/fight），`stand` 模式不可达
 *      ⇒ 而 `stand`（`ts.single` = 恰好一脚着地）才是平衡的验收口径
 *   ③ 每个探针各内联一份 FB 参数，`probe-capture` 的 kLat=0 与
 *      `probe-arch` 的 kLat=3.5 是两个不同控制器，却被当成同一个在比
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe-web] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    (await WebAssembly.instantiate(compiled, imports)).exports);
}

const { DEFAULT_LAB, labHash, labToQuery } = await import('../src/core/lab');
const { DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { STAND_W } = await import('../src/core/sim');

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);

// 探针侧的默认（与网页 DEFAULT_LAB 一致；要试别的就改这里并同步改 URL）
const lab = { ...DEFAULT_LAB };
const PORT = Number(process.argv[3] ?? 5274) || 5274;

console.log('═'.repeat(74));
console.log('  网页 ↔ 探针 同源收据');
console.log('═'.repeat(74));
console.log('');
console.log('配置指纹（网页左下角状态栏显示的就是这一串）：');
console.log(`  ${labHash(lab)}`);
console.log('');
console.log(`打开这条 URL：`);
console.log(`  http://localhost:${PORT}/?${labToQuery(lab)}`);
console.log('');
console.log('指纹覆盖的东西：');
console.log(`  骨架      ${sk.bodies.length} 刚体 / ${sk.joints.length} 关节 / ${SHAPE.inputs}→${SHAPE.hidden}→${SHAPE.outputs}`);
console.log(`  物理      ${DEFAULT_SIM.physicsHz} Hz   控制 ${DEFAULT_SIM.controlHz} Hz   回合 ${lab.dur}s`);
console.log(`  模式      ${lab.mode}   驱动 ${lab.driver}   支撑腿 ${lab.startBearer}   抬腿 ${lab.liftHold}m`);
console.log(`  站立权重  ${JSON.stringify(STAND_W)}`);
console.log('');
console.log('平衡维持系统参数：`DEFAULT_CONTROLLER`（见 src/core/systems/balance.ts）');
console.log('');
console.log('★ 若指纹一致，网页上看到的就是探针测的那个控制器。');
console.log('★ 若不一致：先确认两边都在跑最新的 `npm run dev`（旧 dev server 不会热更新 lab.ts 的默认值）。');