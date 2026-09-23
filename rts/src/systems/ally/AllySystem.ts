// ============================================================
// AllySystem —— 友军管理器（统一更新入口 / 世界端口注入）
// ============================================================
// 职责（《实体架构.md》§6）：
//   - 持有友军列表（WorldMode 不再自己 for 循环）
//   - 世界端口（AllyWorldPort）一次性注入所有友军（替代逐个体回调）
//   - 每帧喂跟随锚点（编队槽位偏移）+ playerPos → updateAI
// 生命周期：WorldMode enter 注入端口，exit/登船 disposeAll。
// ============================================================

import type * as THREE from 'three';
import type { CameraFrame } from '../../services/camera/CameraController';
import { droneFollowOffset } from '../../services/fx/DroneFormation';
import type { AllyBase, AllyWorldPort } from '../../entity/ally/AllyBase';
import { GroundStationaryAlly } from '../../entity/ally/GroundStationaryAlly';
import type { RetireReason } from '../../entity/EntityBase';

/** 每帧上下文（WorldMode 喂入；玩家位置 + 相机帧） */
export interface AllyUpdateContext {
  frame: CameraFrame;
  camera: THREE.Camera | null;
  playerX: number;
  playerY: number;
  playerZ: number;
}

export class AllySystem {
  private list: AllyBase[] = [];
  private port: AllyWorldPort | null = null;

  /** 注入世界端口（WorldMode enter 调用；null = 摘除） */
  setWorldPort(port: AllyWorldPort | null): void {
    this.port = port;
    for (const a of this.list) a.worldPort = port;
  }

  /** 加入友军（自动带上当前世界端口） */
  add(ally: AllyBase): void {
    ally.worldPort = this.port;
    this.list.push(ally);
  }

  /** 移除（损毁/回收；返回是否命中） */
  remove(ally: AllyBase): boolean {
    const i = this.list.indexOf(ally);
    if (i < 0) return false;
    this.list.splice(i, 1);
    return true;
  }

  /** 全部友军（只读视图；UI/HUD/索敌直读） */
  get allies(): AllyBase[] {
    return this.list;
  }

  get count(): number {
    return this.list.length;
  }

  /**
   * ★ 每帧统一更新：按编队槽位喂跟随锚点（左右交替/高度错层/前后错落），
   *   再各自 updateAI（跟随→锁定最近敌人→攻击→返回重锁）。
   *   先于实体管线，保证本帧 syncRender 使用新位置。
   */
  update(dt: number, ctx: AllyUpdateContext): void {
    if (this.list.length === 0) return;
    const { frame, camera, playerX, playerY, playerZ } = ctx;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i];
      const off = droneFollowOffset(i, frame);
      d.followTarget.x = playerX + frame.right.x * off.r + frame.forward.x * off.f;
      d.followTarget.z = playerZ + frame.right.z * off.r + frame.forward.z * off.f;
      d.followTarget.y = playerY + off.up;
      d.playerPos.x = playerX;
      d.playerPos.y = playerY;
      d.playerPos.z = playerZ;
      // （友军伤害在攻击瞬间 queryFinalStats(d.owner) 实时查询，无需逐帧注入）
      d.updateAI(dt, camera);
    }
  }

  /**
   * ★ 接触唤醒（站桩友军留存通用）：玩家 (x,z) 半径 r 内的休眠站桩友军 → wake()；
   *   返回本次唤醒数（WorldMode 每帧调一次，唤醒后自动重新索敌并出现在队友列表）。
   */
  wakeStationaryNear(x: number, z: number, r: number): number {
    let n = 0;
    const r2 = r * r;
    for (const a of this.list) {
      if (!(a instanceof GroundStationaryAlly) || !a.dormant) continue;
      const dx = a.position.x - x, dz = a.position.z - z;
      if (dx * dx + dz * dz <= r2) { a.wake(); n++; }
    }
    return n;
  }

  /** 全部退役（登船 = despawned；退出模式 = mode_cleanup） */
  disposeAll(reason: RetireReason = 'despawned'): void {
    for (const a of this.list) a.retire(reason);
    this.list = [];
  }

  /** 清空列表但不销毁（调用方已自行处置） */
  clear(): void {
    this.list = [];
  }
}

/** 全局单例（与 aiSystem 同范式；WorldMode 驱动） */
export const allySystem = new AllySystem();
