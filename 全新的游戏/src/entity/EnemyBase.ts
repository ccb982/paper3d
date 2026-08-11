// ============================================================
// EnemyBase —— 敌人基类（CharacterBase 子类 + AI 模块）
// ============================================================
// 使用特效包（.scene.zip，Asset 源）：
//   - 帧动画（前/后帧组）+ FTXQuad 渲染 + 扭曲参数（第一帧继承）
//   - ★ AI 模块：状态机驱动（巡逻/索敌/攻击，配置驱动）
//   - ★ 朝向由移动方向决定（非相机）——敌人自主转身，玩家可绕背看后帧

import * as THREE from 'three';
import { CharacterBase, type CharacterBaseOptions } from './CharacterBase';
import type { EntityManager } from './EntityManager';
import type { Asset } from '../vendor/player';
import { FTXQuad } from '../services/render/FTXQuad';
import { AIStateMachine } from '../systems/ai/AIStateMachine';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { aiSystem } from '../systems/ai/AISystem';
import type { AIConfig } from '../systems/ai/aiconfig';

export interface EnemyOptions extends Omit<CharacterBaseOptions, 'kind' | 'asset'> {
  /** 攻击行为标记（预留） */
  aggressive?: boolean;
  /** AI 配置（无 → 静止） */
  aiConfig?: AIConfig;
}

export class EnemyBase extends CharacterBase {
  private assetRef: Asset;
  readonly aggressive: boolean;

  // ---- AI 状态（behaviors/conditions 访问） ----
  aiStateMachine: AIStateMachine | null = null;
  aiTurnTimer = 0;
  aiAttackTimer = 0;
  aiMoveDir = { x: 1, z: 0 };

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
    // bbox 映射（纹理实际尺寸 = bbox.w×bbox.h，不能直接用 frame.width/height）
    const ftxFrame = asset.getFtxFrame(0);
    if (ftxFrame && this.renderer) {
      (this.renderer as FTXQuad).setFrameMapping(
        { width: ftxFrame.bbox.w, height: ftxFrame.bbox.h },
        ftxFrame.bbox,
      );
    }
    // 锁定初始朝向帧
    this.setFacingAnimated((opts.facing ?? '前') as '前' | '后');
    // 纹理宽高比缩放（不压扁）
    this.applyRenderScale(1.5);

    // ---- AI：配置驱动状态机 + 注册到系统 ----
    if (opts.aiConfig) {
      this.aiStateMachine = new AIStateMachine(opts.aiConfig);
      aiSystem.register(this);
    }
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }

  /** ★ AI 驱动入口（AISystem 每帧调用） */
  updateAI(dt: number, ctx: BehaviorContext): void {
    this.aiStateMachine?.update(this, ctx);
  }

  /** ★ 移动（纯位移；朝向由相机相对方位决定，见 onUpdate） */
  moveBy(dx: number, dz: number, dt: number, speed: number): void {
    const p = this.entity.position;
    p.x += dx * speed * dt;
    p.z += dz * speed * dt;
  }

  /** 设置朝向（切帧 + 贴片转身 180°）——切了才动，避免每帧重复调用 */
  private setFacingAnimated(facing: '前' | '后'): void {
    if (this.curFacing === facing) return;
    this.curFacing = facing;
    this.anim!.playFrames([facing], { loop: true, fps: 1 });
    if (this.renderer && 'setYaw' in this.renderer) {
      (this.renderer as { setYaw(r: number): void }).setYaw(facing === '后' ? Math.PI : 0);
    }
  }
  private curFacing: '前' | '后' | null = null;

  protected override onUpdate(dt: number): void {
    // ★ 正反面显示由相机相对方位决定（转身朝向玩家视角 → 背面不消失）：
    //   相机在 +z 侧 → 前帧；绕到 -z 侧 → 转身显示后帧
    if (this.camera) {
      const pz = this.entity.position.z;
      const facing: '前' | '后' = (this.camera.position.z - pz) >= 0 ? '前' : '后';
      this.setFacingAnimated(facing);
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

  /** 销毁：同时从 AI 系统注销 */
  override dispose(): void {
    aiSystem.unregister(this);
    super.dispose();
  }
}
