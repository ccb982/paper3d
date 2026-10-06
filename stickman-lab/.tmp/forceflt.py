# -*- coding: utf-8 -*-
"""① 力链低通（CoP/内外侧柱/力矩）② 脚能给的力矩几何上限（= Fz × CoP 到边缘）"""
import io

# ══ ① rigState：滤波 scratch + ForceChain 新字段 ══
P = 'src/core/rigState.ts'
s = io.open(P, encoding='utf-8').read()

s = s.replace("""  /** 骨盆（树根）本拍角速度模（rad/s）—— 盆骨去噪门的输入 */
  pelvisW = 0;""",
"""  /** 骨盆（树根）本拍角速度模（rad/s）—— 盆骨去噪门的输入 */
  pelvisW = 0;
  /**
   * ★★★ **力链低通的状态**（一阶，τ≈80 ms）—— 用户 2026-10-06：
   *   「都做吧」+ `probe-footpush` 实测：脚部载荷**逐拍在内外侧柱之间翻号**
   *   （±300 N·m 的力矩噪声），而有效的**均值力矩只有 ~60 N·m** ⇒ 信噪比 ≈ 0.2。
   *   纯物理/求解器层面压不住（见 §22.11 的扫描表：接触参数/小步长/求解器迭代/
   *   弓刚度/弓阻尼/脚角阻尼**全部无效**）⇒ 唯一出路是**在信号层低通**。
   *   ⚠ 只滤**原始输入**（fz / colIn / colOut / CoP），派生量（力臂/余量/倾覆）
   *     由滤后的输入重算 —— 否则会出现"力矩与力不一致"。
   */
  ffFlt: { fz: number; colIn: number; colOut: number; copX: number; copZ: number; n: number }[] = [];
  /** 低通是否已初始化（首拍直接把原始值填进去，避免从 0 爬升） */
  ffFltInit = false;""", 1)

s = s.replace("""  /** CoM 投影到最近侧向边缘的距离（m；**负 = 已出界 ⇒ 必然倒**） */
  distEdgeZ: number;""",
"""  /** CoM 投影到最近侧向边缘的距离（m；**负 = 已出界 ⇒ 必然倒**） */
  distEdgeZ: number;
  /**
   * ★★★ **脚能给出的最大倾覆力矩**（N·m，几何上限）—— 用户 2026-10-06：
   *   「腰部也要主动发力…**是腿部发力，然后腰部借力才对**」、以及
   *   「收敛到文献中的强度」。
   *
   *   物理：踝/足想移 CoP，但 **CoP 只能在支撑多边形内**（脚只有 ±90mm 宽）
   *   ⇒ 能给的力矩上限 = `Fz × CoP 到边缘的距离`。
   *   实测（`probe-footpush`）：踝力矩 ±120 N·m 时，实际给到 CoM 的**平均**
   *   力矩撞在 **62 N·m** 上 —— 正好 = `687 N × 0.09 m`。
   *   ⇒ 这是**踝策略的天花板**（文献同口径：踝外翻 28 N·m；ML 稳定主要靠落足，
   *     Hof/Vlutters：落足补偿约 10× 于踝策略）。
   *   `momentMaxSag/Lat` 是**当前姿态下还能给多少**（随 CoM 位置变，不是常数）。
   */
  momentMaxSag: number; momentMaxLat: number;
  /** 本拍力链是否经过低通（诊断：false = 原始逐拍值） */
  chainFiltered: boolean;""", 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('rigState 字段 ok')

# ══ ② forceChain：低通 + 几何上限 ══
P = 'src/core/forceChain.ts'
s = io.open(P, encoding='utf-8').read()

s = s.replace("""import type { FootForce, ForceChain, ForceSource, RigState, Side } from './rigState';""",
"""import type { FootForce, ForceChain, ForceSource, RigState, Side } from './rigState';

/**
 * ★★★ **力链低通时间常数**（秒）—— 见 `RigState.ffFlt` 的注释。
 *   80 ms 的依据：脚部接触噪声的周期 = **2 个控制拍**（1/30 s ≈ 33 ms，
 *   `probe-footforce` 记录的"周期-2"），而有效信号（重心转移）的时间尺度
 *   是 **0.3~1 s** ⇒ 80 ms 能压掉噪声、又不拖慢有效信号（相位滞后 ~80ms 可接受，
 *   与人体踝策略的 ~100 ms 反应延迟同量级）。
 */
const FORCE_FLT_TAU = 0.08;""", 1)

s = s.replace("""export function buildGroundChain(src: ForceSource, rs: RigState): ForceChain {
  const l = src.sole(0);
  const r = src.sole(1);
  const ankle: Record<Side, { x: number; z: number }> = { l: src.ankle(0), r: src.ankle(1) };
  return buildForceChain(
    l, r, ankle,
    { x: rs.com.x, z: rs.com.z },
    src.massKg(), src.tauMax(), src.footLen(),
    src.comAccel(), src.supportLat(),
  );
}""",
"""export function buildGroundChain(src: ForceSource, rs: RigState, dtPhys = 1 / 120): ForceChain {
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
  const a = dtPhys > 1e-9 ? Math.min(1, dtPhys / FORCE_FLT_TAU) : 0.2;
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
}""", 1)

# 几何上限：在 buildForceChain 的返回里算
s = s.replace("""  return {
    l, r,
    copX, copZ, copValid,""",
"""  // ── ★★ 脚能给的**最大倾覆力矩**（几何上限：CoP 只能走到支撑多边形边缘）──
  //   实测锚点：`probe-footpush` 注入踝力矩 ±120 N·m，实际给到 CoM 的平均力矩
  //   撞在 **62 N·m** = `687 N × 0.09 m`（脚的半宽）—— 几何限制，不是力不够。
  //   矢状：CoP 相对踝心可走的半程 ≈ `footHalfLen`（足长的一半）—— 近似值，
  //     精确值要按逐脚的鞋底 x 包围盒算（`footSoleBounds` 的 [0]/[1]），下一轮接。
  const momentMaxSag = fzTot * footHalfLen;
  const momentMaxLat = fzTot * Math.max(Math.abs(com.z - latMin), Math.abs(latMax - com.z));
  return {
    l, r,
    copX, copZ, copValid,
    momentMaxSag, momentMaxLat, chainFiltered: false,""", 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('forceChain ok')
