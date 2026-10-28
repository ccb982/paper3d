/**
 * squatPose.ts —— 蹲姿「标准姿势」快照（被动张力的目标来源）
 *
 * ★ 为什么需要它（2026-10-28 实测，tools/_tmp-freeze-dof.ts）：
 *   蹲下法庭的冻结期（静置 2s）里，大腿绕自身纵轴**拧了 47.6°**
 *   （左腿在 +Z 侧 ⇒ 大腿正面转向中线 ⇒ 视觉上「膝盖朝内/内收」），
 *   而 hip 额状轴 / 扭转轴 / 膝额状轴 / 膝扭转轴的**施加力矩全程 = 0 N·m**
 *   ⇒ 这四个轴完全自由，没有任何东西钉住它 ⇒ 纯漂移。
 *
 * ★ 为什么不能用 baseTable 的 ang 表（架构：单一事实来源）：
 *   court.ts 释放瞬间的 `captureAngFrom` 会用**释放时的姿势**覆盖非轴 0 的项
 *   ⇒ 被动张力若查那张表，目标会变成「已经漂歪的姿势」⇒ 治标不治本。
 *   ⇒ 这里存一份**摆姿完成时**的一次性快照（不可被释放流程覆盖）。
 *
 * ★ 快照口径：`d.angle` = 相对 rest 的**控制角**（与 baseTable.ang 同口径）。
 */
import type { Body } from '../body';

/** key = `${name}/${axis}` → 相对 rest 的控制角（rad） */
const _pose = new Map<string, number>();

/**
 * 捕获标准姿势角。**摆姿刚完成时调用一次**（此后不再改）。
 * 只收非矢状轴（axis 2 归矢状基础力/pair 目标），只收可驱动轴。
 */
export function captureSquatStandardPose(body: Body): void {
  _pose.clear();
  for (const d of body.dofs) {
    if (!/^(hip|knee|foot)_/.test(d.name)) continue;
    if (d.axis === 2) continue;      // 矢状面：归 pair 基础力
    if (d.preRing) continue;         // 预环物理锁死（外八静偏）——不可驱动
    if (d.engineMotor) continue;     // 引擎电机自由度——驱动层跳过
    _pose.set(`${d.name}/${d.axis}`, d.angle);
  }
}

/** 查标准姿势角（rad，相对 rest）；undefined = 未捕获 */
export function squatStandardAngle(name: string, axis: number): number | undefined {
  return _pose.get(`${name}/${axis}`);
}

/** 复位（切状态 / 重置世界） */
export function squatPoseReset(): void {
  _pose.clear();
}
