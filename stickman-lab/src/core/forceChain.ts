/**
 * ★★★ 力链分析（2026-10-06）—— **状态机拥有，平衡系统只读**
 *
 *   用户定调：
 *   「平衡链路要从脚步开始算」「优先调整脚部发力的**力度和方向**」
 *   「需要**正确实现力链的分析**放在**状态机**里，供平衡系统使用」
 *
 *   架构依据见 `架构_v2_三模块协作.md` §20，文献依据：
 *     · Morasso 2020（PMC9713939）：**踝策略 = CoP 策略**，踝力矩**直接**调控 CoP；
 *       髋策略 = CoM 策略（踝不传主动力矩 ⇒ 调不了 CoP）。
 *     · Winter 1996（J Neurophysiol 75:2334）：并步站姿 **A/P 归踝、M/L 归髋**；
 *       随机样的 CoP 散点是「load/unload 线」与「踝控制线」两条规则的叠加。
 *     · Wright 2012：**脚掌是内置测力台**，CoP 估计的第一来源就在脚底。
 *     · Usherwood 2012（9:2396）：**CoP 偏离踝心才有踝力矩**（力臂），
 *       vault 段 GRF 过踝 ⇒ 力臂 ≈0 ⇒ 肌肉几乎不加载。
 *
 *   ── 为什么放在状态机这一层 ──────────────────────────────────────
 *   CoP / GRF / 力臂是**测量层**，但只有状态机同时握有
 *   「接触原始量 + 帧域 + 承接/承重角色 + 本态驻留」，能把它算成**逐态可用**的量。
 *   `balance.ts` 不该自己重建这套口径 —— 本项目已经栽过两套口径打架的坑。
 *
 *   ── L0 的诚实声明 ──────────────────────────────────────────────
 *   Rapier 的 `contactPairsWith` 会返回**预测性接触**（形状没碰但进了预测距离），
 *   这种接触 `numContacts() > 0` 但 `contactImpulse(k) ≈ 0`。
 *   旧代码把「冲量之和 ≈ 0」静默兜底成 `[0.5, 0.5]`，于是
 *   **有接触、没载荷**这种自相矛盾的状态被伪装成"两脚各承担一半"。
 *   ⇒ 这里一律**显式给有效性**（`valid` / `trustNote`），绝不用假值凑数。
 */

import type { FootForce, ForceChain, ForceSource, RigState, Side } from './rigState';

/** 合力低于此值就认为"没有有效载荷"（N）。低于体重 1% 视为噪声。 */
const FZ_MIN_N = 15;
/** CoP 相对踝心超出足长一半 ⇒ 物理上不可达，标为不可信 */
const COP_MAX_ARM = 0.5; // 由调用方按足长换算，这里只做比例检查

/**
 * ★ 组装完整力链（全局 CoP、GRF 方向、Winter 两条控制线、踝力臂、倾覆力矩、τ 余量）。
 *
 * @param ankleX/l 每只脚**踝关节**的世界 x（踝力矩的力臂原点）
 * @param comX/comZ 全局重心
 * @param massKg 质量（kg）
 */
