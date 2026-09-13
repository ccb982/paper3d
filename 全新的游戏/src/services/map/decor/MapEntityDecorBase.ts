// ============================================================
// MapEntityDecorBase —— 地图装饰实体基类（库：声明/规划/物理/阴影/渲染）
// ============================================================
// 架构（2026-08-27 基类化整理）：
//   ┌─ 基类 MapEntityDecorBase：一张装饰实体的全部声明——
//   │    组归属 / 放置规则 / 渲染方式 / 阴影方式 / 物理碰撞体 / 程序化几何
//   │    ★ 物理：createColliders 基类统一生成 fixed cuboid
//   │      （碰撞与阴影共用同一体积：radius/height 单一数据源）
//   │    ★ 阴影：toShadowVolumes 基类统一算烘焙体积
//   │      （装饰物高度参与预渲染结构——先放置后烘焙，见 4.5 节）
//   ├─ 库（注册表）：registerMapDecor(实例) —— 加新装饰 = 注册一个实例
//   ├─ 规划：planChunkProps（确定性散布，纯函数，零 three）
//   ├─ 渲染：PropRenderer 注册表 + 内置 instanced（程序化几何）
//   └─ 宿主：ChunkGroundHost 接口（模式层用 EntityManager 适配，本层不碰 entity）
// ============================================================

import * as THREE from 'three';
import { hash2 } from '../TerrainNoise';
import { tileById, type TileDef } from '../Tiles';

/** 装饰物可生长的地块角色 */
export type PropHostRole = 'ground' | 'platform';

/** 物理碰撞体配置（fixed cuboid；存在 = 可碰撞，可挡人/挡弹） */
export interface DecorCollider {
  type: 'cuboid';
  /** 底面半径（米，基础值；×scale 得实际） */
  radius: number;
  /** 高度（米，基础值；×scale 得实际） */
  height: number;
}

export interface PropPlacement {
  /** 可生长的地块 key（空 = 不限，但受 hostRole 约束） */
  tiles?: string[];
  /** 可生长角色 */
  hostRole: PropHostRole[];
  /** 抖动网格 cell 出现概率（3m cell；400 网格每 chunk） */
  perCellProb: number;
  /** 缩放范围（乘数） */
  scaleRange: [number, number];
  /** 下沉量（米，防悬浮；0=贴面） */
  sinkIntoGround?: number;
  /** 下沉量随机范围（米；存在则覆盖 sinkIntoGround，每实例独立抽取） */
  sinkRange?: [number, number];
  /** 出生保护区（世界坐标 + 半径；规划期排除） */
  keepClear?: { x: number; z: number; r: number }[];
}

export interface MapEntityDecorConfig {
  key: string;
  label: string;
  /** 所属风格组（多对多；空 = 任意组均可用） */
  groups: string[];
  placement: PropPlacement;
  /** 渲染方式：v1 只实现 instanced（程序化几何）；billboard 预留 */
  render: 'instanced' | 'billboard';
  /** 阴影方式：'disc'=烘焙软影印入光照图 / 'none'=无（阴影体积数据源 = physics） */
  shadow: 'disc' | 'none';
  /** 物理碰撞体（存在 = 可碰撞；碰撞与阴影共用同一体积） */
  physics?: DecorCollider;
  /** 程序化几何参数（three 依赖只允许出现在渲染适配层，规划层纯函数） */
  geometry?: { type: string; params: Record<string, number> };
  /** ★ 几何变体数（缺省 4）：高频小物件（花草）设 1~2 以减少 InstancedMesh 桶数/draw call */
  variantCount?: number;
}

/**
 * ★ 地图装饰实体基类。
 * 实例 = 声明（配置数据），基类 = 行为（物理/阴影/渲染的统一实现）。
 */
export class MapEntityDecorBase {
  readonly key: string;
  readonly label: string;
  readonly groups: string[];
  readonly placement: PropPlacement;
  readonly render: 'instanced' | 'billboard';
  readonly shadow: 'disc' | 'none';
  readonly physics?: DecorCollider;
  readonly geometry?: { type: string; params: Record<string, number> };
  /** ★ 几何变体数（缺省 INST_VARIANT_COUNT=4；1~2 高频小物件用） */
  readonly variantCount?: number;

  constructor(cfg: MapEntityDecorConfig) {
    this.key = cfg.key;
    this.label = cfg.label;
    this.groups = cfg.groups;
    this.placement = cfg.placement;
    this.render = cfg.render;
    this.shadow = cfg.shadow;
    this.physics = cfg.physics;
    this.geometry = cfg.geometry;
    this.variantCount = cfg.variantCount;
  }

  // ============================================================
  // ★ 物理（基类统一实现）
  // ============================================================

  get isCollidable(): boolean {
    return this.physics !== undefined;
  }

  /**
   * ★ 生成碰撞体：fixed cuboid（半径/高度 × scale；y 为体积中心）。
   * 宿主由模式层注入（ChunkGroundHost → EntityManager → rapier）。
   */
  createColliders(
    host: ChunkGroundHost, plans: PlannedProp[], cx: number, cz: number,
  ): number[] {
    if (!this.physics) return [];
    const ids: number[] = [];
    for (const p of plans) {
      const r = this.physics.radius * p.scale;
      const h = this.physics.height * p.scale;
      const id = host.createPropBody?.(cx * 60 + p.x, p.y + h / 2, cz * 60 + p.z, r, h);
      if (id !== null && id !== undefined) ids.push(id);
    }
    return ids;
  }

  // ============================================================
  // ★ 阴影（基类统一实现；烘焙域消费）
  // ============================================================

  /**
   * 烘焙阴影体积（世界坐标；供 bakeCompute.stampPropShadows 投影软影）。
   * 数据源 = physics（碰撞与阴影同一体积——声明一处，两处行为一致）。
   */
  toShadowVolumes(plans: PlannedProp[], cx: number, cz: number): PropShadowVolume[] {
    const ph = this.physics;
    if (!ph) return [];
    return plans.map((p) => ({
      x: p.x + cx * 60,
      z: p.z + cz * 60,
      y: p.y,
      r: ph.radius * p.scale,
      h: ph.height * p.scale,
    }));
  }
}

/** 烘焙阴影体积（球/柱近似；r 底半径 × h 高度） */
export interface PropShadowVolume {
  x: number; z: number; y: number;
  r: number;
  h: number;
}

// ============================================================
// 库（注册表）
// ============================================================

const REGISTRY = new Map<string, MapEntityDecorBase>();

