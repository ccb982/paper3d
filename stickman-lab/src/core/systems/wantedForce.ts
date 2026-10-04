/**
 * ══════════════════════════════════════════════════════════════
 * ★★ 上层唯一的产出：**需要的地面反力矢量 F_desired**（世界系，N）
 *
 * 为什么要抽成独立的一层（重构理由）：
 *   ① 此前额状面/矢状面/垂直支撑各写各的控制器：矢状面是手写 P 控制
 *      （`hipTgt = -kSagP·ex`），额状面是 `τ = JᵀF`。**同一文件两套哲学**，
 *      符号要靠实测猜（已猜反过一次：髋 +才是屈曲）。
 *   ② 下层关节分配**只有一条规则**：`τ = JᵀF`（Yin & Zhou 2004 /
 *      Horak 2006 / Reitsma 2013 / van Mierlo 2022/2024）。
 *      关节力矩按力臂几何自动分配，**没有可调的符号旋钮**。
 *   ③ 消融变得有意义：消融的是 **F 的某个分量**，而不是"某个通道"
 *      —— 此前 `lat`/`invDyn`/`ankleSag`/`ankleLat` 四个开关是**死的**
 *      （`on('lat')` 在代码里出现 0 次），导致所有"额状面有没有害"的
 *      对照实验无效。
 *
 * ── 上层只做两件事（都不碰关节）──────────────────────────────
 *   1. **决定要多少水平力**：由倒立摆 / 捕获点 / Houska balance point
 *      （MacKinnon & Winter 1993；Hof 2005）反解。
 *   2. **决定重心该去哪个脚**：交接判据（`RigState.comOverFootX/Z`）。
 *
 * ── 轴约定（本 rig，实测确认）────────────────────────────────
 *      **x = 矢状（+x 朝前，角色正面）　y = 竖直　z = 额状（+z = 左）**
 *   额状面的水平力必须沿 **z**。曾错传给 fx（矢状）⇒ 人前后倒、横向无人管。
 */

import type { RigState, Side } from '../rigState';

/** F 的**分量**（N）。每个分量一个真实的消融开关。 */
export interface ForceComponents {
  /** 矢状水平（前后）。由 `hipTgt = -kSagP·ex` 那个手写 P 控制迁移而来 */
  sagittal: number;
  /** 竖向体重支撑 mg。位置伺服也在撑体重，所以这一项默认**关**（会双计） */
  weight: number;
  /** 额状水平（左右）。单支撑交接、以及对抗侧向扰动的主力 */
  lateral: number;
  /** 躯干侧倾产生的附加水平力（Xu & Sher / Horak 2006「用重力卸载髋」） */
  trunkLean: number;
}

/** 上层输出：`F_desired` + 各自的分量（分量可单独消融，分量之和 = 总力） */
export interface WantedForce {
  fx: number;
  fy: number;
  fz: number;
  comp: ForceComponents;
  /** 支撑腿是否**已确定**（上层唯一的判断，下层不再各算一遍） */
  stanceResolved: boolean;
  sup: Side;
  /** 捕获点（Houska）：ξ = com + v/ω₀。调试/UI 回读 */
  captureZ: number;
  captureX: number;
  /** 倒立摆自然频率 ω₀ = √(g/h) */
  omega0: number;
}

export interface WantedForceParams {
  /** `kXRatio` = kp / ω₀²（以自然频率归一化，姿态下沉时不会变欠阻尼） */
  kXRatio: number;
  /** 阻尼比 */
  zeta: number;
  /** 单个水平分量的限幅（N）。文献单腿静态需求约 49 N，留足裕度 */
  maxLateral: number;
  /** 矢状分量限幅（N） */
  maxSagittal: number;
  /** 体重（N） */
  weight: number;
  /** 躯干侧倾增益（rad/m 横向偏差） */
  kTrunkLean: number;
  /** 躯干侧倾产生的水平力限幅（N） */
  maxTrunkLean: number;
}

export const DEFAULT_WANTED_FORCE: WantedForceParams = {
  kXRatio: 0.4,
  zeta: 0.9,
  maxLateral: 500,
  maxSagittal: 400,
  weight: 70 * 9.81,
  kTrunkLean: 0.35,
  maxTrunkLean: 250,

};

const clamp = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);

