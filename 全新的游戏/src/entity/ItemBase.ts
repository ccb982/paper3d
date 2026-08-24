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
    // ★ 提取物品剪影遮罩（与角色同款逻辑：从帧纹理读 alpha → 小画布）
    this.extractShadowMask();
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

  /** ★ 提取物品剪影遮罩到 shadowAlphaTex（attachToScene 后调用一次） */
  private extractShadowMask(): void {
    if (!this.anim?.source || this.shadowAlphaTex) return;
    const pair = this.anim.source.getFramePair(0);
    if (!pair?.base) return;
    const base = pair.base;
    const raw = (base.image as unknown as { data?: Float32Array }).data;
    if (!raw) return;
    const bw = base.image.width;
    const bh = base.image.height;

    const SW = 16;
    const SH = Math.max(2, Math.round(SW * bh / bw)) || 1;
    const c = document.createElement('canvas');
    c.width = SW; c.height = SH;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(SW, SH);

    for (let sy = 0; sy < SH; sy++) {
      const ay = Math.min(bh - 1, Math.floor((sy / SH) * bh));
      for (let sx = 0; sx < SW; sx++) {
        const ax = Math.min(bw - 1, Math.floor((sx / SW) * bw));
        const o = (ay * bw + ax) * 4;
        const a = Math.max(0, Math.min(1, raw[o + 3]));
        const di = (sy * SW + sx) * 4;
        img.data[di]     = 0;                  // R=黑（影子色）
        img.data[di + 1] = 0;                  // G=黑
        img.data[di + 2] = 0;                  // B=黑
        img.data[di + 3] = a > 0.5 ? 255 : 0; // A=剪影裁形
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    this.shadowAlphaTex = tex;
  }

  /** 贴地圆影（物品：小而淡） */
  override get shadowSpec(): { radius: number; alpha: number } | null {
    return { radius: 0.3, alpha: 0.3 };
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