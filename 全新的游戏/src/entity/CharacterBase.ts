// ============================================================
// CharacterBase —— 角色基类（EntityBase 子类）
// ============================================================
// 集成：CharacterController（相机相对移动/跳跃/朝向）+ 动画/渲染管线
// 物理：velocity 模式（速度驱动 + 位置读回，碰撞交给 rapier）
// 子类：Player（输入驱动）/ Ally / Enemy（AI 驱动）

import * as THREE from "three";
import { EntityBase, type EntityBaseOptions } from "./EntityBase";
import type { EntityManager } from "./EntityManager";
import {
  CharacterController,
  type CharacterAnimMap,
} from "../systems/player/CharacterController";
import type { FrameAssetSource } from "../services/fx/AssetSource";
import type { InputActions } from "../platform/input/InputActions";
import type { CameraFrame } from "../services/camera/CameraController";
import { shapeExtents, separateXZ } from "../services/physics/Collision";
import { CharacterFxManager } from "../services/fx/CharacterFxManager";
import type { FluidEffect } from "../vendor/player/fluid/FluidEffect";
import { RasterMap } from "../services/map/RasterMap";
import { EDGE_CLIFF_BAND } from "../services/map/SurfaceRules";

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
  shape: { type: "cuboid", hx: 0.28, hy: 1.0, hz: 0.15 } as const,
  offsetY: 1.0,
};

export abstract class CharacterBase extends EntityBase {
  readonly controller: CharacterController;
  /** ★ 起跳站立面高（空中 y 基准；落地时刷新为当前贴地高）。真实跳跃用 */
  private airborneStandY = 0;
  /** ★ 角色碰撞体积（实例基类属性；子类可覆写为不同体型） */
  readonly collisionVolume: {
    shape: import("../services/physics/PhysicsWorld").ColliderShape;
    offsetY: number;
  } = DEFAULT_COLLISION_VOLUME;

  constructor(em: EntityManager, opts: CharacterBaseOptions) {
    super(em, {
      kind: opts.kind,
      x: opts.x,
      y: opts.y,
      z: opts.z,
      // ★ 角色 = 运动学刚体：位置 100% 代码驱动（x/z 输入/AI、y 模式层钉地形），
      //   物理只做推挤（踢开物品/子弹碰撞事件），不受重力/力 → 无抖动/无爆炸
      physics: opts.physics ?? {
        type: "kinematic",
        options: { shape: DEFAULT_COLLISION_VOLUME.shape },
      },
      asset: opts.asset,
      animInitial: opts.facing ? { facing: opts.facing } : undefined,
    });
    this.physicsMode = "kinematic";
    if (!this.anim) throw new Error("CharacterBase 需要动画资产");
    this.controller = new CharacterController(
      this.anim,
      opts.animMap,
      opts.moveSpeed ?? 2.5,
    );
  }

