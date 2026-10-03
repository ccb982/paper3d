/**
 * 单腿站立 —— 这是 `stand` 模式的真验收口径（`ts.single = sw.single·accSingle`，
 * `accSingle` = **恰好一脚着地**的时间占比）。
 *
 * ★ 与 `probe-cop2` 的区别（别混用）：
 *   probe-cop2  两个踝都驱动 ⇒ 那是**双脚**站立，20s 不代表单腿。
 *   本文件只驱动**支撑腿**的踝，另一条腿抬起来。
 *
 * 控制器（全部按 probe-ankauth 实测的符号，不猜）：
 *   矢状面 τ_x = Kp·(x_com − x_ref) + Kd·v_x   ⇒ 踝 pitch，τ 正 ⇒ CoM 往后
 *   额状面 τ_z = Kpz·(z_com − z_ref) + Kdz·v_z ⇒ 踝 roll
 *   膝：锁在轻微屈曲 15°（Li & Levine 2010：真人支撑期膝角近似恒定）
 *   摆动腿：髋屈 + 膝屈把脚抬离地面
 *
 * 文献给的难度（用来判断结果是否合理，不是用来 excuses）：
 *   Hof2005：双脚 b_min = 64mm（→ 196mm/s），**单脚 b_min = 15.5mm（→ 47mm/s）**
 *   Mummolo2021（Front Robot AI）：单脚平底最大可恢复 CoM 速度 +0.484 / −0.292 m/s
 *   ⇒ 单腿比双脚紧约 4 倍；侧向被动半宽从 0.139m 掉到约 0.07m
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe-oneleg] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    (await WebAssembly.instantiate(compiled, imports)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { newCom, readCom, newSupport, readSupport, omegaAt, dcm } = await import('../src/core/posture');

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);   // ★ 12 关节；BRAIN_SHAPE 是 9 关节的默认值
const SHAPE = shapeForJoints(sk.joints.length);
const DT = 1 / 120;
const DUR = Number(process.argv[3] ?? 15) || 15;
const log = console.log;

const J = {
  footL: jointIndexByName(sk, 'foot_l'), footR: jointIndexByName(sk, 'foot_r'),
  hipL: jointIndexByName(sk, 'hip_l'), hipR: jointIndexByName(sk, 'hip_r'),
  knL: jointIndexByName(sk, 'knee_l'), knR: jointIndexByName(sk, 'knee_r'),
};
const SAG = 2, LAT = 0;
const ANK_TAU = 45, ANK_RANGE = 0.2618;
const out = new Float64Array(SHAPE.outputs);
const com = newCom();
const sup = newSupport();

// 基准 CoM（零输出站姿）
{
  const s0 = new Sim(sk, SHAPE, DEFAULT_SIM);
  s0.begin(new Float32Array(s0.params.length));
  readCom(s0.doll, com);
}
const X0 = com.x, Z0 = com.z;
log('单腿站立 —— 支撑腿 = 左，摆动腿 = 右（髋屈+膝屈抬脚）');
log(`  x_ref=${X0.toFixed(4)}  z_ref=${Z0.toFixed(4)}   侧面被动半宽 ≈ 0.07 m（单脚）`);
log('');
log('  Kp    Kd   Kpz  Kdz  抬腿°  存活    终倾°  单脚占比  离地峰mm  终ξx    终ξz    终comX  终comZ');
log('  ──────────────────────────────────────────────────────────────────────────────────');

let best = { alive: 0, cfg: '' };
for (const kp of [0, 200, 400]) {
  for (const kdz of [0, 60, 150]) {
    const kpz = kdz * 2;
    const liftDeg = 25;
    const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, duration: DUR, mode: 'stand' });
    sim.begin(new Float32Array(sim.params.length));
    out.fill(0);
    let peakLift = 0, singleTicks = 0, ticks = 0;
    const steps = Math.round(DUR / DT);
    for (let i = 0; i < steps && !sim.finished; i++) {
      if (i % 2 === 0) {
        readCom(sim.doll, com);
        // 支撑腿 = 接地那只；本测试期望一直是左脚着地
        const supL = sim.doll.footGrounded(0);
        const jf = supL ? J.footL : J.footR;
        const jh = supL ? J.hipL : J.hipR;
        const jk = supL ? J.knL : J.knR;
        const jo = supL ? J.hipR : J.hipL;   // 摆动腿
        const ko = supL ? J.knR : J.knL;

        // 矢状面：踝 CoP PD
        const taux = kp * (com.x - X0);
        out[jf * 3 + SAG] = Math.max(-0.9, Math.min(0.9, (taux / ANK_TAU) * 0.9));
        // 额状面：踝 roll CoP PD
        const tauz = kpz * (com.z - Z0) + kdz * com.vz;
        out[jf * 3 + LAT] = Math.max(-0.9, Math.min(0.9, (tauz / ANK_TAU) * 0.9));

        // 支撑膝：锁轻微屈曲 15°
        const kAng = sim.doll.jointAngle(jk);
        const kTgt = -15 / 57.2958;
        out[jk * 3 + SAG] = Math.max(-0.6, Math.min(0.6, -(kAng - kTgt) * 1.5));

        // 摆动腿：髋屈 + 膝屈抬脚
        out[jo * 3 + SAG] = liftDeg / 57.2958 / 1.0;
        out[ko * 3 + SAG] = -1.2 * liftDeg / 57.2958;
        void jh;
      }
      sim.doll.setMotorTargets(out);
      sim.advance(1);
      ticks++;
      const n = (sim.doll.footGrounded(0) ? 1 : 0) + (sim.doll.footGrounded(1) ? 1 : 0);
      if (n === 1) singleTicks++;
      const clr = sim.doll.soleY(1);
      if (clr > peakLift) peakLift = clr;
    }
    readCom(sim.doll, com); readSupport(sim.doll, sup);
    const w = omegaAt(com.y);
    const alive = sim.ticksDone / sim.cfg.controlHz;
    const ratio = singleTicks / Math.max(1, ticks);
    const cfgStr = `${kp}/${kdz}/${liftDeg}`;
    if (alive * ratio > best.alive) best = { alive: alive * ratio, cfg: cfgStr };
    log(`  ${String(kp).padStart(4)} ${String(kdz).padStart(4)} ${String(kpz).padStart(5)} ${String(kdz).padStart(5)}`
      + `  ${String(liftDeg).padStart(5)}  ${(alive >= DUR - 0.05 ? '站满' : alive.toFixed(2) + 's').padStart(7)}`
      + `  ${(sim.endTilt * 57.2958).toFixed(1).padStart(6)}  ${(ratio * 100).toFixed(0).padStart(7)}%`
      + `  ${(peakLift * 1000).toFixed(0).padStart(8)}  ${dcm(com.x, com.vx, w).toFixed(3).padStart(7)}`
      + `  ${dcm(com.z, com.vz, w).toFixed(3).padStart(7)}  ${com.x.toFixed(3).padStart(7)}  ${com.z.toFixed(3).padStart(7)}`);
  }
}
log('');
log(`  最佳 Kp/Kd/抬腿 = ${best.cfg}   （存活 × 单脚占比 = ${best.alive.toFixed(2)}）`);
log('  验收口径 stand 模式：单脚着地占比要高 + 存活 ≥ 3s');
void sup; void ANK_RANGE;