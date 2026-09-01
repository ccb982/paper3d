// ============================================================
// RenderManager —— 实时渲染管理器（每帧渲染域的唯一协调者）
// ============================================================
// ⚠️ 与"地图预渲染"严格分离（两个域互不知晓）：
//   - MapBaker / ChunkAppearance = 离线烘焙域：chunk 创建/重建时一次性
//     Canvas 逐像素烘焙外观，产物是静态纹理
//   - RenderManager              = 实时渲染域：每帧推进的动态全局状态
//     （昼夜时间 / 光照装备）+ 对实体渲染的查询服务
//
// 职责：
//   - 持有昼夜时间（SunCycle）与全局光照装备（GameLights），统一协调
//   - WorldMode：enter 时 resetDay() → update 推进时间 → render 前 follow 锚定
//   - 实体（EntityBase.syncShadow）：querySun() 查询太阳状态做影子仿射投影
//     （实体不直接依赖 SunCycle/GameLights——只认 RenderManager）
// ============================================================

import * as THREE from 'three';
import { SunCycle, type SunSample, type MoonSample, type SkyGradient } from './SunCycle';
import { gameLights, LIGHT_TUNING } from './GameLights';
import { SkyDome } from './SkyDome';
import { updateTerrainLighting } from '../map/TerrainMaterial';
import { updateWallLighting } from '../map/ChunkWalls';

/** 调参统一入口（透传 GameLights.LIGHT_TUNING；曝光/太阳距离等都在这） */
export { LIGHT_TUNING };

class RenderManager {
  private sunCycle = new SunCycle();
  private skyDome = new SkyDome();

  // ---- 全局时间缩放（hitstop 顿帧的基础设施；时间归渲染管理器管） ----
  private _rawDt = 0;
  private _timeScale = 1;
  private _tsTimer = 0;
  private _tsScale = 1;
  private _lastCost = 0;

  /** boot 装配光照（main.ts 调一次；幂等） */
  setup(scene: THREE.Scene): void {
    gameLights.setup(scene);
    this.skyDome.attach(scene);
  }

  /**
   * 每帧推进（★ main.ts 主循环调用，替代此前 WorldMode 内调用——
   * 全局唯一的时间入口）。产出 scaledDt 供模式层驱动世界。
   */
  update(dt: number): void {
    this._rawDt = dt;
    let ts = 1;
    if (this._tsTimer > 0) {
      this._tsTimer -= dt; // 恢复计时走真实时间（否则顿帧永远缓不过来）
      ts = this._tsTimer > 0 ? this._tsScale : 1;
    }
    this._timeScale = ts;
    this.sunCycle.update(dt * ts); // 顿帧时全世界冻结（含太阳），经典 hitstop
  }

  /** 缩放后的帧时间（模式层用这个驱动一切更新） */
  get scaledDt(): number {
    return this._rawDt * this._timeScale;
  }

  /** ★ 顿帧（CombatDirector 调用）：全局时间缩放到 scale 并自动恢复。
   *  并发请求取"损失时间"更大者（连续命中不会叠成幻灯片）。 */
  hitstop(seconds: number, scale = 0.08): void {
    const cost = seconds * (1 - scale);
    if (this._tsTimer <= 0 || cost >= this._lastCost) {
      this._tsTimer = seconds;
      this._tsScale = scale;
      this._lastCost = cost;
    }
  }

  /** 进入战场：重置到清晨出发时刻（后续可按 Session.day 变化） */
  resetDay(hour?: number): void {
    this.sunCycle.reset(hour);
  }

  /** 渲染前锚定光照到跟随目标（WorldMode.render 调用；位置已是本帧最终值） */
  follow(target: { x: number; y: number; z: number }): void {
    gameLights.follow(target, this.sunCycle.current, this.sunCycle.moon);
    // ★ 天空穹顶 + 太阳/月亮圆盘：锚定跟随点，按 SunCycle 刷新颜色与位置
    this.skyDome.update(target, this.sunCycle.current, this.sunCycle.moon, this.sunCycle.sky);
    // ★ 地形烘焙光照的昼夜调制（双纹理方案：地形不吃实时灯，只吃这两个 uniform）
    updateTerrainLighting(this.sunCycle.current);
    // ★ 断崖侧壁同步昼夜色调（仅亮度，不改烘焙阴影方向，与地面顶面一致）
    updateWallLighting(this.sunCycle.current);
  }

  /** ★ 渲染查询接口：太阳状态（方向/色温/白昼因子）——影子投影等消费者用 */
  querySun(): SunSample {
    return this.sunCycle.current;
  }

  /** ★ 渲染查询接口：月亮状态（方向/可见度/月相/月光强度） */
  queryMoon(): MoonSample {
    return this.sunCycle.moon;
  }

  /** ★ 渲染查询接口：天空三色渐变 + 雾色（main.ts 刷新背景/雾） */
  querySky(): SkyGradient {
    return this.sunCycle.sky;
  }

  /** 环境背景开关：world=露天（天空穹顶+太阳/月亮可见）；ship=舰船内部（无天空） */
  setEnvironment(kind: 'ship' | 'world'): void {
    this.skyDome.setVisible(kind === 'world');
  }
}

/** 全局唯一实例（与 eventBus 同款单例风格） */
export const renderManager = new RenderManager();
