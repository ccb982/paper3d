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
    // ★ 主角豁免视锥裁剪 + 距离 LOD：动画永不因远距离/出视野冻结
    this.lodExempt = true;
    this.attachToScene(scene);
    // bbox 映射（帧数据 → quad；★ 纹理已按 bbox 裁剪，尺寸 = bbox 尺寸，偏移归零，与 EnemyBase 一致）
    const source = asset as unknown as { frames: Array<{ bbox: { x: number; y: number; w: number; h: number } }> };
    const frame0 = source.frames[0];
    const b = frame0.bbox;
    (this.renderer as FTXQuad).setFrameMapping(
      { width: b.w, height: b.h },
      { x: 0, y: 0, w: b.w, h: b.h },
    );
    // ★ 按纹理宽高比缩放（角色站立比例）
    // ★ 贴片宽 1.0（与碰撞胶囊 1.0 直径对齐）→ 2.0（2026-09-06 用户：纹理大小增大一倍；
    //   仅视觉放大，碰撞体仍为 1.0 胶囊）
    this.applyRenderScale(2.0);
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

  /** ★ 贴片 mesh（装备贴片子节点宿主；表现层只读引用） */
  get rendererMesh(): THREE.Mesh | null {
    return (this.renderer as unknown as { mesh?: THREE.Mesh | null })?.mesh ?? null;
  }

  /** ★ 当前朝向（前=脸朝相机 / 后=背向相机）；装备前后纹理展示判定用。
   *   判定以"当前真实绘制帧的帧名前缀"为准（如 前_xxx / 后_xxx），
   *   与按键无关——站定时跟随最后一帧实绘纹理，斜向/攻击亦如实。 */
  get facing(): '前' | '后' {
    const name = this.controller.anim.currentFrameName();
    return name.startsWith('后') ? '后' : '前';
  }

  /** ★ 玩家死亡（暂：不销毁主角——记录 + 扣血表现后续接；结算/重生后续） */
  override onDeath(_source: EntityBase | null): void {
    // ★ 死亡动画（自动管线：只播动画不销毁实体，传送复活）
    this.playDeathAnim();
  }
}
