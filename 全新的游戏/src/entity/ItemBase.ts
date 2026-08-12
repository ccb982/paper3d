// ============================================================
// ItemBase —— 物品基类（EntityBase 子类）
// ============================================================
// 掉落物：dynamic 球体 + read 模式（物理落地）+ 拾取碰撞（管线分发）
// 数据：itemId 引用配置表 / displayName / 拾取回调
// 拾取：与玩家/友军碰撞（onCollision 管线分发）→ onPickup 回调 → 销毁
// 静态资源点（采集交互）：physical=false（无刚体，后续采集系统）

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';

export interface ItemOptions extends Omit<EntityBaseOptions, 'kind'> {
  /** 配置表 itemId（物品唯一标识） */
  itemId?: string;
  /** 显示名（无配置表时兜底） */
  displayName?: string;
  /** 是否受物理影响（掉落物 true / 静态装饰/资源点 false） */
  physical?: boolean;
  /** 拾取判定半径（默认 0.25；略大于视觉，手感宽松） */
  pickupRadius?: number;
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
              shape: { type: 'ball', radius: opts.pickupRadius ?? 0.25 },
              linearDamping: 2,
              gravityScale: 1, // 掉落物受重力落地
            },
          }
        : undefined,
      asset,
    });
    // ★ 碰撞体积声明（实体 y = 底部/贴地，球心 = y + 半径；与角色脚底语义一致）
    this.collisionVolume = {
      shape: { type: 'ball', radius: opts.pickupRadius ?? 0.25 },
      offsetY: opts.pickupRadius ?? 0.25,
    };
    this.itemId = opts.itemId;
    this.displayName = opts.displayName ?? opts.itemId ?? '物品';
    this.physicsMode = opts.physical ? 'read' : 'none';
    this.attachToScene(scene);
    // ★ 贴片尺寸对齐碰撞球（直径 0.5；默认 scale 1×1 会与球体严重不符）
    if (this.renderer) {
      this.renderer.setScale(0.5, 0.5);
    }
  }

  /** ★ 拾取判定（实体管线碰撞分发）：玩家/友军接触 → 尝试拾取 */
  override onCollision(other: EntityBase | null, started: boolean): void {
    if (!started || !other) return;
    if (other.camp !== 'player' && other.camp !== 'ally') return;
    if (this.onPickup(this, other)) this.dispose();
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }
}
