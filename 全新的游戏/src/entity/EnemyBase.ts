// ============================================================
// EnemyBase —— 敌人基类（CharacterBase 子类）
// ============================================================
// 使用特效包（.scene.zip，Asset 源）：
//   - 帧动画（前/后帧组）+ FTXQuad 渲染
//   - ★ 每帧应用扭曲参数（distort）——第一帧参数已由 Asset
//     构造时继承到所有帧（见 vendor/player/index.ts）
//   - 随机抖动：distort 的呼吸式扭曲自带随机感（正弦叠加）
// 子类扩展：AI 行为（巡逻/索敌/攻击，后续）

import * as THREE from 'three';
import { CharacterBase, type CharacterBaseOptions } from './CharacterBase';
import type { EntityManager } from './EntityManager';
import type { Asset } from '../vendor/player';
import { FTXQuad } from '../services/render/FTXQuad';

export interface EnemyOptions extends Omit<CharacterBaseOptions, 'kind' | 'asset'> {
  /** 攻击行为标记（后续 AI 用） */
  aggressive?: boolean;
}

export class EnemyBase extends CharacterBase {
  private assetRef: Asset;
  readonly aggressive: boolean;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: Asset,
    opts: EnemyOptions,
  ) {
    super(em, { ...opts, kind: 'enemy', asset });
    this.assetRef = asset;
    this.aggressive = opts.aggressive ?? false;
    this.attachToScene(scene);
    // bbox 映射（帧数据 → quad；★ 纹理实际尺寸 = bbox.w×bbox.h，
    //   不能直接用 frame.width/height（导出时可能与 bbox 不一致 → 只显示部分））
    const ftxFrame = asset.getFtxFrame(0);
    if (ftxFrame && this.renderer) {
      (this.renderer as FTXQuad).setFrameMapping(
        { width: ftxFrame.bbox.w, height: ftxFrame.bbox.h },
        ftxFrame.bbox,
      );
    }
    // ★ 锁定到指定朝向的帧（否则动画控制器默认全资产循环 → 正反面不停交替）
    this.playFacing((opts.facing ?? '前') as '前' | '后');
    // ★ 按纹理宽高比缩放（240×600 竖长纹理 → 不压扁）
    this.applyRenderScale(1.5);
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }

  protected override onUpdate(dt: number): void {
    // 敌人无输入驱动（AI 行为后续接入）
    // 位置保持不变（由 AI 移动后更新）

    // ★ 每帧应用当前帧的扭曲参数（特效包参数，第一帧已继承到所有帧）
    const idx = this.anim!.state.frameIndex;
    const d = this.assetRef.getFrameRenderData(idx);
    if (d && this.renderer) {
      (this.renderer as FTXQuad).setDistort({
        enabled: d.distortEnabled,
        amplitude: d.distortAmplitude,
        frequency: d.distortFrequency,
        speed: d.distortSpeed,
        rotation: d.distortRotation,
      });
    }
  }

  /** 播放朝向（前/后帧组）——与主角 facing 逻辑一致 */
  playFacing(facing: '前' | '后'): void {
    this.anim!.playFrames([facing], { loop: true, fps: 2 });
  }
}
