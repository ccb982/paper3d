// ============================================================
// EnemyBase —— 敌人基类（CharacterBase 子类 + AI 模块）
// ============================================================
// 使用特效包（.scene.zip，Asset 源）：
//   - 帧动画（前/后帧组）+ FTXQuad 渲染 + 扭曲参数（第一帧继承）
//   - ★ AI 模块：状态机驱动（巡逻/索敌/攻击，配置驱动）
//   - ★ 朝向由移动方向决定（非相机）——敌人自主转身，玩家可绕背看后帧

import * as THREE from 'three';
import {
  CharacterBase,
  DEFAULT_COLLISION_VOLUME,
  type CharacterBaseOptions,
} from './CharacterBase';
import type { EntityManager } from './EntityManager';
import type { CharacterFxAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';
import { AIStateMachine } from '../systems/ai/AIStateMachine';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { aiSystem } from '../systems/ai/AISystem';
import type { AIConfig } from '../systems/ai/aiconfig';
import { HealthBar } from '../services/fx/HealthBar';
import { RasterMap } from '../services/map/RasterMap';

export interface EnemyOptions extends Omit<CharacterBaseOptions, 'kind' | 'asset'> {
  /** 攻击行为标记（预留） */
  aggressive?: boolean;
  /** AI 配置（无 → 静止） */
  aiConfig?: AIConfig;
  /** 生命值（默认 30） */
  hp?: number;
  /** ★ 贴片放大（默认 1） */
  scale?: number;
  /** ★ 碰撞体积放大（在 scale 基础上再乘；默认 1，命中体积与贴片可不等） */
  collisionScale?: number;
  /** ★ 防御（伤害结算：damage + 攻方 attackPower - 防方 defense） */
  defense?: number;
  /** ★ 攻击力加成（默认 0） */
  attackPower?: number;
}

export class EnemyBase extends CharacterBase {
  private assetRef: CharacterFxAssetSource;
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
  /** ★ 危险地形转向节流计时（前方坑洞/悬崖 → 禁止直行，转向避让） */
  private hazardTurnTimer = 0;
  /** ★ 上次采纳的安全绕行航向（贴边连续走，不来回抖动；null=无） */
  private hazardSafeDir: { x: number; z: number } | null = null;
  /** ★ 前方探测距离（米；> 碰撞半宽，提前一个身位避开坑沿） */
  private static readonly HAZARD_PROBE = 2.0;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: CharacterFxAssetSource,
    opts: EnemyOptions,
    private camera?: THREE.Camera,
  ) {
    // ★ 体型：贴片 × scale；碰撞体积在 scale 基础上再 × collisionScale（默认 1）
    const scale = opts.scale ?? 1;
    const colScale = (opts.scale ?? 1) * (opts.collisionScale ?? 1);
    const baseVol = DEFAULT_COLLISION_VOLUME;
    const shape = baseVol.shape.type === 'cuboid'
      ? { type: 'cuboid' as const, hx: baseVol.shape.hx * colScale, hy: baseVol.shape.hy * colScale, hz: baseVol.shape.hz * colScale }
      : baseVol.shape;
    const offsetY = baseVol.offsetY * colScale;
    super(em, {
      ...opts,
      kind: 'enemy',
      asset,
      // 物理碰撞体（子弹命中/推挤）形状与碰撞体积声明同步放大
      physics: opts.physics ?? { type: 'kinematic', options: { shape } },
    });
    // ★ 推挤/偏移逻辑读取的碰撞体积 = 实际物理形状（super 后字段可写）
    this.collisionVolume = { shape, offsetY };
    this.camp = 'enemy';
    this.hp = opts.hp ?? 30; // ★ 敌人生命（普瑞赛斯 30；子弹 10 伤害 × 3 发）
    this.maxHp = this.hp;
    this.defense = opts.defense ?? 0;       // ★ 防御（高防 = 子弹/近战都更难打动）
    this.attackPower = opts.attackPower ?? 0; // ★ 攻击力加成（叠加在 AI 近战伤害上）
    this.assetRef = asset;    this.aggressive = opts.aggressive ?? false;
    this.attachToScene(scene);

    // bbox 映射（base/residual 纹理已按 bbox 裁剪 → 尺寸 = bbox.w×bbox.h，
    // 但 bbox 偏移量已裁掉，shader 映射必须用原点 0，否则内容被二次平移裁剪）
    const ftxFrame = asset.getFtxFrame(0);
    if (ftxFrame && this.renderer) {
      const b = ftxFrame.bbox;
      (this.renderer as FTXQuad).setFrameMapping(
        { width: b.w, height: b.h },
        { x: 0, y: 0, w: b.w, h: b.h },
      );
    }
    // 初始朝向（贴片朝 +z；显示帧由相机判定）
    this.setFrameAnimated((opts.facing ?? '前') as '前' | '后');
    // 纹理宽高比缩放（不压扁；宽 = scale，高 = scale×bbox高宽比）
    this.applyRenderScale(scale);
    // ★ 头顶血条：按放大后的实际贴片高度定位（顶端 + 0.4 余量），宽度随体型
    const aspect = ftxFrame ? ftxFrame.bbox.h / ftxFrame.bbox.w : 1;
    this.attachEffect('health', new HealthBar(scene, this, {
      width: 0.8 * scale,
      offsetY: scale * aspect + 0.4,
    }));

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


  /** ★ AI 激活半径（与玩家超过此距离 → AI 休眠：不索敌/不追击/不游走，省算力） */
  aiActiveRadius = 75;

  /** ★ AI 驱动入口（AISystem 每帧调用） */
  updateAI(dt: number, ctx: BehaviorContext): void {
    // ★ 本帧默认不移动；行为调 moveBy 才设方向（否则攻击等无移动行为会残留速度漂移）
    this.controller.moveDir.x = 0;
    this.controller.moveDir.y = 0;
    // ★ 距离分级：超出 AI 激活半径 → 休眠（chunk 波次可能在 100m+ 外生成，
    //   全图 AI 全速跑没意义——进入半径自动唤醒，状态机保留）
    if (ctx.focusX !== undefined && ctx.focusZ !== undefined) {
      const dx = this.entity.position.x - ctx.focusX;
      const dz = this.entity.position.z - ctx.focusZ;
      const r = this.aiActiveRadius;
      if (dx * dx + dz * dz > r * r) return;
    }
    this.aiStateMachine?.update(this, ctx);
  }

  /** ★ 移动（统一走 CharacterController 基类函数，与玩家一致）：
   *   moveToward 设期望方向 → CharacterBase 速度驱动 → rapier 结算位置
   *   ★ 角色朝向 = 移动方向：贴片绕 Y 旋转到移动方向角（任意角度）
   *   ★ 防掉坑：移动前探测前方地形，坑洞/悬崖/水面前提前停下转向 */
  moveBy(dx: number, dz: number, dt: number, speed: number): void {
    // ★ 危险地形回避：若目标方向前方 HAZARD_PROBE 米内有坑/悬崖，
    //   不朝该方向直行，改沿安全方向绕行
    if (this.isDangerAhead(dx, dz)) {
      // ★ 若上次安全航向仍安全（且与目标方向不相反）→ 延续，贴边连续走
      if (this.hazardSafeDir) {
        const k = this.hazardSafeDir;
        if (k.x * dx + k.z * dz > -0.1 && !this.isDangerAhead(k.x, k.z)) {
          this.controller.moveToward(k.x, k.z, dt, speed);
          this.yawBase = Math.atan2(k.x, k.z);
          return;
        }
        this.hazardSafeDir = null;
      }
      // ★ 节流：只隔一段时间重新扫向（避免原地高频抖动/每帧重算）
      this.hazardTurnTimer -= dt;
      if (this.hazardTurnTimer > 0) {
        this.controller.moveDir.x = 0;
        this.controller.moveDir.y = 0;
        return;
      }
      this.hazardTurnTimer = 0.45;
      // ★ 扫描候选航向：从小到大偏转 ±22.5°、±45°… 直到找到安全方向
      const base = Math.atan2(dz, dx);
      let found: { x: number; z: number } | null = null;
      for (let k = 1; k <= 8; k++) {
        const dev = (Math.PI / 8) * k;
        for (const s of [1, -1] as const) {
          const a = base + dev * s;
          const cdx = Math.cos(a), cdz = Math.sin(a);
          if (!this.isDangerAhead(cdx, cdz)) { found = { x: cdx, z: cdz }; break; }
        }
        if (found) break;
      }
      if (found) {
        this.hazardSafeDir = found;
        dx = found.x;
        dz = found.z;
      } else {
        // 全部方向都危险（深坑孤岛）：本帧不动，等下一轮节流再试
        this.controller.moveDir.x = 0;
        this.controller.moveDir.y = 0;
        return;
      }
    } else {
      this.hazardTurnTimer = 0;
      this.hazardSafeDir = null;
    }
    this.controller.moveToward(dx, dz, dt, speed);
    // 贴片朝向 = 移动方向（绕 Y 旋转：+z 指向移动方向）
    if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
      this.yawBase = Math.atan2(dx, dz);
    }
  }

  /** ★ 前方是否有危险地形（坑洞 / 悬崖陡降 / 深坑）：
   *   从脚下向 (dx,dz) 方向探测 HAZARD_PROBE 米，
   *   若落点比脚底低超过阈值（悬崖/深坑）或落在坑洞地块 → 危险。
   *   水不在此列（可涉水，不致命）；只防"掉坑"。
   *   用 RasterMap 高度场（静态），不依赖物理体，成本极低。 */
  private isDangerAhead(dx: number, dz: number): boolean {
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return false;
    const ux = dx / len, uz = dz / len;
    const raster = RasterMap.current;
    if (!raster) return false;
    const p = this.entity.position;
    const p1 = EnemyBase.HAZARD_PROBE;
    const p2 = p1 * 0.55; // 中间采样点（更早发现坑沿，转角更平滑）
    for (const d of [p2, p1]) {
      const hx = p.x + ux * d;
      const hz = p.z + uz * d;
      // 坑洞地块（lethal 深坑）：不可站立 → 危险
      if (raster.tileDefAt(hx, hz).genRole === 'pit') return true;
      // 悬崖陡降 / 被挖穿的深坑：前方高度比脚下低超过 1.2 米（跳不过/会摔入）
      const myY = this.controller.isAirborne() ? p.y : raster.surfaceHeightAt(p.x, p.z);
      const hY = raster.surfaceHeightAt(hx, hz);
      if (myY - hY > 1.2) return true;
    }
    return false;
  }

  /** 切帧（显示帧：由相机判定，见 onUpdate） */
  private setFrameAnimated(facing: '前' | '后'): void {
    if (this.showFacing === facing) return;
    this.showFacing = facing;
    const source = this.anim!.source;
    const name = source.hasFrame(facing) ? facing : '帧 1';
    this.anim!.playFrames([name], { loop: true, fps: 1 });
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

  /** 应用当前帧扭曲参数（按 viewLod 开关）。
   *  ★ 兼容两种资产：特效包(Asset)走 getFrameRenderData；纯纹理包(FtxAsset)
   *    无该方法，改从 getFtxFrame 读同一组 distort 字段。 */
  private applyDistort(): void {
    const idx = this.anim!.state.frameIndex;
    let d: {
      distortEnabled: boolean; distortAmplitude: number; distortFrequency: number;
      distortSpeed: number; distortRotation: number;
    } | null | undefined;
    const a = this.assetRef as unknown as {
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
      const f = this.assetRef.getFtxFrame(idx) as unknown as {
        distortEnabled?: boolean; distortAmplitude?: number; distortFrequency?: number;
        distortSpeed?: number; distortRotation?: number;
      } | null;
      d = f ? {
        distortEnabled: !!f.distortEnabled, distortAmplitude: f.distortAmplitude ?? 0.06,
        distortFrequency: f.distortFrequency ?? 5.0, distortSpeed: f.distortSpeed ?? 1.2,
        distortRotation: f.distortRotation ?? 0,
      } : null;
    }
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
