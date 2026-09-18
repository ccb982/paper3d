// ============================================================
// GroundStationaryAlly —— 陆地站桩友军骨架（AllyBase 子类）
// ============================================================
// 不位移：只维护基座高度 + 绕自身索敌 + 远程/激光/挖矿。
// 子类：SentinelAlly（原祖宗；表现微悬浮仍属站桩骨架）。
// ============================================================

import { AllyBase } from './AllyBase';
import { RasterMap } from '../../services/map/RasterMap';

export abstract class GroundStationaryAlly extends AllyBase {
  /** 站桩标记（WorldMode 共享流体步进判定等复用） */
  override stationary = true;
  /** ★ 站桩基座高度（放置时的 y；贴地 + 微浮动，不移动） */
  stationaryBaseY = 0;

  /** ★ 站桩固定高度（不上下摆动；随地形抬升但不低于放置基准） */
  protected holdStationY(p: { x: number; y: number; z: number }): void {
    const gy = RasterMap.current?.surfaceHeightAtFor(p.x, p.z, p.y) ?? 0; // 洞顶不穿模
    p.y = Math.max(gy + 0.5, this.stationaryBaseY);
  }
}
