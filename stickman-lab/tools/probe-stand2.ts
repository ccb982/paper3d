/**
 * probe-stand2.ts —— 站立**逐步退化归因**（不给单一秒数，要给"哪一步先坏"）
 *
 * 为什么重写：`probe-stand` 只报"倒于 t=?"，而那个秒数受**死亡判定**支配
 * （bodyHitGround / tilt / head 任一触发即止），不是"站立的极限"，
 * 换句话说它是**结果**不是**原因**。本探针逐 0.25s 打一行，找出第一个
 * 真正劣化的量（CoM 漂移 / ξ 发散 / 倾角 / 承重腿 / 触地刚体）。
 *
 * 判据：倾角与 ξ 单调发散且永不回落 ⇒ 绑定姿态是**鞍点**，不是"站着"。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any; const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { newCom, readCom, omegaAt, dcm } = await import('../src/core/posture');
const log = console.log;
const ARCH_ON = !((globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? []).includes('noarch');
const LIM = ((globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? []).includes('nolimit');

const sk = buildSkeleton({ ...DEFAULT_CONFIG, flexibleArch: ARCH_ON });
const SHAPE = shapeForJoints(sk.joints.length);
const PHz = DEFAULT_SIM.physicsHz ?? 240;
const DT = 1 / PHz;
log(`══ 站立逐步退化（柔性足=${ARCH_ON} 限时关=${LIM}）physics=${PHz}Hz══`);
log('   t/s   胸y   骨盆y   comY   comX    ξx     ξz   倾角°  承重  触地刚体                ξ趋势');

// ★ 回合长度可配（默认 6s 就是 duration，到点会 finish(false)=“跑满”，
//   不是摔倒 —— 已被误读作“倒地”不次）。这里拉到 30s。
const DUR2 = Number(((globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [])[1] ?? 30) || 30;
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', physicsHz: PHz, duration: DUR2 });
if (LIM) (sim.doll as any).enforceLimits = () => {};   // 关逐轴限位：看它是不是限位在杀
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
const com = newCom();
const steps = Math.round(DUR2 / DT);
const hist: { t: number; xi: number; z: number }[] = [];
let nxt = 0;
for (let i = 0; i < steps; i++) {
  ctrl.step(1 / (DEFAULT_SIM.controlHz ?? 120));   // 内部已写入 doll
  sim.advance(1);
  const t = i * DT;
  if (t < nxt) continue;
  nxt += 0.25;
  const d = sim.doll;
  readCom(d, com);
  const torso = d.torso();
  const root = d.root();
  const w = omegaAt(com.y);
  const xi = dcm(com.x, com.vx, w), zi = dcm(com.z, com.vz, w);
  const tilt = d.tiltOf(torso) * 57.3;
  const gnd = d.groundTouching().join(',');
  const sup = com.z > 0 ? 'l' : 'r';
  hist.push({ t, xi, z: zi });
  // ξ 趋势：最近 1s 的一阶差分（正 = 发散）
  const older = hist.find((h) => h.t <= t - 1.0);
  const trend = older ? (Math.abs(zi) - Math.abs(older.z)) / (t - older.t) : 0;
  log(`  ${t.toFixed(2).padStart(5)} ${torso.translation().y.toFixed(3)}`
    + ` ${root.translation().y.toFixed(3)} ${com.y.toFixed(3)}`
    + ` ${com.x.toFixed(3)} ${xi.toFixed(3).padStart(6)} ${zi.toFixed(3).padStart(6)}`
    + ` ${tilt.toFixed(1).padStart(6)}   ${sup}   ${(gnd || '（腾空）').padEnd(22)}`
    + ` ${trend >= 0 ? '↑发散' : '↓收敛'} ${trend.toFixed(3)}`);
  if (sim.finished || tilt > 25) {
    // ★ 分开报：死亡判定触发的是哪一条，与倾角是否有关。
    const d2: any = sim.doll;
    log(`  ⇒ t=${t.toFixed(2)}s  sim.finished=${sim.finished}  fallReason=[${sim.fallReason}]`
      + `  倾角=${tilt.toFixed(1)}°`);
    log(`     触地非脚刚体 = ${d2.lastHitKey || '（无）'}`);
    log(`     当前触地刚体 = ${d2.groundTouching().join(',') || '（无）'}`);
    break;
  }
}
