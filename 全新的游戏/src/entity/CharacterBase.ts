// ============================================================
// CharacterBase —— 角色基类（EntityBase 子类）
// ============================================================
// 集成：CharacterController（相机相对移动/跳跃/朝向）+ 动画/渲染管线
// 物理：velocity 模式（速度驱动 + 位置读回，碰撞交给 rapier）
// 子类：Player（输入驱动）/ Ally / Enemy（AI 驱动）

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import { CharacterController, type CharacterAnimMap } from '../systems/player/CharacterController';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import type { InputActions } from '../platform/input/InputActions';
import type { CameraFrame } from '../services/camera/CameraController';
import { shapeExtents, separateXZ } from '../services/physics/Collision';
import { CharacterFxManager } from '../services/fx/CharacterFxManager';
import type { FluidEffect } from '../vendor/player/fluid/FluidEffect';
import { SilhouetteShadow } from '../services/render/SilhouetteShadow';
import { RasterMap } from '../services/map/RasterMap';

export interface CharacterBaseOptions extends EntityBaseOptions {
  /** 动画状态表（状态 → 帧名序列，按朝向分组） */
  animMap: CharacterAnimMap;
  /** 移动速度（世界单位/秒） */
  moveSpeed?: number;
  /** 初始朝向 */
  facing?: string;
}

/** ★ 角色默认碰撞体积（长方体，2D 贴片正反面都扁：
 *   正面（x）宽 0.56 对齐贴片宽度；厚度（z）0.3 薄片；
 *   高 2.0（贴片 2.5 的 80%，脚底到肩部）
 *   模块级常量：super() 时字段尚未初始化，构造参数只能引用常量 */
const DEFAULT_COLLISION_VOLUME = {
  shape: { type: 'cuboid', hx: 0.28, hy: 1.0, hz: 0.15 } as const,
  offsetY: 1.0,
};

export abstract class CharacterBase extends EntityBase {
  readonly controller: CharacterController;
  /** ★ 角色碰撞体积（实例基类属性；子类可覆写为不同体型） */
  readonly collisionVolume: { shape: import('../services/physics/PhysicsWorld').ColliderShape; offsetY: number } = DEFAULT_COLLISION_VOLUME;

  constructor(
    em: EntityManager,
    opts: CharacterBaseOptions,
  ) {
    super(em, {
      kind: opts.kind,
      x: opts.x, y: opts.y, z: opts.z,
      // ★ 角色 = 运动学刚体：位置 100% 代码驱动（x/z 输入/AI、y 模式层钉地形），
      //   物理只做推挤（踢开物品/子弹碰撞事件），不受重力/力 → 无抖动/无爆炸
      physics: opts.physics ?? {
        type: 'kinematic',
        options: { shape: DEFAULT_COLLISION_VOLUME.shape },
      },
      asset: opts.asset,
      animInitial: opts.facing ? { facing: opts.facing } : undefined,
    });
    this.physicsMode = 'kinematic';
    if (!this.anim) throw new Error('CharacterBase 需要动画资产');
    this.controller = new CharacterController(this.anim, opts.animMap, opts.moveSpeed ?? 2.5);
  }

  protected override onUpdate(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    if (input && cameraFrame) {
      this.controller.update(dt, input, cameraFrame);
    }
    // ★ 位置推进（kinematic：直接移动实体位置 → syncPhysics 驱动刚体；
    //   y = 地形高度由模式层每帧设置）
    const dir = this.controller.moveDir;
    const speed = this.controller.moveSpeed;
    this.entity.position.x += dir.x * speed * dt;
    this.entity.position.z += dir.y * speed * dt;
    // ★ 角色间推挤（kinematic 无物理响应 → 实体层处理互相阻挡）
    this.separateFromOthers();
    // ★ 受击染料推进（矢量平流 + 计时释放）
    this.updateHitDye(dt);
  }

  /** ★ 受击染料流体纹理（有染料时贴片采样 composite；Timer 结束后恢复 null） */
  protected override getFluidTexture(): THREE.Texture | null {
    return this.hitDye ? this.hitDye.getCompositeTexture() : null;
  }

  /** ★ 角色间推挤：分块查询邻近角色（querySphere）→ 水平重叠 → 最小分离轴推开
   *   （公共规则库 separateXZ，各推一半）。物品/子弹不参与（dynamic，走物理） */
  private separateFromOthers(): void {
    const vol = this.collisionVolume;
    if (!vol) return;
    const p = this.entity.position;
    const me = shapeExtents(vol.shape);
    if (me.hx <= 0 || me.hz <= 0) return;
    // 分块查询（RasterMap）：半径 = 自身半宽 + 最大角色半宽余量（可调参）
    const near = this.em.querySphere(p.x, p.z, me.hx + 0.6);
    for (const o of near) {
      if (o === this || !(o instanceof CharacterBase)) continue;
      const ov = o.collisionVolume;
      if (!ov) continue;
      const op = o.entity.position;
      // 高度差过大（不同层）不分离
      if (Math.abs(p.y - op.y) > 1.5) continue;
      const other = shapeExtents(ov.shape);
      const sep = separateXZ(p.x, p.z, me.hx, me.hz, op.x, op.z, other.hx, other.hz);
      if (!sep) continue;
      p.x += sep.ax;
      p.z += sep.az;
      op.x += sep.bx;
      op.z += sep.bz;
    }
  }

