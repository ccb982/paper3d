/**
 * probe-authority —— **发力→拉腰**的端到端权威性检验
 *   （用户：「必须保证脚发力+腰借力的情况下一定要有足够的力把腰拉起来，
 *    然后才能考虑控制算法，否则无从谈起」）
 *
 *   实验：站立 1s 稳后，对支撑踝施加**阶跃 τ = +V4AT N·m**（0.5s）。
 *   理论预测（静力）：ΔCoP = τ/Fz，CoM 加速度 a ≈ g·ΔCoP/h。
 *   实测 CoM.x/vx/腰 pitch 的响应 —— 与预测同量级 ⇒ 权威链通；
 *   若实测 ≈ 0 ⇒ 力在半路被吃掉（无从谈起）。
 *
 *   用法：`node tools/run.mjs probe-authority [tau] `
 *   （建议配 `V4MODE=1 V4KA=0` 让平衡层安静，只看纯链条）
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
const bg = bgNs as any;
const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
const c = await WebAssembly.compile(fs.readFileSync(p));
const im: any = {};
for (const i of WebAssembly.Module.imports(c)) {
  const impl = (bg as any)[i.name];
  if (typeof impl === 'function') (im[i.module] ??= {})[i.name] = impl;
}
bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const TAU = Number(ARGS[0] ?? 30);
const TSTEP = Number(ARGS[1] ?? 1.0);
const TDUR = Number(ARGS[2] ?? 0.5);
const JOINT = String(ARGS[3] ?? 'foot_l');
// 通过控制器钩子注入（唯一有效注入点）
const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.AUTH_TAU = String(TAU);
env.AUTH_T0 = String(TSTEP);
env.AUTH_T1 = String(TSTEP + TDUR);
env.AUTH_AX = String(Number(ARGS[4] ?? 2));

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: TSTEP + TDUR + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;
const jAnkL = jointIndexByName(sk, JOINT);
env.AUTH_J = String(jAnkL);
const log = (s: string) => console.log(s);

const G = 9.81;
let x0 = 0, vx0 = 0, cop0 = 0;
const N = Math.round((TSTEP + TDUR) * HZ);
log(`══ probe-authority：踝阶跃 τ=${TAU} N·m（t=1.0~1.5s）══`);
log('     t   | CoM.x   vx    | CoP.x  | ΔCoP   | 预测ΔCoP | 实测a   预测a');
const NS = Math.round(0.15 * HZ), ND = 2;
for (let k = 0; k <= N; k++) {
  const t0 = k * DT;
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (t < TSTEP - 0.03) continue;
  if (t < TSTEP && t > TSTEP - 0.04) {
    const F = d.soleForceProfile(0, DT);
    if (Math.abs(t - (TSTEP - 0.02)) < DT) { x0 = (rs.com?.x ?? 0); vx0 = (rs.com?.vx ?? 0); cop0 = F.copX; }
  }
  if (t >= TSTEP && (k % (ND) === 0)) {
    const F = d.soleForceProfile(0, DT);
    const Fz = F.fz > 100 ? F.fz : rs.sk.massTotal * G;
    const cx = rs.com?.x ?? 0, vx = rs.com?.vx ?? 0;
    const dCop = F.copX - cop0;
    const predCop = TAU / Fz;
    const aMeas = (vx - vx0) / Math.max(1e-6, t - TSTEP);
    const h = Math.max(0.3, rs.com?.y ?? 0.9);
    const predA = G * predCop / h;
    log(
      `  ${t.toFixed(3)} |${(cx * 1000).toFixed(2).padStart(8)}${(vx * 1000).toFixed(1).padStart(7)} |` +
      `${(F.copX * 1000).toFixed(0).padStart(7)} |${(dCop * 1000).toFixed(1).padStart(7)} |` +
      `${(predCop * 1000).toFixed(1).padStart(9)} |${aMeas.toFixed(2).padStart(8)}${predA.toFixed(2).padStart(8)}`,
    );
  }
}
