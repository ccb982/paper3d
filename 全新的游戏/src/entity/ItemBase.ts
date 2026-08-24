// ============================================================
// ItemBase —— 物品基类（EntityBase 子类）
// ============================================================
// 掉落物：由 ItemArchetype 驱动生成，拾取后自动转为背包数据。
// 物理：dynamic 薄片 + read 模式（纯物理落地/被踢开）。
// 拾取：与玩家碰撞 → onPickup 回调 → 销毁。
// ============================================================

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { ItemArchetype } from '../core/ItemArchetype';
import type { ItemManager } from '../systems/inventory/ItemManager';
import { FTXQuad } from '../services/render/FTXQuad';
import { HealthBar } from '../services/fx/HealthBar';
import { createSolidBulletAsset } from '../services/fx/SolidBulletAsset';

export interface ItemOptions extends Omit<EntityBaseOptions, 'kind'> {
  /** 是否受物理影响（掉落物 true / 静态装饰/资源点 false） */
  physical?: boolean;
  /** 生命值（可被打烂；默认 20 = 2 发子弹） */
  hp?: number;
}

export class ItemBase extends EntityBase {
  readonly archetype: ItemArchetype;
  itemManager: ItemManager;
  displayName: string;
  /** ★ 拾取回调（掉落系统/模式层注册；返回 true = 拾取成功 → 销毁） */
  onPickup: (item: ItemBase, picker: EntityBase) => boolean = () => false;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    archetype: ItemArchetype,
    x: number,
    y: number,
    z: number,
    itemManager: ItemManager,
    opts?: { physical?: boolean; hp?: number },
  ) {
    // 用原形的颜色生成临时贴图
    const asset = createSolidBulletAsset(64, archetype.color.h, archetype.color.s, archetype.color.l);
    const physical = opts?.physical ?? true;
    const shape = archetype.worldShape;

    super(em, {
      kind: 'item',
      x, y, z,
      physics: physical
        ? {
            type: 'dynamic',
            options: {
              shape,
              linearDamping: 2,
              gravityScale: 1,
              density: 1.5,
              canSleep: false,
            },
          }
        : undefined,
      asset,
    });

    this.archetype = archetype;
    this.itemManager = itemManager;
    this.displayName = archetype.name;
    // ★ 碰撞体积声明
    this.collisionVolume = {
      shape,
      offsetY: (shape as any).hy ?? (shape as any).radius ?? 0.22,
    };
    this.physicsMode = physical ? 'read' : 'none';
    this.hp = opts?.hp ?? 20;
    this.maxHp = this.hp;
    this.camp = 'neutral';
    this.attachToScene(scene);

    // 贴片尺寸对齐碰撞体
    if (this.renderer) {
      this.renderer.setScale(archetype.worldScale, archetype.worldScale);
    }
    // 物品血条
    this.attachEffect('health', new HealthBar(scene, this, { width: 0.5, offsetY: 0.75 }));
  }

  /** ★ 刚体偏移 */
  protected override physicsBodyOffsetY(): number {
    return this.collisionVolume?.offsetY ?? 0.22;
  }

  /** ★ 影子声明（物品：贴片同宽的剪影影，基类统一驱动） */
  protected override get shadowShape(): { w: number; d: number; alpha?: number } | null {
    const r = this.renderer as unknown as { mesh?: THREE.Mesh } | null;
    if (!r?.mesh) return null;
    return {
      w: Math.abs(r.mesh.scale.x),
      d: Math.abs(r.mesh.scale.y) * 0.8,
      alpha: 0.3,
    };
  }

  /** 提供帧纹理数据给基类统一剪影提取 */
  protected override getShadowFrameData() {
    if (!this.anim?.source) return null;
    const pair = this.anim.source.getFramePair(0);
    if (!pair?.base?.image) return null;
    const data = (pair.base.image as unknown as { data?: Float32Array }).data;
    if (!data) return null;
    return { base: { width: pair.base.image.width, height: pair.base.image.height, data } };
  }

  /** ★ 小地图：物品只显示静止的 */
  override get minimapInfo(): { kind: string; moving: boolean } {
    let moving = false;
    const rb = this.entity.rigidBody;
    if (rb && this.em.physics) {
      const v = this.em.physics.getLinearVelocity(rb.handle);
      moving = Math.hypot(v.x, v.z) > 0.1;
    }
    return { kind: this.entity.kind, moving };
  }

  /** ★ 拾取判定：只玩家角色接触才拾取 */
  override onCollision(other: EntityBase | null, started: boolean): void {
    if (!started || !other) return;
    if (other.entity.kind !== 'player') return;
    if (this.onPickup(this, other)) this.dispose();
  }

  /** ★ 坠落保护 */
  protected override onUpdate(dt: number): void {
    if (this.entity.position.y < -20) this.dispose();
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }
}