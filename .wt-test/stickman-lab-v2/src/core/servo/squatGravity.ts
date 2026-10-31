/**
 * squatGravity.ts —— 蹲下/起立的动态支撑力矩（2026-10-25 定稿）
 *
 * 定位：动作层的**支撑写手**，只负责托住身体；不参与姿势、不做重心平衡。
 *
 * 为什么站立 gravityComp 屈膝后不能用：
 *   · 站立 gcomp 的脊柱子树力矩按站立构型标定，屈膝后躯干前倾，符号会反；
 *   · 站立 gcomp 的腿项只有子树重力，没有地面反力（GRF），深蹲会把腿算轻。
 *
 * 本模块：
 *   τ_j = −[ Σ子树 m·g·(x−x_j) + N·(CoP−x_j) ]
 *   · 与 squat 伺服 captureSquatBase 同式（子树重力 + 竖直 GRF，CoP=CoM 钳位）；
 *   · 每帧按**当前姿势**算，不依赖目标姿势固定表；
 *   · 用 mapMomentToAxes 把世界系纯矢状 Mz 分解回真实三轴：
 *     轴 0/1 只抵消离轴分量，防止脊柱 S 形把支撑力矩漏成扭转/侧翻。
 *
 * 依据：Winter 1995（GRF/CoP）、Horak & Nashner 1986（踝策略）、
 *       Kuo 1995 / Hof 2005（CoP 与质心），以及用户 2026-10-18“力沿踝→膝→髋→腰传递”。
 */
import type { Body } from '../body';
import { staticBalance } from './staticBalance';
import { mapMomentToAxes, type AdapterAxis } from './ankleAxisAdapter';

export interface SquatSupportOptions {
  /** 支撑倍率（默认 1 = staticBalance 原值） */
  scale?: number;
  /** CoP 前后钳位（m） */
  copXLimit?: number;
  /** CoP 侧向钳位（m） */
  copZLimit?: number;
}

/**
 * 计算动态全身支撑力矩，写入 out[dofIndex]（N·m）。
 * 前提：双脚支撑；CoP 取当前 CoM 投影并钳在脚掌内。
 * 只输出 hip/knee/spine/neck/shoulder/elbow；足部保持 0（由动作层踝角度/CoP 负责）。
 */
export function squatDynamicSupport(body: Body, out: Float64Array, opt: SquatSupportOptions = {}): void {
  out.fill(0);
  const W = body.bodies.reduce((a, b) => a + b.mass(), 0) * 9.81;
  let cx = 0, cz = 0, m = 0;
  for (const rb of body.bodies) {
    const c = rb.worldCom();
    m += rb.mass();
    cx += rb.mass() * c.x;
    cz += rb.mass() * c.z;
  }
  const comX = m > 1e-9 ? cx / m : 0;
  const comZ = m > 1e-9 ? cz / m : 0;
  const foot = (s: 'l' | 'r'): { x: number; z: number } => {
    const i = body.indexByKey.get(`foot_${s}`);
    if (i === undefined) return { x: 0, z: 0 };
    const p = body.bodies[i]!.translation();
    return { x: p.x, z: p.z };
  };
  const fl = foot('l'), fr = foot('r');
  const lx = Math.abs(opt.copXLimit ?? 0.12), lz = Math.abs(opt.copZLimit ?? 0.06);
  const cl = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const buf = new Float64Array(body.dofs.length);
  staticBalance(body, buf, {
    l: { N: W * 0.5, copX: cl(comX, fl.x - lx, fl.x + lx), copZ: cl(comZ, fl.z - lz, fl.z + lz) },
    r: { N: W * 0.5, copX: cl(comX, fr.x - lx, fr.x + lx), copZ: cl(comZ, fr.z - lz, fr.z + lz) },
  });
  const scale = opt.scale ?? 1;
  const groups = ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'spine1', 'spine2', 'spine3', 'neck', 'shoulder_l', 'shoulder_r', 'elbow_l', 'elbow_r'];
  for (const name of groups) {
    const idx: number[] = [];
    const axes: AdapterAxis[] = [];
    let Mz = 0;
    let ok = true;
    for (const ax of [0, 1, 2] as const) {
      const i = body.dofByName(name, ax);
      if (i < 0) { ok = false; break; }
      const d = body.dofs[i]!;
      idx.push(i);
      axes.push({ u: [d.axisWorld[0]!, d.axisWorld[1]!, d.axisWorld[2]!], tauMax: d.tauMax > 0 ? d.tauMax : 200, available: !d.preRing });
      Mz += (buf[i] ?? 0) * d.axisWorld[2]!;
    }
    if (!ok) continue;
    const map = mapMomentToAxes([0, 0, Mz * scale], axes, 1e-4);
    for (let k = 0; k < 3; k++) out[idx[k]!] = map.tau[k] ?? 0;
  }
}