  protected override heightOffset(): number {
    return this.controller.getHeightOffset();
  }

  /** ★ 刚体偏移：构造时 collisionVolume 尚未初始化（super 后）→ fallback 常量，
   *   否则初始刚体位置不修正（kinematic 不受力，不会自动推正 → 埋地） */
  protected override physicsBodyOffsetY(): number {
    return this.collisionVolume?.offsetY ?? DEFAULT_COLLISION_VOLUME.offsetY;
  }

  /** ★ 按纹理宽高比设置角色缩放（避免竖长/横长纹理被压扁）——子类 attach 后调用 */
  protected applyRenderScale(baseSize = 1.5): void {
    if (this.renderer && 'setScaleKeepAspect' in this.renderer) {
      (this.renderer as { setScaleKeepAspect(s: number): void }).setScaleKeepAspect(baseSize);
    }
  }

  // ============================================================
  // 贴地剪影影子（架构 8.0 v4：所有角色自动获得剪影形状的贴地影）
  // ============================================================

  private _silhouetteTex: THREE.CanvasTexture | null = null;
  private _silhouetteExtracted = false;

  override attachToScene(scene: THREE.Scene): void {
    super.attachToScene(scene);
    this.extractSilhouette();
    this.initGroundShadowMesh(scene);
  }

  /** ★ 创建贴地剪影影子面片（独立于主渲染器的暗色剪影层） */
  private initGroundShadowMesh(scene: THREE.Scene): void {
    if (this.gsShadow) return;
    const r = this.renderer as unknown as { mesh?: THREE.Mesh } | null;
    if (!r?.mesh) return;

    const w = Math.abs(r.mesh.scale.x || 1.2);
    const d = Math.abs(r.mesh.scale.y || 1) * 0.7; // 影长≈身高×0.7
    this.gsShadow = new SilhouetteShadow(scene, w, d, 0.38);
  }

  /** 每帧同步：更新剪影遮罩 + 跟随位置 + LOD 渐隐（render 尾部调用） */
  /** ★ 影子每帧同步（EntityBase.update ⑦ 自动调用） */
  protected override onShadowSync(): void {
    if (!this.gsShadow || !this.anim?.source || !this.state) return;
    const pair = this.anim.source.getFramePair(this.state.frameIndex);
    if (pair) this.gsShadow.updateSilhouette(pair.base as never);
    const p = this.entity.position;
    this.gsShadow.followEntity(p.x, p.z, (wx, wz) => RasterMap.current?.surfaceHeightAt(wx, wz) ?? 0);
    this.gsShadow.setOpacityByLod(this.viewLod);
  }

  private gsShadow: import('../services/render/SilhouetteShadow').SilhouetteShadow | null = null;

  /** 从第一帧 FTX 数据提取 alpha 剪影 → 缓存为小画布纹理（一次性）。
   *  遍历基础色纹理，alpha > 阈值的像素写入黑色不透明 → 影子呈角色轮廓形状。 */
  private extractSilhouette(): void {
    if (this._silhouetteExtracted) return;
    this._silhouetteExtracted = true;
    if (!this.anim?.source) return;
    const pair = this.anim.source.getFramePair(0);
    if (!pair) return;

    const base = pair.base as THREE.DataTexture;
    const raw = (base.image as unknown as { width: number; height: number; data: Float32Array });
    const bw = raw.width ?? 0;
    const bh = raw.height ?? 0;
    const data = raw.data;
    if (!bw || !bh || !data) return;

    const SW = 16;
    const SH = Math.max(2, Math.round(SW * bh / bw));
    const c = document.createElement('canvas');
    c.width = SW; c.height = SH;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(SW, SH);

    for (let sy = 0; sy < SH; sy++) {
      const ay = Math.min(bh - 1, Math.floor((sy / SH) * bh));
      for (let sx = 0; sx < SW; sx++) {
        const ax = Math.min(bw - 1, Math.floor((sx / SW) * bw));
        const o = (ay * bw + ax) * 4;
        const a = Math.max(0, Math.min(1, data[o + 3]));
        const di = (sy * SW + sx) * 4;
        img.data[di]     = 0;              // R=黑（影子色）
        img.data[di + 1] = 0;              // G=黑
        img.data[di + 2] = 0;              // B=黑
        img.data[di + 3] = a > 0.5 ? 255 : 0; // A=剪影裁形
      }
    }
    ctx.putImageData(img, 0, 0);

    let opq = 0;
    for (let i = 3; i < img.data.length; i += 4) { if (img.data[i] > 128) opq++; }

    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    this.shadowAlphaTex = tex;
  }

  /** ★ 死亡动画自动管线：任何角色死亡 → 纹理所有权转移给死亡动画
   *   （独立流体撕碎消散，纯表现，不阻塞掉落/结算）。
   *   死亡动画开关（玩家死亡 = 传送复活，不销毁 → 走 onDeath 覆写跳过） */
  protected deathAnimEnabled = true;

