/**
 * probe-executor —— 「执行器有没有问题」的分层体检（离屏，零分配）
 *
 *   用户问：「你先测一下执行器有问题吗」
 *
 *   把「力从 τ 走到身体」这一条链**逐段**拆开，每段给一个可判定数字：
 *     A. τ 注入有没有落地         → 读 doll.v4Tau / torqueCmd
 *     B. 关节真的算出力矩了吗     → 用 `motorImpulse` 记账核对（Rapier 无关节反力读回）
 *     C. 身体真的被推动了吗       → CoM.x / vx 响应
 *     D. 力传到脚上了吗（法向载荷）→ soleForceProfile.fz / contactN
 *     E. CoP 读得回来吗           → soleForceProfile.copX / copValid
 *        若不回来，再细分：总接触点 / 过法线对齐闸 / 过包围盒闸（对齐旧版 dump）
 *
 *   用法：`node tools/run.mjs probe-executor [tau] [joint] [axis]`
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
const JOINT = String(ARGS[1] ?? 'foot_l');
const AXIS = Number(ARGS[2] ?? 2);
const TSTEP = 1.0, TDUR = 0.5;

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.AUTH_TAU = String(TAU);
env.AUTH_T0 = String(TSTEP);
env.AUTH_T1 = String(TSTEP + TDUR);
env.AUTH_AX = String(AXIS);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: TSTEP + TDUR + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll as any;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;
const JI = jointIndexByName(sk, JOINT);
env.AUTH_J = String(JI);
const log = (s: string) => console.log(s);

const G = 9.81;
const N = Math.round((TSTEP + TDUR) * HZ);
log(`══ probe-executor：${JOINT} 轴${AXIS} 阶跃 τ=${TAU} N·m（t=${TSTEP}~${TSTEP + TDUR}s）══`);
log('  t     | CoM.x  vx   | fz(N)  nC | copX  ok | 接触 过法线 过盒 | v4Tau[JI]  τCmd[JI]  motImp');
let x0 = 0, vx0 = 0, cop0 = 0;
const audit = new Float64Array(3);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (t < TSTEP - 0.05) continue;
  const F = d.soleForceProfile(0, DT);
  if (t < TSTEP && t > TSTEP - 0.06) { x0 = rs.com?.x ?? 0; vx0 = rs.com?.vx ?? 0; cop0 = F.copX; }
  if (t >= TSTEP - 0.02 && k % 2 === 0) {
    d.soleContactAudit(0, audit);
    const v4t = d.v4Tau?.[JI] ?? 0;
    const tcmd = d.torqueCmd?.[JI] ?? 0;
    const mi = d.motorImpulse?.[JI] ?? 0;
    const cx = rs.com?.x ?? 0, vx = rs.com?.vx ?? 0;
    log(
      ` ${t.toFixed(3)} |${(cx * 1000).toFixed(1).padStart(7)}${(vx * 1000).toFixed(0).padStart(6)} |` +
      `${F.fz.toFixed(0).padStart(6)}${String(F.contactN).padStart(3)} |` +
      `${(F.copX * 1000).toFixed(0).padStart(5)}${F.copValid ? ' ✔' : ' ✘'} |` +
      `${audit[0].toFixed(0).padStart(4)}${audit[1].toFixed(0).padStart(6)}${audit[2].toFixed(0).padStart(6)} |` +
      `${v4t.toFixed(1).padStart(8)}${tcmd.toFixed(1).padStart(9)}${mi.toFixed(2).padStart(8)}`,
    );
  }
}
log('── 判读 ──');
log('  A τ落地     : v4Tau[JI]/τCmd[JI] 在 t=1.0~1.5 内非零 ⇒ 注入到达');
log('  C 身体被推动 : vx 变化 ⇒ 力真的进了动力学');
log('  D 力到脚上   : fz ≈ 体重(≈700N) ⇒ 体重真压在脚上');
log('  E CoP 可读   : copValid=✔ 且 copX 随 τ 移动 ⇒ 读回通路正常');
log('  接触 过法线 过盒 : 若「接触>0 但 过法线=0」⇒ 法线闸把接触全滤掉（读回坏了）');