/** ★ 扩展点：注册装饰实体（加内容 = 注册一个基类实例） */
export function registerMapDecor(decor: MapEntityDecorBase): void {
  if (REGISTRY.has(decor.key)) throw new Error(`[MapEntityDecor] 装饰实体 key 已存在: ${decor.key}`);
  REGISTRY.set(decor.key, decor);
}

export function mapDecorByKey(key: string): MapEntityDecorBase | undefined {
  return REGISTRY.get(key);
}

export function allMapDecors(): MapEntityDecorBase[] {
  return [...REGISTRY.values()];
}

/** 按组取可用装饰实体（组面板消费；空组声明 = 通用；foundation = 兜底通用） */
export function propsForGroup(groupKey: string): MapEntityDecorBase[] {
  return [...REGISTRY.values()].filter(
    (p) => p.groups.length === 0 || p.groups.includes(groupKey) || p.groups.includes(FOUNDATION_PROP_GROUP),
  );
}

/** 基石兜底组 key（基石组的装饰实体 = 任何 chunk 都可出现） */
export const FOUNDATION_PROP_GROUP = 'foundation';

// ============================================================
// 占位内容（基石组；2026-09-02 曾按"1-7 写实风"移除，2026-09-05 应用户要求
// 重建——接通装饰实体管线验证链路。放置时机 = 精修层后处理（补丁层数覆盖）
// 之后的最终视觉面：planChunkProps 贴地采样走 raster.surfaceHeightAt
//（已减 levelDepthAt，装饰落在坑口沿外的原面/坑底新面）。
// 后续装饰 = 在此注册实例即可）
// ============================================================

// ★ 占位·碎石（foundation_pebble）已停用（2026-09-06 用户要求）：
//   与晶簇同为"石头感"装饰，默认地图里反而稀释了耗尽原石晶体的观感。
//   geometry 'rock' 保留，需要时可重新注册。

// ★ 能量耗尽原石晶体（2026-09-06 用户新增；09-07 重做几何）：
//   4 变体 × 每簇 = 主峰 + 环状外张中晶 + 大倾角细针 + 地面碎屑；
//   晶柱截面 5/6/8 边混排、腰肩两段收尖、尖端偏斜（off-axis）、
//   逐柱 random spin + 朝外倾斜（splay）→ 每簇形状/朝向都不同
//   （详见 buildCrystalCluster；变体由规划 variant 选取 → 共享几何缓存分桶）；
//   ★ 地面为主、总体 ~0.5%（用户定稿）：ground+platform 双角色都长，
//     地面方格多于高台 → 晶簇多数落在地面平地；perCellProb 0.005。
registerMapDecor(new MapEntityDecorBase({
  key: 'depleted_crystal', label: '耗尽原石晶体', groups: [FOUNDATION_PROP_GROUP],
  placement: {
    hostRole: ['ground', 'platform'], perCellProb: 0.005,
    scaleRange: [0.7, 1.5], sinkRange: [0.10, 0.26],
  },
  render: 'instanced', shadow: 'disc',
  physics: { type: 'cuboid', radius: 1.15, height: 2.8 },
  geometry: { type: 'crystal', params: { color: 0x6f6f6a, noise: 0.12 } },
}));

// ★ 水泥台座不在本库（独立结构模块 decor/CementPlinth.ts）：
//   4×4 整格正置铺满高台、顶面进 RasterMap.surfaceHeightAt 叠加层
//   （角色可站），几何复用下方 buildTrapezoidPlinth。

// ============================================================
// 规划（地形生成完成后、渲染前调用；纯函数零 three）
// ============================================================

/** 散布网格：20×20 cell × 3m */
export const PROP_GRID = 20;
export const PROP_CELL = 3;

/** 单 chunk 装饰实体上限（预算闸门） */
export const PROP_BUDGET = 150;

/** 坡度过滤：cell 四点高度极差超过此值不放（装饰物必须能站稳） */
export const PROP_MAX_SLOPE = 0.8;

export interface PlannedProp {
  propKey: string;
  /**
   * chunk 本地坐标（0~60，相对 chunk 角）——渲染层直接挂进 chunk group
   * （group.position 已是世界偏移，子对象必须本地坐标，否则整体错位）。
   * y 为贴地高度（世界高度，group.position.y=0 故本地=世界）。
   */
  x: number;
  z: number;
  y: number;
  scale: number;
  rotY: number;
  variant: number;
  /** ★ 下沉深度（米）：挖坑局部重贴地时 newY = surfaceHeightAt - sink（免重排） */
  sink?: number;
}

export interface PropPlanContext {
  seed: number;
  cx: number;
  cz: number;
  /** 本 chunk 生效组（ChunkData.groupKey） */
  groupKey: string;
  /** 15×15 地块 id */
  blockTypes: Uint8Array;
  /** 贴地高度采样（RasterMap.surfaceHeightAt；规划层只认接口） */
  surfaceHeightAt(x: number, z: number): number;
}

/** cell 中心落在哪个地块 */
function tileAtCell(ctx: PropPlanContext, cellX: number, cellY: number): TileDef {
  const wx = ctx.cx * 60 + cellX * PROP_CELL + PROP_CELL / 2;
  const wz = ctx.cz * 60 + cellY * PROP_CELL + PROP_CELL / 2;
  const bx = Math.floor((wx - ctx.cx * 60) / 4);
  const bz = Math.floor((wz - ctx.cz * 60) / 4);
  return tileById(ctx.blockTypes[Math.max(0, Math.min(14, bz)) * 15 + Math.max(0, Math.min(14, bx))]);
}

/** 四点高度极差（坡度判定；角点按 cell 中心 ±1m） */
function slopeOf(ctx: PropPlanContext, x: number, z: number): number {
  const h00 = ctx.surfaceHeightAt(x - 1, z - 1);
  const h10 = ctx.surfaceHeightAt(x + 1, z - 1);
  const h01 = ctx.surfaceHeightAt(x - 1, z + 1);
  const h11 = ctx.surfaceHeightAt(x + 1, z + 1);
  return Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
}

/**
 * ★ 地形生成后散布装饰实体：逐 cell 判定 → 组/地块/角色/坡度过滤 →
 * 加权抽装饰物 → 贴地 + 下沉。确定性：同 seed 同 chunk 必复现。
 */