  // ★ 受击染料管线（矢量平流注红 + 速度阻尼；变色表示受伤，缓停后恢复）
  protected hitDye: FluidEffect | null = null;
  /** 受击染料存活计时（超时释放 → 恢复原纹理） */
  private hitDyeTimer = 0;
  /** 受击染料时长（秒，默认 1.2） */
  protected hitDyeDuration = 1.2;
  /** 受击染料开关（不需要的角色可关，默认开；★ 仅最高档 LOD(0) 启用，远距离省算） */
  protected hitDyeEnabled = true;
  /** ★ 受击染料注入参数（H/S/L/A + 速率；红色系，高饱和/高亮更明显） */
  protected hitDyeColor: [number, number, number, number] = [0.0, 0.95, 0.6, 0.9];
  /** 受击染料注入半径（归一化，默认 0.45） */
  protected hitDyeRadius = 0.45;

  /** ★ 受击：注入红色染料（矢量平流晕开；已有则重置计时重新注入）。
   *   仅 viewLod===0（最高档）启用——远程 LOD 省算、不干扰远焦。 */
  protected spawnHitDye(at: { x: number; y: number }): void {
    if (!this.hitDyeEnabled || this.viewLod !== 0) return;
    const renderer = CharacterFxManager.renderer;
    const source = this.anim?.source as unknown as {
      createHitDyeEffect?: (renderer: THREE.WebGLRenderer, frameIndex: number) => FluidEffect | null;
    };
    if (!renderer || !source?.createHitDyeEffect) return;

    const frameIndex = this.anim?.state.frameIndex ?? 0;
    if (!this.hitDye || this.hitDyeTimer <= 0) {
      // 首次受击（或已超时释放）：新建独立流体
      this.hitDye?.dispose();
      this.hitDye = source.createHitDyeEffect(renderer, frameIndex) ?? null;
    }
    if (!this.hitDye) return;

    this.hitDyeTimer = this.hitDyeDuration;
    // ★ 注入红色染料（矢量平流；速度很小 → 靠阻尼缓停）
    this.hitDye.solver.queueInjection({
      enabled: true,
      position: { x: at.x, y: at.y },
      radius: this.hitDyeRadius,
      velocity: { x: 0, y: 0 },
      color: this.hitDyeColor,
      rate: 0.6,
    });
  }

  /** ★ 受击染料每帧驱动（update 内调用） */
  private updateHitDye(dt: number): void {
    if (this.hitDye && this.hitDyeTimer > 0) {
      this.hitDye.step(dt);
      this.hitDyeTimer -= dt;
      if (this.hitDyeTimer <= 0) {
        // ★ 计时结束：释放流体 → 恢复原纹理（下次受击重建）
        this.hitDye.dispose();
        this.hitDye = null;
      }
    } else if (this.hitDye && this.hitDyeTimer <= 0) {
      this.hitDye.dispose();
      this.hitDye = null;
    }
  }

  /** ★ 受伤钩子：受击染红 + 死亡动画（正常扣血/死亡流程不变） */
  override onTakeDamage(dmg: number, source: EntityBase | null): void {
    // ★ 受击染料：注入点 = 上半身（x 居中微偏，y=0.35 胸口附近）
    this.spawnHitDye({
      x: 0.5 + (Math.random() - 0.5) * 0.2,
      y: 0.35 + (Math.random() - 0.5) * 0.2,
    });
    super.onTakeDamage(dmg, source);
  }

  /** ★ 只触发死亡动画（不销毁实体）——玩家死亡（传送复活）用 */
  playDeathAnim(): void {
    if (!this.deathAnimEnabled) return;
    const frameIndex = this.anim?.state.frameIndex ?? 0;
    const p = this.entity.position;
    CharacterFxManager.spawnDeathAnim(this.anim!.source, frameIndex, p.x, p.y, p.z);
  }

  /** ★ 销毁：释放受击染料流体（恢复原纹理资源） */
  override dispose(): void {
    this.hitDye?.dispose();
    this.hitDye = null;
    super.dispose();
  }

  /** ★ 死亡：先触发死亡动画（冻结死亡帧 → 流体消散），再走默认销毁 */
  override onDeath(source: EntityBase | null): void {
    if (this.deathAnimEnabled) {
      const frameIndex = this.anim?.state.frameIndex ?? 0;
      const p = this.entity.position;
      CharacterFxManager.spawnDeathAnim(this.anim!.source, frameIndex, p.x, p.y, p.z);
    }
    super.onDeath(source);
  }

  /** 角色世界位置（物理读回后，x/z）——相机/模式层读取 */
  get controllerPosition(): { x: number; y: number } {
    return { x: this.entity.position.x, y: this.entity.position.z };
  }

  /** ★ 当前跳跃高度偏移（相机聚焦点跟随用：跳跃时相机跟着升） */
  get jumpHeight(): number {
    return this.controller.getHeightOffset();
  }
}
