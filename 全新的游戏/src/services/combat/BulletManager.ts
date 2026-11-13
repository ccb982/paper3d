// ============================================================
// BulletManager —— 子弹组合层（池 + 离屏视觉 + 3D 渲染器串联）
// ============================================================
// 三个模块，零直接依赖，只通过数据契约交互：
//   ① BulletVisual  离屏子弹实体（流体+蒙版/VAT → 一张纹理）
//   ② BulletEntity  纯物理实体（位置/速度/碰撞/寿命，独立数据）
//   ③ BulletRenderer InstancedMesh 一次 draw call（消费①纹理 + ②快照）
// 本类只做：池化生命周期 + 每帧串联（step → bake → sync）。

import * as THREE from 'three';
import { BulletEntity, type BulletEntityOptions, type BulletHitPayload } from './BulletEntity';

export type { BulletHitPayload };
import { BulletVisual } from './BulletVisual';
import { BulletRenderer } from '../render/BulletRenderer';
import { makeSilhouetteCanvas } from '../render/SilhouetteShadow';
import type { EntityManager } from '../../entity/EntityManager';
import type { EntityBase } from '../../entity/EntityBase';
import type { FrameAssetSource } from '../fx/AssetSource';
import { attachHitEffect } from '../fx/attachHitEffect';
import type { EntityEffect } from '../fx/EntityEffect';
import { renderManager } from '../render/RenderManager';
import type { HitEffectShapeExport } from '../../vendor/player';
import {
  BULLET_PROBE,
  bulletProbe,
  nowMs,
  probeBulletFlush,
  probeHit,
  probePoolStat,
} from '../debug/RuntimeProbe';

/** ★ 轻量发射参数（AI 行为/近战/远程共用；不依赖实体构造细节） */
export interface SpawnBulletOptions {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  speed: number;
  camp: 'player' | 'ally' | 'enemy';
  lifetime?: number;
  damage?: number;
  /** ★ 攻击公式（命中时按 owner 实时最终攻击力现算；与 damage 二选一） */
  attackFormula?: { min: number; ratio: number } | null;
  /** ★ 公式主人（executeAttack 自动取 source） */
  owner?: import('../../entity/EntityBase').EntityBase | null;
  /** ★ 命中/落地后在该点生成站桩友军（itemId；如祖宗弹） */
  allyOnHit?: string;
  /** ★ 投射落点（准星收敛点；组合层计算）——命中窗口放大的基准点 */
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  /** ★ 无视墙（玩家贴城墙开枪）：碰撞分组 filter 掉 GROUP_WALL */
  ignoreWalls?: boolean;
  /** ★ 本阵营掩体背面豁免（用户定 2026-09-29） */
  ignoreOwnCovers?: boolean;
  /** ★ 弹种标签（**组合层路由用**：选哪个子弹池 → 哪种程序化视觉）。
   *  BulletEntity 不读它；WorldMode 按它把敌方弹分派到箭池 / 法球池。缺省 = 'arrow'。 */
  bulletSkin?: string;
}