export function planChunkProps(ctx: PropPlanContext): PlannedProp[] {
  const out: PlannedProp[] = [];
  const defs = propsForGroup(ctx.groupKey);
  if (defs.length === 0) return out;

  // 加权池（主打加成：出现率只看可用池 perCellProb 之和，主打只影响"抽谁"）
  const FEATURED_BOOST = 3;
  const featuredKey = defs[Math.floor(hash2(ctx.cx, ctx.cz, ctx.seed + 9601) * defs.length)].key;
  const weights = new Map<string, number>();
  for (const p of defs) {
    weights.set(p.key, p.placement.perCellProb * (p.key === featuredKey ? FEATURED_BOOST : 1));
  }

  for (let cy = 0; cy < PROP_GRID && out.length < PROP_BUDGET; cy++) {
    for (let cx = 0; cx < PROP_GRID && out.length < PROP_BUDGET; cx++) {
      // ★ 世界格坐标（2026-09-07 用户：晶体分布一点也不随机）——此前全用
      //   chunk 局部格坐标 (cx,cy) 做 hash2 参数，每个 chunk 内部同格序的
      //   判定处处相同 → 全图同一 20 格×3m 排列无限重复。掺入 chunk 世界
      //   坐标后每 chunk 布局独立（同 seed 同 chunk 仍确定性复现）。
      const gxc = ctx.cx * PROP_GRID + cx;
      const gyc = ctx.cz * PROP_GRID + cy;
      const r = hash2(gxc * 7 + 1, gyc * 7 + 2, ctx.seed + 9602);

      // ★ 先按地块角色筛"本格可用池"，再以【可用池】perCellProb 之和做出现判定
      //   （2026-09-14 修正：此前用全量 defs 求和 → 高台格只有晶簇可用时，
      //    出现率被花草的 perCellProb 一起抬高（晶簇高台出现率 ~20 倍）；
      //    逐格可用池后各物出现率 = 各自声明值，回到原比例）
      const tile = tileAtCell(ctx, cx, cy);
      const eligible = defs.filter((p) => {
        if (p.placement.tiles && p.placement.tiles.length > 0 && !p.placement.tiles.includes(tile.key)) return false;
        if (!p.placement.hostRole.includes(tile.genRole as PropHostRole)) return false;
        return true;
      });
      if (eligible.length === 0) continue;
      let presenceProb = 0;
      for (const d of eligible) presenceProb += d.placement.perCellProb;
      if (r >= Math.min(1, presenceProb)) continue;

      const wx = ctx.cx * 60 + (cx + 0.5) * PROP_CELL;
      const wz = ctx.cz * 60 + (cy + 0.5) * PROP_CELL;
      const jx = wx + (hash2(gxc, gyc, ctx.seed + 9603) - 0.5) * PROP_CELL * 0.6;
      const jz = wz + (hash2(gxc, gyc, ctx.seed + 9604) - 0.5) * PROP_CELL * 0.6;

      if (slopeOf(ctx, jx, jz) > PROP_MAX_SLOPE) continue;

       let etotal = 0;
       for (const d of eligible) etotal += weights.get(d.key)!;
       let rr = hash2(gxc, gyc, ctx.seed + 9605) * etotal;
       let pick = eligible[0];
       for (const d of eligible) {
         rr -= weights.get(d.key)!;
         if (rr <= 0) { pick = d; break; }
       }

       const safe = pick.placement.keepClear ?? [];
       let blocked = false;
       for (const z of safe) {
         const dx = jx - z.x, dz = jz - z.z;
         if (dx * dx + dz * dz <= z.r * z.r) { blocked = true; break; }
       }
       if (blocked) continue;

       const [sMin, sMax] = pick.placement.scaleRange;
       // ★ 下沉深度（米）：sinkRange 随机抽取（以中值为基准波动）；否则固定 sinkIntoGround
const sink = pick.placement.sinkRange
          ? pick.placement.sinkRange[0] +
            hash2(gxc, gyc, ctx.seed + 9609) * (pick.placement.sinkRange[1] - pick.placement.sinkRange[0])
          : pick.placement.sinkIntoGround ?? 0;
        out.push({
          propKey: pick.key,
          // ★ 输出转 chunk 本地坐标（渲染层直接挂 chunk group；过滤/坡度/贴地均用世界坐标）
          x: jx - ctx.cx * 60,
          z: jz - ctx.cz * 60,
          y: ctx.surfaceHeightAt(jx, jz) - sink,
         scale: sMin + hash2(gxc, gyc, ctx.seed + 9606) * (sMax - sMin),
         rotY: hash2(gxc, gyc, ctx.seed + 9607) * Math.PI * 2,
         variant: Math.floor(hash2(gxc, gyc, ctx.seed + 9608) * 4),
         sink,
       });
    }
  }
  return out;
}

/**
 * ★ 烘焙阴影体积汇总（预渲染前调用）：按装饰物分组 → 各实例基类统一换算。
 */
export function computePropVolumes(props: PlannedProp[], cx: number, cz: number): PropShadowVolume[] {
  const out: PropShadowVolume[] = [];
  const byDef = groupPropsByKey(props);
  for (const [key, list] of byDef) {
    const def = mapDecorByKey(key);
    if (!def) continue;
    out.push(...def.toShadowVolumes(list, cx, cz));
  }
  return out;
}

/** 按装饰物 key 分组（规划/渲染/物理共用） */
export function groupPropsByKey(props: PlannedProp[]): Map<string, PlannedProp[]> {
  const byDef = new Map<string, PlannedProp[]>();
  for (const p of props) {
    const arr = byDef.get(p.propKey);
    if (arr) arr.push(p);
    else byDef.set(p.propKey, [p]);
  }
  return byDef;
}

// ============================================================
// 渲染适配层（基类实例经渲染器注册表出网格；three 只允许出现在本层）
// ============================================================

export interface PropRenderer {
  /** 构建实例组；无内容时返回 null（调用方跳过） */
  build(def: MapEntityDecorBase, instances: PlannedProp[]): THREE.Object3D | null;
  /** 共享资源回收（geometry/material 的 module 级缓存） */
  dispose?(): void;
}

const RENDERERS = new Map<string, PropRenderer>();

/** ★ 扩展点：注册某渲染方式（'instanced' 等）的实现 */
export function registerPropRenderer(type: string, renderer: PropRenderer): void {
  RENDERERS.set(type, renderer);
}

/**
 * ★ 渲染入口（ChunkManager.finishStandardChunk 调用）：
 * 按实例分组 → 交给对应渲染器 → 挂进 chunk group。
 */
export function buildPropLayer(instances: PlannedProp[]): THREE.Object3D | null {
  if (instances.length === 0) return null;
  const group = new THREE.Group();
  for (const [key, list] of groupPropsByKey(instances)) {
    const def = mapDecorByKey(key);
    if (!def) continue;
    const renderer = RENDERERS.get(def.render);
    if (renderer) {
      const obj = renderer.build(def, list);
      if (obj) group.add(obj);
    }
  }
  return group.children.length > 0 ? group : null;
}

