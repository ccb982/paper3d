// ============================================================
// ItemBase —— 物品基类（EntityBase 子类）
// ============================================================
// 掉落物：dynamic 薄片 + read 模式（纯物理落地/被踢开）+ 拾取碰撞（管线分发）
// 数据：itemId 引用配置表 / displayName / 拾取回调
// 拾取：与玩家/友军碰撞（onCollision 管线分发）→ onPickup 回调 → 销毁
// 静态资源点（采集交互）：physical=false（无刚体，后续采集系统）

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';
import { HealthBar } from '../services/fx/HealthBar';

export interface ItemOptions extends Omit<EntityBaseOptions, 'kind'> {
  /** 配置表 itemId（物品唯一标识） */
  itemId?: string;
  /** 显示名（无配置表时兜底） */
  displayName?: string;
  /** 是否受物理影响（掉落物 true / 静态装饰/资源点 false） */
  physical?: boolean;
  /** 生命值（可被打烂；默认 20 = 2 发子弹） */
  hp?: number;
}

export class ItemBase extends EntityBase {
  readonly itemId: string | undefined;
  displayName: string;
  /** ★ 拾取回调（掉落系统/模式层注册；返回 true = 拾取成功 → 销毁） */
  onPickup: (item: ItemBase, picker: EntityBase) => boolean = () => false;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: FrameAssetSource,
    opts: ItemOptions,
  ) {
    super(em, {
      kind: 'item',
      x: opts.x, y: opts.y, z: opts.z,
      physics: opts.physical
        ? {
            type: 'dynamic',
            options: {
              shape: { type: 'cuboid', hx: 0.22, hy: 0.22, hz: 0.1 }, // ★ 薄片（正反面扁）
              linearDamping: 2,  // 中等阻尼：被踢开滑一小段即停（有接触感）
              gravityScale: 1,   // 掉落物受重力落地
              density: 1.5,      // ★ 适中质量：踢开但不会瞬间弹飞
              canSleep: false,   // ★ 不休眠：被撞必响应（休眠刚体可能不响应推挤）
            },
          }
        : undefined,
      asset,
    });
    // ★ 碰撞体积声明（实体 y = 底部/贴地；2D 贴片正反面都扁：
    //   正面 0.44 宽 × 0.44 高，厚度 0.2 薄片）
    this.collisionVolume = {
      shape: { type: 'cuboid', hx: 0.22, hy: 0.22, hz: 0.1 },
      offsetY: 0.22,
    };
    this.itemId = opts.itemId;
    this.displayName = opts.displayName ?? opts.itemId ?? '物品';
    this.physicsMode = opts.physical ? 'read' : 'none';
    this.hp = opts.hp ?? 20; // ★ 物品可被打烂（2 发子弹）
    this.maxHp = this.hp;
    this.attachToScene(scene);
    // ★ 贴片尺寸对齐碰撞体（0.5×0.5 = 正面 0.44 宽；默认 scale 1×1 会与碰撞体严重不符）
    if (this.renderer) {
      this.renderer.setScale(0.5, 0.5);
    }
    // ★ 物品血条（贴片 0.5 高 → offsetY 0.75 悬在头顶上方）
    this.attachEffect('health', new HealthBar(scene, this, { width: 0.5, offsetY: 0.75 }));
  }

  /** ★ 刚体偏移：构造时 collisionVolume 尚未初始化（super 后）→ fallback 0.22 */
  protected override physicsBodyOffsetY(): number {
    return this.collisionVolume?.offsetY ?? 0.22;
  }

  /** ★ 小地图：物品只显示静止的（物理速度 > 阈值 = 移动中，不显示） */
  override get minimapInfo(): { kind: string; moving: boolean } {
    let moving = false;
    const rb = this.entity.rigidBody;
    if (rb && this.em.physics) {
      const v = this.em.physics.getLinearVelocity(rb.handle);
      moving = Math.hypot(v.x, v.z) > 0.1;
    }
    return { kind: this.entity.kind, moving };
  }

  /** ★ 拾取判定（实体管线碰撞分发）：★ 只玩家角色接触才拾取
   *   （kind 判定而非 camp——玩家子弹 camp 也是 'player'，误判成拾取） */
  override onCollision(other: EntityBase | null, started: boolean): void {
    if (!started || !other) return;
    if (other.entity.kind !== 'player') return;
    if (this.onPickup(this, other)) this.dispose();
  }

  /** ★ 坠落保护：无限地图中掉出已加载区（无地面）→ 无限下落 → NaN 卡死；深度超限销毁 */
  protected override onUpdate(dt: number): void {
    if (this.entity.position.y < -20) this.dispose();
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }
}
