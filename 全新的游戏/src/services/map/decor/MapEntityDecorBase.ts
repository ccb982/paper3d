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

  constructor(cfg: MapEntityDecorConfig) {
    this.key = cfg.key;
    this.label = cfg.label;
    this.groups = cfg.groups;
    this.placement = cfg.placement;
    this.render = cfg.render;
    this.shadow = cfg.shadow;
    this.physics = cfg.physics;
    this.geometry = cfg.geometry;
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
// 占位内容（基石组；后续替换/扩充——注册实例即可）
// ============================================================

registerMapDecor(new MapEntityDecorBase({
  key: 'foundation_pebble', label: '占位·碎石', groups: [FOUNDATION_PROP_GROUP],
  placement: {
    hostRole: ['ground', 'platform'], perCellProb: 0.09,
    scaleRange: [0.6, 1.5], sinkIntoGround: 0.08,
  },
  render: 'instanced', shadow: 'disc',
  physics: { type: 'cuboid', radius: 0.7, height: 1.2 },
  geometry: { type: 'rock', params: { radius: 0.7, height: 1.2, noise: 0.35, color: 0x8a7f74 } },
}));

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
  /** 调试钩子：每阶段过滤计数（?dbgdecor=1 时由 ChunkManager 传入打日志） */
  debug?: (stage: string, pass: number, total: number) => void;
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
  ctx.debug?.('候选装饰物表', defs.length, defs.length);
  if (defs.length === 0) return out;

  // 加权池（主打加成：出现率只看 perCellProb 总和，主打只影响"抽谁"）
  const FEATURED_BOOST = 3;
  const featuredKey = defs[Math.floor(hash2(ctx.cx, ctx.cz, ctx.seed + 9601) * defs.length)].key;
  let presenceProb = 0;
  const weights = new Map<string, number>();
  for (const p of defs) {
    presenceProb += p.placement.perCellProb;
    weights.set(p.key, p.placement.perCellProb * (p.key === featuredKey ? FEATURED_BOOST : 1));
  }
  presenceProb = Math.min(1, presenceProb);
  let total = 0;
  for (const w of weights.values()) total += w;
  ctx.debug?.('presence概率', presenceProb, 1);

  let nPresence = 0, nSlope = 0, nTile = 0, nKeepClear = 0;
  for (let cy = 0; cy < PROP_GRID && out.length < PROP_BUDGET; cy++) {
    for (let cx = 0; cx < PROP_GRID && out.length < PROP_BUDGET; cx++) {
      const r = hash2(cx * 7 + 1, cy * 7 + 2, ctx.seed + 9602);
      if (r >= presenceProb) continue;
      nPresence++;

      const wx = ctx.cx * 60 + (cx + 0.5) * PROP_CELL;
      const wz = ctx.cz * 60 + (cy + 0.5) * PROP_CELL;
      const jx = wx + (hash2(cx, cy, ctx.seed + 9603) - 0.5) * PROP_CELL * 0.6;
      const jz = wz + (hash2(cx, cy, ctx.seed + 9604) - 0.5) * PROP_CELL * 0.6;

      if (slopeOf(ctx, jx, jz) > PROP_MAX_SLOPE) continue;
      nSlope++;

      const tile = tileAtCell(ctx, cx, cy);
      const host = defs.find((p) => {
        if (p.placement.tiles && p.placement.tiles.length > 0 && !p.placement.tiles.includes(tile.key)) return false;
        if (!p.placement.hostRole.includes(tile.genRole as PropHostRole)) return false;
        return true;
      });
      if (!host) continue;
      nTile++;

      const safe = host.placement.keepClear ?? [];
      let blocked = false;
      for (const z of safe) {
        const dx = jx - z.x, dz = jz - z.z;
        if (dx * dx + dz * dz <= z.r * z.r) { blocked = true; break; }
      }
      if (blocked) continue;
      nKeepClear++;

      let rr = hash2(cx, cy, ctx.seed + 9605) * total;
      let pick = defs[0];
      for (const p of defs) {
        rr -= weights.get(p.key)!;
        if (rr <= 0) { pick = p; break; }
      }
      const [sMin, sMax] = pick.placement.scaleRange;
      out.push({
        propKey: pick.key,
        // ★ 输出转 chunk 本地坐标（渲染层直接挂 chunk group；过滤/坡度/贴地均用世界坐标）
        x: jx - ctx.cx * 60,
        z: jz - ctx.cz * 60,
        y: ctx.surfaceHeightAt(jx, jz) - (pick.placement.sinkIntoGround ?? 0),
        scale: sMin + hash2(cx, cy, ctx.seed + 9606) * (sMax - sMin),
        rotY: hash2(cx, cy, ctx.seed + 9607) * Math.PI * 2,
        variant: Math.floor(hash2(cx, cy, ctx.seed + 9608) * 4),
      });
    }
  }
  ctx.debug?.('presence通过', nPresence, PROP_GRID * PROP_GRID);
  ctx.debug?.('坡度通过', nSlope, nPresence);
  ctx.debug?.('地块通过', nTile, nSlope);
  ctx.debug?.('keepClear通过', nKeepClear, nTile);
  ctx.debug?.('最终抽取', out.length, nKeepClear);
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

const SHARED = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }>();

/** 确定性顶点噪声位移（同参数恒同几何——跨 chunk 共享才安全） */
function rockVertexNoise(i: number): number {
  let h = (Math.imul(i, 374761393) + 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function getSharedRock(key: string, params: Record<string, number>): { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } {
  let entry = SHARED.get(key);
  if (entry) return entry;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = rockVertexNoise(i * 7 + 3);
    const squash = 0.72 + 0.15 * n;                  // 底部压扁（半球感）
    const s = 1 + (n - 0.5) * (params.noise ?? 0.35);
    pos.setXYZ(i, x * s, y * s * squash, z * s);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(params.color ?? 0x8a7f74),
    roughness: 0.95, metalness: 0, flatShading: true,
  });
  entry = { geo, mat };
  SHARED.set(key, entry);
  return entry;
}

/** 注册内置 instanced 渲染器（岩石几何；后续几何类型在此扩展） */
registerPropRenderer('instanced', {
  build(def: MapEntityDecorBase, instances: PlannedProp[]): THREE.Object3D | null {
    const params = def.geometry?.params ?? {};
    const { geo, mat } = getSharedRock(`${def.key}|${def.geometry?.type ?? ''}`, params);
    const mesh = new THREE.InstancedMesh(geo, mat, instances.length);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < instances.length; i++) {
      const p = instances[i];
      e.set(0, p.rotY, 0);
      q.setFromEuler(e);
      v.set(p.x, p.y, p.z);
      const yScale = 0.85 + 0.15 * (p.variant / 4);
      s.set(p.scale, p.scale * yScale, p.scale);
      m.compose(v, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  },
});

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
}