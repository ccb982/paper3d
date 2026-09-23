// ============================================================
// GroundFollowAlly —— 陆地跟随友军骨架（AllyBase 子类）
// ============================================================
// 贴地运动 + 跟随锚点（WorldMode 每帧喂 followTarget：玩家 + 编队偏移）。
// ★ 本阶段只落骨架（无兵种使用），等第一批素材/配置接入。
// ★ 运动层说明：AllyBase 不背 CharacterController（飞天/站桩不需要），
//   这里先手写"直线接近 + 表面高度贴地"；接入兵种时若需要
//   立面阻挡/角色推挤，再评估迁移到 CharacterBase 运动层
//   （《实体架构.md》§6.6）。
// ============================================================

import { AllyBase } from './AllyBase';
import { RasterMap } from '../../services/map/RasterMap';

export abstract class GroundFollowAlly extends AllyBase {
  /** 跟随停止距离（米）：进入该距离内不移动 */
  followStopDist = 3.0;
  /** 跟随移动速度（米/秒） */
  followSpeed = 4.0;

  protected think(dt: number): void {
    const p = this.entity.position;
    const dx = this.followTarget.x - p.x;
    const dz = this.followTarget.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= this.followStopDist || d < 1e-4) return;
    const step = Math.min(this.followSpeed * dt, d - this.followStopDist);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    // 贴地（骨架版：表面高度直接落位；正式接入时改走运动层规则）
    p.y = RasterMap.current?.surfaceHeightAtFor(p.x, p.z, p.y) ?? p.y;
  }
}
