/**
 * squatGravity.ts —— 蹲姿/下蹲/起立专用的“上身重力补偿”（2026-10-25 用户定调）
 *
 * 为什么站立 gravityComp 屈膝后不能用：
 *   · 站立 gcomp 的脊柱项只算子树重力，符号/量级是站立构型标定的；
 *   · 屈膝后躯干前倾、骨盆后移，脊柱力矩会反号（实测脊柱从 −115 变为 +114）；
 *   · 站立 gcomp 的腿项只算子树，不含地面反力（GRF），蹲姿下会把腿算轻。
 *
 * 本模块只做**上身**（spine/neck/shoulder/elbow）：
 *   τ_j = −[ Σ子树 m·g·(x−x_j) + N·(CoP−x_j) ]
 * 与 staticBalance 同式（子树重力 + 竖直 GRF），但由动作层每帧按**当前姿势**调用，
 * 不再依赖目标姿势的固定表。腿的支撑仍由动作层标定力矩 + FootContactServo 负责。
 *
 * 依据：Winter 1995（GRF/CoP）、Horak & Nashner 1986（踝策略）、
 *       Kuo 1995 / Hof 2005（CoP 与质心），以及用户 2026-10-18“力沿踝→膝→髋→腰传递”。
 */
import type { Body } from '../body';
import { staticBalance } from './staticBalance';
import { mapMomentToAxes, type AdapterAxis } from './ankleAxisAdapter';

export interface SquatUpperGravityOptions {
  /** 上身补偿倍率（默认 1 = staticBalance 原值） */
  scale?: number;
  /** CoP 前后钳位（m） */
  copXLimit?: number;
  /** CoP 侧向钳位（m） */
  copZLimit?: number;
}

/**
 * 计算上身重力补偿，写入 out[dofIndex]（N·m；腿的项保持 0）。
 * 前提：双脚支撑；CoP 取当前 CoM 投影并钳在脚掌内。
 */
/**
 * 动态全身支撑力矩（下蹲/起立过渡用）：
 *   与 squat 伺服 captureSquatBase 同一公式（子树重力 + 竖直 GRF，CoP=CoM 钳位），
 *   但每帧按**当前姿势**算；只输出矢状轴（axis 2），足部保持 0（FootContactServo 负责）。
 *   hip/knee/spine/neck/shoulder/elbow 全部由这一个写手给前馈。
 */
export function squatDynamicSupport(body: Body, out: Float64Array, opt: SquatUpperGravityOptions = {}): void {
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
  // ★★★ 矢量分解（用户 2026-10-21：'基础力需要矢量分解到关节各个轴上，只允许矢状面'）：
  //   staticBalance 给的是各轴力矩；直接只写 axis2 时，脊柱轴不纯 z（S 形曲线），
  //   114 N·m 的轴 2 力矩会漏到扭转/侧向 → 上身扭。这里先把该关节的支撑力矩合成
  //   世界系 Mz，再用 mapMomentToAxes 分解回真实轴（轴 0/1 只用来抵消离轴分量）。
  const groups: string[][] = [
    ['hip_l'], ['hip_r'], ['knee_l'], ['knee_r'],
    ['spine1'], ['spine2'], ['spine3'], ['neck'],
    ['shoulder_l'], ['shoulder_r'], ['elbow_l'], ['elbow_r'],
  ];
  for (const names of groups) {
    for (const name of names) {
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
}

export function squatUpperGravityComp(body: Body, out: Float64Array, gY: number, opt: SquatUpperGravityOptions = {}): void {
  out.fill(0);
  void gY;
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
  const tmp = new Float64Array(out.length);
  squatDynamicSupport(body, tmp, opt);
  for (const d of body.dofs) {
    if (!/^(spine|neck|shoulder|elbow)/.test(d.name)) continue;
    if (d.engineMotor) continue;
    out[d.dofIndex] = tmp[d.dofIndex]!;
  }
}
