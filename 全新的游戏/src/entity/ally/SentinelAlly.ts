// ============================================================
// SentinelAlly —— 陆地站桩友军（原 DroneEntity 的祖宗段）
// ============================================================
// 原地不动；绕自身索敌；目标在射程内 → 定时远程攻击。
// 远程攻击由模式层注入（rangedAttack → executeAttack projectile / 友军弹道）。
// 敌人实体只在玩家 35m 内存在，射程 42m 且站桩 → 必须能打代理层
// （findAgentTarget / agentPosOf / rangedAgentAttack，每帧重查、不缓存 index）。
// ============================================================

import type * as THREE from 'three';
import { GroundStationaryAlly } from './GroundStationaryAlly';
import type { EntityBase } from '../EntityBase';
import type { FluidEffect } from '../../vendor/player/fluid/FluidEffect';

/** ★ 站桩模式（祖宗）：以自身为中心的索敌/攻击参数
 *  ★ 射程远大于无人机（LOD 12m）——站桩单位靠长手覆盖；命中为瞬时激光，天然穿墙 */
const SENTINEL_RANGE = 42;      // 索敌/射程（米）
const SENTINEL_ATTACK_CD = 1.1; // 激光冷却（秒）
/** ★ 祖宗自动挖矿冷却（无敌人时；随机打附近的铁/水/地面） */
const SENTINEL_MINE_CD = 1.8;

export class SentinelAlly extends GroundStationaryAlly {
  /** ★ 休眠（2026-09-19 留存祖宗）：重进世界后留在原地，不索敌/不攻击/不挖矿，
   *  玩家回到原地**接触**（≈2.2m）才启用并加入队友列表（HUD） */
  dormant = false;
  /** 挖矿冷却计时 */
  private mineCd = 0;
  /** ★ 常驻流体（祖宗：单帧 + 流体参数；由资产缓存持有，实体销毁不 dispose） */
  private soulFluid: FluidEffect | null = null;

  /** ★ 站桩模式：原地不动；绕自身索敌；目标在射程内 → 定时远程攻击 */
  protected think(dt: number): void {
    const p = this.entity.position;
    // ★ 休眠：站桩保持，不做任何索敌/攻击/挖矿（接触唤醒由 WorldMode 判定）
    if (this.dormant) { this.holdStationY(p); return; }
    // ★ 流体步进由 WorldMode 统一每帧一次（多个祖宗共享同一份实例，绝不能每个都 step）
    if (!this.targetAlive(this.target)) this.target = null;
    this.relockTimer -= dt;

    // ---- ① 实体目标优先（玩家附近时敌人就是实体）----
    if (!this.target && this.relockTimer <= 0) {
      this.relockTimer = 0.4;
      this.target = this.findNearestEnemy(SENTINEL_RANGE, p.x, p.z);
    }
    if (this.target) {
      const t = this.target;
      const d = Math.hypot(p.x - t.position.x, p.z - t.position.z);
      if (d > SENTINEL_RANGE * 1.25) {
        this.target = null; // 超出射程：重新索敌
      } else {
        this.attackCd -= dt;
        if (this.attackCd <= 0) {
          this.attackCd = SENTINEL_ATTACK_CD;
          // ★ 红色激光：光束特效从这里射向目标；瞬时伤害由模式层结算（rangedAttack）
          this.playBeam();
          this.worldPort?.rangedAttack(this, t);
        }
        this.holdStationY(p);
        return;
      }
    }

    // ---- ② 无实体 → 打代理层（★ 远处祖宗唯一能看见的敌人）----
    //   敌人实体只在玩家 L3_RADIUS(35m) 内存在，祖宗射程 42m 且站桩不动 →
    //   离开玩家后 ① 永远锁不到，必须退到代理层，否则表现为「远处祖宗不开火」。
    // ★★ 每帧重新锁定最近代理，**绝不跨帧缓存下标**：
    //    AgentPool 是 swap-remove（删中间元素 = 末尾元素补位），缓存的 idx 会在别的代理
    //    死亡/被回收时静默指到另一只身上 —— 表现为"激光突然打向不相干的方向"。
    //    每帧一次 O(count) 扫描（祖宗数量个位数、count 数百）开销可忽略，换取绝对正确。
    this.agentIdx = this.worldPort?.findAgentTarget(p.x, p.z, SENTINEL_RANGE) ?? -1;
    if (this.agentIdx >= 0) {
      const ap = this.worldPort?.agentPosOf(this.agentIdx) ?? null;
      if (!ap) {
        this.agentIdx = -1;                       // 代理已死 / 被回收
      } else {
        this.attackCd -= dt;
        if (this.attackCd <= 0) {
          this.attackCd = SENTINEL_ATTACK_CD;
          this.playBeam();
          this.worldPort?.rangedAgentAttack(this, this.agentIdx);
        }
        this.holdStationY(p);
        return;
      }
    }

    // ---- ③ 实体和代理都没有 → 自动挖矿：随机打附近的铁（原石晶体）/ 水 / 地面 ----
    if (this.agentIdx < 0) {
      this.mineCd -= dt;
      if (this.mineCd <= 0) {
        this.mineCd = SENTINEL_MINE_CD;
        this.worldPort?.mineAttack(this);
      }
    }
    this.holdStationY(p);
  }

  /** ★ 启用常驻流体（祖宗：读取该帧自带的流体参数；单帧资产专用）。
   *  实例由资产内部缓存持有（重复放置复用同一份），实体销毁不 dispose。 */
  enableAmbientFluid(renderer: THREE.WebGLRenderer): void {
    const source = this.anim?.source as unknown as {
      getFluidEffect?: (i: number, r: THREE.WebGLRenderer) => FluidEffect | null;
    } | null;
    this.soulFluid = source?.getFluidEffect?.(0, renderer) ?? null;
  }

  /** ★ 魂体渲染模式（祖宗）：透明背景不写深度、流体裁到轮廓（不挡水/子弹） */
  enableSoulRenderMode(): void {
    const r = this.renderer as unknown as { setSoulMode?: () => void } | null;
    r?.setSoulMode?.();
  }

  /** ★ 祖宗常驻流体合成纹理（FTXQuad 采样；无流体 = 原贴图） */
  protected override getFluidTexture(): THREE.Texture | null {
    return this.soulFluid ? this.soulFluid.getCompositeTexture() : null;
  }

  /** 影子：祖宗是 2.0 大体积站桩 → 用更大的影子，避免"看起来没影子" */
  protected override get shadowShape(): { w: number; h?: number; alpha?: number } | null {
    return { w: 1.9, h: 1.3, alpha: 0.36 };
  }
}
