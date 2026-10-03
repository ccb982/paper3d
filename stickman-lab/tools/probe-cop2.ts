/**
 * 决定性实验：踝 CoP 权限既然是满的，那么**一个两行 PD 能不能站住**？
 *
 * 前置实测（probe-ankauth，与代数无关）：
 *   a_x/a_理论 ≈ 1.2~1.7 随 τ 线性且对称 ⇒ **踝有完整 CoP 权限**
 *   符号：τ 负 ⇒ CoM 往前加速；τ 正 ⇒ 往后
 *
 * 控制器（踝策略最简形式， ankle-only PD on CoM）：
 *     τ = Kp·(x_com − x_ref) + Kd·v_com          ⇒ 经实测符号映射成踝目标角
 *   其余 12 个关节 θ_ref ≡ 0（保持绑定姿态）
 *
 * 判读（预先登记）：
 *   能站满 ⇒ 硬件完全够，"站不住" 100% 是控制器缺失 ⇒ 该做的是补 ankle CoP 通道，
 *            而不是继续扫 kPelvis / kWtX / 踝力矩上限
 *   站不住 ⇒ 踝权限在闭环里被腿/腰的耦合吃掉，要看是哪个自由度在拆台
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
    if (typeof fn !== 'function') throw new Error(`[probe-cop2] wasm 导入缺失 ${imp.module}::${imp.name}`);
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
const DUR = Number(process.argv[3] ?? 20) || 20;
const log = console.log;

const FL = jointIndexByName(sk, 'foot_l');
const FR = jointIndexByName(sk, 'foot_r');
const AX = 2;
const ANK_TAU = 45;
const ANK_RANGE = 0.2618;
const out = new Float64Array(SHAPE.outputs);
const com = newCom();
const sup = newSupport();

readCom(new Sim(sk, SHAPE, DEFAULT_SIM).doll, com);
const X0 = com.x;
log('踝策略最简验证：τ_ankle = Kp·(x_com − x_ref) + Kd·v_com，仅踝动作，其余 12 关节保持 0');
log(`  x_ref = 初始 CoM.x = ${X0.toFixed(4)} m`);
log('');
log('   Kp    Kd    存活      终倾°   峰|τ|   终ξx    终ξz    终comX  终comY  峰踝指令°');
log('  ──────────────────────────────────────────────────────────────────────────');

let best = { alive: 0, kp: 0, kd: 0 };
for (const kp of [0, 200, 400, 800, 1600]) {
  for (const kd of [0, 150, 300, 600]) {
    if (kp === 0 && kd !== 0) continue;
    const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, duration: DUR, mode: 'stand' });
    sim.begin(new Float32Array(sim.params.length));
    out.fill(0);
    let peakTau = 0, peakCmd = 0;
    const steps = Math.round(DUR / DT);
    for (let i = 0; i < steps && !sim.finished; i++) {
      if (i % 2 === 0) {
        readCom(sim.doll, com);
        const tau = kp * (com.x - X0) + kd * com.vx;
        const cl = Math.max(-ANK_TAU, Math.min(ANK_TAU, tau));
        if (Math.abs(cl) > peakTau) peakTau = Math.abs(cl);
        // ★ 实测符号：τ 正 ⇒ CoM 往后。所以目标角 ∝ +τ。
        const c = (cl / ANK_TAU) * 0.9;
        out[FL * 3 + AX] = c; out[FR * 3 + AX] = c;
        if (Math.abs(c) > peakCmd) peakCmd = Math.abs(c);
      }
      sim.doll.setMotorTargets(out);
      sim.advance(1);
    }
    readCom(sim.doll, com); readSupport(sim.doll, sup);
    const w = omegaAt(com.y);
    const alive = sim.ticksDone / sim.cfg.controlHz;
    if (alive > best.alive) best = { alive, kp, kd };
    log(`  ${String(kp).padStart(5)} ${String(kd).padStart(5)}  `
      + `${(alive >= DUR - 0.05 ? '站满' : alive.toFixed(2) + 's').padStart(8)}`
      + `  ${(sim.endTilt * 57.2958).toFixed(1).padStart(6)}  ${peakTau.toFixed(0).padStart(6)}`
      + `  ${dcm(com.x, com.vx, w).toFixed(3).padStart(7)}  ${dcm(com.z, com.vz, w).toFixed(3).padStart(7)}`
      + `  ${com.x.toFixed(3).padStart(7)}  ${com.y.toFixed(3).padStart(7)}  ${(peakCmd * 15).toFixed(1).padStart(8)}`);
  }
}
log('');
log(`  最佳：Kp=${best.kp} Kd=${best.kd} → 存活 ${best.alive.toFixed(2)}s / ${DUR}s`);
log(`  零输出基线：5.53s 倒（bodyHitGround）`);
void sup;