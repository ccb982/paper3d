// ============================================================
// GameLights —— 全局光照装备（实时光照包，2026-08-23）
// ============================================================
// 设计哲学：把贵的变成一次性的，把每帧的变便宜的。
//   - 复杂计算全部前置烘焙（AO 进顶点色、装饰进 Imposter 图集、法线预计算）
//   - 实时部分只保留最便宜的光照词汇表：半球光 + 单平行光 + 实体阴影
//
// 用法（★ 由 RenderManager 协调，外部不要直接调用）：
//   renderManager.setup(scene)   —— main.ts boot 调一次（全局唯一装备）
//   renderManager.follow(pos)    —— WorldMode.render 每帧锚定+按太阳调制
//
// 调参入口：LIGHT_TUNING（集中一处，调参不翻代码）
// ============================================================

import * as THREE from 'three';

export const LIGHT_TUNING = {
  hemiSky: 0x9db8e8,        // 天空色（冷蓝，太空/泰拉基调）
  hemiGround: 0x8a7455,     // 地面反照色（暖棕）
  hemiIntensity: 0.85,
  sunColor: 0xfff2dd,       // 基准阳光色（实际每帧被 SunCycle 色温调制）
  sunIntensity: 1.6,
  /** 太阳距离（follow 时 = 目标 + SunCycle.dir × 此值）→ 决定剪影影子方向与长度 */
  sunDistance: 90,
  /** 月光距离（月亮平行光位置；独立于太阳） */
  moonDistance: 90,
  moonColor: 0xc8d8f0,      // 冷银蓝月光
  exposure: 1.08,
};

class GameLights {
  private hemisphere: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private moon: THREE.DirectionalLight | null = null;

  /**
   * 装备全局光照（main.ts boot 调一次；幂等）。
   * ★ 不开 castShadow：全项目无投影 mesh，shadow map 是纯空转开销（2026-08-26 移除）。
   *   实体影子统一走 SilhouetteShadow 解析剪影贴地；光照只提供方向/色温/强度。
   */
  setup(scene: THREE.Scene): void {
    if (this.sun) return; // 幂等

    this.hemisphere = new THREE.HemisphereLight(
      LIGHT_TUNING.hemiSky, LIGHT_TUNING.hemiGround, LIGHT_TUNING.hemiIntensity,
    );
    scene.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight(LIGHT_TUNING.sunColor, LIGHT_TUNING.sunIntensity);
    // 初始占位方向（follow 每帧由 RenderManager 用 SunCycle 状态覆盖）
    this.sun.position.set(0, 1, 0).multiplyScalar(LIGHT_TUNING.sunDistance);
    scene.add(this.sun);
    scene.add(this.sun.target); // ★ target 必须在场景图中，follow 才生效

    // ★ 月光平行光：独立于太阳，白天禁用，夜晚按可见度/月相点亮
    this.moon = new THREE.DirectionalLight(LIGHT_TUNING.moonColor, 0);
    this.moon.position.set(0, 1, 0).multiplyScalar(LIGHT_TUNING.moonDistance);
    scene.add(this.moon);
    scene.add(this.moon.target);
  }

  /** 每帧：太阳/月亮位置锚定到目标（玩家）+ 按传入状态调制颜色/强度。
   *  ★ 被动消费：不依赖 SunCycle——由 RenderManager 协调注入。
   *  参数用纯数据坐标（实体系统 position 风格），不要求 THREE.Vector3。 */
  follow(
    target: { x: number; y: number; z: number },
    sun: { dir: { x: number; y: number; z: number }; color: number; intensityScale: number; daylight: number },
    moon?: { dir: { x: number; y: number; z: number }; intensityScale: number },
  ): void {
    if (!this.sun) return;
    this.sun.target.position.set(target.x, target.y, target.z);
    this.sun.position.set(
      target.x + sun.dir.x * LIGHT_TUNING.sunDistance,
      target.y + sun.dir.y * LIGHT_TUNING.sunDistance,
      target.z + sun.dir.z * LIGHT_TUNING.sunDistance,
    );
    // ★ 昼夜调制：色温（晨昏暖橙/正午暖白/夜晚冷蓝）+ 强度衰减
    this.sun.color.setHex(sun.color);
    this.sun.intensity = LIGHT_TUNING.sunIntensity * sun.intensityScale;
    if (this.hemisphere) {
      this.hemisphere.intensity = LIGHT_TUNING.hemiIntensity * (0.55 + 0.45 * sun.daylight);
    }

    // ---- 月光（独立于太阳；有月亮数据才更新） ----
    if (this.moon && moon) {
      this.moon.target.position.set(target.x, target.y, target.z);
      this.moon.position.set(
        target.x + moon.dir.x * LIGHT_TUNING.moonDistance,
        target.y + moon.dir.y * LIGHT_TUNING.moonDistance,
        target.z + moon.dir.z * LIGHT_TUNING.moonDistance,
      );
      this.moon.intensity = moon.intensityScale * 1.0; // moon.intensityScale 已含满月系数
      this.moon.color.setHex(LIGHT_TUNING.moonColor);
    }
  }
}

/** 全局唯一实例（与 eventBus 同款单例风格） */
export const gameLights = new GameLights();
