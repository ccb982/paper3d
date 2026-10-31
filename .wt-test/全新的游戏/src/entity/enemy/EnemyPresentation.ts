// ============================================================
// EnemyPresentation —— 敌人表现器（E5 组合件；纯搬运，行为零变化）
// ============================================================
// 显示帧（相机判定：前/后）+ 贴片转身（billboard / 双向）+ 扭曲参数。
// 视锥外跳过由调用方（EnemyBase.onUpdate）保证。
// ============================================================

import type * as THREE from 'three';
import type { FrameAnimatorBase } from '../../services/fx/FrameAnimatorBase';
import type { CharacterFxAssetSource } from '../../services/fx/AssetSource';

/** 表现帧上下文（EnemyBase 每次喂入）。
 *  renderer 用 unknown：实际为 FxRendererBase（含 setYaw/setDistort），内部结构化取用。 */
export interface PresentationFrame {
  anim: FrameAnimatorBase;
  asset: CharacterFxAssetSource;
  renderer: unknown;
  viewLod: number;
}

export class EnemyPresentation {
  /** ★ 贴片朝向角（移动方向决定） */
  yawBase = 0;
  /** 当前显示帧（相机判定） */
  private showFacing: '前' | '后' | null = null;

  /** 切帧（显示帧：由相机判定，见 update） */
  setFrameAnimated(anim: FrameAnimatorBase, facing: '前' | '后'): void {
    if (this.showFacing === facing) return;
    this.showFacing = facing;
    const source = anim.source;
    // 缺帧回退：目标帧 → 前帧 → 资产单帧「帧 1」；都没有 = 保持第 0 帧（不刷警告）
    let name: string | null = null;
    if (source.hasFrame(facing)) name = facing;
    else if (source.hasFrame('前')) name = '前';
    else if (source.hasFrame('帧 1')) name = '帧 1';
    if (name) anim.playFrames([name], { loop: true, fps: 1 });
  }

  /** ★ 每帧显示帧 + 转身 + 扭曲（相机判定）：
   *   相机在角色正面侧 → 前帧 + 贴片保持移动方向朝向
   *   相机在背面侧 → 后帧 + 贴片转身 180°（面向相机绘制背面） */
  update(o: PresentationFrame & { billboard: boolean; camera: THREE.Camera | null | undefined; x: number; z: number }): void {
    if (o.billboard) {
      // ★ 无背面素材：始终正面朝相机（billboard 由 EntityBase.render 应用）——
      //   不转身、不切后帧（否则露出背面空白/镜像贴图）
      this.setFrameAnimated(o.anim, '前');
    } else if (o.camera) {
      const camDirZ = o.camera.position.z - o.z;
      const camDirX = o.camera.position.x - o.x;
      // 贴片正面方向（+z 经 yawBase 旋转）
      const fz = Math.cos(this.yawBase);
      const fx = Math.sin(this.yawBase);
      // 相机是否在正面侧（点积 > 0）
      const facingCam = (camDirX * fx + camDirZ * fz) >= 0;
      if (facingCam) {
        this.setFrameAnimated(o.anim, '前');
        this.applyYaw(o.renderer, this.yawBase);
      } else {
        this.setFrameAnimated(o.anim, '后');
        this.applyYaw(o.renderer, this.yawBase + Math.PI);
      }
    }
    // ★ 每帧应用当前帧的扭曲参数（特效包参数，第一帧已继承到所有帧；
    //   ★ LOD 降级：viewLod 1+ 不应用扭曲——省计算，视觉可接受）
    this.applyDistort(o);
  }

  /** 应用当前帧扭曲参数（按 viewLod 开关）。
   *  ★ 兼容两种资产：特效包(Asset)走 getFrameRenderData；纯纹理包(FtxAsset)
   *    无该方法，改从 getFtxFrame 读同一组 distort 字段。 */
  applyDistort(o: PresentationFrame): void {
    const idx = o.anim.state.frameIndex;
    let d: {
      distortEnabled: boolean; distortAmplitude: number; distortFrequency: number;
      distortSpeed: number; distortRotation: number;
    } | null | undefined;
    const a = o.asset as unknown as {
      getFrameRenderData?: (i: number) => {
        distortEnabled: boolean; distortAmplitude: number; distortFrequency: number;
        distortSpeed: number; distortRotation: number;
      } | null;
    };
    if (typeof a.getFrameRenderData === 'function') {
      d = a.getFrameRenderData(idx);
      if (d && 'distortEnabled' in d) {
        // 特效包：直接使用
      } else {
        d = null;
      }
    } else {
      // 纯纹理包(FtxAsset)：无特效包 distort 参数 → 默认关闭
      const f = o.asset.getFtxFrame(idx) as unknown as {
        distortEnabled?: boolean; distortAmplitude?: number; distortFrequency?: number;
        distortSpeed?: number; distortRotation?: number;
      } | null;
      d = f ? {
        distortEnabled: !!f.distortEnabled, distortAmplitude: f.distortAmplitude ?? 0.06,
        distortFrequency: f.distortFrequency ?? 5.0, distortSpeed: f.distortSpeed ?? 1.2,
        distortRotation: f.distortRotation ?? 0,
      } : null;
    }
    if (d && o.renderer) {
      (o.renderer as { setDistort(o: { enabled: boolean; amplitude: number; frequency: number; speed: number; rotation: number }): void }).setDistort({
        enabled: o.viewLod === 0 && d.distortEnabled,
        amplitude: d.distortAmplitude,
        frequency: d.distortFrequency,
        speed: d.distortSpeed,
        rotation: d.distortRotation,
      });
    }
  }

  /** 贴片绕 Y 旋转（朝相机侧显示对应面） */
  private applyYaw(renderer: unknown, rad: number): void {
    if (renderer && typeof renderer === 'object' && 'setYaw' in renderer) {
      (renderer as { setYaw(r: number): void }).setYaw(rad);
    }
  }
}