  protected override onUpdate(
    dt: number,
    input?: InputActions,
    cameraFrame?: CameraFrame,
  ): void {
    if (input && cameraFrame) {
      this.controller.update(dt, input, cameraFrame);
    }
    // ★ 位置推进（kinematic：直接移动实体位置 → syncPhysics 驱动刚体；
    //   y 由角色二态（落地/空中）在下方统一结算）
    const dir = this.controller.moveDir;
    const speed = this.controller.moveSpeed;
    const prevX = this.entity.position.x;
    const prevZ = this.entity.position.z;
    // ★ boss4D 玩家专属：垂直壁贴附保护——位移逐分量受阻检查。
    //   朝壁方向（前方地表比脚底地表高出 EDGE_CLIFF_BAND 的立面）位移分量为 0，
    //   角色始终与壁保留 clearance 距离（碰撞盒边缘外 m）。
    //   检查只看地形高差、与跳跃离地高度无关 → 跳跃中朝壁的速度分量同样被消，
    //   实现"跳跃无向墙壁速度"。
    let dx = dir.x * speed * dt;
    let dz = dir.y * speed * dt;
    if (this.controller.requireRealLanding) {
      const raster = RasterMap.current;
      const p0 = this.entity.position;
      const gyHere = raster?.surfaceHeightAt(p0.x, p0.z) ?? 0;
      if (raster) {
        const ext = shapeExtents(this.collisionVolume.shape);
        const m = 0.1; // 贴壁保留距离
        if (
          dx > 0 &&
          raster.surfaceHeightAt(p0.x + ext.hx + m, p0.z) - gyHere > EDGE_CLIFF_BAND
        ) {
          dx = 0;
        } else if (
          dx < 0 &&
          raster.surfaceHeightAt(p0.x - ext.hx - m, p0.z) - gyHere > EDGE_CLIFF_BAND
        ) {
          dx = 0;
        }
        if (
          dz > 0 &&
          raster.surfaceHeightAt(p0.x, p0.z + ext.hz + m) - gyHere > EDGE_CLIFF_BAND
        ) {
          dz = 0;
        } else if (
          dz < 0 &&
          raster.surfaceHeightAt(p0.x, p0.z - ext.hz - m) - gyHere > EDGE_CLIFF_BAND
        ) {
          dz = 0;
        }
      }
    }
    this.entity.position.x += dx;
    this.entity.position.z += dz;
    const p = this.entity.position;
    const gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    if (this.controller.isAirborne()) {
      // ★ 空中态：真实离地，y = 起跳站立面 + 抛物线偏移（峰值 0.8 → 可越 0.5 高差）。
      //   落地交给 WorldMode 落回贴地。横向位移已在上面按分量做了垂直壁受阻检查，
      //   因此跳跃无法朝壁方向推进（不穿模、不会横向切入壁腹被 clamp 抬升）。
      p.y = this.airborneStandY + this.controller.getHeightOffset();
    } else {
      // ★ 落地态：刷新站立基准；cliff（大落差）水平阻挡仅落地态适用——
      //   位移后目标贴地高比当前脚高高出 EDGE_CLIFF_BAND(0.5) 以上 → 回退，
      //   0.5 以下小台阶由 clampCharacter 上行限速自动踏过（stepHeight ≡ EDGE_CLIFF_BAND）。
      this.airborneStandY = gy;
      if (gy - p.y > EDGE_CLIFF_BAND) {
        p.x = prevX;
        p.z = prevZ;
      }
    }
    // ★ 真实贴地信号（boss4D 玩家跳跃资格用）：落地态 ∧ 脚底已贴合实际站位
    //   地表高（±0.05）才算"在地面上"。悬崖回退后重新采样，避免用位移前采样。
    //   悬空/虚空（地表低于脚底）→ 不贴地 → 长按跳跃不生效。
    if (this.controller.requireRealLanding) {
      const floorY = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
      this.controller.onFloor =
        !this.controller.isAirborne() && Math.abs(p.y - floorY) <= 0.05;
    }
    // ★ 角色间推挤（kinematic 无物理响应 → 实体层处理互相阻挡）
    this.separateFromOthers();
    // ★ 地图装饰物推挤（碎石等 fixed cuboid 障碍；同上原理）
    this.separateFromStatics();
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
      const sep = separateXZ(
        p.x,
        p.z,
        me.hx,
        me.hz,
        op.x,
        op.z,
        other.hx,
        other.hz,
      );
      if (!sep) continue;
      p.x += sep.ax;
      p.z += sep.az;
      op.x += sep.bx;
      op.z += sep.bz;
    }
  }

  /** ★ 地图装饰物推挤（碎石等 fixed cuboid；kinematic 无物理响应 → 手动弹出）。
   *   与角色间推挤同套路：圆形重叠 → 沿连线把角色推出障碍半径外。
   *   只处理 kind='decoration' 的 cuboid（trimesh/角色/物品由各自机制负责）。 */
  private separateFromStatics(): void {
    const vol = this.collisionVolume;
    const pw = this.em.physics;
    if (!vol || !pw) return;
    const me = shapeExtents(vol.shape);
    if (me.hx <= 0 || me.hz <= 0) return;
    const p = this.entity.position;
    const obstacles = pw.queryStaticObstacles(
      { x: p.x, y: p.y, z: p.z },
      me.hx + 0.4,
    );
    for (const o of obstacles) {
      const ent = this.em.get(o.id);
      if (!ent || ent.kind !== "decoration") continue; // 只推挤地图装饰物
      // 层差过滤：角色脚底不在障碍高度带内不推挤（允许上下平台重叠）
      const baseY = o.y - o.hy,
        topY = o.y + o.hy;
      if (p.y < baseY - me.hy - 0.3 || p.y > topY + me.hy + 0.3) continue;
      const dx = p.x - o.x,
        dz = p.z - o.z;
      const minDist = me.hx + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        p.x = o.x + minDist;
        continue;
      } // 正中心：任选一侧推出
      const push = (minDist - d) / d;
      p.x += dx * push;
      p.z += dz * push;
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
    if (this.renderer && "setScaleKeepAspect" in this.renderer) {
      (
        this.renderer as { setScaleKeepAspect(s: number): void }
      ).setScaleKeepAspect(baseSize);
    }
  }

  /** ★ 影子声明（角色：宽/视觉高=贴片尺寸；太阳投影模式，早晚影子方向长度随日照变化） */
  protected override get shadowShape(): {
    w: number;
    h?: number;
    alpha?: number;
  } | null {
    const r = this.renderer as unknown as { mesh?: THREE.Mesh } | null;
    if (!r?.mesh) return null;
    return {
      w: Math.abs(r.mesh.scale.x || 1.2),
      h: Math.abs(r.mesh.scale.y || 1),
      alpha: 0.38,
    };
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
  protected hitDyeColor: [number, number, number, number] = [
    0.0, 0.95, 0.6, 0.9,
  ];
  /** 受击染料注入半径（归一化，默认 0.45） */
  protected hitDyeRadius = 0.45;

  /** ★ 受击：注入红色染料（矢量平流晕开；已有则重置计时重新注入）。
   *   仅 viewLod===0（最高档）启用——远程 LOD 省算、不干扰远焦。 */
  protected spawnHitDye(at: { x: number; y: number }): void {
    if (!this.hitDyeEnabled || this.viewLod !== 0) return;
    const renderer = CharacterFxManager.renderer;
    const source = this.anim?.source as unknown as {
      createHitDyeEffect?: (
        renderer: THREE.WebGLRenderer,
        frameIndex: number,
      ) => FluidEffect | null;
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
    // ★ 注入红色染料（scalar 模式注入密度，vector 模式注入颜色）
    this.hitDye.solver.queueInjection({
      enabled: true,
      position: { x: at.x, y: at.y },
      radius: this.hitDyeRadius,
      velocity: { x: 0, y: 0 },
      color: this.hitDyeColor,
      density: 1.0,  // scalar 模式注入浓度，vector 模式忽略
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
    CharacterFxManager.spawnDeathAnim(
      this.anim!.source,
      frameIndex,
      p.x,
      p.y,
      p.z,
    );
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
      CharacterFxManager.spawnDeathAnim(
        this.anim!.source,
        frameIndex,
        p.x,
        p.y,
        p.z,
      );
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