// ============================================================
// 内置 'instanced' 渲染器（占位实现：程序化岩石）
// ============================================================
// 共享几何/材质（module 级缓存，chunk 销毁只丢实例矩阵）；
// 阴影不在此画——装饰物影子已在烘焙时印进光照图（勿重复压暗）。

const SHARED_GEO = new Map<string, THREE.BufferGeometry>();
const SHARED_MAT = new Map<string, THREE.MeshStandardMaterial>();

/** 确定性顶点噪声位移（同参数恒同几何——跨 chunk 共享才安全） */
function rockVertexNoise(i: number): number {
  let h = (Math.imul(i, 374761393) + 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** ★ 晶簇每变体确定性 RNG 流（mulberry32；变体种子不同 → 簇形/朝向各异，
 *   同变体同种子 → chunk 重建几何完全一致，可缓存共享） */
function crystalRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 多边形棱环（cornerR[k] = 逐角半径；spin 绕 +Y 旋）→ [x,y,z]×sides */
function ringPoints(sides: number, y: number, cornerR: number[], spin: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2 + spin;
    out.push(Math.cos(a) * cornerR[k], y, Math.sin(a) * cornerR[k]);
  }
  return out;
}

/**
 * 梯形台座几何（平截四棱台 + 顶面下沉槽）。
 * 底 = baseHalf 正方形，顶 = topHalf 正方形（侧视梯形）；顶面中间挖一块
 * 矩形下沉槽（slotDepth 深度，槽沿保留梯形顶面外沿 → 下沉后仍保持平面）。
 * 顶点/索引手工构造（无噪声，轮廓硬朗）。
 */
export function buildTrapezoidPlinth(params: Record<string, number>): THREE.BufferGeometry {
  const baseHalf = params.baseHalf ?? 1.0;
  const topHalf = params.topHalf ?? 0.62;
  const height = params.height ?? 0.55;
  const slotDepth = params.slotDepth ?? 0.16;
  const slotHalf = params.slotHalf ?? 0.28; // 下沉槽半宽（占顶面中线）

  const b0 = [-baseHalf, 0, -baseHalf];
  const b1 = [baseHalf, 0, -baseHalf];
  const b2 = [baseHalf, 0, baseHalf];
  const b3 = [-baseHalf, 0, baseHalf];
  const t0 = [-topHalf, height, -topHalf];
  const t1 = [topHalf, height, -topHalf];
  const t2 = [topHalf, height, topHalf];
  const t3 = [-topHalf, height, topHalf];
  const s0 = [-slotHalf, height, -slotHalf];
  const s1 = [slotHalf, height, -slotHalf];
  const s2 = [slotHalf, height, slotHalf];
  const s3 = [-slotHalf, height, slotHalf];
  const d0 = [-slotHalf, height - slotDepth, -slotHalf];
  const d1 = [slotHalf, height - slotDepth, -slotHalf];
  const d2 = [slotHalf, height - slotDepth, slotHalf];
  const d3 = [-slotHalf, height - slotDepth, slotHalf];

  const V: number[] = [];
  const push = (p: number[]) => V.push(p[0], p[1], p[2]);
  const I: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => I.push(a, b, c, a, c, d);

  const vi = [b0, b1, b2, b3, t0, t1, t2, t3, s0, s1, s2, s3, d0, d1, d2, d3];
  for (const p of vi) push(p);

  quad(0, 1, 2, 3);       // 底面（法线 -Y：b0→b2→b3 从下看逆时针）
  quad(4, 5, 1, 0);       // 前斜面（法线 -Z）
  quad(6, 7, 3, 2);       // 后斜面（法线 +Z）
  quad(5, 6, 2, 1);       // 右斜面（法线 +X）
  quad(7, 4, 0, 3);       // 左斜面（法线 -X）
  quad(8, 9, 5, 4);       // 顶前沿（法线 +Y，俯视可见封顶）
  quad(9, 10, 6, 5);      // 顶右沿（法线 +Y）
  quad(10, 11, 7, 6);     // 顶后沿（法线 +Y）
  quad(11, 8, 4, 7);      // 顶左沿（法线 +Y）
  quad(13, 12, 15, 14);   // 槽底（法线 +Y）
  quad(12, 13, 9, 8);      // 槽前壁（法线 +Z 朝槽内：d0,d1,s1,s0）
  quad(13, 14, 10, 9);     // 槽右壁（法线 -X 朝槽内：d1,d2,s2,s1）
  quad(14, 15, 11, 10);    // 槽后壁（法线 -Z 朝槽内：d2,d3,s3,s2）
  quad(15, 12, 8, 11);     // 槽左壁（法线 +X 朝槽内：d3,d0,s0,s3）

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  geo.setIndex(I);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 能量耗尽原石晶体簇几何（向上水晶柱群 + 低矮底座盘）。
 * 簇内高矮混排：中央高塔（~3.6m）+ 环状中柱（2~3m）+ 矮柱（0.5~1.5m）
 * + 地面碎晶（~0.2m）——"很多向上的柱体，有的很高，有的很矮"。
 * 每柱 = 六棱锥（六槽底环 → 单尖顶，晶面色/棱半径带指针噪声 → 天然晶体歪尖）；
 * 底座 = 六边低矮扁盘（顶面扇 + 侧壁）接地，柱从盘顶生长。
 * 非索引三角形（每面独立顶点 → computeVertexNormals 逐面平整 + flatShading 硬棱）。
 */
/**
 * ★ 能量耗尽原石晶体簇（多变体程序化生成，2026-09-06 用户要求重做：
 *   "都是竖直向上、形状相同"→ 要更复杂的几何 + 朝向变化）。
 * 方案（综合业内程序化晶簇做法——hexagonal prism + tapered shaft +
 * off-axis 尖端、imaginu 式"中心主晶 + 环状外张倾斜晶"）：
 *   · 4 个变体（variant 0~3）各自确定性地生成不同簇形；
 *   · 每簇 = 主峰 + 环状中晶 + 细针 + 地面碎屑；截面 5/6/8 边混排；
 *   · 每根晶柱：底座环 → (可选)腰肩环 → 顶肩环 → 尖端，两段收尖；
 *     尖端沿晶柱朝向方向偏斜（off-axis termination）+ 抬升（歪尖手感）；
 *   · 朝向变化：每根晶柱绕 Y 随机 spin + 沿自身方位朝外倾斜（splay）——
 *     中晶/细针明显外张、主峰轻微；底座环埋进底盘 + 底端封盖（密封倾斜
 *     柱的底口，且环先旋 spin 再倾斜再平移，棱边全程直线）。
 * 非索引三角形（每面独立顶点 → computeVertexNormals 逐面平整 + flatShading 硬棱）。
 */
export function buildCrystalCluster(params: Record<string, number>, variant: number): THREE.BufferGeometry {
  const noise = params.noise ?? 0.12;
  const rng = crystalRng(variant * 97 + 0x9e3779b9);
  const BR = 1.15;              // 底座半径
  const BRH = 0.12;             // 底座高（晶柱底基准面，坐盘顶）
  const BRING = 6;              // 底座边数
  const V: number[] = [];
  const emit = (a: number, b: number, c: number) => V.push(a, b, c);

  // ---- 变换工具：spin(y) → lean(朝 out 方向倾斜) → 平移 (px, BRH, pz) ----
  const _v = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _out = new THREE.Vector3();
  const _axis = new THREE.Vector3();
  const _off = new THREE.Vector3();
  const _rot = new THREE.Quaternion();
  const _qy = new THREE.Quaternion();
  const _ql = new THREE.Quaternion();
  const tr = (x: number, y: number, z: number): void => {
    _v.set(x, y, z).applyQuaternion(_rot).add(_off);
    emit(_v.x, _v.y, _v.z);
  };

  /**
   * 建一根晶柱（局部坐标构建后整体旋/倾/移）。
   * @param crad 逐角半径（棱边噪声；同 k 各环同值 → 棱直）
   * @param h 肩高；topFrac 肩环半径比例；waist 腰高份数（null=无腰）
   * @param apexOff 尖端偏斜量（×r，向 tiltDir 方向）；apexFrac 尖端高出肩的比例
   */
  const column = (
    sides: number, px: number, pz: number,
    tiltDir: number, lean: number, spin: number,
    crad: number[], h: number, topFrac: number,
    waist: number | null, apexOff: number, apexFrac: number,
  ): void => {
    _qy.setFromAxisAngle(_up, spin);
    _out.set(Math.cos(tiltDir), 0, Math.sin(tiltDir));
    _axis.crossVectors(_up, _out).normalize();
    _ql.setFromAxisAngle(_axis, lean);          // 向 +out 倾斜
    _rot.multiplyQuaternions(_ql, _qy);
    _off.set(px, BRH, pz);

    const rnf = (f: number) => crad.map((r) => r * f);
    const R0 = ringPoints(sides, 0, crad, 0);                       // 底座环
    const R2 = ringPoints(sides, h, rnf(topFrac), 0);               // 顶肩环
    // 腰肩环（topFrac 与 1 之间偏收腰 → 两段收尖）
    const R1 = waist ? ringPoints(sides, h * waist, rnf(topFrac + (1 - topFrac) * 0.45), 0) : null;
    const yA = h * (1 + apexFrac);
    const ax = Math.cos(tiltDir) * apexOff, az = Math.sin(tiltDir) * apexOff;

    // 底端封盖（中心尖略微下沉；密封倾斜柱底口）
    const yF = -0.03;
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      tr(0, yF, 0);
      tr(R0[k1 * 3], R0[k1 * 3 + 1], R0[k1 * 3 + 2]);
      tr(R0[k * 3], R0[k * 3 + 1], R0[k * 3 + 2]);
    }
    // 侧壁（下环→上环 的四边形；绕向沿用台座已验证朝外序）
    const lateral = (A: number[], B: number[]): void => {
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        tr(A[k * 3], A[k * 3 + 1], A[k * 3 + 2]);
        tr(B[k * 3], B[k * 3 + 1], B[k * 3 + 2]);
        tr(B[k1 * 3], B[k1 * 3 + 1], B[k1 * 3 + 2]);
        tr(A[k * 3], A[k * 3 + 1], A[k * 3 + 2]);
        tr(B[k1 * 3], B[k1 * 3 + 1], B[k1 * 3 + 2]);
        tr(A[k1 * 3], A[k1 * 3 + 1], A[k1 * 3 + 2]);
      }
    };
    if (R1) { lateral(R0, R1); lateral(R1, R2); } else { lateral(R0, R2); }
    // 尖端（R2[k1] R2[k] A → 朝外；沿用原晶柱已验证序）
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      tr(R2[k1 * 3], R2[k1 * 3 + 1], R2[k1 * 3 + 2]);
      tr(R2[k * 3], R2[k * 3 + 1], R2[k * 3 + 2]);
      tr(ax, yA, az);
    }
  };

  // ---- 底座（6 边扁盘：顶面扇 + 侧壁；角半径微抖保持变体差异） ----
  const topR: number[] = [];
  const botR: number[] = [];
  for (let k = 0; k < BRING; k++) {
    const a = (k / BRING) * Math.PI * 2;
    const rr = BR * (1 + (rng() - 0.5) * noise);
    topR.push(Math.cos(a) * rr, BRH, Math.sin(a) * rr);
    botR.push(Math.cos(a) * rr * 0.98, -0.03, Math.sin(a) * rr * 0.98);
  }
  for (let k = 0; k < BRING; k++) {
    const k1 = (k + 1) % BRING;
    emit(0, BRH, 0);
    emit(topR[k1 * 3], topR[k1 * 3 + 1], topR[k1 * 3 + 2]);
    emit(topR[k * 3], topR[k * 3 + 1], topR[k * 3 + 2]);
    emit(botR[k * 3], botR[k * 3 + 1], botR[k * 3 + 2]);
    emit(topR[k * 3], topR[k * 3 + 1], topR[k * 3 + 2]);
    emit(topR[k1 * 3], topR[k1 * 3 + 1], topR[k1 * 3 + 2]);
    emit(botR[k * 3], botR[k * 3 + 1], botR[k * 3 + 2]);
    emit(topR[k1 * 3], topR[k1 * 3 + 1], topR[k1 * 3 + 2]);
    emit(botR[k1 * 3], botR[k1 * 3 + 1], botR[k1 * 3 + 2]);
  }

  // ---- 晶簇体（主峰 + 环晶 + 细针 + 碎屑；全部确定性随机） ----
  const jit = (r: number, k: number) => r * (1 + (rng() - 0.5) * noise * 1.6);

  // 主峰（1~2 根：中央高塔 + 偶发第二峰）
  const nBig = 1 + (rng() < 0.45 ? 1 : 0);
  for (let i = 0; i < nBig; i++) {
    const big = i === 0;
    const sides = big ? 6 : (rng() < 0.5 ? 6 : 8);
    const r = BR * (0.16 + rng() * 0.035) * (big ? 1 : 0.8);
    const h = (big ? 3.1 : 2.2) + rng() * 0.7;
    const crad: number[] = [];
    for (let k = 0; k < sides; k++) crad.push(jit(r, k));
    column(
      sides,
      big ? (rng() - 0.5) * 0.16 : (rng() - 0.5) * 0.6,
      big ? (rng() - 0.5) * 0.16 : (rng() - 0.5) * 0.6,
      rng() * Math.PI * 2,           // 微倾方位
      big ? 0.05 + rng() * 0.09 : 0.10 + rng() * 0.14,   // 主峰近直立、第二峰微倾
      rng() * Math.PI * 2,
      crad, h, 0.18 + rng() * 0.12,
      0.5 + rng() * 0.3, r * (0.15 + rng() * 0.5), 0.12 + rng() * 0.12,
    );
  }

  // 环状中晶（4~7 根；沿方位外张倾斜——"朝向有变化"主来源）
  const nRing = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < nRing; i++) {
    const a = (i / nRing) * Math.PI * 2 + rng() * 0.5;
    const rad = 0.45 + rng() * 0.5;                       // 离中心距离
    const r = 0.09 + rng() * 0.06;
    const sides = rng() < 0.5 ? 6 : (rng() < 0.5 ? 5 : 8);
    const h = 0.9 + rng() * 1.5;
    const crad: number[] = [];
    for (let k = 0; k < sides; k++) crad.push(jit(r, k));
    column(
      sides, Math.cos(a) * rad, Math.sin(a) * rad,
      a + (rng() - 0.5) * 0.5,       // 朝外倾斜方位（≈自身方位）
      0.12 + rng() * 0.28,           // 外张 7°~23°
      rng() * Math.PI * 2,
      crad, h, 0.2 + rng() * 0.2,
      rng() < 0.25 ? null : 0.5 + rng() * 0.35,
      r * (0.1 + rng() * 0.5), 0.1 + rng() * 0.14,
    );
  }

  // 细长针晶（3~6 根；大倾角斜插）
  const nNeedle = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < nNeedle; i++) {
    const a = rng() * Math.PI * 2;
    const rad = 0.5 + rng() * 0.45;
    const r = 0.04 + rng() * 0.035;
    const sides = rng() < 0.5 ? 5 : 6;
    const h = 1.2 + rng() * 1.1;
    const crad: number[] = [];
    for (let k = 0; k < sides; k++) crad.push(jit(r, k));
    column(
      sides, Math.cos(a) * rad, Math.sin(a) * rad,
      a + (rng() - 0.5) * 0.4,
      0.35 + rng() * 0.4,            // 20°~43° 大倾角
      rng() * Math.PI * 2,
      crad, h, 0.15 + rng() * 0.15,
      null, r * (0.05 + rng() * 0.35), 0.08 + rng() * 0.1,
    );
  }

  // 地面碎屑（4~6 片矮小歪晶）
  const nChip = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < nChip; i++) {
    const a = rng() * Math.PI * 2;
    const rad = rng() * 0.95;
    const r = 0.05 + rng() * 0.05;
    const sides = 5 + (rng() < 0.5 ? 0 : 1);
    const h = 0.15 + rng() * 0.25;
    const crad: number[] = [];
    for (let k = 0; k < sides; k++) crad.push(jit(r, k));
    column(
      sides, Math.cos(a) * rad, Math.sin(a) * rad,
      a + (rng() - 0.5) * 0.6,
      0.05 + rng() * 0.18,
      rng() * Math.PI * 2,
      crad, h, 0.45 + rng() * 0.3,
      null, r * (0.05 + rng() * 0.3), 0.08 + rng() * 0.1,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================
// ★ 采集物植被几何（2026-09-14 新增）：草丛 / 花丛 / 浆果丛 / 小树
//   程序化低多边形 + 逐顶点色（材质 vertexColors + DoubleSide；薄叶双面可见）；
//   每变体一套形态（crystalRng 确定性）；无 physics（纯视觉 + JS 查询采集）。
// ============================================================

const PLANT_STEM: [number, number, number] = [0.30, 0.48, 0.22];
const PLANT_STEM_DARK: [number, number, number] = [0.21, 0.35, 0.15];
const PLANT_TRUNK: [number, number, number] = [0.42, 0.29, 0.18];
const PLANT_LEAF: [number, number, number] = [0.24, 0.45, 0.20];

/** 0xRRGGBB → 0..1 顶点色 */
function rgbOf(hex: number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/** 非索引三角形 + 逐顶点色 累积器（computeVertexNormals 出硬棱） */
function plantBuilder() {
  const V: number[] = [];
  const C: number[] = [];
  type V3 = [number, number, number];
  const tri = (a: V3, b: V3, c: V3, ca: V3, cb: V3 = ca, cc: V3 = ca): void => {
    V.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    C.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  };
  /** 八面体（叶团/浆果用；squash 压扁） */
  const octa = (cx: number, cy: number, cz: number, r: number, squash: number, col: V3, jitter: number, rng: () => number): void => {
    const ys = r * squash;
    const e: V3[] = [
      [cx + r, cy, cz], [cx, cy, cz + r], [cx - r, cy, cz], [cx, cy, cz - r],
    ];
    const top: V3 = [cx, cy + ys, cz];
    const bot: V3 = [cx, cy - ys, cz];
    for (let k = 0; k < 4; k++) {
      const f = 1 + (rng() - 0.5) * jitter;
      const c: V3 = [Math.min(1, col[0] * f), Math.min(1, col[1] * f), Math.min(1, col[2] * f)];
      tri(top, e[k], e[(k + 1) % 4], c);
      tri(bot, e[(k + 1) % 4], e[k], c);
    }
  };
  const geo = (): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };
  return { tri, octa, geo };
}

/** 一撮放射状叶片（草/花茎共用；lean = 外倾量） */
function emitTuft(
  tri: ReturnType<typeof plantBuilder>['tri'],
  rng: () => number,
  blades: number, hMin: number, hMax: number, lean: number,
  col: [number, number, number],
): void {
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rng() * 0.7;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz, pz = dx;
    const h = hMin + rng() * (hMax - hMin);
    const w = 0.042 + rng() * 0.03;
    const out = lean * (0.6 + rng() * 0.9);
    const f = 0.85 + rng() * 0.3;
    const c: [number, number, number] = [col[0] * f, col[1] * f, col[2] * f];
    const tipC: [number, number, number] = [Math.min(1, c[0] * 1.2 + 0.04), Math.min(1, c[1] * 1.2 + 0.04), Math.min(1, c[2] * 1.15)];
    const baseL: [number, number, number] = [px * w, 0, pz * w];
    const baseR: [number, number, number] = [-px * w, 0, -pz * w];
    const mid: [number, number, number] = [dx * out * 0.35, h * 0.55, dz * out * 0.35];
    const tip: [number, number, number] = [dx * out, h, dz * out];
    tri(baseL, baseR, mid, PLANT_STEM_DARK, PLANT_STEM_DARK, c);
    tri(baseL, mid, tip, PLANT_STEM_DARK, c, tipC);
    tri(baseR, tip, mid, PLANT_STEM_DARK, tipC, c);
  }
}

/** 草丛：7~10 片细叶，中心略高外圈外倾 */
function buildGrassTuft(_params: Record<string, number>, variant: number): THREE.BufferGeometry {
  const rng = crystalRng(variant * 131 + 23);
  const b = plantBuilder();
  emitTuft(b.tri, rng, 7 + Math.floor(rng() * 4), 0.45, 0.95, 0.22, PLANT_STEM);
  return b.geo();
}

/** 花丛：绿茎 + 数朵菱形十字花（花瓣色取 params.color2，缺省品红） */
function buildFlowerCluster(params: Record<string, number>, variant: number): THREE.BufferGeometry {
  const rng = crystalRng(variant * 137 + 41);
  const b = plantBuilder();
  emitTuft(b.tri, rng, 5 + Math.floor(rng() * 3), 0.30, 0.58, 0.15, PLANT_STEM);
  const petal = params.color2 !== undefined ? rgbOf(params.color2) : ([0.86, 0.45, 0.62] as [number, number, number]);
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const rad = 0.05 + rng() * 0.14;
    const h = 0.34 + rng() * 0.3;
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
    const s = 0.065 + rng() * 0.05;
    const top: [number, number, number] = [cx, h + s * 0.8, cz];
    const bot: [number, number, number] = [cx, h - s * 0.8, cz];
    const le: [number, number, number] = [cx - s, h, cz];
    const ri: [number, number, number] = [cx + s, h, cz];
    const f = 0.9 + rng() * 0.25;
    const pc: [number, number, number] = [Math.min(1, petal[0] * f), Math.min(1, petal[1] * f), Math.min(1, petal[2] * f)];
    b.tri(top, le, bot, pc);
    b.tri(top, bot, ri, pc);
    b.tri(top, ri, le, pc); // 背面补一片，任意角度有色
  }
  return b.geo();
}

