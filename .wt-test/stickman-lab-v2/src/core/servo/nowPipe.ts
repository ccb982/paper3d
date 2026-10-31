/**
 * 伺服层 · Now 管道（当前修正）——`保护预警与反射弧.md` §2.13 双管道架构
 *
 * 职责：**当前状态**驱动的即时修正核心——CoM 修正量（comAdjust，含摩擦预算饱和）
 * 与期望 CoP（desiredCop，含可行性投影）；只读输入、纯计算，不写关节；
 * 输出经整合层进入 `StabilityCorrection` 提案（唯一出口）。
 * 与 Future 管道**互不读对方中间量**（独立可测）。
 */
export interface NowInput {
  /** 目标（governor）与当前 CoM/速度 */
  govX: number; govZ: number;
  comX: number; comZ: number; comY: number;
  velX: number; velZ: number;
  gAbs: number;
  comKp: number; comKd: number;
  /** 摩擦预算（水平加速度上界 = maxForceFrac·g） */
  maxForceFrac: number;
  /** 双脚踝锚点（CoP 投影边界用；无踝则空数组） */
  ankleZ: number[]; ankleX: number[]; ankleY: number;
}

export interface NowOutput {
  /** CoM 修正加速度（已按摩擦预算饱和） */
  ax: number; az: number;
  /** 是否被摩擦预算饱和（→ 提案 level 升 1） */
  saturated: boolean;
  /** 期望 CoP（投影进支撑面后；无踝为 null） */
  desiredCop: { x: number; z: number } | null;
}

export const NOW_DEAD = {
  /** 死区（m）：|误差| 低于此值 → 修正 OFF（文献：事件驱动+感觉死区，小误差自由演化） */
  dead: 0.008,
};

export class NowPipe {
  compute(i: NowInput): NowOutput {
    let errX = i.govX - i.comX;
    let errZ = i.govZ - i.comZ;
    // ★ L1-Now 间歇化（§2.18）：死区内 → 修正 OFF（自由演化，tonic 托底）；
    //   出死区 → 修正 ON（事件驱动）。防抖：速度项仍进（阻尼常开，防开关颤振）。
    const inDead = Math.abs(errX) < NOW_DEAD.dead && Math.abs(errZ) < NOW_DEAD.dead;
    if (inDead) { errX = 0; errZ = 0; }
    let ax = i.comKp * errX + i.comKd * -i.velX;
    let az = i.comKp * errZ + i.comKd * -i.velZ;
    const aMax = i.maxForceFrac * i.gAbs;
    const am = Math.hypot(ax, az);
    let saturated = false;
    if (am > aMax) { ax *= aMax / am; az *= aMax / am; saturated = true; }
    // 期望 CoP：p = x − (h/g)·a；再投影进支撑面（Englsberger 2013/2015：
    // 期望 CoP 必须落在支撑面内，越界投影到边界——否则执行方追不可达点）
    let desiredCop: { x: number; z: number } | null = null;
    if (i.ankleZ.length > 0) {
      const h = Math.max(0.3, i.comY - i.ankleY);
      desiredCop = {
        x: i.comX - (h / i.gAbs) * ax,
        z: i.comZ - (h / i.gAbs) * az,
      };
      const copLo = Math.min(...i.ankleZ) - 0.055, copHi = Math.max(...i.ankleZ) + 0.055;
      const copXLo = Math.min(...i.ankleX) - 0.10, copXHi = Math.max(...i.ankleX) + 0.10;
      desiredCop.z = Math.max(copLo, Math.min(copHi, desiredCop.z));
      desiredCop.x = Math.max(copXLo, Math.min(copXHi, desiredCop.x));
    }
    return { ax, az, saturated, desiredCop };
  }
}
