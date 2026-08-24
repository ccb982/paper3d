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
import { SunCycle, type SunSample } from './SunCycle';
import { gameLights, LIGHT_TUNING } from './GameLights';

/** 调参统一入口（透传 GameLights.LIGHT_TUNING；曝光/太阳距离等都在这） */
export { LIGHT_TUNING };

class RenderManager {
  private sunCycle = new SunCycle();

  /** boot 装配光照（main.ts 调一次；幂等） */
  setup(scene: THREE.Scene): void {
    gameLights.setup(scene);
  }

  /** 进入战场：重置到清晨出发时刻（后续可按 Session.day 变化） */
  resetDay(hour?: number): void {
    this.sunCycle.reset(hour);
  }

  /** 每帧推进昼夜时间（WorldMode.update 开头调用；先于实体更新 → 本帧太阳一致） */
  update(dt: number): void {
    this.sunCycle.update(dt);
  }

  /** 渲染前锚定光照到跟随目标（WorldMode.render 调用；位置已是本帧最终值） */
  follow(target: { x: number; y: number; z: number }): void {
    gameLights.follow(target, this.sunCycle.current);
  }

  /** ★ 渲染查询接口：太阳状态（方向/色温/白昼因子）——影子投影等消费者用 */
  querySun(): SunSample {
    return this.sunCycle.current;
  }
}

/** 全局唯一实例（与 eventBus 同款单例风格） */
export const renderManager = new RenderManager();
