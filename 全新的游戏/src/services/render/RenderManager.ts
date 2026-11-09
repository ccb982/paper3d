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
import { CloudSolver } from './CloudSolver';
import { updateTerrainLighting, updateWallMaterialsLighting as updateWallLighting } from '../map/TerrainMaterial';
import { sharedWaterMaterial } from '../map/WaterMaterial';
import { updateApronLighting } from '../map/decor/PlatformApron';

import { FxRuntime } from '../../fx';
import type { MoonRenderBackend, MoonSource, MoonView } from '../../fx';
import { MOON_PROBE, moonProbe, probeMoonAttach } from '../debug/RuntimeProbe';

/** 调参统一入口（透传 GameLights.LIGHT_TUNING；曝光/太阳距离等都在这） */
export { LIGHT_TUNING };

class RenderManager {
  private sunCycle = new SunCycle();
  private skyDome = new SkyDome();
  /** ★ renderer 引用（离屏细节法线图每帧渲染用） */
  private renderer: THREE.WebGLRenderer | null = null;
  private cloudSolver: CloudSolver | null = null;
  /** ★ 游戏内唯一特效播放器（src/fx）：爆炸/月亮统一从这里调度 */
  private fx: FxRuntime | null = null;

  // ---- 全局时间缩放（hitstop 顿帧的基础设施；时间归渲染管理器管） ----
  private _rawDt = 0;
  private _timeScale = 1;
  private _tsTimer = 0;
  private _tsScale = 1;
  private _lastCost = 0;
  /** ★ 昼夜时钟冻结（2026-09-18）：舰内等"世界已停"的室内场景用。
   *  只停太阳/昼夜，不动 scaledDt —— 房间行走、UI 动画照常用真实 dt。
   *  接线方负责成对开合（WorldMode：进舱 true / 出舱 + 每次 enter 复位 false）。 */
  private clockPaused = false;

  /** boot 装配光照（main.ts 调一次；幂等）
   *  renderer 用于构造 GPU 云朵求解器；scene 挂天空穹顶
   */
  setup(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    gameLights.setup(scene);
    this.skyDome.attach(scene);
    this.skyDome.setMoonEffectRenderer(renderer);
    if (!this.fx) this.fx = new FxRuntime({ scene });
    if (!this.cloudSolver) {
      this.cloudSolver = new CloudSolver(renderer);
    }
  }

  /** ★ 游戏内唯一特效播放器（世界/月亮共用；setup 后可用） */
  get fxRuntime(): FxRuntime | null {
    return this.fx;
  }

  /**
   * 每帧推进（★ main.ts 主循环调用，替代此前 WorldMode 内调用——
   * 全局唯一的时间入口）。产出 scaledDt 供模式层驱动世界。
   */
  /** ★ 航行低耗渲染模式（用户定调）：云流体不推进、月亮离屏渲染不更新
   *  （水由 ChunkManager.setWaterVisible 隐藏） */
  private flightMode = false;
  setFlightMode(v: boolean): void {
    this.flightMode = v;
  }

  /** ★ 昼夜时钟冻结开关（室内场景：世界逻辑已停，太阳也不该偷偷走） */
  setClockPaused(v: boolean): void {
    this.clockPaused = v;
  }

  update(dt: number): void {
    this._rawDt = dt;
    let ts = 1;
    if (this._tsTimer > 0) {
      this._tsTimer -= dt; // 恢复计时走真实时间（否则顿帧永远缓不过来）
      ts = this._tsTimer > 0 ? this._tsScale : 1;
    }
    this._timeScale = ts;
    // 顿帧时全世界冻结（含太阳），经典 hitstop；舰内等室内场景 clockPaused 也冻结昼夜
    if (!this.clockPaused) this.sunCycle.update(dt * ts);
    // 云朵求解推进（跟随真实时间，顿帧时也冻结保持一致性）；航行期不推进（省 GPU）
    if (!this.flightMode) {
      this.cloudSolver?.setHour(this.sunCycle.current.hour);
      this.cloudSolver?.update(dt * ts);
    }
  }

  /** 缩放后的帧时间（模式层用这个驱动一切更新） */
  get scaledDt(): number {
    return this._rawDt * this._timeScale;
  }

