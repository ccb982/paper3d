/**
 * ══════════════════════════════════════════════════════════════════
 * probe-authority.ts —— **执行力/权限测试**（足 · 腰 · 骨盆 · 髋外展）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-04：「先保证足部，腰部，盆骨真能发力，重心真能转移，
 *                   再做限制保证不过度。」
 *
 * ⇒ 本探针只回答"**能不能**"，不回答"**该不该**"：
 *   对每条通道在**着地站立**这个真实构型下施加已知力矩/目标角，量三件事：
 *     ① 实际产生了多大关节力矩（发力）
 *     ② CoM 横向移动了多少 mm（转移）
 *     ③ 两侧载荷分配变了多少（这是"转移"在物理上唯一有意义的证据）
 *   并同时记录躯干倾角与存活 —— 因为"把身体掀翻"也是一种"出力"，
 *   必须和"有效转移"区分开。
 *
 * ★ 为什么必须在**着地**构型下测：
 *   之前在**悬空**构型（腿自由、人在空中）测过一次，结论是
 *   「髋/1 外展 Δz = 0、腰 spine1/0 Δz = 35mm」，据此判定"额状面只能走躯干"。
 *   那个结论**不能用来判断站立**：脚踩在地上时髋外展能通过地面反力起作用，
 *   悬空时它确实无处发力 —— 两者的差别正是本探针要量的东西。
 *
 * 用法：node tools/run.mjs probe-authority
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
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
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');

const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const DUR = 6;

interface Row {
  tag: string;
  dComZ: number;      // mm
  dLoad: number;      // 载荷差变化（0..1），正 = 支撑腿承重更多
  tilt: number;       // 终倾角 deg
  tauApplied: number; // 实际产生的关节力矩 N·m
  alive: boolean;
  secs: number;
  fell: string;
}

/**
 * 施加一路恒定力矩（或恒定目标角），测权限。
 * 走 `controller` 驱动但**只留一条通道** —— 其余全部消融，
 * 这样测到的位移一定归因于该通道。
 */
function run(
  tag: string,
  axis: { joint: number; axis: number },
  mode: 'torque' | 'angle',
  amount: number,
): Row {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: DUR, driver: 'controller' });
  sim.begin(new Float32Array(sim.paramCount));

  // 控制器：只留垂直支撑（让身体别塌），把要测的通道换成恒定激励。
  const bal: Record<string, unknown> = {
    // 关掉所有会自己动的通道，避免和激励打架
    ablate: 'torso,latwaist,pelvicLift,lat',
    lateralEnabled: false,
    torqueControl: false,
  };
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
    balance: { ...DEFAULT_CONTROLLER.balance, ...bal },
  });

  const n = Math.round(DUR * 120);
  let tauPeak = 0;
  for (let i = 0; i < n && !sim.finished; i++) {
    if (i % 2 === 0) {
      // 每拍：先让控制器提需求（提供基础支撑），再叠加恒定激励
      const out = ctrl.step(1 / 60);
      const idx = axis.joint * 3 + axis.axis;
      if (mode === 'torque') {
        // ⚠ Controller.step() 内部**已经**调过 setTorqueTargets(rs.tauOut)，
        //   所以光写 tauOut 不会生效 —— 必须写完再补一次发送。
        //   （第一版漏了这一句 ⇒ 所有力矩行的 Δ 全是 0，探针自己骗了自己。）
        ctrl.rs.tauOut[idx] = amount;
        sim.doll.setTorqueTargets(ctrl.rs.tauOut);
      } else {
        out[idx] = amount;
      }
      sim.doll.setMotorTargets(out);
      for (const v of ctrl.rs.tauOut) tauPeak = Math.max(tauPeak, Math.abs(v ?? 0));
    }
    sim.advance(1);
  }
  const s = ctrl.snapshot;
  // 减掉"同一时刻不开激励"的基线（下表里直接用第一次跑出的 base）
  return {
    tag, dComZ: s.com.z, dLoad: s.legs.l.loadFrac, tilt: s.tiltDeg,
    tauApplied: tauPeak, alive: !sim.fallReason, fell: String(sim.fallReason), secs: sim.ticksDone / 60,
  };
}

const HIP_L = jointIndexByName(sk, 'hip_l');
const KNEE_L = jointIndexByName(sk, 'knee_l');
const SP1 = jointIndexByName(sk, 'spine1');

log('══ 执行力测试：着地站立，各通道能产生多少 CoM 横移与载荷转移 ══');
log('   （Δ列为相对"零输出基线"的变化；站距 ≈326mm，CoM 需移动 ~161mm 才算完全转移）');

const base = run('基线', { joint: -1, axis: 0 }, 'torque', 0);
log('');
log(`  基线（零输出）：CoM.z=${(base.dComZ * 1000).toFixed(0)}mm  载荷L=${(base.dLoad * 100).toFixed(0)}%  存活 ${base.secs.toFixed(1)}s`);
log('');

const CASES: [string, { joint: number; axis: number }, 'torque' | 'angle', number[]][] = [
  ['髋外展 hip_l/0 (力矩)', { joint: HIP_L, axis: 0 }, 'torque', [-20, -40, -70, -110]],
  ['髋屈伸 hip_l/2 (力矩)', { joint: HIP_L, axis: 2 }, 'torque', [-40, -80]],
  ['腰侧倾 spine1/0 (力矩)', { joint: SP1, axis: 0 }, 'torque', [-20, -42, -80]],
  ['腰侧倾 spine1/0 (目标角)', { joint: SP1, axis: 0 }, 'angle', [0.08, 0.17, 0.26]],
  ['膝伸展 knee_l/2 (目标角)', { joint: KNEE_L, axis: 2 }, 'angle', [-0.26]],
];

for (const [name, ax, mode, amounts] of CASES) {
  log(`  ── ${name}`);
  log('     施加      ΔCoM.z     Δ载荷L    终倾角   τ实际   结果');
  for (const a of amounts) {
    const r = run(name, ax, mode, a);
    const dCom = (r.dComZ - base.dComZ) * 1000;
    const dLd = (r.dLoad - base.dLoad) * 100;
    const unit = mode === 'torque' ? 'N·m' : 'rad';
    log(`     ${String(a).padStart(6)}${unit}`
      + ` ${dCom.toFixed(0).padStart(8)}mm ${dLd.toFixed(0).padStart(7)}%`
      + ` ${r.tilt.toFixed(1).padStart(7)}° ${r.tauApplied.toFixed(0).padStart(6)}`
      + `   ${r.alive ? '✓ 存活 ' + r.secs.toFixed(1) + 's' : `✗ ${r.fell || '倒'} 于 ${r.secs.toFixed(1)}s`}`);
  }
  log('');
}

log('★ 判读');
log('  · Δ载荷L 是"转移"的**唯一物理证据**：CoM 移动若不伴随载荷重分配，');
log('    那只是身体在晃/倾，不是在转移重心。');
log('  · 髋外展若 Δ载荷L 大而 ΔCoM.z 小 ⇒ 力矩被用来"掀"而不是"移"。');
log('  · 腰侧倾若能显著改变 Δ载荷L ⇒ 它才是解锁摆动侧卸载的主动作。');