/** 浆果丛：3 团压扁八面体叶团 + 6~9 颗浆果（浆果色取 params.color2，缺省红） */
function buildBerryBush(params: Record<string, number>, variant: number): THREE.BufferGeometry {
  const rng = crystalRng(variant * 139 + 59);
  const b = plantBuilder();
  b.octa(0, 0.44, 0, 0.52, 0.72, PLANT_LEAF, 0.35, rng);
  b.octa(0.30, 0.34, 0.20, 0.34, 0.78, PLANT_LEAF, 0.35, rng);
  b.octa(-0.28, 0.37, -0.22, 0.32, 0.75, PLANT_LEAF, 0.35, rng);
  const berry = params.color2 !== undefined ? rgbOf(params.color2) : ([0.78, 0.16, 0.18] as [number, number, number]);
  const n = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const rr = 0.25 + rng() * 0.35;
    const br = 0.05 + rng() * 0.03;
    b.octa(Math.cos(a) * rr, 0.34 + rng() * 0.42, Math.sin(a) * rr, br, 1.0, berry, 0.25, rng);
  }
  return b.geo();
}

/** 小树：六边锥台树干 + 3 层锥形树冠（低多边形） */
function buildYoungTree(_params: Record<string, number>, variant: number): THREE.BufferGeometry {
  const rng = crystalRng(variant * 149 + 73);
  const b = plantBuilder();
  const trunkH = 1.5 + rng() * 0.5;
  const sides = 6;
  const r0 = 0.15 + rng() * 0.03;
  const r1 = 0.085;
  const ring = (y: number, r: number): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + rng() * 0.12;
      out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return out;
  };
  const bot = ring(0, r0);
  const top = ring(trunkH, r1);
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    const f = 0.9 + rng() * 0.2;
    const c: [number, number, number] = [PLANT_TRUNK[0] * f, PLANT_TRUNK[1] * f, PLANT_TRUNK[2] * f];
    b.tri(bot[k], top[k1], top[k], c);
    b.tri(bot[k], bot[k1], top[k1], c);
  }
  // 树冠：三层锥（底环 → 尖顶）
  const cones: { y: number; r: number; h: number }[] = [
    { y: trunkH - 0.25, r: 0.95, h: 1.05 },
    { y: trunkH + 0.45, r: 0.78, h: 0.95 },
    { y: trunkH + 1.05, r: 0.55, h: 0.85 },
  ];
  for (const cone of cones) {
    const cs = 8;
    const base: [number, number, number][] = [];
    for (let k = 0; k < cs; k++) {
      const a = (k / cs) * Math.PI * 2 + rng() * 0.2;
      base.push([Math.cos(a) * cone.r, cone.y, Math.sin(a) * cone.r]);
    }
    const apex: [number, number, number] = [(rng() - 0.5) * 0.1, cone.y + cone.h, (rng() - 0.5) * 0.1];
    for (let k = 0; k < cs; k++) {
      const k1 = (k + 1) % cs;
      const f = 0.85 + rng() * 0.3;
      const c: [number, number, number] = [PLANT_LEAF[0] * f, PLANT_LEAF[1] * f, PLANT_LEAF[2] * f];
      b.tri(base[k], base[k1], apex, c);
    }
  }
  return b.geo();
}

