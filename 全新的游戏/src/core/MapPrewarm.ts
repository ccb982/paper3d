// ============================================================
// MapPrewarm —— 统一的地图预创建层（2026-11-14）
// ============================================================
// ★ 为什么要有这一层（用户定调）：
//   「一局一个种子 → 进游戏就可以先预创建地图和其他相关的」
//
//   地图 = 主种子决定，**整局固定**（出生点才每天随机）。所以地图相关的
//   预创建产物都可以在**进游戏那一刻**就启动，而不是等出击时临时准备：
//     · 地形数据层（RasterMap）—— 整局一份，不再每次出击重建（generateChunk
//       是纯函数，重建 = 白算一遍）；
//     · 出生点周围的粗块（CoarsePrewarm）—— 进场即完整地形，不见空洞；
//     · 精细地形的 shader program（TerrainProgramPrewarm）—— ★ 必须在
//       **野外灯光状态**下预热（基地往同一 scene 加了 4 盏灯 → program 缓存键
//       不同 → 预热失效）；"进游戏时"正是野外灯光 → 最佳时机。
//
// ★ 职责边界（单一判据源）：
//   本层只做「地图相关预创建」的**编排与持有**；
//   具体怎么建粗块 → CoarsePrewarm；怎么编译 program → TerrainProgramPrewarm。
//   本层不重复实现它们，只决定「什么时候做」。
//
// ★ 生命周期：跟着**一局**（session）走，不是跟着一次出击走。
//   WorldMode 通过 ctx.raster 复用本层的 RasterMap 实例。
// ============================================================

import * as THREE from 'three';
import { RasterMap } from '../services/map/RasterMap';
import { prewarmCoarseAround, prewarmUpload, setPrewarmedVisible } from '../services/map/CoarsePrewarm';
import { prewarmTerrainPrograms } from '../services/map/TerrainProgramPrewarm';

/** 出生点粗块预创建的半径（格；1 格 = 60m）→ ±8 = 960m 见方 */
export const PREWARM_SPAWN_RADIUS = 8;

export class MapPrewarm {
  /** 本局主种子 */
  readonly seed: number;
  /** ★ 本局地形数据层（整局复用；WorldMode 通过 ctx.raster 取用） */
  readonly raster: RasterMap;

  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.Camera;
  private programsWarmed = false;

  constructor(
    seed: number,
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
  ) {
    this.seed = seed;
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    // ★ 本局的地图数据层：整局唯一（进游戏时就建好，不等出击）
    this.raster = new RasterMap(seed);
  }

  /**
   * ★ 精细地形 shader program 预热（异步；驱动侧并行编译，主线程不阻塞）。
   *   必须在**野外灯光状态**下调用 → "进游戏时"调用最合适。
   */
  warmPrograms(): void {
    if (this.programsWarmed) return;
    this.programsWarmed = true;
    prewarmTerrainPrograms(this.renderer, this.scene, this.camera);
  }

  /**
   * ★ 预创建出生点周围的粗块（几何 + 载入 GPU）。
   *   @param visible 是否立刻可见 —— 基地期间必须 false（基地渲染的就是室外
   *     scene，可见会穿帮）；出击瞬间传 true。
   *   @param upload   是否顺带做一次离屏渲染把几何送进 GPU
   */
  warmSpawn(x: number, z: number, visible: boolean, upload: boolean): void {
    // 幂等：prewarmCoarseAround 内部按 key 跳过已建的块
    prewarmCoarseAround(this.scene, x, z, PREWARM_SPAWN_RADIUS, visible, this.seed);
    if (visible) setPrewarmedVisible(this.scene, true);
    if (upload) prewarmUpload(this.renderer, this.scene, x, z);
  }
}
