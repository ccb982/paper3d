// ============================================================
// AllyBase —— 友军基类（EntityBase 子类）
// ============================================================
// 公共职责（《实体架构.md》§6）：
//   - 世界端口：索敌（实体优先 + 代理兜底）/ 攻击结算 / 挖矿回调
//   - 攻击节奏：冷却 + 目标维持 + 光束表现统一入口 playBeam
//   - 槽位与存活：slotIndex/itemId/owner；损毁即彻底消失
//   - 更新模板：think(dt)【子类】→ 光束推进 → 左右朝向
// 三种骨架：
//   AirAlly（飞天）/ GroundFollowAlly（陆地跟随）/ GroundStationaryAlly（陆地站桩）
// ★ 代理目标绝不跨帧缓存 index（AgentPool 是 swap-remove）
// ★ 飞天/站桩友军不背 CharacterController（无地形/推挤需求）；
//   陆地跟随的运动层迁移（CharacterBase）在接入兵种时再定（见《实体架构.md》§6.6）
// ============================================================

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from '../EntityBase';
import type { EntityManager } from '../EntityManager';
import type { Asset } from '../../vendor/player';
import type { FtxAsset } from '../../vendor/player/FtxAsset';
import { DroneCompositeRender } from '../../services/render/DroneCompositeRender';
import { DroneBeamEffect } from '../../services/render/DroneBeam';
import { executeAttack } from '../../services/combat/Attack';
import { queryFinalStats } from '../../services/combat/FinalStats';
import type { ShadowFrameSource } from '../../services/render/SilhouetteShadow';
import { playSfx } from '../../services/audio/Sfx';

/** 友军 AI 状态（跟随类使用；站桩类不进入此状态机） */
export type AllyState = 'follow' | 'approach' | 'attack' | 'return';

/** 友军通用参数 */
export interface AllyOptions extends Omit<EntityBaseOptions, 'kind'> {
  /** 贴片放大（缺省 1.2） */
  scale?: number;
}

/** 攻击瞄准高度：敌人身体（脚部 + 0.9m 躯干），不追脚、不擦角 */
export const ALLY_ATTACK_AIM_Y = 0.9;
/** 激光音效的听距（米；玩家超出这个距离就不响） */
const LASER_SFX_RANGE = 40;

/**
 * ★ 友军世界端口 —— AllyBase 与外部世界（模式层 / 蜂群 / 掉落）的唯一交互面。
 *   由 WorldMode 实现一次、经 AllySystem 注入所有友军（不再逐个体回调）。
 */
export interface AllyWorldPort {
  /** 远程攻击（实体目标；from = 发起友军，模式层据此算伤害/命中点） */
  rangedAttack(from: AllyBase, target: EntityBase): void;
  /** 代理层索敌（返回池下标；-1 = 无） */
  findAgentTarget(x: number, z: number, radius: number): number;
  /** 代理坐标（无效/已死 = null） */
  agentPosOf(idx: number): { x: number; y: number; z: number } | null;
  /** 对代理结算伤害 */
  rangedAgentAttack(from: AllyBase, idx: number): void;
  /** 自动挖矿（无敌人时；模式层选点/结算，实体只播光束） */
  mineAttack(from: AllyBase): void;
}

export abstract class AllyBase extends EntityBase {
  // ---- 锚点 / 身份 ----
  /** 跟随目标（WorldMode 每帧喂入：玩家侧上方偏移 / 编队偏移） */
  readonly followTarget = { x: 0, y: 0, z: 0 };
  /** 玩家位置（WorldMode 每帧喂入；锁定/返回判定用） */
  readonly playerPos = { x: 0, y: 0, z: 0 };
  /** 友军槽位号（-1 = 道具召唤不入槽；回收/损毁时按槽位精确联动） */
  slotIndex = -1;
  /** 道具 ID（HUD 图标/名称用；WorldMode 生成时写入） */
  itemId = '';
  /** 主人实体（WorldMode 生成时写入；攻击瞬间实时查询其最终攻击力） */
  owner: EntityBase | null = null;