/**
 * 共享几何工厂：按 geometry.type 分发——
 * 'rock'：细分 icosahedron + 顶点噪声 + 压扁（通用）
 * 'block'：立方体 + 顶点噪声 + 压扁（★ 极简几何风格，Boss 战四维空间用）
 * 'trapezoid'：平截四棱台（底大方、顶小方 ÷ 梯台）+ 顶面下沉槽
 * 'crystal'：能量耗尽原石晶体簇（多变体：主峰+环晶+细针+碎屑，倾斜+歪尖）
 * 'grass' / 'flower' / 'bush' / 'tree'：采集物植被（顶点色 + 双面；每变体一套形态）
 *（《水泥高台上的装饰性实体.json》：侧面梯形 + 顶面一块向下凹且保持平面）
 */
function buildSharedGeometry(type: string | undefined, params: Record<string, number>, variant: number): THREE.BufferGeometry {
  const noise = params.noise ?? 0.35;
  if (type === 'trapezoid') {
    return buildTrapezoidPlinth(params);
  }
  if (type === 'crystal') {
    return buildCrystalCluster(params, variant);
  }
  if (type === 'grass') {
    return buildGrassTuft(params, variant);
  }
  if (type === 'flower') {
    return buildFlowerCluster(params, variant);
  }
  if (type === 'bush') {
    return buildBerryBush(params, variant);
  }
  if (type === 'tree') {
    return buildYoungTree(params, variant);
  }
  if (type === 'block') {
    const geo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = rockVertexNoise(i * 7 + 3);
      const s = 1 + (n - 0.5) * noise * 0.6;
      pos.setXYZ(i, x * s, y * s * (0.7 + 0.3 * n), z * s);
    }
    geo.computeVertexNormals();
    return geo;
  }
  // rock（默认）
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = rockVertexNoise(i * 7 + 3);
    const squash = 0.72 + 0.15 * n;                  // 底部压扁（半球感）
    const s = 1 + (n - 0.5) * noise;
    pos.setXYZ(i, x * s, y * s * squash, z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

/** instanced 装饰变体数（每变体一套确定性簇形） */
const INST_VARIANT_COUNT = 4;

function getSharedRock(key: string, type: string | undefined, params: Record<string, number>, variant: number): { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } {
  // ★ 变体分桶：几何按 `${type}|v${variant}`（每变体一套簇形），材质按 prop key 共享
  const geoKey = `${type ?? ''}|v${variant}`;
  let geo = SHARED_GEO.get(geoKey);
  if (!geo) {
    geo = buildSharedGeometry(type, params, variant);
    // ★ 标记共享：ChunkManager.disposeVisual 不得释放（否则每次重建 chunk 都把
    //   全地图共用的几何/材质 dispose 掉再重传，造成持续抖动与 churn）
    geo.userData.decorShared = true;
    SHARED_GEO.set(geoKey, geo);
  }
  let mat = SHARED_MAT.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(params.color ?? 0x8a7f74),
      roughness: 0.95, metalness: 0, flatShading: true,
      // ★ 植被等程序化几何用逐顶点色；薄叶双面可见（params 显式开启）
      vertexColors: params.vertexColors === 1,
      side: params.doubleSide === 1 ? THREE.DoubleSide : THREE.FrontSide,
    });
    mat.userData.decorShared = true;
    SHARED_MAT.set(key, mat);
  }
  return { geo, mat };
}

