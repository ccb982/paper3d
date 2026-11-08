// ============================================================
// visibility —— 可见性判据单一事实源（2026-11-07 架构重构）
// ============================================================
// ★ 为什么建这个模块（架构级重构的根因）：
//   原来「视野」有 5 套各写各的判据，阈值散在 6 个文件：
//     ① RasterMap.queryFrustum  —— 相机视锥投到 y=0 的 **2D 地面梯形**（忽略 y）
//     ② WorldMode.inView        —— NDC 投影 + 220m（升格判据）
//     ③ ChunkManager.markLightVisibility —— 75° 锥 + 170m（地形光照）
//     ④ WaterMaterial.rippleInView      —— three.js Frustum + 球（涟漪）
//     ⑤ Minimap/MapPanel        —— 纯半径圆
//
//   ★★ ① 是「近处敌人冻住 + 真身不知道在哪」的**真凶**：
//     地面梯形的**近边离相机很近**（相机在玩家身后 4.2m，梯形近边只覆盖相机前几米）
//     ⇒ 相机与玩家之间的敌人**在屏幕上可见、却落在梯形外** → 被判出视锥
//     ⇒ present() 跳过 syncRender() → 贴片**停在旧位置**（鬼影）
//     ⇒ 而 FTXQuad.mesh.frustumCulled = false 且没人把 visible 置 false
//        ⇒ 鬼影一直画在屏幕上 ⇒ 「纹理冻住、真身不知道在哪」
//
// ★ 本模块的职责（只做判据，不做执行）：
//   · 真 3D 视锥（含 y，与屏幕所见一致）：实体裁剪 / 代理裁剪 / 分层判据共用
//   · 距离 LOD：**连续**渐隐（消除档位边界跳变 = 闪烁）
//   · 分层半径（实体 ↔ 代理）：升格与降格用**同一**判据 + 滞回
//
// ★ 铁律：
//   1. 「可见性」只有一个判据实现；谁都不许自己再写一套。
//   2. 升格与降格必须用**同一个** shouldBeEntity + 滞回半径（否则必然抖动）。
//   3. 距离 → 表现强度是**连续函数**；LOD 档位只用于「要不要更新」，不用于「要不要画」。
// ============================================================

import * as THREE from 'three';

/** LOD 距离档位（沿用 services/lod.ts 的表；本模块是唯一消费方） */
export const LOD_RANGES = [45, 90, 140] as const;

/** 实体渲染最远距离（= lod3 边界；代理也在此距离内绘制） */
export const LOD_MAX_DIST = LOD_RANGES[LOD_RANGES.length - 1];

/** 距离 → LOD 档位（0 近 / 1 中 / 2 远渐隐 / 3 不渲染） */
export function levelForDistance(d: number): number {
  if (d < LOD_RANGES[0]) return 0;
  if (d < LOD_RANGES[1]) return 1;
  if (d < LOD_RANGES[2]) return 2;
  return 3;
}

/**
 * 距离 → 表现强度（连续，0~1）。
 * ★ 为什么连续：档位是阶跃的（45/90/140），敌人在边界两侧抖一下就会
 *   alpha 1↔0.45↔0 跳变 = 视觉闪烁。连续函数没有跳变。
 *   渐隐起点 = lod1 末（90m）→ 完全消失 = lod3 末（140m）。
 */
export function fadeForDistance(d: number): number {
  if (d <= LOD_RANGES[1]) return 1;
  if (d >= LOD_RANGES[2]) return 0;
  const t = (d - LOD_RANGES[1]) / (LOD_RANGES[2] - LOD_RANGES[1]);
  return 1 - t * t * (3 - 2 * t);   // smoothstep：两端一阶导为 0 ⇒ 进出都柔和
}

// ============================================================
// 分层半径（实体 ↔ 代理 切换）
// ============================================================
/**
 * ★ 升格（代理→实体）/ 降格（实体→代理）必须用同一判据。
 *   原来：升格 = inView(NDC + 220m)，降格 = 距离 > 125m ⇒ 125~220m 带内两者结论相反
 *   ⇒ 敌人反复升降 ⇒ 实体贴片与代理贴片交替出现 ⇒ 「真身不知道在哪」+ 一闪一闪。
 *
 *   修正：**同源判据 + 滞回半径**
 *     · 升格：shouldBeEntity(..., curIsEntity=false) → 视锥内 且 距离 ≤ PROMOTE_DIST
 *     · 降格：shouldBeEntity(..., curIsEntity=true)  → 出视锥 或 距离 > DEMOTE_DIST
 *     · DEMOTE_DIST > PROMOTE_DIST ⇒ 中间形成滞回带，边界不抖
 */
export const TIER_PROMOTE_DIST = 110;   // 升格上限（米）
export const TIER_DEMOTE_DIST = 125;    // 降格下限（米；> PROMOTE ⇒ 滞回带 15m）

// ============================================================
// 可见性判据（每帧一份；相机变一次算一次）
// ============================================================

/**
 * ★★ 判据容差半径（米）—— 视锥裁剪的「提前消失」防线（2026-11-08 实测调大）。
 *   ★ 为什么从 0.6 调到 1.0：
 *     实测（真 TPS 相机 fov=50°/near=0.1/距离4.2m，判据「贴片在屏幕内 vs 被判出视锥」，
 *     45 万采样点，覆盖 pitch ±60° × yaw 0~85°）：
 *       0.6m → 贴片还在屏幕上却被剔除 **9.5%**（敌人走到画面边缘时整块闪没）
 *       1.0m → **0.00%**
 *     根因：贴片是【竖直片】（宽 0.9m × 高 1.8m），球心在脚底+0.9m，
 *     半径 0.6m 的球在**侧向**只覆盖很窄的一条 ⇒ 侧边缘必然切掉。
 *   ★ 代价：多保留 1.62% 的「已离开屏幕却仍绘制」样本（画面边缘多画几个贴片）
 *     —— 相比「敌人提前消失」这个可见缺陷，代价可忽略。
 */