export function buildForceChain(
  l: FootForce,
  r: FootForce,
  ankle: Record<Side, { x: number; z: number }>,
  com: { x: number; z: number },
  massKg: number,
  tauMax: { sag: number; lat: number },
  footHalfLen: number,
): ForceChain {
  const bothValid = l.copValid && r.copValid;
  const oneValid = l.copValid || r.copValid;

  // ── 全局 CoP：按法向力加权 ──
  const wsum = (l.copValid ? l.fz : 0) + (r.copValid ? r.fz : 0);
  const copValid = wsum > FZ_MIN_N;
  const copX = copValid ? ((l.copValid ? l.fz * l.copX : 0) + (r.copValid ? r.fz * r.copX : 0)) / wsum : 0;
  const copZ = copValid ? ((l.copValid ? l.fz * l.copZ : 0) + (r.copValid ? r.fz * r.copZ : 0)) / wsum : 0;

  // ── GRF 大小与方向（用户要的"力度和方向"）──
  const grfX = l.fx + r.fx;
  const grfY = l.fz + r.fz;
  const grfZ = l.fzTan + r.fzTan;
  const grfAngleDeg = grfY > 1e-6 ? (Math.atan2(Math.hypot(grfX, grfZ), grfY) * 180) / Math.PI : 0;

  // ── Winter 1996 的两条控制线 ──
  //   load/unload 线 = 两脚 CoP 连线（髋机制：搬运重量）
  //   踝控制线 = 与其垂直（踝机制：前后倾）
  let luX0 = l.copValid ? l.copX : ankle.l.x;
  let luZ0 = l.copValid ? l.copZ : ankle.l.z;
  let luX1 = r.copValid ? r.copX : ankle.r.x;
  let luZ1 = r.copValid ? r.copZ : ankle.r.z;
  if (!l.copValid && !r.copValid) { luX0 = 0; luZ0 = 0; luX1 = 1; luZ1 = 0; }
  const dx = luX1 - luX0;
  const dz = luZ1 - luZ0;
  const dl = Math.hypot(dx, dz) || 1;
  const ankleNx = -dz / dl;   // 垂直单位向量
  const ankleNz = dx / dl;

  // ── 踝力臂：Usherwood 的"力臂" —— CoP 偏离踝心才有踝力矩 ──
  const bear: Side = r.copValid && r.fz > l.fz ? 'r' : 'l';
  const armSag = copX - ankle[bear].x;
  const armLat = copZ - ankle[bear].z;

  // ── 重力倾覆力矩 + 踝需求力矩 + 余量 ──
  const g = 9.81;
  const toppleSag = massKg * g * (com.x - copX);
  const toppleLat = massKg * g * (com.z - copZ);
  const tauReqSag = toppleSag;
  const tauReqLat = toppleLat;
  const tauMarginSag = tauMax.sag - Math.abs(tauReqSag);
  const tauMarginLat = tauMax.lat - Math.abs(tauReqLat);

  // ── 可信度与原因（人话，给 UI）──
  let trustNote = '';
  if (!oneValid) {
    trustNote = '两脚都读不到有效载荷 ⇒ 力链不可信（检查接触冲量）';
  } else if (!bothValid) {
    trustNote = '只有一脚读到有效载荷 ⇒ CoP 加权只用这一脚';
  } else if (Math.abs(armSag) > COP_MAX_ARM * footHalfLen * 2) {
    trustNote = 'CoP 跑到踝心外过远 ⇒ 力臂已超出足长，物理上不可达';
  }

  return {
    l, r,
    copX, copZ, copValid,
    grfX, grfY, grfZ, grfAngleDeg,
    lines: { luX0, luZ0, luX1, luZ1, ankleNx, ankleNz },
    armSag, armLat,
    toppleSag, toppleLat,
    tauReqSag, tauMarginSag,
    tauReqLat, tauMarginLat,
    trustable: copValid && trustNote === '',
    trustNote: trustNote || 'ok',
  };
}

/** 力链 → UI 可直接渲染的几行（**已格式化**，UI 不做换算） */
export function forceChainLines(fc: ForceChain): string[] {
  const n = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const m = (v: number, d = 0): string => (Number.isFinite(v) ? v.toFixed(d) : '—');
  return [
    `CoP 全局 (${n(fc.copX * 1000)}, ${n(fc.copZ * 1000)}) mm ${fc.copValid ? '' : '**无效**'}`,
    `  左 (${n(fc.l.copX * 1000)}, ${n(fc.l.copZ * 1000)}) ${m(fc.l.fz)}N`
      + `　右 (${n(fc.r.copX * 1000)}, ${n(fc.r.copZ * 1000)}) ${m(fc.r.fz)}N`
      + `　接触块 ${fc.l.contactN}/${fc.r.contactN}`,
    `GRF ${m(Math.hypot(fc.grfX, fc.grfY, fc.grfZ))}N 方向 ${n(fc.grfAngleDeg, 1)}°`,
    `踝力臂 sag ${n(fc.armSag * 1000)}mm  lat ${n(fc.armLat * 1000)}mm`,
    `倾覆力矩 sag ${n(fc.toppleSag, 1)} lat ${n(fc.toppleLat, 1)} N·m`,
    `踝余量 sag ${n(fc.tauMarginSag, 1)} lat ${n(fc.tauMarginLat, 1)} N·m`
      + `（负 = 必然倒）`,
    `可信：${fc.trustable ? '是' : '否 — ' + fc.trustNote}`,
  ];
}

/**
 * ★★ 状态机侧的**力链组装**（用户：「力链的分析放在状态机里，供平衡系统使用」）。
 *
 *   每拍调用一次：从 `ForceSource` 取原始读数 → 组装成 `ForceChain` →
 *   发布到 `rs.groundChain`。平衡系统**只准读 `rs.groundChain`**。
 */
export function buildGroundChain(src: ForceSource, rs: RigState): ForceChain {
  const l = src.sole(0);
  const r = src.sole(1);
  const ankle: Record<Side, { x: number; z: number }> = { l: src.ankle(0), r: src.ankle(1) };
  return buildForceChain(
    l, r, ankle,
    { x: rs.com.x, z: rs.com.z },
    src.massKg(), src.tauMax(), src.footLen(),
  );
}
