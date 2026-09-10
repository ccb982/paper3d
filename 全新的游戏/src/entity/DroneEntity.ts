// ============================================================
// DroneEntity —— 可露希尔的无人机（召唤物实体）
// ============================================================
// 复用 EntityBase 动画/渲染/影子管线：
//   - 特效包三帧实为三图层（主体/左翅膀/右翅膀，共享同一画布）
//     → DroneCompositeRender 复合渲染：
//       主体 = FTXQuad 静态贴片；
//       双翼 = 播放器区域实体 VAT 管线（整翼矩形重建 + 恒等 uv + 数据驱动根边锚定）
//             → 离屏 RT → billboard quad，时间源 = FrameAnimatorBase.localTime
//   - 无物理刚体：悬浮体。
// ★ 召唤 AI（2026-09-09 重构，用户定调）：
//   follow（跟随玩家侧上方）→ 周期锁定此刻距离最近的敌人 →
//   approach（攻击范围小 → 飞到敌人身边）→ attack（贴脸近战挥击）→
//   目标被击倒 或 与玩家距离非常远 → return（返回玩家）→ 重新锁定。
// ============================================================

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { Asset } from '../vendor/player';
import type { FtxAsset } from '../vendor/player/FtxAsset';
import { DroneCompositeRender } from '../services/render/DroneCompositeRender';
import { DroneBeamEffect } from '../services/render/DroneBeam';
import { HealthBar } from '../services/fx/HealthBar';
import { executeAttack } from '../services/combat/Attack';
import { RasterMap } from '../services/map/RasterMap';
import type { ShadowFrameSource } from '../services/render/SilhouetteShadow';

/** 无人机 AI 状态 */
export type DroneState = 'follow' | 'approach' | 'attack' | 'return';

/** ★ 无人机战斗参数（可调） */
const LOCK_RANGE = 12;      // 锁定最近敌人的搜索半径（米，绕玩家）
const ATTACK_RANGE = 1.8;   // 攻击范围（米；攻击范围小 → 必须贴脸）
const RETURN_DIST = 30;     // 与玩家距离非常远 → 强制返回（米）
const RETURN_OK_DIST = 2.5; // 返回至多近算归队（米）
const ATTACK_CD = 1.2;      // 挥击冷却（秒）
const DRONE_DAMAGE = 12;    // 单次挥击伤害
/** ★ 攻击瞄准高度：敌人身体（脚部 + 0.9m 躯干），不追脚、不擦角 */
const ATTACK_AIM_Y = 0.9;

export interface DroneOptions extends Omit<EntityBaseOptions, 'kind'> {
  /** 贴片放大（默认 1.2） */
  scale?: number;
}

