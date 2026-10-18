/**
 * staticBalance.ts —— 约束静态平衡（2026-10-18 用户：'约束动力学控制器/快做吧'）
 *
 * 问题：蹲姿的逐关节手调永远解不出"姿势+脚+体重"自洽的力矩（今天 10 小时实验的结论）。
 *
 * 正解：**每帧从约束出发算力矩**——以"脚踩地"为前提，逐关节解自由体平衡：
 *
 *   腿链（踝/膝/髋）：子树（关节到脚之间的体重）+ **地面反力项** N×(CoP−x_j)
 *     —— N 用**期望值**（体重按脚分配），不用传感器（下坠时 fz→0 会把需求算成 0）
 *     —— CoP 用 CoM 投影钳位在脚内（平衡时 CoP≈CoM）
 *   上身（脊柱/颈/头）：子树（关节上方体重）——无地面项（GRF 在关节下方）
 *
 *   τ_j = −[ N×(cop − x_j) + Σ_{子树} m·g·(x − x_j) ]   （绕关节横轴，矢状面）
 *
 * 与"互补子树"的区别：互补子树用**关节上方全部体重**（含对侧腿、含头臂的完整链），
 * 数值会放大 2-10 倍（实测 ±200-700=链爆）；本模块用**自由体子树+GRF**（CH 回读验证：
 * 标准姿势需求=踝0/膝±4/髋−25，与实测稳定值一致）。
 */
import type { Body } from '../body';

/** 每只脚的约束输入 */
export interface FootConstraint {
  /** 期望法向力（N；体重按脚分配——不用传感器） */
  N: number;
  /** 压力中心 x（世界米；平衡时≈CoM 投影，已钳位在脚内） */
  copX: number;
}

const G = 9.81;

/**
 * 计算支撑所需力矩，写入 out[dofIndex]（N·m，未限幅——由 executor 按 τmax 削）。
 * 前提：双脚支撑、矢状面为主。非腿关节只用子树（无地面项）。
 */
export function staticBalance(body: Body, out: Float64Array, feet: { l: FootConstraint; r: FootConstraint }): void {
  for (const d of body.dofs) {
    if (d.engineMotor) { out[d.dofIndex] = 0; continue; }
    const a = d.anchorWorld;
    const u = d.axisWorld;
    // 子树（关节远端侧：腿=脚侧、上身=上方）——body.subtree 已按关节建好
    let tau = 0;
    for (const bi of body.subtree[d.joint]!) {
      const rb = body.bodies[bi]!;
      const c = rb.worldCom();
      const Fy = rb.mass() * -G;   // 重力向下
      const rx = c.x - a[0]!;
      const rz = c.z - a[2]!;
      tau += u[0]! * (-rz * Fy) + u[2]! * (rx * Fy);
    }
    // 地面反力项（仅腿链：本侧脚）
    const legM = /^(hip|knee|foot|ankle)_/.test(d.name) ? d.name.match(/_([lr])$/) : null;
    if (legM) {
      const f = legM[1] === 'l' ? feet.l : feet.r;
      const rx = f.copX - a[0]!;
      const Fy = f.N;   // 反力向上
      tau += u[2]! * (rx * Fy);
    }
    // ★ 撤翻转（实测更糟：腰 -45 快折）；★ 加强髋/上身（用户：'要成了'）——增益可调
    const e = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    let g = 1;
    if (/^hip_/.test(d.name)) g = Number(e.SQB_GH ?? 2.5);      // 髋 ×2.5（实测：夹住骨盆 136→139）
    else if (/^spine3/.test(d.name)) g = Number(e.SQB_G3 ?? 2.0);   // ★ 末段单独补（胸原地旋转=俯仰源）
    else if (/^(spine|neck)/.test(d.name)) g = Number(e.SQB_GU ?? 1.0);
    // ★ 脊柱符号：不翻（实测不翻=伸展/上升、翻=折叠——需求在两者之间，靠 GU 缩到量级）
    out[d.dofIndex] = -g * tau;
  }
}