  // ---- 世界端口（WorldMode 实现、AllySystem 一次性注入；见 AllyWorldPort） ----
  worldPort: AllyWorldPort | null = null;

  /** 当前代理目标下标（-1 = 无；与 target 互斥：有实体目标时优先打实体） */
  agentIdx = -1;
  /** 当前锁定目标（敌人；null = 无） */
  protected target: EntityBase | null = null;
  /** 挥击/射击冷却计时 */
  protected attackCd = 0;
  /** 索敌扫描节流 */
  protected relockTimer = 0;
  /** 常驻相位（悬浮摆动/环绕用） */
  protected phase = 0;
  /** 是否站桩（子类覆写；WorldMode 共享流体步进判定用） */
  stationary = false;

  // ---- 渲染 / 表现 ----
  protected readonly sceneRef: THREE.Scene;
  private beam: DroneBeamEffect | null = null;
  protected lastCamera: THREE.Camera | null = null;
  private _beamStart = new THREE.Vector3();
  private _beamEnd = new THREE.Vector3();
  private _lastX = 0;
  private _lastZ = 0;
  private _camRight = new THREE.Vector3();

  constructor(em: EntityManager, scene: THREE.Scene, asset: Asset | FtxAsset, opts: AllyOptions) {
    super(em, {
      kind: 'decoration',
      x: opts.x, y: opts.y, z: opts.z,
      asset,
      animInitial: opts.animInitial,
    });
    this.sceneRef = scene;
    this.camp = 'ally';
    this.billboard = true;
    // ★ 豁免视锥裁剪 + 距离 LOD：VAT 连续时钟（localTime）不因距离/视野冻结
    this.lodExempt = true;
    this.attachToScene(scene);
    // 按画布宽高比设贴片尺寸（宽 = scale；不压扁）
    const r = this.renderer as unknown as { setScaleKeepAspect?: (s: number) => void } | null;
    r?.setScaleKeepAspect?.(opts.scale ?? 1.2);
  }

  /** 渲染器统一为无人机复合渲染（主体 FTX + 双翼 VAT） */
  protected createRenderer(scene: THREE.Scene): DroneCompositeRender {
    return new DroneCompositeRender(scene, this.anim!.source as Asset | FtxAsset, this.anim);
  }

  /** ★ 注入主渲染器：翅膀 VAT 离屏 RT 需与主渲染器共享上下文 */
  setRenderer(renderer: THREE.WebGLRenderer): void {
    const r = this.renderer as DroneCompositeRender | null;
    if (r) r.setRenderer(renderer);
  }

  /** 友军位置由 updateAI/think 手动维护；这里不跑额外行为逻辑（原 DroneEntity 同款） */
  protected override onUpdate(_dt: number): void {}

  /**
   * ★ 每帧由 WorldMode 调用（喂完 followTarget/playerPos 后）：
   *   think（子类行为）→ 光束推进 → 左右朝向
   * @param camera 相机（攻击射线 billboard 朝向用）
   */
  updateAI(dt: number, camera?: THREE.Camera | null): void {
    this.lastCamera = camera ?? this.lastCamera;
    this.phase += dt * 2.2;
    this.think(dt);
    this.updateBeam(dt);
    this.updateFacing();
  }

  /** 子类行为（跟随 / 站桩） */
  protected abstract think(dt: number): void;

  /** 目标是否仍存活（敌人 hp>0；非敌人/已销毁 = 无效） */
  protected targetAlive(t: EntityBase | null): boolean {
    return !!t && t.camp === 'enemy' && (t as { hp?: number }).hp != null && (t as { hp?: number }).hp! > 0;
  }