export class DroneEntity extends EntityBase {
  /** 跟随目标（WorldMode 每帧设为玩家侧上方偏移） */
  readonly followTarget = { x: 0, y: 0, z: 0 };
  /** 玩家位置（WorldMode 每帧喂入；锁定/返回判定用） */
  readonly playerPos = { x: 0, y: 0, z: 0 };
  /** ★ 友军槽位号（-1 = 道具召唤不入槽；回收/损毁时按槽位精确联动） */
  slotIndex = -1;
  /** 当前 AI 状态（调试/表现可读） */
  aiState: DroneState = 'follow';
  /** 悬浮相位（正弦摆动/环绕用） */
  private phase = 0;
  /** 当前锁定目标（敌人；null = 无） */
  private target: EntityBase | null = null;
  /** 挥击冷却计时 */
  private attackCd = 0;
  /** 跟随态锁定扫描节流 */
  private relockTimer = 0;
  /** 攻击射线特效（外红内白；挥击时发射，播完销毁） */
  private beam: DroneBeamEffect | null = null;
  /** 最近一帧相机（射线 billboard 用；updateAI 喂入） */
  private lastCamera: THREE.Camera | null = null;
  private _beamStart = new THREE.Vector3();
  private _beamEnd = new THREE.Vector3();
  /** 场景引用（攻击射线挂载） */
  private _sceneRef: THREE.Scene;
  /** 左右朝向：上一帧位置（水平位移判向） */
  private _lastX = 0;
  private _lastZ = 0;
  private _camRight = new THREE.Vector3();

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: Asset | FtxAsset,
    opts: DroneOptions,
  ) {
    super(em, {
      kind: 'decoration',
      x: opts.x, y: opts.y, z: opts.z,
      asset,
      animInitial: opts.animInitial,
    });
    this._sceneRef = scene;
    this.camp = 'ally';
    this.billboard = true;
    // ★ 无人机豁免视锥裁剪 + 距离 LOD：LOD≥2 会冻结动画时间轴（FrameAnimatorBase.update），
    //   双翼 VAT 连续时钟（localTime）随之停摆 → 必须全程满档
    this.lodExempt = true;
    this.attachToScene(scene);
    // ★ 可损毁：头顶血条（损毁后残骸进槽位，舰船加工台用材料维修）
    this.attachEffect('health', new HealthBar(scene, this, { width: 0.6, height: 0.07, offsetY: 1.6 }));

    // 按画布宽高比设贴片尺寸（宽 = baseSize；不压扁）
    const r = this.renderer as DroneCompositeRender | null;
    if (r) r.setScaleKeepAspect(opts.scale ?? 1.2);
  }

  protected createRenderer(scene: THREE.Scene): DroneCompositeRender {
    return new DroneCompositeRender(scene, this.anim!.source as Asset | FtxAsset, this.anim);
  }

  /** ★ 注入主渲染器：翅膀 VAT 离屏 RT 需与主渲染器共享上下文 */
  setRenderer(renderer: THREE.WebGLRenderer): void {
    const r = this.renderer as DroneCompositeRender | null;
    if (r) r.setRenderer(renderer);
  }

  /** ★ 贴片数学上不带碰撞/影子：只保留基类漂浮逻辑 */
  protected override onUpdate(dt: number): void {
    void dt;
  }

  /** 目标是否仍存活（敌人 hp>0；非敌人/已销毁 = 无效） */
  private targetAlive(t: EntityBase | null): boolean {
    return !!t && t.camp === 'enemy' && (t as { hp?: number }).hp != null && (t as { hp?: number }).hp! > 0;
  }

  /** ★ 玩家周围半径内最近的存活敌人（此刻距离最近；horizontal） */
  private findNearestEnemy(radius: number): EntityBase | null {
    let best: EntityBase | null = null;
    let bestD2 = Infinity;
    const px = this.playerPos.x, pz = this.playerPos.z;
    for (const b of this.em.querySphere(px, pz, radius)) {
      if (!this.targetAlive(b)) continue;
      const dx = b.position.x - px, dz = b.position.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = b; }
    }
    return best;
  }

  /** 平滑追踪（速度越大越跟手）；y 带地面高度钳制 + 正弦漂浮。
 *  minAir = 离地最小高度（跟随态 1.2m 高位悬浮；攻击态 0.5m 俯冲贴脚打） */
  private moveTo(dt: number, tx: number, ty: number, tz: number, speed: number, minAir = 1.2): void {
    const p = this.entity.position;
    const k = Math.min(1, dt * speed);
    p.x += (tx - p.x) * k;
    p.z += (tz - p.z) * k;
    const gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    const baseY = Math.max(ty, gy + minAir);
    p.y += (baseY + Math.sin(this.phase) * 0.18 - p.y) * Math.min(1, dt * speed);
  }

  /** ★ 近战挥击（贴脸小范围；执行器内自动排除同阵营）+ 发射外红内白射线。
 *  瞄准点 = 敌人身体（脚部 + ATTACK_AIM_Y），不打脚不擦角 */
  private swing(t: EntityBase): void {
    executeAttack(this.em, null, {
      type: 'melee',
      source: this,
      x: t.position.x, y: t.position.y + ATTACK_AIM_Y, z: t.position.z,
      range: ATTACK_RANGE + 0.8,
      damage: DRONE_DAMAGE,
      camp: 'ally',
      dmgType: 'physical',
    });
    // ★ 攻击特效：射线从无人机射向目标（0.55s 高亮保持；上一束未播完则先销毁）
    this.beam?.dispose();
    this.beam = new DroneBeamEffect(this._sceneRef);
  }

  /**
   * ★ 每帧由 WorldMode 调用（喂完 followTarget/playerPos 后）：
   *   follow → 锁定最近敌人 → approach（飞到身边）→ attack（贴脸挥击）
   *   → 目标死/离玩家太远 → return → 归队重新锁定。
   * @param camera 相机（攻击射线 billboard 朝向用）
   */
  updateAI(dt: number, camera?: THREE.Camera | null): void {
    this.lastCamera = camera ?? this.lastCamera;
    this.phase += dt * 2.2;
    const p = this.entity.position;
    const distPlayer = Math.hypot(p.x - this.playerPos.x, p.z - this.playerPos.z);

    // ★ 强制返回：与玩家距离非常远（任意非 follow 状态都触发）
    if (this.aiState !== 'follow' && distPlayer > RETURN_DIST) {
      this.aiState = 'return';
      this.target = null;
    }

    switch (this.aiState) {
      case 'follow': {
        // 跟随玩家侧上方
        this.moveTo(dt, this.followTarget.x, this.followTarget.y, this.followTarget.z, 6);
        // 周期扫描：锁定此刻距离最近的敌人
        this.relockTimer -= dt;
        if (this.relockTimer <= 0) {
          this.relockTimer = 0.4;
          const t = this.findNearestEnemy(LOCK_RANGE);
          if (t) { this.target = t; this.aiState = 'approach'; }
        }
        break;
      }
      case 'approach': {
        const t = this.target;
        if (!this.targetAlive(t)) { this.target = null; this.aiState = 'follow'; break; }
        const dx = p.x - t!.position.x, dz = p.z - t!.position.z;
        if (Math.hypot(dx, dz) <= ATTACK_RANGE) { this.aiState = 'attack'; break; }
        // ★ 悬停高度 = 敌人身体（脚部 + 0.9），水平飞近，不俯冲追脚
        this.moveTo(dt, t!.position.x, t!.position.y + ATTACK_AIM_Y, t!.position.z, 7);
        break;
      }
      case 'attack': {
        const t = this.target;
        if (!this.targetAlive(t)) { this.target = null; this.aiState = 'return'; break; }
        const dx = p.x - t!.position.x, dz = p.z - t!.position.z;
        const d = Math.hypot(dx, dz);
        // 拉近到攻击圈内（攻击范围小 → 必须贴脸；身体高度）
        if (d > ATTACK_RANGE) {
          this.moveTo(dt, t!.position.x, t!.position.y + ATTACK_AIM_Y, t!.position.z, 8);
        } else {
          // 圈内：绕目标缓慢环绕（不重叠、不静止；身体高度）
          const a = this.phase * 0.6;
          const ox = t!.position.x + Math.cos(a) * 1.0;
          const oz = t!.position.z + Math.sin(a) * 1.0;
          this.moveTo(dt, ox, t!.position.y + ATTACK_AIM_Y, oz, 2);
        }
        // 挥击冷却
        this.attackCd -= dt;
        if (this.attackCd <= 0) {
          this.attackCd = ATTACK_CD;
          this.swing(t!);
        }
        break;
      }
      case 'return': {
        // 返回玩家（目标已死或离玩家太远）；归队后重新锁定
        this.moveTo(dt, this.followTarget.x, this.followTarget.y, this.followTarget.z, 6);
        const dp = Math.hypot(p.x - this.followTarget.x, p.z - this.followTarget.z);
        if (dp < RETURN_OK_DIST || distPlayer < RETURN_OK_DIST) this.aiState = 'follow';
        break;
      }
    }

    // ★ 攻击射线推进：起点 = 无人机，终点 = 目标身体（脚部 + ATTACK_AIM_Y；目标已死则停在最后落点）
    if (this.beam) {
      const end = this._beamEnd;
      if (this.target && this.targetAlive(this.target)) {
        end.set(this.target.position.x, this.target.position.y + ATTACK_AIM_Y, this.target.position.z);
      }
      const done = this.beam.update(
        dt,
        this._beamStart.set(p.x, p.y, p.z),
        end,
        this.lastCamera ?? new THREE.Camera(),
      );
      if (done) {
        this.beam.dispose();
        this.beam = null;
      }
    }

    // ★ 左右两个方向的朝向：水平位移投影到相机 right → 向左翻转 / 向右正立
    //   （镜像两态；静止保持上次朝向，不来回抖）
    if (this.lastCamera) {
      const vx = p.x - this._lastX, vz = p.z - this._lastZ;
      this._lastX = p.x; this._lastZ = p.z;
      if (Math.hypot(vx, vz) > 0.02) {
        this._camRight.set(1, 0, 0).applyQuaternion(this.lastCamera.quaternion);
        const along = vx * this._camRight.x + vz * this._camRight.z;
        this.anim?.setFlipX(along < 0);
      }
    } else {
      this._lastX = p.x; this._lastZ = p.z;
    }
  }

  /** 影子：无人机悬浮，给一个小的地面投影剪影（主体轮廓） */
  protected override get shadowShape(): { w: number; h?: number; alpha?: number } | null {
    return { w: 1.1, h: 0.7, alpha: 0.32 };
  }

  /** ★ 剪影源：三层（主体+双翼）alpha 按各自 bbox 合成到整画布 →
   *  影子包含翅膀，不再只有主体轮廓。一次性构建（引用稳定 → 零重采）。 */
  private _shdBase: { width: number; height: number; data: Float32Array } | null = null;
  protected override getShadowFrameData(): ShadowFrameSource | null {
    const source = this.anim?.source as unknown as {
      getFtxFrame?: (i: number) => { bbox: { x: number; y: number; w: number; h: number }; width?: number; height?: number } | null;
      getFramePair?: (i: number) => { base?: { image?: unknown } } | null;
    } | null;
    if (!source?.getFtxFrame || !source.getFramePair) return null;
    if (this._shdBase) return { base: this._shdBase };

    const f0 = source.getFtxFrame(0);
    if (!f0) return null;
    // 画布尺寸（与渲染器同源：frame0 的 width/height）
    const W = f0.width ?? 441, H = f0.height ?? 300;
    const data = new Float32Array(W * H * 4);
    for (let i = 0; i < 3; i++) {
      const f = source.getFtxFrame(i);
      const img = source.getFramePair(i)?.base?.image as { width?: number; height?: number; data?: Float32Array } | undefined;
      if (!f || !img?.data) continue;
      const bw = img.width ?? 0, bh = img.height ?? 0;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const a = img.data[(y * bw + x) * 4 + 3];
          if (a <= 0.5) continue;
          const px = f.bbox.x + x, py = f.bbox.y + y;
          if (px >= 0 && py >= 0 && px < W && py < H) data[(py * W + px) * 4 + 3] = a;
        }
      }
    }
    this._shdBase = { width: W, height: H, data };
    return { base: this._shdBase };
  }

  override dispose(): void {
    this.beam?.dispose();
    this.beam = null;
    super.dispose();
  }
}