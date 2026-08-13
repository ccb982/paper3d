// ============================================================
// BulletManager —— 子弹管理器（对象池，架构 4.2）
// ============================================================
// 预创建 N 颗子弹（刚体/贴片常驻复用），spawn 取出激活 / 超时回池。
// 池空（N 颗全在飞）→ spawn 返回 null（调用方忽略即可）。
// 玩家/敌人/友军共用（camp 由 spawn 参数决定）。

import * as THREE from 'three';
import { BulletBase, type BulletOptions } from '../../entity/BulletBase';
import type { EntityManager } from '../../entity/EntityManager';
import type { FrameAssetSource } from '../fx/AssetSource';

/** ★ 轻量发射参数（AI 行为/近战/远程共用；不依赖实体构造细节） */
export interface SpawnBulletOptions {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  speed: number;
  camp: 'player' | 'ally' | 'enemy';
  lifetime?: number;
  damage?: number;
}

export class BulletManager {
  private pool: BulletBase[] = [];
  private capacity: number;

  constructor(
    private em: EntityManager,
    private scene: THREE.Scene,
    private asset: FrameAssetSource,
    capacity = 100,
  ) {
    this.capacity = capacity;
    for (let i = 0; i < capacity; i++) {
      // 池中子弹初始失活（构造末尾已 deactivate，藏在地图外）
      const b = new BulletBase(em, scene, asset, {
        kind: 'bullet',
        x: 0, y: -50, z: 0,
        dirX: 1, dirY: 0, dirZ: 0,
        speed: 0,
        camp: 'player',
      });
      b.recycle = () => this.pool.push(b); // 超时 → 回池
      this.pool.push(b);
    }
  }

  /** ★ 发射：从池取一颗激活；池空返回 null */
  spawn(opts: SpawnBulletOptions): BulletBase | null {
    const b = this.pool.pop();
    if (!b) return null;
    const full: BulletOptions = {
      ...opts,
      kind: 'bullet' as const,
    };
    b.activate(full);
    return b;
  }

  /** 池中可用子弹数（诊断/调参） */
  get available(): number {
    return this.pool.length;
  }

  dispose(): void {
    for (const b of this.pool) b.dispose();
    this.pool = [];
  }
}