/** 注册内置 instanced 渲染器（几何按 geometry.type × variant 分发；后续几何类型在此扩展） */
registerPropRenderer('instanced', {
  build(def: MapEntityDecorBase, instances: PlannedProp[]): THREE.Object3D | null {
    const params = def.geometry?.params ?? {};
    const type = def.geometry?.type ?? '';
    const matKey = `${def.key}|${type}`;
    // ★ 按 variant 分桶成多个 InstancedMesh（每组占用自己的一套簇形几何）；
    //   变体数可由声明收窄（花草 1~2 → 减少 draw call）
    const VC = Math.max(1, def.variantCount ?? INST_VARIANT_COUNT);
    const counts = new Map<number, number>();
    for (const p of instances) {
      const v = p.variant % VC;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const vp = new THREE.Vector3();
    const s = new THREE.Vector3();
    const group = new THREE.Group();
    group.name = `props:${def.key}`;
    for (const [variant, n] of counts) {
      const { geo, mat } = getSharedRock(matKey, type, params, variant);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = `${def.key}|v${variant}`;
      let idx = 0;
      for (const p of instances) {
        if (p.variant % VC !== variant) continue;
        e.set(0, p.rotY, 0);
        q.setFromEuler(e);
        vp.set(p.x, p.y, p.z);
        const yScale = 0.85 + 0.15 * ((p.variant % VC) / VC);
        s.set(p.scale, p.scale * yScale, p.scale);
        m.compose(vp, q, s);
        mesh.setMatrixAt(idx++, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      // ★ 实例化包围球：默认只按基几何算 → 实例远离原点会被错误视锥剔除（花草/晶体边缘消失）
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    return group;
  },
  dispose(): void {
    // ★ 仅此处（模式退出）释放共享几何/材质；chunk 重建不得释放
    for (const geo of SHARED_GEO.values()) geo.dispose();
    for (const mat of SHARED_MAT.values()) mat.dispose();
    SHARED_GEO.clear();
    SHARED_MAT.clear();
  },
});

/** 模式退出时释放所有装饰渲染器的共享资源（仅调用一次） */
export function disposePropRenderers(): void {
  for (const r of RENDERERS.values()) r.dispose?.();
}

// ============================================================
// 宿主接口（模式层适配：EntityManager → rapier；本层不碰 entity）
// ============================================================

/**
 * 地面/装饰物刚体宿主接口。
 * chunk 的碰撞体必须进实体/物理体系（碰撞分发按 userData=id 找实体），
 * 由模式层注入两个回调即可。
 */
export interface ChunkGroundHost {
  /** 为 chunk 创建 fixed trimesh 地面刚体，返回可销毁的 id */
  createGround(cx: number, cz: number, vertices: Float32Array, indices: Uint32Array): number;
  destroyGround(id: number): void;
  /** 为装饰实体创建 fixed cuboid 碰撞体（世界坐标；返回可销毁的 id，null=不支持） */
  createPropBody?(x: number, y: number, z: number, r: number, h: number): number | null;
  /** ★ 分区地面：每 chunk 一个刚体 + grid×grid 个 trimesh 分区 collider（全部同步建） */
  createGroundCells?(cx: number, cz: number, cells: GroundCellGeom[]): number | null;
  /** ★ 挖坑增量：只原位换受影响分区的 collider（O(受影响分区)，不重建整 chunk） */
  updateGroundCell?(id: number, slot: number, vertices: Float32Array, indices: Uint32Array): void;
  /** ★ 停用/恢复刚体（远处 chunk 封存：停用 = 不参与模拟、保留句柄；回程瞬间恢复） */
  setBodyEnabled?(id: number, enabled: boolean): void;
}

/** ★ 地面分区 trimesh（slot = pcz*grid+pcx；每分区含若干 4m 块） */
export interface GroundCellGeom {
  slot: number;
  vertices: Float32Array;
  indices: Uint32Array;
}