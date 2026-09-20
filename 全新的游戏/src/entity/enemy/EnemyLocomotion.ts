// ============================================================
// EnemyLocomotion —— 敌人移动器（E5 组合件；纯搬运，行为零变化）
// ============================================================
// 危险地形绕行（坑 / 深水 / 高台立面）→ 解析本帧移动方向；
// 实际移动仍走 CharacterController（由 EnemyBase.moveBy 调用）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';

/** 本帧移动解析结果（move=false → 本帧不动） */
export interface LocomotionResult {
  move: boolean;
  x: number;
  z: number;
}

export class EnemyLocomotion {
  /** ★ 危险地形转向节流计时（前方坑洞/悬崖 → 禁止直行，转向避让） */
  private hazardTurnTimer = 0;
  /** ★ 上次采纳的安全绕行航向（贴边连续走，不来回抖动；null=无） */
  private hazardSafeDir: { x: number; z: number } | null = null;
  /** ★ 前方探测距离（米；> 碰撞半宽，提前一个身位避开坑沿） */
  private static readonly HAZARD_PROBE = 2.0;

  /**
   * 解析本帧移动方向（危险地形绕行）。
   * @param px,py,pz 当前位置（py 用于第二层高度/洞顶选层）
   * @param airborne 空中单位豁免地面危险
   */
  resolve(px: number, py: number, pz: number, airborne: boolean, dx: number, dz: number, dt: number): LocomotionResult {
    if (this.isDangerAhead(px, py, pz, airborne, dx, dz)) {
      // ★ 若上次安全航向仍安全（且与目标方向不相反）→ 延续，贴边连续走
      if (this.hazardSafeDir) {
        const k = this.hazardSafeDir;
        if (k.x * dx + k.z * dz > -0.1 && !this.isDangerAhead(px, py, pz, airborne, k.x, k.z)) {
          return { move: true, x: k.x, z: k.z };
        }
        this.hazardSafeDir = null;
      }
      // ★ 节流：只隔一段时间重新扫向（避免原地高频抖动/每帧重算）
      this.hazardTurnTimer -= dt;
      if (this.hazardTurnTimer > 0) return { move: false, x: 0, z: 0 };
      this.hazardTurnTimer = 0.45;
      // ★ 扫描候选航向：从小到大偏转 ±22.5°、±45°… 直到找到安全方向
      const base = Math.atan2(dz, dx);
      let found: { x: number; z: number } | null = null;
      for (let k = 1; k <= 8; k++) {
        const dev = (Math.PI / 8) * k;
        for (const s of [1, -1] as const) {
          const a = base + dev * s;
          const cdx = Math.cos(a), cdz = Math.sin(a);
          if (!this.isDangerAhead(px, py, pz, airborne, cdx, cdz)) { found = { x: cdx, z: cdz }; break; }
        }
        if (found) break;
      }
      if (found) {
        this.hazardSafeDir = found;
        return { move: true, x: found.x, z: found.z };
      }
      // 全部方向都危险（深坑孤岛）：本帧不动，等下一轮节流再试
      return { move: false, x: 0, z: 0 };
    }
    this.hazardTurnTimer = 0;
    this.hazardSafeDir = null;
    return { move: true, x: dx, z: dz };
  }

  /** ★ 前方是否有危险地形（只挡"坑/深水/高台立面"）：
   *   从脚下向 (dx,dz) 方向探测 HAZARD_PROBE 米，
   *   落点是坑洞地块（lethal）或表面过低（深坑底）→ 危险；
   *   ★ 深水（水深 > 0.8m）→ 危险（敌人不过水）；
   *   ★ 高台立面（近探陡升且不继续延伸 = 墙）→ 危险；插值坡（连续上升）放行。
   *   用 RasterMap 高度场（静态），不依赖物理体，成本极低。 */
  private isDangerAhead(px: number, py: number, pz: number, airborne: boolean, dx: number, dz: number): boolean {
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return false;
    // ★ 空中层（2026-09-18）：飞行单位不吃地面危险（坑/深水/立面）→ 永远"前方安全"
    if (airborne) return false;
    const ux = dx / len, uz = dz / len;
    const raster = RasterMap.current;
    if (!raster) return false;
    const p1 = EnemyLocomotion.HAZARD_PROBE;
    const p2 = p1 * 0.55; // 中间采样点（更早发现坑沿，转角更平滑）
    // ★ 第二层高度（浮空洞顶）：用自身当前高度选层——站在山上的敌人不会把洞当坑
    const h0 = raster.surfaceHeightAtFor(px, pz, py);
    for (const d of [p2, p1]) {
      const hx = px + ux * d;
      const hz = pz + uz * d;
      const role = raster.tileDefAt(hx, hz).genRole;
      const h = raster.surfaceHeightAtFor(hx, hz, py);
      // 坑洞地块（lethal 深坑）：不可站立 → 危险
      if (role === 'pit') return true;
      // 坑底过低（挖深/坑洞的深底，判定死亡线以下）→ 危险
      if (h < -1.2) return true;
      // ★ 水域允许站立（不再当危险；移动端由 SteerPick 给"上岸"权重）
    }
    // ★ 高台立面判定：0.45m 处陡升 > 0.6m，且 1.2m 处没有同斜率延续 → 墙（插值坡放行）
    const hNear = raster.surfaceHeightAtFor(px + ux * 0.45, pz + uz * 0.45, py);
    const hFar = raster.surfaceHeightAtFor(px + ux * 1.2, pz + uz * 1.2, py);
    if (hFar - h0 > 1.0) return true;   // ★ 连续陡坡（≈40°+）也是墙：别一直撞（硬墙仍可当掩体）
    const riseNear = hNear - h0;
    const riseFar = hFar - hNear;
    if (riseNear > 0.6 && riseFar < riseNear * 0.5) return true;
    return false;
  }
}
