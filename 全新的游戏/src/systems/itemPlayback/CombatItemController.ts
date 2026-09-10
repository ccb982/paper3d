// ============================================================
// CombatItemController —— 战斗道具播放装配（弹药 + 友军 + 装备）
// ============================================================
// WorldMode 唯一的战斗道具播放入口：
//   ammo     弹药池（数值 + AmmoHud 由 WorldUIManager 消费）
//   equipment 装备贴片（挂主角 mesh，场景内自动渲染）
//   友军    由 WorldMode 进战场时查 AllyPlaybackRegistry 分发
// 方向：表现模块单向调用 Session/ItemManager，不反向。
// ============================================================

import type * as THREE from 'three';
import type { GameSession } from '../../core/Session';
import { AmmoStore, DEFAULT_AMMO_TYPE } from './AmmoStore';
import { EquipmentLayer } from './EquipmentLayer';

export class CombatItemController {
  readonly ammo: AmmoStore;
  readonly equipment: EquipmentLayer;

  constructor(
    private session: GameSession,
    scene: THREE.Scene,
    host: THREE.Object3D,
  ) {
    this.ammo = new AmmoStore(session);
    this.equipment = new EquipmentLayer(scene, host);
  }

  /** ★ 玩家开火弹药消耗：池空 → 拒发（返回 false，调用方跳过开火） */
  tryFire(): boolean {
    return this.ammo.tryFire(DEFAULT_AMMO_TYPE, 1);
  }

  /** 每帧驱动（装备贴片帧动画） */
  update(dt: number): void {
    this.equipment.update(dt);
  }

  /** 同步穿戴数据 → 装备贴片（进入战场时调用；内部 diff，后续穿戴变更也可随时再调） */
  syncEquips(): Promise<void> {
    return this.equipment.apply(this.session.player.equips ?? {});
  }

  dispose(): void {
    this.equipment.dispose();
  }
}