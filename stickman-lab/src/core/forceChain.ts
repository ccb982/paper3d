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

/**
 * ★★★ **力链低通时间常数**（秒）—— 见 `RigState.ffFlt` 的注释。
 *   80 ms 的依据：脚部接触噪声的周期 = **2 个控制拍**（1/30 s ≈ 33 ms，
 *   `probe-footforce` 记录的"周期-2"），而有效信号（重心转移）的时间尺度
 *   是 **0.3~1 s** ⇒ 80 ms 能压掉噪声、又不拖慢有效信号（相位滞后 ~80ms 可接受，
 *   与人体踝策略的 ~100 ms 反应延迟同量级）。
 */
const FORCE_FLT_TAU_DEFAULT = 0.08;
/** 运行时可变（研究开关）：0 = 关闭低通（A/B 用） */
export let FORCE_FLT_TAU = FORCE_FLT_TAU_DEFAULT;
/** 设置低通时间常数（0 = 关）。`Controller` 按消融名 `forceFlt` 调用。 */
export function setForceFilterTau(t: number): void { FORCE_FLT_TAU = t; }

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
  /** ★ 重心水平加速度（m/s²，已低通）—— 真实水平地面反力的唯一来源 */
  comA: { x: number; z: number } = { x: 0, z: 0 },
  /** ★ 侧向支撑多边形（世界 z，m）：两脚鞋底包围盒的并集 */
  support: { min: number; max: number; lMin: number; lMax: number; rMin: number; rMax: number } | null = null,
): ForceChain {
  const bothValid = l.copValid && r.copValid;
  const oneValid = l.copValid || r.copValid;

  // ── ★ 水平地面反力：`ΣF_水平 = m·a_com`（牛顿第二定律）──
  //   为什么不用 Rapier 的切向冲量：`contactTangentImpulseX/Y` 实测**恒 0/NaN**
  //   （`probe-footlat` Q1：138 拍 Σ|f_t| = 0.0）⇒ 那条路已证死。
  //   ⚠ 诚实声明：`m·a_com` 给的是**两脚合计**；按法向载荷分配到单脚是**估计**
  //     （内力对会互相抵消：两脚对推时合计为 0，而单脚确实在发力）。
  //     ⇒ 单脚的 `fx`/`fzTan` 当"合力分配"读，不当"接触测力"读。
  const fzTot = l.fz + r.fz;
  const wl = fzTot > FZ_MIN_N ? l.fz / fzTot : 0.5;
  const wr = fzTot > FZ_MIN_N ? r.fz / fzTot : 0.5;
  const grfX = massKg * comA.x;
  const grfZ = massKg * comA.z;
  l.fx = grfX * wl; r.fx = grfX * wr;
  l.fzTan = grfZ * wl; r.fzTan = grfZ * wr;

  // ── 全局 CoP：按法向力加权 ──
  const wsum = (l.copValid ? l.fz : 0) + (r.copValid ? r.fz : 0);
  const copValid = wsum > FZ_MIN_N;
  const copX = copValid ? ((l.copValid ? l.fz * l.copX : 0) + (r.copValid ? r.fz * r.copX : 0)) / wsum : 0;
  const copZ = copValid ? ((l.copValid ? l.fz * l.copZ : 0) + (r.copValid ? r.fz * r.copZ : 0)) / wsum : 0;

  // ── GRF 大小与方向（用户要的"力度和方向"）──
  //   ⚠ 旧代码写 `grfX = l.fx + r.fx`，而 `fx/fzTan` 当时**恒 0**（`soleForceProfile` 硬编码）
  //     ⇒ "方向"永远是 0.0°。现在 `fx/fzTan` 由 `m·a_com` 分配而来，方向是**真的**。
  const grfY = fzTot;
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
  // ── ★★ 侧向边界 = **侧向支撑多边形**（柔性足的真实能力边界）──
  //   `support` 给世界 z 的并集边界；CoM 投影离最近边缘还有多少 mm 才是真余量。
  //   可承受的额外倾覆力矩 = `Fz·distEdge`（量纲 N·m，与旧口径同量纲、但**不再是幻觉**）。
  const latMin = support ? support.min : Math.min(ankle.l.z, ankle.r.z) - 0.09;
  const latMax = support ? support.max : Math.max(ankle.l.z, ankle.r.z) + 0.09;
  const distEdgeZ = Math.min(com.z - latMin, latMax - com.z);   // 正 = CoM 还在支撑面内
  const tauMarginLat = fzTot * distEdgeZ;
  // 单脚 CoP 用了多少侧向权限（±1 = 压到鞋底边缘 ⇒ 该脚就要翻了）
  //   ⚠ 分母必须是**该脚自己**的半宽，不是两脚并集的 —— 用并集会把"压到边缘"读小一倍。
  const copFrac = (f: FootForce, side: Side): number => {
    if (!support || !f.copValid) return Number.NaN;
    const lo = side === 'l' ? support.lMin : support.rMin;
    const hi = side === 'l' ? support.lMax : support.rMax;
    const half = Math.max(1e-3, (hi - lo) / 2);
    return (f.copZ - (lo + hi) / 2) / half;
  };

  // ── 可信度与原因（人话，给 UI）──
  let trustNote = '';
  if (!oneValid) {
    trustNote = '两脚都读不到有效载荷 ⇒ 力链不可信（检查接触冲量）';
  } else if (!bothValid) {
    trustNote = '只有一脚读到有效载荷 ⇒ CoP 加权只用这一脚';
  } else if (Math.abs(armSag) > COP_MAX_ARM * footHalfLen * 2) {
    trustNote = 'CoP 跑到踝心外过远 ⇒ 力臂已超出足长，物理上不可达';
  } else if (distEdgeZ < 0) {
    trustNote = `CoM 已越出侧向支撑面 ${(distEdgeZ * 1000).toFixed(0)}mm ⇒ 侧向必然倒`;
  }

  // ── ★★ 脚能给的**最大倾覆力矩**（几何上限：CoP 只能走到支撑多边形边缘）──
  //   实测锚点：`probe-footpush` 注入踝力矩 ±120 N·m，实际给到 CoM 的平均力矩
  //   撞在 **62 N·m** = `687 N × 0.09 m`（脚的半宽）—— 几何限制，不是力不够。
  //   矢状：CoP 相对踝心可走的半程 ≈ `footHalfLen`（足长的一半）—— 近似值，
  //     精确值要按逐脚的鞋底 x 包围盒算（`footSoleBounds` 的 [0]/[1]），下一轮接。
  const momentMaxSag = fzTot * footHalfLen;
  const momentMaxLat = fzTot * Math.max(Math.abs(com.z - latMin), Math.abs(latMax - com.z));
  return {
    l, r,
    copX, copZ, copValid,
    momentMaxSag, momentMaxLat, chainFiltered: false,
    grfX, grfY, grfZ, grfAngleDeg,
    lines: { luX0, luZ0, luX1, luZ1, ankleNx, ankleNz },
    armSag, armLat,
    toppleSag, toppleLat,
    tauReqSag, tauMarginSag,
    tauReqLat, tauMarginLat,
    latMin, latMax, distEdgeZ, copFracLat: { l: copFrac(l, 'l'), r: copFrac(r, 'r') },
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
    // ★ 柔性足专用（§15.5）：内/外侧柱分配 + 摩擦占用 —— 脚"侧向发力"的直接读数
    `柔性足 左 内${m(fc.l.colIn)}/外${m(fc.l.colOut)}N`
      + `　右 内${m(fc.r.colIn)}/外${m(fc.r.colOut)}N`,
    `摩擦占用 左 ${fc.l.tangentValid ? (fc.l.frictionUse * 100).toFixed(0) + '%' : '不可用(切向NaN)'}`
      + `　右 ${fc.r.tangentValid ? (fc.r.frictionUse * 100).toFixed(0) + '%' : '不可用(切向NaN)'}`,
    `GRF ${m(Math.hypot(fc.grfX, fc.grfY, fc.grfZ))}N 方向 ${n(fc.grfAngleDeg, 1)}°`,
    `踝力臂 sag ${n(fc.armSag * 1000)}mm  lat ${n(fc.armLat * 1000)}mm`,
    `倾覆力矩 sag ${n(fc.toppleSag, 1)} lat ${n(fc.toppleLat, 1)} N·m`,
    `踝余量 sag ${n(fc.tauMarginSag, 1)} N·m（负 = 必然倒）`,
    // ★ 侧向不写"踝余量"：踝没有额状执行器，侧向边界来自**足部几何**
    `侧向支撑面 ${n(fc.latMin * 1000, 0)} ~ ${n(fc.latMax * 1000, 0)}mm`
      + `　CoM 距边缘 ${n(fc.distEdgeZ * 1000, 0)}mm（负 = 已出界）`
      + `　可承受倾覆 ${n(fc.tauMarginLat, 1)} N·m`,
    `侧向权限占用 左 ${n(fc.copFracLat.l * 100, 0)}% 右 ${n(fc.copFracLat.r * 100, 0)}%`
      + `（±100% = 压到鞋底边缘）`,
    `可信：${fc.trustable ? '是' : '否 — ' + fc.trustNote}`,
  ];
}

