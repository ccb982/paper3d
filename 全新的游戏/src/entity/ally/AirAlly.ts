// ============================================================
// AirAlly —— 飞天友军骨架（AllyBase 子类）
// ============================================================
// 移动：3D 平滑追踪（速度越大越跟手）+ 地面高度钳制 + 正弦漂浮。
// 不吃地形落差（不贴地/不绕坑），是"飞天"这一类友军的公共运动层。
// 子类：DroneAlly（跟随无人机）；远期轰炸友军也从这里派生。
// ============================================================

import { AllyBase } from './AllyBase';
import { RasterMap } from '../../services/map/RasterMap';

export abstract class AirAlly extends AllyBase {
  /**
   * 平滑追踪（速度越大越跟手）；y 带地面高度钳制 + 正弦漂浮。
   * @param minAir 离地最小高度（跟随态 1.2m 高位悬浮；攻击态 0.5m 俯冲贴脚打）
   */
  protected moveTo(
    dt: number,
    tx: number, ty: number, tz: number,
    speed: number,
    minAir = 1.2,
  ): void {
    const p = this.entity.position;
    const k = Math.min(1, dt * speed);
    p.x += (tx - p.x) * k;
    p.z += (tz - p.z) * k;
    const gy = RasterMap.current?.surfaceHeightAtFor(p.x, p.z, p.y) ?? 0; // 洞顶不穿模
    const baseY = Math.max(ty, gy + minAir);
    p.y += (baseY + Math.sin(this.phase) * 0.18 - p.y) * Math.min(1, dt * speed);
  }
}
