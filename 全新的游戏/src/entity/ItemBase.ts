// ============================================================
// ItemBase —— 物品基类（EntityBase 子类）
// ============================================================
// 最小版：掉落物（物理落地，read 模式）+ 视觉（ftx 单帧贴片）
// 后续：拾取传感器（onSensor）、资源点采集、itemId 配置表引用

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';

export interface ItemOptions extends Omit<EntityBaseOptions, 'kind'> {
  /** 配置表 itemId（后续） */
  itemId?: string;
  /** 是否受物理影响（掉落物 true / 静态装饰 false） */
  physical?: boolean;
}

export class ItemBase extends EntityBase {
  readonly itemId: string | undefined;

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
        ? { type: 'dynamic', options: { shape: { type: 'ball', radius: 0.15 }, linearDamping: 2 } }
        : undefined,
      asset,
    });
    this.itemId = opts.itemId;
    this.physicsMode = opts.physical ? 'read' : 'none';
    this.attachToScene(scene);
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }
}
