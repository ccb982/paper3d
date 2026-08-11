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
  private curFacing: '前' | '后' | null = null;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: Asset,
    opts: EnemyOptions,
    private camera?: THREE.Camera,
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

    // ★ 非 billboard：固定朝向（贴片不面相机）。相机相对位置决定 facing：
    //   相机在敌人前方（+z 侧）→ 前帧；绕到背后（-z 侧）→ 转身显示后帧。
    //   这样能检查背面帧，且有立体感（不是始终面向玩家）。
    if (this.camera) {
      const px = this.entity.position.x;
      const pz = this.entity.position.z;
      const camDirZ = this.camera.position.z - pz;
      const camDirX = this.camera.position.x - px;
      // 以贴片朝向（+z）为基准：相机在朝向侧 → 前，反侧 → 后
      const facing: '前' | '后' = camDirZ >= 0 ? '前' : '后';
      if (facing !== this.curFacing) {
        this.curFacing = facing;
        this.playFacing(facing);
        // 转身：后帧时贴片绕 Y 转 180°（背面朝向相机，内容为"后"帧）
        if (this.renderer && 'setYaw' in this.renderer) {
          (this.renderer as { setYaw(r: number): void }).setYaw(facing === '后' ? Math.PI : 0);
        }
      }
      void camDirX;
    }

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