/**
 * ★★ 状态机侧的**力链组装**（用户：「力链的分析放在状态机里，供平衡系统使用」）。
 *
 *   每拍调用一次：从 `ForceSource` 取原始读数 → 组装成 `ForceChain` →
 *   发布到 `rs.groundChain`。平衡系统**只准读 `rs.groundChain`**。
 */
export function buildGroundChain(src: ForceSource, rs: RigState, dtPhys = 1 / 120): ForceChain {
  const rawL = src.sole(0);
  const rawR = src.sole(1);
  // ── ★★ 一阶低通（滤原始输入：fz / colIn / colOut / CoP）─────────────
  //   ⚠ 不能用"滤波后的 CoP 覆盖 raw 对象"：`src.sole()` 返回的是**缓存对象**，
  //     改了它 ⇒ 下游（探针/UI 的原始读数）也变 ⇒ 再也看不到原始信号。
  //     ⇒ 这里做**浅拷贝**再滤。
  if (!rs.ffFlt.length) {
    rs.ffFlt = [
      { fz: 0, colIn: 0, colOut: 0, copX: 0, copZ: 0, n: 0 },
      { fz: 0, colIn: 0, colOut: 0, copX: 0, copZ: 0, n: 0 },
    ];
  }
  const a = FORCE_FLT_TAU <= 0 ? 1
    : (dtPhys > 1e-9 ? Math.min(1, dtPhys / FORCE_FLT_TAU) : 0.2);
  const flt = (side: 0 | 1, raw: FootForce): FootForce => {
    const f = rs.ffFlt[side]!;
    if (!rs.ffFltInit || !raw.copValid) {
      // 首拍（或本拍 CoP 无效）直接跟随原始值 —— 否则会从 0 爬升/拖尾
      f.fz = raw.fz; f.colIn = raw.colIn; f.colOut = raw.colOut;
      f.copX = raw.copX; f.copZ = raw.copZ; f.n = raw.contactN;
    } else {
      f.fz += a * (raw.fz - f.fz);
      f.colIn += a * (raw.colIn - f.colIn);
      f.colOut += a * (raw.colOut - f.colOut);
      f.copX += a * (raw.copX - f.copX);
      f.copZ += a * (raw.copZ - f.copZ);
      f.n = raw.contactN;
    }
    return {
      ...raw,
      fz: f.fz, colIn: f.colIn, colOut: f.colOut,
      copX: f.copX, copZ: f.copZ,
    };
  };
  const l = flt(0, rawL);
  const r = flt(1, rawR);
  rs.ffFltInit = true;
  const ankle: Record<Side, { x: number; z: number }> = { l: src.ankle(0), r: src.ankle(1) };
  const out = buildForceChain(
    l, r, ankle,
    { x: rs.com.x, z: rs.com.z },
    src.massKg(), src.tauMax(), src.footLen(),
    src.comAccel(), src.supportLat(),
  );
  out.chainFiltered = true;
  return out;
}