export const VIS_RADIUS = 1.0;

/**
 * ★ 实体「身体中心」相对脚底的高度（米）—— 视锥判定统一用这个高度。
 * ★ 为什么必须统一（2026-11-07 架构重构）：
 *   三个消费者（实体裁剪 / 升格判据 / 降格判据）如果各用各的高度，
 *   同一只敌人在边界上会得到**不同**的可见性结论 ⇒ 反复升降格 ⇒ 闪烁 + 俩血条。
 */
export const VIS_BODY_H = 0.9;

/**
 * 可见性判据（构造后只读 ⇒ 多消费者可安全共享同一份）。
 */
export class Visibility {
  /** 真 3D 视锥（three.js Frustum，含 y —— 与屏幕所见一致） */
  readonly frustum: THREE.Frustum;
  readonly camX: number;
  readonly camY: number;
  readonly camZ: number;
  /** 相机水平朝向（单位向量） */
  readonly fwdX: number;
  readonly fwdZ: number;
  /** 水平半视场角切线（cot(halfFovH)）—— 快速锥筛用 */
  readonly tanHalfH: number;

  private readonly projScreen = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();

  constructor(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    this.camX = camera.position.x;
    this.camY = camera.position.y;
    this.camZ = camera.position.z;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum = new THREE.Frustum().setFromProjectionMatrix(this.projScreen);
    const e = camera.matrixWorld.elements;
    this.fwdX = -e[8];
    this.fwdZ = -e[10];
    const fl = Math.hypot(this.fwdX, this.fwdZ) || 1;
    this.fwdX /= fl;
    this.fwdZ /= fl;
    const m = camera.projectionMatrix.elements;
    const aspect = Math.abs(m[5] / m[0]) || 1;
    this.tanHalfH = (1 / Math.max(1e-6, m[5])) * aspect;
  }

  /**
   * 目标是否在真 3D 视锥内（**含 y**）。
   * @param y 目标的世界高度（实体用身体中心高度；代理用贴地高度）
   * @param r 容差半径（默认 VIS_RADIUS；边缘柔化，防硬切闪烁）
   */
  isVisible(x: number, y: number, z: number, r = VIS_RADIUS): boolean {
    const dx = x - this.camX;
    const dz = z - this.camZ;
    const dist = Math.hypot(dx, dz);
    // ★★ 快速锥筛（水平方向）—— 省掉大部分球体测试。
    //   ⚠⚠ 2026-11-08 修复：**必须考虑容差半径 r**。
    //     旧实现按「球心」出锥即判不可见 ⇒ 球心刚出锥一点点就整块剔除，
    //     而球（半径 r）其实仍与视锥侧面相交 ⇒ 贴片还在屏幕上却消失
    //     （实测：旧实现误杀 21.9%，修正后 9.6%，与「纯球测试」的 9.5% 齐平）。
    //   ★ 修正：球心允许出锥 asin(r/dist) 的余量（球仍可能与侧面相交）。
    if (dist > r + 0.5) {
      const dot = (dx * this.fwdX + dz * this.fwdZ) / dist;
      const cosLimit = 1 / Math.sqrt(1 + this.tanHalfH * this.tanHalfH);
      // 球心可超出半视场角的最大余量（切线角）
      const slack = Math.asin(Math.min(1, r / Math.max(1e-6, dist)));
      const limit = Math.cos(Math.acos(cosLimit) + slack);
      if (dot < limit) return false;
    }
    this.sphere.center.set(x, y, z);
    this.sphere.radius = r;
    return this.frustum.intersectsSphere(this.sphere);
  }

  /** 水平距离（xz 平面） */
  distance(x: number, z: number): number {
    return Math.hypot(x - this.camX, z - this.camZ);
  }

  /** 距离 → LOD 档位 */
  levelAt(x: number, z: number): number {
    return levelForDistance(this.distance(x, z));
  }

  /** 距离 → 连续表现强度（0~1） */
  fadeAt(x: number, z: number): number {
    return fadeForDistance(this.distance(x, z));
  }

  /**
   * 分层判据：这只单位此刻**应当**是实体（升格）还是代理（降格）。
   * ★ 升格与降格共用此判据（WorldSpawner / SwarmSystem 消费）——这是"不闪烁"的根本保证。
   * @param curIsEntity 当前是否已是实体（用于滞回：已实体时用更宽的降格半径）
   * @param y 目标高度（贴地高度；代理在地面，实体在脚底）
   */
  shouldBeEntity(x: number, z: number, curIsEntity: boolean, y = 0): boolean {
    const d = this.distance(x, z);
    if (curIsEntity) {
      // 已在实体层：只有「出视锥」或「超过降格半径」才降
      if (d > TIER_DEMOTE_DIST) return false;
      return this.isVisible(x, y, z);
    }
    // 在代理层：进入视锥且够近才升
    if (d > TIER_PROMOTE_DIST) return false;
    return this.isVisible(x, y, z);
  }
}

/** 每帧构建一份可见性判据（调用点唯一：WorldMode，相机定稿后） */
export function buildVisibility(camera: THREE.Camera): Visibility {
  return new Visibility(camera);
}