  /** ★ 半径内最近的存活敌人（默认绕玩家；站桩模式传自身坐标） */
  protected findNearestEnemy(radius: number, px = this.playerPos.x, pz = this.playerPos.z): EntityBase | null {
    let best: EntityBase | null = null;
    let bestD2 = Infinity;
    for (const b of this.em.querySphere(px, pz, radius)) {
      if (!this.targetAlive(b)) continue;
      const dx = b.position.x - px, dz = b.position.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = b; }
    }
    return best;
  }

  /** ★ 近战挥击（贴脸小范围；执行器内自动排除同阵营）+ 发射射线。
   *  伤害 = max(下限, 主人攻击力 × 系数)：攻击瞬间实时查询（遗物/装备/限时效果全实时） */
  protected swing(t: EntityBase, range: number, minDamage: number, ratio = 1): void {
    const atk = this.owner ? queryFinalStats(this.owner).attackPower : 0;
    const dmg = Math.max(minDamage, Math.round(atk * ratio));
    executeAttack(this.em, null, {
      type: 'melee',
      source: this,
      x: t.position.x, y: t.position.y + ALLY_ATTACK_AIM_Y, z: t.position.z,
      range: range + 0.8,
      damage: dmg,
      camp: 'ally',
      dmgType: 'physical',
    });
    this.playBeam();
  }

  /**
   * ★ 播放红色激光光束（**唯一入口**：近战挥击 / 远程 / 挖矿 都走这里；
   *   上一束未播完先销毁）。激光音效也挂在这里，三处自动都有声。
   *   ★ 音效带距离门：射程远，玩家不在附近时不响（否则远处自动开火会很吵）。
   *   ★ 节流 60ms：多只同帧开火只响一次，避免叠加成噪音。
   */
  playBeam(): void {
    this.beam?.dispose();
    this.beam = new DroneBeamEffect(this.sceneRef);
    const dx = this.entity.position.x - this.playerPos.x;
    const dz = this.entity.position.z - this.playerPos.z;
    if (dx * dx + dz * dz <= LASER_SFX_RANGE ** 2) {
      playSfx('laserFire', 60);
    }
  }

  /** 光束推进：起点 = 自身，终点 = 目标受击点 / 代理当前位置（每帧刷新） */
  private updateBeam(dt: number): void {
    if (!this.beam) return;
    const p = this.entity.position;
    const end = this._beamEnd;
    if (this.target && this.targetAlive(this.target)) {
      end.set(this.target.position.x, this.target.position.y + ALLY_ATTACK_AIM_Y, this.target.position.z);
    } else if (this.agentIdx >= 0) {
      // ★ 代理目标：光束终点跟着代理当前位置（代理会移动，每帧刷新）
      const ap = this.worldPort?.agentPosOf(this.agentIdx);
      if (ap) end.set(ap.x, ap.y + ALLY_ATTACK_AIM_Y, ap.z);
      else this.agentIdx = -1;   // 代理已死/被回收 → 断锁
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

  /** 左右两个方向的朝向：水平位移投影到相机 right → 向左翻转 / 向右正立
   *  （镜像两态；静止保持上次朝向，不来回抖） */
  private updateFacing(): void {
    const p = this.entity.position;
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

  /** ★ 剪影源：多层（主体 + 双翼）alpha 按各自 bbox 合成到整画布 →
   *  影子包含翅膀，不再只有主体轮廓。一次性构建（引用稳定 → 零重采）。 */
  private _shdBase: { width: number; height: number; data: Float32Array } | null = null;
  protected override getShadowFrameData(): ShadowFrameSource | null {
    const source = this.anim?.source as unknown as {
      getFtxFrame?: (i: number) => { bbox: { x: number; y: number; w: number; h: number } } | null;
      getFramePair?: (i: number) => { base?: { image?: unknown } } | null;
    } | null;
    if (!source?.getFtxFrame || !source.getFramePair) return null;
    if (this._shdBase) return { base: this._shdBase };

    const f0 = source.getFtxFrame(0);
    if (!f0) return null;
    // 画布尺寸（与渲染器同源：frame0 的 width/height）
    const W = (f0 as { width?: number }).width ?? 441;
    const H = (f0 as { height?: number }).height ?? 300;
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
