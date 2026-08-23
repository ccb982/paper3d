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
import { HealthBar } from '../services/fx/HealthBar';

export interface EnemyOptions extends Omit<CharacterBaseOptions, 'kind' | 'asset'> {
  /** 攻击行为标记（预留） */
  aggressive?: boolean;
  /** AI 配置（无 → 静止） */
  aiConfig?: AIConfig;
  /** 生命值（默认 30） */
  hp?: number;
}

export class EnemyBase extends CharacterBase {
  private assetRef: Asset;
  readonly aggressive: boolean;

  // ---- AI 状态（behaviors/conditions 访问） ----
  aiStateMachine: AIStateMachine | null = null;
  aiTurnTimer = 0;
  aiAttackTimer = 0;
  /** ★ 本次挥击是否已播完（attackFinished 条件用） */
  aiSwingDone = false;
  aiMoveDir = { x: 1, z: 0 };
  /** 巡逻目标点（wander 用；null = 选新目标） */
  aiWaypoint: { x: number; z: number } | null = null;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: Asset,
    opts: EnemyOptions,
    private camera?: THREE.Camera,
  ) {
    super(em, { ...opts, kind: 'enemy', asset });
    this.camp = 'enemy';
    this.hp = opts.hp ?? 30; // ★ 敌人生命（普瑞赛斯 30；子弹 10 伤害 × 3 发）
    this.maxHp = this.hp;
    this.assetRef = asset;    this.aggressive = opts.aggressive ?? false;
    this.attachToScene(scene);

    // ★ 头顶血条（附属特效管线：EntityBase.attachEffect；offsetY 高于贴片 2.5 → 不挡头）
    this.attachEffect('health', new HealthBar(scene, this, { width: 0.8, offsetY: 2.8 }));
    // bbox 映射（纹理实际尺寸 = bbox.w×bbox.h，不能直接用 frame.width/height）
    const ftxFrame = asset.getFtxFrame(0);
    if (ftxFrame && this.renderer) {
      (this.renderer as FTXQuad).setFrameMapping(
        { width: ftxFrame.bbox.w, height: ftxFrame.bbox.h },
        ftxFrame.bbox,
      );
    }
    // 初始朝向（贴片朝 +z；显示帧由相机判定）
    this.setFrameAnimated((opts.facing ?? '前') as '前' | '后');
    // 纹理宽高比缩放（不压扁）
    this.applyRenderScale(1.0); // ★ 贴片宽 1.0（与碰撞胶囊 1.0 直径对齐）

    // ---- AI：配置驱动状态机 + 注册到系统 ----
    if (opts.aiConfig) {
      this.aiStateMachine = new AIStateMachine(opts.aiConfig);
      aiSystem.register(this);
    }
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    const quad = new FTXQuad(scene, source);
    quad.setCastShadow(true); // ★ 实体投影（cutout 剪影随帧同步）
    return quad;
  }

  /** ★ AI 驱动入口（AISystem 每帧调用） */
  updateAI(dt: number, ctx: BehaviorContext): void {
    // ★ 本帧默认不移动；行为调 moveBy 才设方向（否则攻击等无移动行为会残留速度漂移）
    this.controller.moveDir.x = 0;
    this.controller.moveDir.y = 0;
    this.aiStateMachine?.update(this, ctx);
  }

  /** ★ 移动（统一走 CharacterController 基类函数，与玩家一致）：
   *   moveToward 设期望方向 → CharacterBase 速度驱动 → rapier 结算位置
   *   ★ 角色朝向 = 移动方向：贴片绕 Y 旋转到移动方向角（任意角度） */
  moveBy(dx: number, dz: number, dt: number, speed: number): void {
    this.controller.moveToward(dx, dz, dt, speed);
    // 贴片朝向 = 移动方向（绕 Y 旋转：+z 指向移动方向）
    if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
      this.yawBase = Math.atan2(dx, dz);
    }
  }

  /** 切帧（显示帧：由相机判定，见 onUpdate） */
  private setFrameAnimated(facing: '前' | '后'): void {
    if (this.showFacing === facing) return;
    this.showFacing = facing;
    this.anim!.playFrames([facing], { loop: true, fps: 1 });
  }
  /** 贴片朝向角（移动方向决定） */
  private yawBase = 0;
  /** 当前显示帧（相机判定） */
  private showFacing: '前' | '后' | null = null;

  /** ★ 渲染距离应用（基类联动动画/渲染管线；基类 viewLod 供子类降级表现） */
  override applyViewDistance(distance: number): void {
    super.applyViewDistance(distance);
    // 立即按等级应用扭曲开关（不等下一帧 onUpdate）
    this.applyDistort();
  }

  protected override onUpdate(dt: number): void {
    // ★ 基类位置推进（moveDir × speed → 位置；无输入时 controller.update 不跑）
    super.onUpdate(dt);
    // ★ 显示帧 + 转身由相机判定（旁观者视角）：
    //   相机在角色正面侧 → 前帧 + 贴片保持移动方向朝向
    //   相机在背面侧 → 后帧 + 贴片转身 180°（面向相机绘制背面）
    if (this.camera) {
      const camDirZ = this.camera.position.z - this.entity.position.z;
      const camDirX = this.camera.position.x - this.entity.position.x;
      // 贴片正面方向（+z 经 yawBase 旋转）
      const fz = Math.cos(this.yawBase);
      const fx = Math.sin(this.yawBase);
      // 相机是否在正面侧（点积 > 0）
      const facingCam = (camDirX * fx + camDirZ * fz) >= 0;
      if (facingCam) {
        this.setFrameAnimated('前');
        this.applyYaw(this.yawBase);
      } else {
        this.setFrameAnimated('后');
        this.applyYaw(this.yawBase + Math.PI);
      }
    }

    // ★ 每帧应用当前帧的扭曲参数（特效包参数，第一帧已继承到所有帧；
    //   ★ LOD 降级：viewLod 1+ 不应用扭曲——省计算，视觉可接受）
    this.applyDistort();
  }

  /** 应用当前帧扭曲参数（按 viewLod 开关） */
  private applyDistort(): void {
    const idx = this.anim!.state.frameIndex;
    const d = this.assetRef.getFrameRenderData(idx);
    if (d && this.renderer) {
      (this.renderer as FTXQuad).setDistort({
        enabled: this.viewLod === 0 && d.distortEnabled,
        amplitude: d.distortAmplitude,
        frequency: d.distortFrequency,
        speed: d.distortSpeed,
        rotation: d.distortRotation,
      });
    }
  }

  /** 贴片绕 Y 旋转（朝相机侧显示对应面） */
  private applyYaw(rad: number): void {
    if (this.renderer && 'setYaw' in this.renderer) {
      (this.renderer as { setYaw(r: number): void }).setYaw(rad);
    }
  }

  /** 销毁：同时从 AI 系统注销 */
  override dispose(): void {
    aiSystem.unregister(this);
    super.dispose();
  }
}
