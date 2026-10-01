// ============================================================
// probe-ground —— 回答"脚到底有没有在施力？身体为什么不保持重心？"
// ============================================================
// 三组数：
//   A. 地面接触冲量（直接从接触流形读 contactImpulse） → 换成力，和体重对账
//   B. 动量法交叉验证：Σ m·(Δv_y/dt + g) 应当等于 A（两条独立路径互证）
//   C. 重心水平位置 vs 脚的支撑多边形 —— 这才是"会不会倒"的判据：
//      重心的水平投影一旦离开两脚之间的区域，重力产生的力矩没有任何东西能抵消
//      （★ 尤其因为本骨架**没有踝关节**，脚与小臂一体化 ⇒ 脚掌无法单独施力矩）。
//
// 跑法：node tools/run.mjs probe-ground

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);

// ★ rapier 相关模块必须先导入完，再注入真实 wasm（见 tools/_bundle.mjs 的说明）
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
const { Ragdoll } = await import('../src/core/ragdoll');

{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
}

const RAPIER = (await import('@dimforge/rapier3d')).default;
const sk = buildSkeleton(DEFAULT_CONFIG);
const DT = 1 / 120;
const W_TOTAL = sk.massTotal * 9.81;

type Vec = { x: number; y: number; z: number };

function run(restTension: number, aRef = Infinity, seconds = 3, verbose = false): void {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 16;
  world.numAdditionalFrictionIterations = 8;
  const doll = new Ragdoll(world, sk, { restTension, restTensionRef: aRef });
  doll.reset(0);

  // 两只脚所在刚体的全部 collider（小腿胶囊 + 脚掌扁盒）
  const footCols = (['l', 'r'] as const).flatMap((side) => {
    const b = doll.bodyByKey(side === 'l' ? 'shin_l' : 'shin_r');
    const out: unknown[] = [];
    for (let i = 0; i < b.numColliders(); i++) out.push(b.collider(i));
    return out;
  });

  const targets = new Float32Array(doll.jointCount * 3);   // 全 0 = 保持姿态
  doll.setMotorTargets(targets);

  const prevV = doll.bodies.map((b) => b.linvel() as Vec);
  const footPt = new Float64Array(3);
  const SAMPLE = 30;                 // 每 30 物理步（0.25 s）采样一次
  const SAMPLE_DT = SAMPLE * DT;

  if (verbose) {
    console.log('   t    躯干y   脚Ly   脚Ry   接触力N  动量法N  CoM.x   脚支撑[x0,x1]  CoM在支撑内');
  }

  let standTime = seconds;
  let torsoY2s = NaN;
  let sumF = 0, nF = 0;

  for (let step = 1; step <= seconds * 120; step++) {
    doll.driveMotors(DT);
    world.step();

    if (step % SAMPLE !== 0) continue;

    // ---- A. 接触冲量 → 力 ----
    let impSum = 0;
    for (const col of footCols) {
      world.contactPairsWith(col as never, (other) => {
        world.contactPair(col as never, other, (mf) => {
          for (let i = 0; i < mf.numContacts(); i++) impSum += mf.contactImpulse(i);
        });
      });
    }
    const fContact = impSum / DT;
    sumF += fContact; nF++;

    // ---- B. 动量法：Σ m·(Δv_y/Δt + g)。★ Δt 必须是**采样间隔**，不是 DT ----
    let fMom = 0;
    let mtot = 0, cmx = 0;
    for (let i = 0; i < doll.bodies.length; i++) {
      const b = doll.bodies[i];
      const m = b.mass();
      const v = b.linvel() as Vec;
      fMom += m * ((v.y - prevV[i].y) / SAMPLE_DT + 9.81);
      const t = b.translation();
      mtot += m; cmx += m * t.x;
      prevV[i].x = v.x; prevV[i].y = v.y; prevV[i].z = v.z;
    }
    cmx /= mtot;

    // ---- C. 支撑多边形（两脚的 x 跨度）----
    doll.footPoint('l', footPt);
    const lx = footPt[0];
    doll.footPoint('r', footPt);
    const rx = footPt[0];
    const x0 = Math.min(lx, rx), x1 = Math.max(lx, rx);
    const inside = cmx >= x0 - 0.02 && cmx <= x1 + 0.02;
    if (!inside && standTime === seconds) standTime = step / 120;
    if (Math.abs(step / 120 - 2) < 1e-9) torsoY2s = doll.torso().translation().y;

    if (verbose) {
      console.log(
        `  ${(step / 120).toFixed(2)}  ` +
        `${doll.torso().translation().y.toFixed(3)}  ` +
        `${doll.soleY('l').toFixed(3)}  ${doll.soleY('r').toFixed(3)}  ` +
        `${fContact.toFixed(0).padStart(7)}  ${fMom.toFixed(0).padStart(7)}  ` +
        `${cmx.toFixed(3).padStart(6)}  [${x0.toFixed(2)},${x1.toFixed(2)}]  ${inside ? '是' : '★否'}`,
      );
    }
  }

  console.log(
    `  k=${String(restTension).padStart(2)} a_ref=${(aRef === Infinity ? '∞' : aRef.toFixed(2)).padStart(4)}  ` +
    `重心撑在支撑区内 ${standTime.toFixed(2)}s / ${seconds}s   ` +
    `t=2s 躯干y=${Number.isNaN(torsoY2s) ? '—' : torsoY2s.toFixed(3)}   ` +
    `平均接触力 ${(sumF / nF).toFixed(0)} N（= 体重的 ${((sumF / nF / W_TOTAL) * 100).toFixed(0)}%）`,
  );
}

console.log(`\n=== 地面反力 / 重心支撑 实测（体重 ${W_TOTAL.toFixed(0)} N，关节目标全 0）===`);
console.log('  逐帧细节（k=9, a_ref=0.25 = 当前默认）:');
run(9, 0.25, 3, true);
console.log('\n  k / a_ref 对照（站桩，看"不饱和"会不会塌、饱和之后掉多少）:');
for (const [k, a] of [[0, Infinity], [3, Infinity], [6, Infinity], [9, Infinity], [9, 0.12], [9, 0.25], [9, 0.4], [12, 0.25]] as const) {
  run(k, a, 3, false);
}
console.log('  k = 0 ⇒ 纯阻尼（重力能压垮关节，因为静态下速度=0 ⇒ 马达出力=0）');
console.log('');

