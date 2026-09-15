// ============================================================
// CombatItemController —— 战斗道具播放装配（装备 + 友军）
// ============================================================
// WorldMode 唯一的战斗道具播放入口：
//   equipment 装备贴片（挂主角 mesh，场景内自动渲染）
//   友军    由 WorldMode 进战场时查 AllyPlaybackRegistry 分发
// 方向：表现模块单向调用 Session/ItemManager，不反向。
// ============================================================

import type * as THREE from 'three';
import type { GameSession } from '../../core/Session';
import { EquipmentLayer } from './EquipmentLayer';

export class CombatItemController {
  readonly equipment: EquipmentLayer;

  constructor(
    private session: GameSession,
    scene: THREE.Scene,
    host: THREE.Object3D,
    getFacing: () => '前' | '后',
  ) {
    this.equipment = new EquipmentLayer(scene, host, getFacing);
  }

  /** 每帧驱动（装备贴片帧动画 + 贴地影子） */
  update(dt: number, camera?: THREE.Camera): void {
    this.equipment.update(dt, camera);
  }

  /** ★ 同步出击槽池 → 装备贴片（进入战场时调用；内部 diff，槽位变更后可随时再调） */
  syncLoadout(): Promise<void> {
    const slots = this.session.player.slots;
    return this.equipment.apply(Array.isArray(slots) ? slots.filter((s): s is string => !!s) : []);
  }

  dispose(): void {
    this.equipment.dispose();
  }
}