// ============================================================
// GroundStationaryAlly —— 陆地站桩友军骨架（AllyBase 子类）
// ============================================================
// 不位移：只维护基座高度 + 绕自身索敌 + 远程/激光/挖矿。
// 子类：SentinelAlly（原祖宗；表现微悬浮仍属站桩骨架）。
// ============================================================

import type * as THREE from 'three';
import { AllyBase } from './AllyBase';
import { RasterMap } from '../../services/map/RasterMap';

export abstract class GroundStationaryAlly extends AllyBase {
  /** 站桩标记（WorldMode 共享流体步进判定等复用） */
  override stationary = true;
  /** ★ 站桩基座高度（放置时的 y；贴地 + 微浮动，不移动） */
  stationaryBaseY = 0;

  // ============ ★ 休眠 / 启用（站桩友军留存通用 API，2026-09-19） ============
  // 语义：留存回位的站桩友军先 sleep() 入场——不索敌/不攻击/不挖矿、不入队友列表；
  //       玩家回到原地接触 → AllySystem.wakeStationaryNear → wake() 恢复全部行为。
  private dormantFlag = false;

  /** 是否休眠中（HUD/存档筛选直读） */
  get dormant(): boolean { return this.dormantFlag; }

  /** 休眠（留存恢复入场；子类可覆写追加表现，须 super.sleep()） */
  sleep(): void {
    this.dormantFlag = true;
    this.target = null;      // 清索敌残留：唤醒后重新锁定
    this.agentIdx = -1;      // 清代理下标（代理池 swap-remove，跨帧缓存必错）
  }

  /** 启用（玩家接触唤醒；子类可覆写追加表现，须 super.wake()） */
  wake(): void {
    this.dormantFlag = false;
  }

  /** ★ 休眠闸门收口在骨架：休眠期只维持站桩高度，AI/光束/朝向全免 */
  override updateAI(dt: number, camera?: THREE.Camera | null): void {
    if (this.dormantFlag) {
      this.holdStationY(this.entity.position);
      return;
    }
    super.updateAI(dt, camera);
  }

  /** ★ 站桩固定高度（不上下摆动；随地形抬升但不低于放置基准） */
  protected holdStationY(p: { x: number; y: number; z: number }): void {
    const gy = RasterMap.current?.surfaceHeightAtFor(p.x, p.z, p.y) ?? 0; // 洞顶不穿模
    p.y = Math.max(gy + 0.5, this.stationaryBaseY);
  }
}