/**
 * ★ 支撑腿"是否已确定"的**唯一判定处**。
 *
 *   此前 `latArmed` 在 balance.ts 里自己算一遍、相位机在 gaitState 再算一遍，
 *   两个系统各自判断 ⇒ 边界不清、行为无法解释。现在只有这里判。
 *
 * ── 判据修正（2026-10-03，曾造成循环依赖）──────────────────────
 *   旧版要求「已授予承重标识」或「已进入 SINGLE/PUSH/STEP」。但用户的交接定义是
 *   「**要显式的把重心移动到前腿，然后才允许动后腿**」——
 *   而**前腿是由脚的 x 序几何确定的，不需要等承重**（`RigState.frontLeg()`）。
 *   ⇒ 于是出现循环依赖：
 *       相位机停在 DOUBLE 等交接 → 门控为 false → **F_desired 全零**
 *       → 重心永远不移过去 → 交接永远不成立 → 永远停在 DOUBLE
 *   实测：`Fz` 在所有消融组合下都是 **0 N**，`comOverFootZ` 恒为 158mm。
 *
 *   ⇒ 正确的门是** sanity 级**（别在已经倒下时还施加定量前馈），不是载荷级：
 *     · 躯干还没倾倒（tilt < 90°）⇒ 支撑腿有效，可以给力
 *     · 已倾倒 ⇒ 不给力（此时给多少都救不回来）
 */
export function stanceResolved(rs: RigState): boolean {
  return rs.tiltDeg < 90;
}

/**
 * 算 `F_desired`。
 *
 * @param on 分量开关。**每个都必须真实接线**到下面的求和，否则消融实验无效
 *           （此前 `lat` 是死开关，害得所有对照实验作废）。
 */
export function computeWantedForce(
  rs: RigState,
  p: WantedForceParams,
  on: (ch: string) => boolean,
): WantedForce {
  const sup = rs.supportLeg();
  const resolved = stanceResolved(rs);
  const comp: ForceComponents = { sagittal: 0, weight: 0, lateral: 0, trunkLean: 0 };

  if (resolved) {
    // ── 摆高与自然频率。h = CoM 高出支撑面的高度 ──────────────
    const soleY = rs.soleY[sup] ?? 0;
    const h = Math.max(0.3, rs.com.y - soleY - 0.05);
    const om0 = Math.sqrt(9.81 / h);

    // ── 额状：捕获点 → 支撑脚上方 ────────────────────────────
    //   ξ = z + vz/ω₀（Houska balance point / MacKinnon & Winter 1993）
    const stanceZ = sup === 'l' ? rs.soleZ.l : rs.soleZ.r;
    const capZ = rs.com.z + rs.com.vz / om0;
    const kp = p.kXRatio * om0 * om0;
    const kd = 2 * p.zeta * om0;
    const aDesZ = -kp * (capZ - stanceZ) - kd * rs.com.vz;
    // `F = m·h·a_des`（h = 摆高）。m 由 weight 反推，避免两处各写一个 70。
    const mass = p.weight / 9.81;
    if (on('lat')) comp.lateral = clamp(mass * h * aDesZ, p.maxLateral);

    // ── 矢状：同一套律（x 向前为正，目标 = 支撑脚 x）──────────
    const stanceX = sup === 'l' ? rs.soleX.l : rs.soleX.r;
    const capX = rs.com.x + rs.com.vx / om0;
    const aDesX = -kp * (capX - stanceX) - kd * rs.com.vx;
    if (on('sag')) comp.sagittal = clamp(mass * h * aDesX, p.maxSagittal);

    // ── 竖向体重 ────────────────────────────────────────────
    //  ⚠ 默认**关**。位置伺服（`θ_ref ≠ θ ⇒ 一直有力矩`）本身已经在撑体重，
    //    再叠一份 mg 就是**重力双计** ⇒ 关节被灌爆
    //    （实测：含 mg 的版本把单腿从 1.5 s 打到 0.43 s；髋/1 钉在 ±70 N·m）。
    //    垂直支撑要定量时，应先把位置伺服换成阻抗模式（见 `requestHold`），
    //    再打开这个开关。
    if (on('weight')) comp.weight = p.weight;

    // ── 躯干侧倾的附加水平力 ────────────────────────────────
    if (on('trunkLean') && p.kTrunkLean !== 0) {
      const dz = rs.com.z - stanceZ;
      comp.trunkLean = clamp(p.kTrunkLean * dz * 140, p.maxTrunkLean);
    }

    return {
      fx: comp.sagittal + comp.trunkLean,
      fy: comp.weight,
      fz: comp.lateral,
      comp, stanceResolved: resolved, sup,
      captureZ: capZ, captureX: capX, omega0: om0,
    };
  }

  // 未确定支撑腿 ⇒ 上层不给力（否则就是在错误的构型上施加定量前馈）
  return {
    fx: 0, fy: 0, fz: 0, comp, stanceResolved: false, sup,
    captureZ: rs.com.z + rs.com.vz / 3.1, captureX: rs.com.x + rs.com.vx / 3.1, omega0: 3.1,
  };
}