  /** ★ 游戏内时钟（HUD 读）：hour 0~24（900 现实秒 = 24h）+ 累计天数 */
  get clock(): { hour: number; day: number } {
    return { hour: this.sunCycle.current.hour, day: this.sunCycle.dayCount };
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

  /** 进入战场：重置到初始时刻（白天，默认 START_HOUR=10） */
  resetDay(hour?: number): void {
    this.sunCycle.reset(hour);
  }

  /** 渲染前锚定光照到跟随目标（WorldMode.render 调用；位置已是本帧最终值） */
  follow(target: { x: number; y: number; z: number }): void {
    if (MOON_PROBE) {
      moonProbe.followCalls++;
      // 与下方 updateMoonEffect 的 animate 实参保持一致（月亮 VAT 已定为冻结）
      moonProbe.followAnimate = false;
      moonProbe.hour = this.sunCycle.current.hour;
      moonProbe.flight = this.flightMode;
      const el = this.renderer?.domElement;
      if (el) {
        moonProbe.winW = el.width;
        moonProbe.winH = el.height;
      }
    }
    gameLights.follow(target, this.sunCycle.current, this.sunCycle.moon);
    // ★ 月亮：几何帧冻结（animate=false），但**每帧仍要驱动重绘**：
    //   1) 通道要至少产出一次 RT 内容，否则 RT 是 WebGL 全 0 → 月亮本体透明不可见；
    //   2) 实测（?fxProbe=1 夜间 RT 采样）VAT 时间推进时某些相位会画不出几何
    //      → 几何帧锁定在 vat≈0（实测 alpha 满，不出现周期性清空窗口）；
    //   3) ★ 时间驱动的呼吸 UV 扭曲由通道内部独立推进（与几何帧解耦），
    //      因此这里不能跳过驱动，否则扭曲会被一起冻住（用户已确认该症状）。
    this.skyDome.updateMoonEffect(this.scaledDt, false);
    // ★ 天空穹顶 + 太阳/月亮圆盘：锚定跟随点，按 SunCycle 刷新颜色与位置
    // ★ Gerstner 几何波集推进（GPU Gems：随机参数 + 随时间淡出/淡入 ⇒ 永不重复）
    sharedWaterMaterial.updateGerstner(this.scaledDt);
    // ★ 离屏细节法线图（GPU Gems：render target；主 pass 只采样一次）
    if (this.renderer) sharedWaterMaterial.renderDetailRT(this.renderer, performance.now() * 0.001);
    // ★ 天空穹顶 + 太阳/月亮圆盘：锚定跟随点，按 SunCycle 刷新颜色和位置
    this.skyDome.update(target, this.sunCycle.current, this.sunCycle.moon, this.sunCycle.sky);
    // ★ 云朵双缓冲纹理 + 过渡进度（每帧喂，平滑 2fps 结算）
    if (this.cloudSolver) {
      this.skyDome.setCloudTextures(
        this.cloudSolver.getPrevTexture(),
        this.cloudSolver.getCurrentTexture(),
        this.cloudSolver.getBlend(),
      );
    }
    // ★ 地形烘焙光照的昼夜调制（双纹理方案：地形不吃实时灯，只吃这两个 uniform）
    updateTerrainLighting(this.sunCycle.current);
    // ★ 断崖侧壁同步昼夜色调
    updateWallLighting(this.sunCycle.current);
    // ★ 墙裙同步昼夜色调（自定义 ShaderMaterial，与地形同源）
    updateApronLighting(this.sunCycle.current);
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

  /** 环境背景开关：world=露天（天空穹顶+太阳/月亮可见）；ship=舰船内部（无天空）
   *  进入 world 时重建云场，ship 时暂停推进（穹顶隐藏即不采样） */
  setEnvironment(kind: 'ship' | 'world'): void {
    this.skyDome.setVisible(kind === 'world');
    if (kind === 'world' && this.cloudSolver) this.cloudSolver.reset();
  }

  /** ★ 注入月亮贴图（大猫哥月亮素材包解码出的 base/residual 纹理）。
   *  无素材包时传 null 即可回退到程序化月相。 */
  setMoonTexture(
    base: THREE.Texture | null,
    residual: THREE.Texture | null,
  ): void {
    this.skyDome.setMoonTexture(base, residual);
  }

  /** ★ 设置月亮视图（统一运行时产出的 MoonView）。与 setMoonTexture 互斥。 */
  setMoonEffect(effect: MoonView | null): void {
    this.skyDome.setMoonEffect(effect);
  }

  /** ★ 通过统一运行时接入月亮（数据源由 legacy 适配器临时提供） */
  attachMoon(source: MoonSource, backend: MoonRenderBackend): MoonView | null {
    if (!this.fx) {
      probeMoonAttach('no-fx');
      return null;
    }
    const view = this.fx.attachMoon(source, backend);
    this.skyDome.setMoonEffect(view);
    probeMoonAttach(view ? 'view' : 'null');
    return view;
  }
}

/** 全局唯一实例（与 eventBus 同款单例风格） */
export const renderManager = new RenderManager();
