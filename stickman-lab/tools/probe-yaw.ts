/**
 * ══════════════════════════════════════════════════════════════════
 * probe-yaw.ts —— **"还在转圈"专项回读**：谁在世界里转、转了多少
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户：「**你回读关节啊，还在转圈**」。
 *
 * 全机转圈可能是：
 *   · **骨盆在世界系的偏航**（不经过任何关节 —— 关节回读看不见）；
 *   · 某几根**扭转轴**（各关节的 1 号轴）在累积（spine1/1、hip/1、knee/1）。
 *
 * 所以本探针同时打：**世界偏航**（骨盆/头的朝向角，累计值）+ **逐关节扭转轴角**。
 * 世界偏航由刚体旋转矩阵的 x 轴在水平面的分量 atan2 得到（0 = 初始朝向）。
 *
 * 用法：`node tools/run.mjs probe-yaw [秒数=6] [间隔=0.25]`
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
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const log = (s: string) => console.log(s);
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECS = Number(ARGS[0] ?? 6);
const STEP = Number(ARGS[1] ?? 0.25);
const HZ = 120, DT = 1 / HZ, PER = 2;
const DEG = 180 / Math.PI;
const sk = buildSkeleton(DEFAULT_CONFIG);
const jn = sk.joints.map((j) => j.name);
const J = (n: string): number => jn.indexOf(n);

log(`══ probe-yaw ${SECS}s：世界偏航（骨盆/头）+ 扭转轴（每 ${STEP}s）══`);
log('   t(s)  骨盆yaw  头yaw  躯干roll | spine1/1 spine2/1 spine3/1 | hip_l/1 hip_r/1 | knee_l/1 knee_r/1 | comZ');
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
});
const d = sim.doll;
const rs = ctrl.rs;
const jr = new Float64Array(3);
/** 世界偏航（deg，累计不折返：用 unwrap 记录总转角） */
const yawOf = (q: { x: number; y: number; z: number; w: number }): number => {
  // 旋转矩阵第一列（body x 轴）在水平面的投影
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const bx = 1 - 2 * (y * y + z * z);
  const bz = 2 * (x * z + y * w);       // m[0][2] 附近（body x 轴的世界 z 分量）
  return Math.atan2(bz, bx) * DEG;
};
let prevYaw = Number.NaN, unwrapped = 0, total = 0;
let firstYawP = Number.NaN;
let nextT = 0;
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  const t = i / HZ;
  if (t + 1e-6 < nextT) continue;
  nextT += STEP;
  const qp = d.root().rotation(), qh = d.head().rotation();
  let yawP = yawOf(qp);
  if (!Number.isFinite(firstYawP)) firstYawP = yawP;
  if (Number.isFinite(prevYaw)) {
    let dY = yawP - prevYaw;
    if (dY > 180) dY -= 360; else if (dY < -180) dY += 360;
    unwrapped += dY;
    total += Math.abs(dY);
  }
  prevYaw = yawP;
  const a = (n: string): string => { const j = J(n); if (j < 0) return '  — '; d.jointRot(j, jr); return (jr[1]! * DEG).toFixed(0).padStart(5); };
  log(`   ${t.toFixed(2).padStart(5)} ${yawP.toFixed(0).padStart(7)} ${yawOf(qh).toFixed(0).padStart(6)}  (累计 ${unwrapped.toFixed(0).padStart(5)}°) |${a('spine1')}${a('spine2')}${a('spine3')} |${a('hip_l')}${a('hip_r')} |${a('knee_l')}${a('knee_r')} | ${((rs.com.z * 1000).toFixed(0)).padStart(5)}`);
}
log(`\n── 全段 ──`);
log(`  骨盆**净转了** ${unwrapped.toFixed(0)}°（正=逆时针，累计绝对转角 ${total.toFixed(0)}°）`);
log(`  ⇒ 若 ${'净转'} ≥ 300° ⇒ **确实转满一圈**（用户观感正确）`);