export class BulletManager {
  /** 全部实体（固定容量，渲染器按索引对应 instance；含激活/失活） */
  private allBullets: BulletEntity[] = [];
  /** 池中可用实体（激活的被 pop 出去） */
  private pool: BulletEntity[] = [];
  private activeBullets = new Set<BulletEntity>();
  private activeCount = 0;
  private visual: BulletVisual | null;
  private renderer: BulletRenderer;
  /** ★ 地形命中特效（固定点播放列表：fx + 命中坐标；播完自回收） */
  private terrainFxViews: { fx: EntityEffect; x: number; y: number; z: number }[] = [];
  /** 击中特效形状定义（素材包 hit_effects.json；空 = 无矢量动画） */
  private hitEffectShapes: HitEffectShapeExport[];
  /** 插桩：池标签 + 上次 update 时间（算帧间隔） */
  private readonly probeLabel: string;
  private probeLastFrameMs = 0;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: FrameAssetSource,
    capacity = 10, // ★ 2026-09-12：池 100 → 10（用户定调；90 个休眠记录/刚体随之消失）
    glRenderer?: THREE.WebGLRenderer,
    hitEffectShapes: HitEffectShapeExport[] = [],
    onHit?: (payload: BulletHitPayload) => void,
    /** ★ 世界宽度（米）：高 = 本值 × 纹理宽高比。缺省 3.0（原口径）；
     *  程序化箭矢等细长弹道须给小数（如 0.28）→ 否则 4 倍长的方片 */
    opts?: { baseWidth?: number },
  ) {
    this.hitEffectShapes = hitEffectShapes;
    this.probeLabel = `bullet#${bulletProbe.pools.length + 1}`;
    // ---- ① 离屏视觉（流体 + 蒙版/VAT → 纹理）----
    this.visual = glRenderer ? new BulletVisual(glRenderer, asset) : null;
    // ★ 提取子弹剪影遮罩（公共工具一次性提取 → 共享画布，全部子弹实例复用）
    //   ★ 同时写进每个实例（多弹种并存时 static 会被后建的池覆盖，见 BulletEntity）
    let silhouette: HTMLCanvasElement | null = null;
    if (asset) {
      try {
        const pair0 = asset.getFramePair(0);
        const raw = pair0?.base?.image?.data as unknown as Float32Array | undefined;
        if (raw) {
          silhouette = makeSilhouetteCanvas(
            raw, pair0!.base!.image.width, pair0!.base!.image.height, 16,
          );
          BulletEntity.sharedSilhouetteCanvas = silhouette;
        }
      } catch { /* 提取失败不阻塞 */ }
    }
    this.visual?.init(); // 强制首帧烘焙，避免 RT 纹理全黑

    // ---- ③ 3D 渲染器（InstancedMesh；世界尺寸 = 基类函数计算）----
    const quadSize = BulletEntity.computeWorldSize(asset, opts?.baseWidth ?? 3.0);
    this.renderer = new BulletRenderer(scene, capacity, quadSize);
    this.renderer.setTexture(this.visual ? this.visual.getTexture() : null);
    // ★ 扭曲/纹理旋转参数（素材包 per_frame_data 携带；纯纹理包无 → 关闭）
    const anyBundle = asset as {
      getFrameRenderData?: (idx: number) => {
        distortEnabled: boolean; distortAmplitude: number; distortFrequency: number;
        distortSpeed: number; distortRotation: number; textureRotation: number;
      } | null;
    };
    const fd0 = anyBundle.getFrameRenderData?.(0);
    if (fd0) {
      this.renderer.setDistort({
        enabled: fd0.distortEnabled,
        amplitude: fd0.distortAmplitude,
        frequency: fd0.distortFrequency,
        speed: fd0.distortSpeed,
        rotation: fd0.distortRotation,
      });
      // ★ 纹理旋转：只绕平面法线 Z 轴（2D UV 旋转）
      this.renderer.setTextureRotation(fd0.textureRotation ?? 0);
    }

    // ---- ② 纯实体池 ----
    for (let i = 0; i < capacity; i++) {
      const b = new BulletEntity(em, {
        x: 0, y: -50, z: 0,
        dirX: 1, dirY: 0, dirZ: 0,
        speed: 0,
        camp: 'player',
      });
      b.recycle = () => {
        // ★ 幂等：同一颗子弹被重复回收（一帧内多次命中）不得重复入池/重复减计数，
        //   否则池里出现同槽重复项 → 同一实体被 spawn 两次 → 活动数/循环次数虚高
        const alreadyPooled = this.pool.includes(b);
        const wasActive = this.activeBullets.has(b);
        if (BULLET_PROBE) {
          bulletProbe.recycles++;
          if (alreadyPooled) bulletProbe.recycleDup++;
        }
        this.activeBullets.delete(b);
        if (!alreadyPooled) this.pool.push(b);
        if (wasActive) this.activeCount = Math.max(0, this.activeCount - 1);
      };
      // ★ 命中特效（每次碰撞只触发一次）：
      //   命中实体 → attachEffect 挂实体槽（实体骨架驱动坐标 → 自动跟随 + 播完自动回收）
      //   命中地形 → 固定点播放列表（每帧重传同一命中坐标）
      b.hitFx = (other: EntityBase | null) => this.spawnHitEffect(b, other);
      // ★ 命中解析层回调：每次碰撞开始把命中（敌人/装饰物/地块）交给解析层分类结算
      //   ★ 插桩：包一层计时，定位「命中同步链路」是否吃掉单帧预算
      b.onHit = onHit
        ? (payload: BulletHitPayload) => {
            if (!BULLET_PROBE) {
              onHit(payload);
              return;
            }
            const t = nowMs();
            onHit(payload);
            probeHit(
              nowMs() - t,
              payload.other ? payload.other.entity.kind : (payload.staticKind ?? 'static'),
              payload.damage,
              `act=${this.activeCount}/${this.activeBullets.size} pool=${this.pool.length}/${this.allBullets.length}`,
            );
          }
        : null;
      b.setSceneReference(scene); // ★ 让子弹的贴地圆影能创建（需要场景引用）
      b.silhouetteCanvas = silhouette; // ★ 本池剪影（多弹种各自正确）
      this.allBullets.push(b);
      this.pool.push(b);
    }
  }

  /** ★ 发射：从池取一颗激活；池空返回 null（短暂无弹，等回收） */
  spawn(opts: SpawnBulletOptions): BulletEntity | null {
    const b = this.pool.pop();
    if (!b) {
      console.warn(`[bullet] 池空：${this.allBullets.length} 颗都在飞行中，等待超时回收`);
      return null;
    }
    if (BULLET_PROBE) {
      bulletProbe.spawns++;
      // 池里出现重复槽位时，会 pop 到仍在活动的实体 → 双活/双计数
      if (b.isActive) bulletProbe.spawnOnActive++;
    }
    const full: BulletEntityOptions = {
      ...opts,
    };
    // ★ 每次开火重置离屏视觉（恢复初始残差 → 纹理重新流动）
    if (BULLET_PROBE) {
      const t = nowMs();
      this.visual?.reset();
      const ms = nowMs() - t;
      bulletProbe.resetMs += ms;
      if (ms > bulletProbe.maxResetMs) bulletProbe.maxResetMs = ms;
    } else {
      this.visual?.reset();
    }
    this.activeCount++;
    this.activeBullets.add(b);
    b.activate(full);
    return b;
  }

  /** ★ 每帧驱动：离屏视觉 step（流体+烘焙）→ 渲染器同步实例变换（需相机算滚转） */
  update(dt: number, camera: THREE.Camera): void {
    const tFrame = BULLET_PROBE ? nowMs() : 0;
    if (BULLET_PROBE && this.probeLastFrameMs > 0) {
      const gap = tFrame - this.probeLastFrameMs;
      if (gap > bulletProbe.frameGapMaxMs) bulletProbe.frameGapMaxMs = gap;
    }
    if (this.activeCount > 0) {
      if (BULLET_PROBE) {
        const t = nowMs();
        this.visual?.step(dt);
        bulletProbe.stepMs += nowMs() - t;
      } else {
        this.visual?.step(dt);
      }
    }
    this.renderer.sync(this.allBullets, camera);
    // ★ 地形命中特效驱动（固定点：播完回收）
    for (let i = this.terrainFxViews.length - 1; i >= 0; i--) {
      const item = this.terrainFxViews[i];
      if (item.fx.update(dt, item.x, item.y, item.z)) {
        item.fx.dispose();
        this.terrainFxViews.splice(i, 1);
      }
    }
    if (BULLET_PROBE) {
      this.probeLastFrameMs = tFrame;
      const ms = nowMs() - tFrame;
      bulletProbe.updateMs += ms;
      if (ms > bulletProbe.maxUpdateMs) bulletProbe.maxUpdateMs = ms;
      // 池重复项检测（重复入池 = 回收路径不幂等的直接证据）
      let dup = 0;
      if (this.pool.length > 1) {
        const seen = new Set<BulletEntity>();
        for (const x of this.pool) {
          if (seen.has(x)) dup++;
          else seen.add(x);
        }
      }
      probePoolStat({
        label: this.probeLabel,
        capacity: this.allBullets.length,
        pool: this.pool.length,
        activeCount: this.activeCount,
        activeSet: this.activeBullets.size,
        poolDupes: dup,
      });
      probeBulletFlush();
    }
  }

  /** ★ 遍历激活子弹（蜂群代理命中判定用；不暴露内部集合） */
  forEachActive(cb: (b: BulletEntity) => void): void {
    for (const b of this.activeBullets) cb(b);
  }

  /** ★ 命中特效 billboard 朝向（render 前调用；实体槽特效由实体骨架驱动） */
  syncHitEffects(camera: THREE.Camera): void {
    for (const item of this.terrainFxViews) item.fx.render(camera);
  }

  /** ★ 命中特效挂载（共用服务层函数 attachHitEffect）：
   *   实体 → 函数内完成偏移计算 + attachEffect（击中点跟着实体走）；
   *   地形 → 返回 fx 进固定点列表（命中坐标原地播放） */
  private spawnHitEffect(b: BulletEntity, other: EntityBase | null): void {
    if (this.hitEffectShapes.length === 0) return;
    const fxRuntime = renderManager.fxRuntime;
    if (!fxRuntime) return;
    const p = b.entity.position;
    const t = BULLET_PROBE ? nowMs() : 0;
    const fx = attachHitEffect(fxRuntime, this.hitEffectShapes, { x: p.x, y: p.y, z: p.z }, other, { worldSize: 3 });
    if (BULLET_PROBE) {
      const ms = nowMs() - t;
      bulletProbe.fxMs += ms;
      if (ms > bulletProbe.maxFxMs) bulletProbe.maxFxMs = ms;
    }
    if (fx) this.terrainFxViews.push({ fx, x: p.x, y: p.y, z: p.z });
  }

  dispose(): void {
    for (const b of this.allBullets) b.dispose();
    this.allBullets = [];
    this.pool = [];
    this.activeBullets.clear();
    for (const item of this.terrainFxViews) item.fx.dispose();
    this.terrainFxViews = [];
    this.visual?.dispose();
    this.visual = null;
    this.renderer.dispose();
  }
}
