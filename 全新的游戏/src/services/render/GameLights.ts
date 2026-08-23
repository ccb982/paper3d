// ============================================================
// GameLights —— 全局光照装备（实时光照包，2026-08-23）
// ============================================================
// 设计哲学：把贵的变成一次性的，把每帧的变便宜的。
//   - 复杂计算全部前置烘焙（AO 进顶点色、装饰进 Imposter 图集、法线预计算）
//   - 实时部分只保留最便宜的光照词汇表：半球光 + 单平行光 + 实体阴影
//
// 用法：
//   setupGameLights(scene)      —— main.ts boot 调一次（全局唯一装备）
//   gameLights.follow(pos)      —— WorldMode.update 每帧跟随玩家（阴影相机锚定）
//
// 调参入口：LIGHT_TUNING（集中一处，调参不翻代码）
// ============================================================

import * as THREE from 'three';

export const LIGHT_TUNING = {
  hemiSky: 0x9db8e8,        // 天空色（冷蓝，太空/泰拉基调）
  hemiGround: 0x8a7455,     // 地面反照色（暖棕）
  hemiIntensity: 0.85,
  sunColor: 0xfff2dd,       // 微暖阳光
  sunIntensity: 1.6,
  /** 太阳相对跟随目标的偏移 → 决定影子方向与长度 */
  sunOffset: { x: 26, y: 48, z: 16 },
  shadowMapSize: 1024,
  /** 阴影相机覆盖半径（世界单位）：玩家周围区域 */
  shadowExtent: 42,
  exposure: 1.08,
};

class GameLights {
  private hemisphere: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;

  /**
   * 装备全局光照（main.ts boot 调一次；幂等）。
   * 阴影策略（事故红线配套的性能决策）：
   *   - 只有实体 castShadow（billboard 数量有限）
   *   - 地形 receiveShadow 但不 castShadow —— 地形自阴影太贵，
   *     凹凸暗部交给顶点假 AO（buildChunkMesh 烘焙）
   */
  setup(scene: THREE.Scene): void {
    if (this.sun) return; // 幂等

    this.hemisphere = new THREE.HemisphereLight(
      LIGHT_TUNING.hemiSky, LIGHT_TUNING.hemiGround, LIGHT_TUNING.hemiIntensity,
    );
    scene.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight(LIGHT_TUNING.sunColor, LIGHT_TUNING.sunIntensity);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(LIGHT_TUNING.shadowMapSize, LIGHT_TUNING.shadowMapSize);
    const ext = LIGHT_TUNING.shadowExtent;
    s.camera.left = -ext;
    s.camera.right = ext;
    s.camera.top = ext;
    s.camera.bottom = -ext;
    s.camera.near = 5;
    s.camera.far = 160;
    // 高度场接收实体阴影：小偏置防 acne（地形自身不投，无自阴影问题）
    s.bias = -0.0004;
    s.normalBias = 0.6;
    this.sun.position.set(
      LIGHT_TUNING.sunOffset.x, LIGHT_TUNING.sunOffset.y, LIGHT_TUNING.sunOffset.z,
    );
    scene.add(this.sun);
    scene.add(this.sun.target); // ★ target 必须在场景图中，follow 才生效
  }

  /** 每帧：阴影相机锚定到目标（玩家）。太阳=目标+固定偏移，影子方向恒定。
   *  参数用纯数据坐标（实体系统 position 风格），不要求 THREE.Vector3。 */
  follow(target: { x: number; y: number; z: number }): void {
    if (!this.sun) return;
    this.sun.target.position.set(target.x, target.y, target.z);
    this.sun.position.set(
      target.x + LIGHT_TUNING.sunOffset.x,
      target.y + LIGHT_TUNING.sunOffset.y,
      target.z + LIGHT_TUNING.sunOffset.z,
    );
  }
}

/** 全局唯一实例（与 eventBus 同款单例风格） */
export const gameLights = new GameLights();

/** main.ts boot 调用的便捷入口 */
export function setupGameLights(scene: THREE.Scene): void {
  gameLights.setup(scene);
}
