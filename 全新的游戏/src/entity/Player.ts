// ============================================================
// Player —— 主角实体（CharacterBase 子类：输入驱动）
// ============================================================
// 渲染：FTXQuad（纯纹理贴片，billboard 面相机）

import * as THREE from 'three';
import { CharacterBase, type CharacterBaseOptions } from './CharacterBase';
import type { EntityBase } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';

export class Player extends CharacterBase {
  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: FrameAssetSource,
    opts: Omit<CharacterBaseOptions, 'kind' | 'asset'>,
  ) {
    super(em, { ...opts, kind: 'player', asset });
    this.camp = 'player';
    this.attachToScene(scene);
    // bbox 映射（帧数据 → quad；★ 纹理实际尺寸 = bbox 尺寸，与 EnemyBase 一致）
    const source = asset as unknown as { frames: Array<{ bbox: { x: number; y: number; w: number; h: number } }> };
    const frame0 = source.frames[0];
    (this.renderer as FTXQuad).setFrameMapping(
      { width: frame0.bbox.w, height: frame0.bbox.h },
      frame0.bbox,
    );
    // ★ 按纹理宽高比缩放（角色站立比例）
    this.applyRenderScale(1.0); // ★ 贴片宽 1.0（与碰撞胶囊 1.0 直径对齐）
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    // anim.source = 传入的 FrameAssetSource（FrameAnimatorBase 公共字段）
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }

  /** 攻击（消费式按键由模式层转发） */
  attack(): void {
    this.controller.attack();
  }

  /** ★ 玩家死亡（暂：不销毁主角——记录 + 扣血表现后续接；结算/重生后续） */
  override onDeath(source: EntityBase | null): void {
    console.log(`[玩家] 被 ${source?.constructor.name ?? '未知'} 击杀！`);
    // ★ 死亡动画（自动管线：只播动画不销毁实体，传送复活）
    this.playDeathAnim();
  }
}
