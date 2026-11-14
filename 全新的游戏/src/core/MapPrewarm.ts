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
import { createPrewarmJob, prewarmKeySet, prewarmUpload, setPrewarmedVisible, disposeOrphanPrewarmed, type PrewarmJob } from '../services/map/CoarsePrewarm';
import { prewarmTerrainPrograms } from '../services/map/TerrainProgramPrewarm';

/**
 * 出生点粗块预创建的半径（格；1 格 = 60m）。
 *
 * ★ 2026-11-14 用户反馈「进游戏黑屏，应该是战场预加载导致的」：
 *   prewarmCoarseAround 是**同步主线程**逐块建几何，±8 = 289 块 ≈ 1~2s 纯主线程，
 *   把 enterWorldMode 整个堵住 → 黑屏。
 *   ±8 = 289 块（960m）：航行速度 48m/s，前向需要足够远景，覆盖不能砍；
 *   但这 289 块由分帧任务在基地阶段（玩家通常停留数十秒）建完，
 *   不再同步阻塞进场 —— 进场只同步补出生点 ±2 保底，其余随后到位。
 */
export const PREWARM_SPAWN_RADIUS = 8;

export class MapPrewarm {
  /** 本局主种子 */
  readonly seed: number;
  /** ★ 当前出生点预创建任务（出击/换点时可取消；2026-11-14） */
  private spawnJob: PrewarmJob | null = null;
  private spawnTimer: ReturnType<typeof setTimeout> | null = null;
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
    // ★ 2026-11-14 黑屏取证：compileAsync 在主线程同步轮询 getProgramParameter
    //   （CDP profile 占 enter CPU 样本 ~50%）。延后 100ms，让首帧先渲染出来。
    setTimeout(() => {
      try {
        prewarmTerrainPrograms(this.renderer, this.scene, this.camera);
      } catch { /* 预热失败不影响主流程 */ }
    }, 100);
  }

  /**
   * ★ 预创建出生点周围的粗块（几何 + 载入 GPU）。
   *   @param visible 是否立刻可见 —— 基地期间必须 false（基地渲染的就是室外
   *     scene，可见会穿帮）；出击瞬间传 true。
   *   @param upload   是否顺带做一次离屏渲染把几何送进 GPU
   */
  warmSpawn(x: number, z: number, visible: boolean, upload: boolean): void {
    // ★ 先清「未被认领」的旧预创建粗块（2026-11-14 跨天显存炸弹修复）：
    //   出生点每天不同 ⇒ 每天预创建的是新位置的一片；旧位置那些没被
    //   ChunkManager 认领的块会永久留在共享 scene 里累积 ⇒ 显存爆掉。
    //   认领过的块已被摘掉标记（见 ChunkManager 构造器）⇒ 不受此清理影响。
    //   ★ keepKeys：本次范围**保留** —— 回基地时已建好、出击瞬间再 warmSpawn
    //   同一出生点时不会"先删后建"重跑 289 块同步几何（省一次主线程尖峰）。
    const keep = prewarmKeySet(x, z, PREWARM_SPAWN_RADIUS);
    disposeOrphanPrewarmed(this.scene, keep);
    // ★ 分帧建几何（2026-11-14 黑屏修复）：原来走 prewarmCoarseAround 同步循环，
    //   每块 ensureData + computeTableGeometry 全在主线程 → 进场被整片堵死。
    //   现在每帧只给 4ms，建不完也不挡渲染；未建到的块由粗块管线（syncCoarse）补。
    const job = createPrewarmJob(this.scene, x, z, PREWARM_SPAWN_RADIUS, visible, this.seed);
    const finish = (): void => {
      if (visible) setPrewarmedVisible(this.scene, true);
      if (upload) prewarmUpload(this.renderer, this.scene, x, z);
    };
    if (job.total === 0) {
      finish();
      return;
    }
    if (visible) setPrewarmedVisible(this.scene, true);
    // ★ 进场先同步跑一小段（~150ms，按距离升序 ≈ 覆盖出生点 ±2 格），
    //   保证首帧脚下不是虚空；其余 ±8 由后台分帧继续铺，航行中由粗块管线补。
    this.cancelSpawnJob();
    this.spawnJob = job;
    job.step(150);
    // ★ 2026-11-14：后台分帧 8ms → 4ms，且**出击可取消**。
    //   旧行为：船飞走后仍在铺出生点那 289 块（每帧 8ms，且跑在主循环外、
    //   不计入 worldPerf）→ 这是「飞行帧率低 + 粗块建不出来 + 预加载没见效」
    //   的共同根因：预创建的块在旧位置，飞行时毫无用处，还抢走了铺块的时间。
    const tick = (): void => {
      if (this.spawnJob !== job) return;   // 已取消 / 被新任务替换
      if (job.step(4)) {
        this.spawnJob = null;
        this.spawnTimer = null;
        finish();
      } else {
        this.spawnTimer = setTimeout(tick, 16);
      }
    };
    this.spawnTimer = setTimeout(tick, 16);
  }

  /** ★ 取消出生点预创建（出击瞬间调用：船会飞走，旧出生点的块没用了） */
  cancelSpawnJob(): void {
    if (this.spawnTimer !== null) { clearTimeout(this.spawnTimer); this.spawnTimer = null; }
    this.spawnJob = null;
  }
}
