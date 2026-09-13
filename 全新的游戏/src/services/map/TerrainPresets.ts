// ============================================================
// TerrainPresets —— 地形结构预设（chunk 级形态模板；与材质解耦）
// ============================================================
// 定位（2026-09-13 定调）：只负责「精细层之前」的结构生成——
//   ① 区域级抽预设：每 2×2 chunk（120m）一个区域；四邻+对角去重 →
//      相邻区域形态必不同，同形态至少隔 240m 才会重现（2026-09-14 优化：破"连片"）
//   ② 块级预设种子：同一种预设在不同 chunk/区域形态各异（salt 驱动）
//   ③ 输出 = 225 角色槽位（ROLE_*）；材质（TileGroups 选组/调色）仍走原 L2，互不影响
// 下游不变：L3 抽取 / L4 高度与连通 / L5 输出 / 精细层（FaceTable/FaceBuild）全部沿用。
//
// 加新形态 = 注册一个预设（build 返回角色槽位）；不改任何下游代码。
// ★ 2026-09-14：移除「旷野」「迷宫」两个重复无特色预设（高原来承接平原替身）。
// ============================================================

import { hash2, vnoise } from './TerrainNoise';
import type { GroupDef } from './TileGroups';

/** 与 ChunkGenerator 保持一致（此处独立常量化，避免循环依赖） */
const SIDE = 15;
const N = SIDE * SIDE;

// ============ 结构角色（唯一真源；ChunkGenerator 从这里导入） ============
export const ROLE_PATH = 0;    // 地面位（可走）
export const ROLE_WALL = 1;    // 高台位（截断视线/可上）
export const ROLE_LIQUID = 2;  // 液体位（不可走）
export const ROLE_PIT = 3;     // 坑洞位（致死）

// ============ 端口（L0；在此定义供预设消费） ============
export interface Ports {
  top: number[];
  bottom: number[];
  left: number[];
  right: number[];
}

/** 端口派生（盐与历史版本逐位一致——跨 chunk 连通的对齐基准） */
export function generatePorts(seed: number, cx: number, cz: number): Ports {
  const sidePorts = (sideSeed: number): number[] => {
    const p1 = (Math.floor(hash2(sideSeed, 0, seed + 101) * 11) + 2) % 15;
    let p2: number;
    for (let i = 1; ; i++) {
      p2 = (Math.floor(hash2(sideSeed, i, seed + 202) * 11) + 2) % 15;
      if (p2 !== p1 && Math.abs(p2 - p1) >= 3) break;
    }
    return [p1, p2].sort((a, b) => a - b);
  };
  const top = sidePorts((hash2(cx, cz, seed + 303) * 1000000) | 0);
  const bottom = sidePorts((hash2(cx, cz - 1, seed + 303) * 1000000) | 0);
  const left = sidePorts((hash2(cx, cz, seed + 404) * 1000000) | 0);
  const right = sidePorts((hash2(cx + 1, cz, seed + 404) * 1000000) | 0);
  return { top, bottom, left, right };
}

// ============ 预设接口 ============

export interface PresetCtx {
  seed: number;
  cx: number;
  cz: number;
  ports: Ports;
  /** 预设专属种子（区域+块坐标派生；同预设不同处形态不同） */
  salt: number;
  /** 当前生效风格组的生成偏置（只作"倾向"：开阔/墙体/水/坑比例） */
  gen?: GroupDef['gen'];
}

/** 预设输出：角色槽位 + 可选高度覆盖（Float32(225)；NaN = 走 L4 自动高度） */
export interface PresetResult {
  roles: Uint8Array;
  heights?: Float32Array;
  /** ★ 端口格也应用高度覆盖（默认 false：端口强制基础面保跨块顺滑）。
   *  大高程地形（高原）置 true → 相邻同预设块在端口处同高、可直接连通。 */
  overridePorts?: boolean;
  /** ★ 材质覆盖：角色 → 固定地块 key（跳过组抽取；人造地形需要明确对比，如 325）*/
  materials?: Partial<Record<'ground' | 'platform' | 'liquid' | 'pit', string>>;
  /** ★ 不做 PATH 装饰斑块（背景保持纯净；配合 materials.ground）*/
  noGroundPatch?: boolean;
  /** ★ 浮空洞顶（2026-09-14）：逐 4m 块顶面高度（NaN = 无）。
   *  语义 = "该格上方有一层可站的岩板"（高度场第二层）：地表 floor 仍是角色
   *  脚下的洞底，顶面供站立/遮挡；由 RasterMap.surfaceHeightAtFor(x,z,y) 按
   *  当前高度选择层。渲染/物理由 ChunkManager 生成岩板网格 + 固定 trimesh。 */
  caveCaps?: Float32Array;
}

export interface TerrainPreset {
  key: string;
  label: string;
  /** 区域抽取权重（0 = 只作测试用，不参与自然生成） */
  weight: number;
  /** 生成角色槽位（225；端口处会被统一凿通）；可附带高度覆盖（山峰/峡谷/岛屿用） */
  build(ctx: PresetCtx): Uint8Array | PresetResult;
}

const REGISTRY = new Map<string, TerrainPreset>();
const ORDER: string[] = [];

export function registerPreset(def: TerrainPreset): void {
  if (REGISTRY.has(def.key)) throw new Error(`[TerrainPresets] 预设 key 已存在: ${def.key}`);
  REGISTRY.set(def.key, def);
  ORDER.push(def.key);
}

export function presetByKey(key: string): TerrainPreset | undefined {
  return REGISTRY.get(key);
}

export function allPresets(): TerrainPreset[] {
  return ORDER.map((k) => REGISTRY.get(k)!);
}

// ============ 区域抽取（预设 + 种子） ============

/** 区域边长（chunk）：2×2 = 120m 一个形态区域（2026-09-14：4→2 破"同一地形连片"） */
const REGION = 2;

function weightedPickPreset(r: number): TerrainPreset {
  const pool = ORDER.map((k) => REGISTRY.get(k)!).filter((p) => p.weight > 0);
  let total = 0;
  for (const p of pool) total += p.weight;
  let x = r * total;
  for (const p of pool) {
    x -= p.weight;
    if (x <= 0) return p;
  }
  return pool[pool.length - 1];
}

const presetCache = new Map<number, TerrainPreset>();

// ---- ★「325」稀疏投放（≈2% 且不成片；投放区与形态区域解耦） ----
// 以 4×4 chunk 为投放区：每区至多 1 块，候选格限定区域内部 2×2 →
// 相邻投放区的 325 至少隔 2 块（120m）
const P325_REGION_SIZE = 4;
const P325_CHANCE = 0.32;

/** 该 chunk 是否是「325」（独立于区域预设抽样） */
function is325Chunk(seed: number, cx: number, cz: number): boolean {
  const rx = Math.floor(cx / P325_REGION_SIZE);
  const rz = Math.floor(cz / P325_REGION_SIZE);
  if (hash2(rx, rz, seed + 9606) >= P325_CHANCE) return false;
  // 候选格：区域内部 2×2（(1,1)~(2,2)），远离边界 → 不会与邻区 325 贴脸
  const pick = Math.floor(hash2(rx, rz, seed + 9616) * 4);
  const lx = 1 + (pick % 2);
  const lz = 1 + Math.floor(pick / 2);
  return cx - rx * P325_REGION_SIZE === lx && cz - rz * P325_REGION_SIZE === lz;
}

/** 区域原始抽样（纯 hash；去重比较用，不含去重位移） */
function regionPickRaw(seed: number, rx: number, rz: number): TerrainPreset {
  return weightedPickPreset(hash2(rx, rz, seed + 9101));
}

/** 邻区原始 key 集合（左/上/左上/右上；纯 hash → 与求值顺序无关） */
function neighborKeys(seed: number, rx: number, rz: number): Set<string> {
  return new Set([
    regionPickRaw(seed, rx - 1, rz).key,
    regionPickRaw(seed, rx, rz - 1).key,
    regionPickRaw(seed, rx - 1, rz - 1).key,
    regionPickRaw(seed, rx + 1, rz - 1).key,
  ]);
}

/** 区域预设（★ 去重：与任一相关邻区同名 → 剔除全部冲突名后按权重重抽；比例不偏） */
function regionPick(seed: number, rx: number, rz: number): TerrainPreset {
  const p = regionPickRaw(seed, rx, rz);
  const bad = neighborKeys(seed, rx, rz);
  if (!bad.has(p.key)) return p;
  const pool = ORDER.map((k) => REGISTRY.get(k)!).filter((q) => q.weight > 0 && !bad.has(q.key));
  if (pool.length === 0) return p;
  let total = 0;
  for (const q of pool) total += q.weight;
  let r = hash2(rx, rz, seed + 9505) * total;
  for (const q of pool) {
    r -= q.weight;
    if (r <= 0) return q;
  }
  return pool[pool.length - 1];
}

/** 该 chunk 的预设（区域一致；小区域不做边缘过渡——跨块连通由端口保证） */
export function pickPreset(seed: number, cx: number, cz: number): TerrainPreset {
  const key = ((cx + 32768) * 65536 + (cz + 32768)) ^ seed;
  const cached = presetCache.get(key);
  if (cached) return cached;
  const rx = Math.floor(cx / REGION);
  const rz = Math.floor(cz / REGION);
  const p = regionPick(seed, rx, rz);
  const out = is325Chunk(seed, cx, cz) ? (REGISTRY.get('field325') ?? p) : p;
  if (presetCache.size > 4096) presetCache.clear();
  presetCache.set(key, out);
  return out;
}

/** ★ 测试地图：强制所有 chunk 使用指定预设（null = 恢复自然加权） */
let testPresetOverride: string | null = null;
export function setTestPreset(key: string | null): void {
  if (key !== null && !REGISTRY.has(key)) {
    throw new Error(`[TerrainPresets] 测试预设不存在: "${key}"（可用: ${ORDER.join(', ')}）`);
  }
  testPresetOverride = key;
  presetCache.clear();
  console.info(`[TerrainPresets] 测试地形预设 = ${key ?? '关闭（区域加权）'}`);
}
export function getTestPreset(): string | null {
  return testPresetOverride;
}

// ============================================================
// 预制件工具（全部确定性；salt 驱动）
// ============================================================

const _nbrBuf: number[] = [];
/** 四邻域（★ 返回共享缓冲：调用方需立即消费，勿持有） */
export function gridNeighbors(idx: number): number[] {
  const r = Math.floor(idx / SIDE);
  const c = idx % SIDE;
  _nbrBuf.length = 0;
  if (r > 0) _nbrBuf.push(idx - SIDE);
  if (r < SIDE - 1) _nbrBuf.push(idx + SIDE);
  if (c > 0) _nbrBuf.push(idx - 1);
  if (c < SIDE - 1) _nbrBuf.push(idx + 1);
  return _nbrBuf;
}

/** 全部端口格（★ 正确坐标映射：top/bottom = 列号，left/right = 行号 → 扁平下标） */
export function portCells(ports: Ports): number[] {
  const out: number[] = [];
  for (const c of ports.top) out.push(c);                          // 行 0
  for (const c of ports.bottom) out.push((SIDE - 1) * SIDE + c);   // 行 14
  for (const r of ports.left) out.push(r * SIDE);                  // 列 0
  for (const r of ports.right) out.push(r * SIDE + (SIDE - 1));    // 列 14
  return [...new Set(out)];
}

/** 逐边端口扁平下标（凿通/邻域用） */
function portCellsPerSide(ports: Ports): number[][] {
  return [
    ports.top.map((c) => c),
    ports.bottom.map((c) => (SIDE - 1) * SIDE + c),
    ports.left.map((r) => r * SIDE),
    ports.right.map((r) => r * SIDE + (SIDE - 1)),
  ];
}

/** 端口及其 1 圈邻域（布局生成时豁免，保证衔接） */
export function portNearSet(ports: Ports): Set<number> {
  const s = new Set<number>();
  for (const p of portCells(ports)) {
    s.add(p);
    for (const nb of gridNeighbors(p)) s.add(nb);
  }
  return s;
}

/** 凿通端口：端口格 + 向内 2 格走廊置 PATH（模板边界可走） */
export function openPorts(roles: Uint8Array, ports: Ports): void {
  const carve = (cells: number[], inward: number): void => {
    for (const p of cells) {
      roles[p] = ROLE_PATH;
      let cur = p;
      for (let k = 0; k < 2; k++) {
        const nb = cur + inward;
        if (nb < 0 || nb >= N) break;
        // 边界防护：列位移不跨行
        if (inward === 1 && nb % SIDE === 0) break;
        if (inward === -1 && nb % SIDE === SIDE - 1) break;
        roles[nb] = ROLE_PATH;
        cur = nb;
      }
    }
  };
  const [top, bottom, left, right] = portCellsPerSide(ports);
  carve(top, SIDE);      // 上边界 → 向下
  carve(bottom, -SIDE);  // 下边界 → 向上
  carve(left, 1);        // 左边界 → 向右
  carve(right, -1);      // 右边界 → 向左
}

/** 确定性洗牌（Fisher-Yates；用 salt 派生） */
function shuffled(arr: number[], salt: number): number[] {
  const out = arr.slice();
  let s = salt | 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s + 1) % 1000000;
    const j = Math.floor(hash2(s, 0, salt * 7 + 13) * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

/** BFS 生长一团并涂色（返回涂色格）；filter 限定可涂范围 */
function paintCluster(
  roles: Uint8Array,
  seedCell: number,
  size: number,
  role: number,
  exclude: Set<number>,
  salt: number,
): number {
  const painted: number[] = [];
  const visited = new Set<number>([seedCell]);
  const frontier = [seedCell];
  let s = salt | 0;
  while (frontier.length > 0 && painted.length < size) {
    s = (s + 1) % 1000000;
    const fi = Math.floor(hash2(s, 3, salt + 29) * frontier.length);
    const cur = frontier[fi];
    frontier[fi] = frontier[frontier.length - 1];
    frontier.pop();
    if (exclude.has(cur)) continue;
    roles[cur] = role;
    painted.push(cur);
    for (const nb of gridNeighbors(cur)) {
      if (!visited.has(nb) && !exclude.has(nb)) {
        visited.add(nb);
        frontier.push(nb);
      }
    }
  }
  return painted.length;
}

/** 在可用格中挑起始点（salt 洗牌后取第一个） */
function pickStart(roles: Uint8Array, allow: (i: number) => boolean, salt: number): number {
  const all: number[] = [];
  for (let i = 0; i < N; i++) if (allow(i)) all.push(i);
  if (all.length === 0) return -1;
  return shuffled(all, salt)[0];
}

/** 液体/坑洞配额（吃组偏置；作为"倾向"） */
function hazards(gen: GroupDef['gen'] | undefined): { water: number; pit: number } {
  const wm = gen?.waterMul ?? 1;
  const pm = gen?.pitMul ?? 1;
  return { water: wm, pit: pm };
}

// ============================================================
// 内置预设
// ============================================================

/** ① 湖盆：中央大水体 + 环岸 + 少量岛 */
registerPreset({
  key: 'lake', label: '湖盆', weight: 1.7,      // 常规变体
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    const { water } = hazards(ctx.gen);
    // 中心偏置（避免压端口边缘）
    const ccx = 4 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 2) * 7);
    const ccz = 4 + Math.floor(hash2(ctx.cz, ctx.cx, ctx.salt + 3) * 7);
    const rBase = 3.2 + hash2(ctx.cx + 1, ctx.cz + 1, ctx.salt + 4) * 2.6 * Math.min(1.6, water);
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        if (near.has(i)) continue;
        const dx = x - ccx, dz = z - ccz;
        const d = Math.sqrt(dx * dx + dz * dz);
        // 不规则边缘（噪声扰动）
        const wob = (vnoise(x * 0.35, z * 0.35, ctx.salt + 5) - 0.5) * 1.8;
        if (d + wob < rBase) roles[i] = ROLE_LIQUID;
      }
    }
    // 岛 0~2 块
    const islands = hash2(ccx, ccz, ctx.salt + 6) < 0.45 ? 1 + Math.floor(hash2(ccx, ccz, ctx.salt + 8) * 2) : 0;
    for (let k = 0; k < islands; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_LIQUID, ctx.salt + 701 + k);
      if (s < 0) break;
      paintCluster(roles, s, 2 + Math.floor(hash2(k, 5, ctx.salt + 9) * 3), ROLE_WALL, near, ctx.salt + 801 + k);
    }
    openPorts(roles, ctx.ports);
    return roles;
  },
});

/** ② 遗迹：房间阵列（墙线 + 门洞） */
registerPreset({
  key: 'ruins', label: '遗迹', weight: 1.6,     // 常规变体
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    const cell = 4 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 21) * 2); // 房间 4~5 格
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        if (near.has(i)) continue;
        const onGrid = x % cell === 0 || z % cell === 0;
        if (onGrid) roles[i] = ROLE_WALL;
      }
    }
    // 门洞：每条墙线随机开 1~2 口
    for (let a = 0; a < SIDE; a += cell) {
      for (let k = 0; k < 6; k++) {
        const g = Math.floor(hash2(a, k, ctx.salt + 22) * SIDE);
        const g2 = (g + 1) % SIDE;
        for (const gg of [g, g2]) {
          const iH = a * SIDE + gg;
          const iV = gg * SIDE + a;
          if (!near.has(iH)) roles[iH] = ROLE_PATH;
          if (!near.has(iV)) roles[iV] = ROLE_PATH;
        }
      }
    }
    // 房内少量水/坑点缀
    const { water, pit } = hazards(ctx.gen);
    for (let k = 0; k < Math.floor(2 * water); k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 901 + k);
      if (s >= 0) paintCluster(roles, s, 2, ROLE_LIQUID, near, ctx.salt + 911 + k);
    }
    for (let k = 0; k < Math.floor(2 * pit); k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 921 + k);
      if (s >= 0) paintCluster(roles, s, 2, ROLE_PIT, near, ctx.salt + 931 + k);
    }
    openPorts(roles, ctx.ports);
    return roles;
  },
});

/** ③ 坑原：大片地面 + 密集坑簇（危险高原） */
registerPreset({
  key: 'pitfield', label: '坑原', weight: 1.1,  // 地标
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    const { pit } = hazards(ctx.gen);
    const clusters = Math.floor((4 + hash2(ctx.cx, ctx.cz, ctx.salt + 23) * 4) * pit);
    for (let k = 0; k < clusters; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 941 + k);
      if (s < 0) break;
      paintCluster(roles, s, 2 + Math.floor(hash2(k, 11, ctx.salt + 24) * 5), ROLE_PIT, near, ctx.salt + 951 + k);
    }
    // 少量掩体高台
    for (let k = 0; k < 6; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 961 + k);
      if (s < 0) break;
      paintCluster(roles, s, 3 + Math.floor(hash2(k, 12, ctx.salt + 25) * 3), ROLE_WALL, near, ctx.salt + 971 + k);
    }
    openPorts(roles, ctx.ports);
    return roles;
  },
});

/** ④ 峡道：2~3 条宽走廊穿过墙区（险要地形） */
registerPreset({
  key: 'corridor', label: '峡道', weight: 1.1,  // 地标
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    roles.fill(ROLE_WALL);
    const lanes = 2 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 30) * 2);
    for (let k = 0; k < lanes; k++) {
      let pos = 2 + Math.floor(hash2(k, 14, ctx.salt + 31) * (SIDE - 4));
      const width = 2 + Math.floor(hash2(k, 15, ctx.salt + 32) * 2);
      for (let x = 0; x < SIDE; x++) {
        if (hash2(x, k, ctx.salt + 33) < 0.25) pos += hash2(x, k, ctx.salt + 34) < 0.5 ? -1 : 1;
        pos = Math.min(SIDE - width - 1, Math.max(1, pos));
        for (let d = 0; d < width; d++) {
          const i = (pos + d) * SIDE + x;
          roles[i] = ROLE_PATH;
        }
      }
    }
    // 走廊内少量水/坑口袋
    const { water, pit } = hazards(ctx.gen);
    if (water > 1.2) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 981);
      if (s >= 0) paintCluster(roles, s, 2, ROLE_LIQUID, near, ctx.salt + 991);
    }
    if (pit > 1.2) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 992);
      if (s >= 0) paintCluster(roles, s, 2, ROLE_PIT, near, ctx.salt + 993);
    }
    openPorts(roles, ctx.ports);
    return roles;
  },
});

/** ⑤ 高原：高顶 11.5~13.5m（平均 >10m）+ 常高缘台 7.5m + 端口坡道（替代一部分平原） */
registerPreset({
  key: 'highland', label: '高原', weight: 2.2, // 常规地貌（体量大，承担"平原替身"）
  build(ctx) {
    const roles = new Uint8Array(N);
    const heights = new Float32Array(N).fill(NaN);
    const SHELF = 6.0;                                   // 缘台常高（跨块可直连）
    const H = 9 + hash2(ctx.cx, ctx.cz, ctx.salt + 71) * 2; // 顶面 9~11m
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        const edge = Math.min(x, z, SIDE - 1 - x, SIDE - 1 - z);
        if (edge < 1) {
          // 缘台（含端口）：常高，保证相邻高原地块跨块直连
          roles[i] = ROLE_PATH;
          heights[i] = Math.round((SHELF + (vnoise(x * 0.3, z * 0.3, ctx.salt + 74) - 0.5) * 0.4) * 4) / 4;
          continue;
        }
        const wob = (vnoise(x * 0.3, z * 0.3, ctx.salt + 72) - 0.5) * 0.8;
        heights[i] = Math.round((H + wob) * 4) / 4;
        const soil = vnoise(x * 0.22, z * 0.22, ctx.salt + 73) > 0.62;
        roles[i] = soil ? ROLE_PATH : ROLE_WALL;
      }
    }
    // 端口坡道：端口向内 1 格宽；前 2 格缘台 → 每 0.75m 一级上到顶面
    const ramp = (p0: number, inward: number): void => {
      let cur = p0;
      let h = SHELF;
      for (let k = 1; k <= 12; k++) {
        const nb = cur + inward;
        if (nb < 0 || nb >= N) break;
        if (inward === SIDE && Math.floor(nb / SIDE) > SIDE - 1) break;
        if (inward === -SIDE && Math.floor(nb / SIDE) < 0) break;
        if (inward === 1 && nb % SIDE === 0) break;
        if (inward === -1 && nb % SIDE === SIDE - 1) break;
        roles[nb] = ROLE_PATH;
        if (k <= 2) {
          heights[nb] = SHELF;
        } else {
          h = Math.min(H, SHELF + (k - 2) * 0.75);
          heights[nb] = Math.round(h * 4) / 4;
        }
        cur = nb;
        if (h >= H) break;
      }
    };
    for (const c of ctx.ports.top) ramp(c, SIDE);
    for (const c of ctx.ports.bottom) ramp((SIDE - 1) * SIDE + c, -SIDE);
    for (const r of ctx.ports.left) ramp(r * SIDE, 1);
    for (const r of ctx.ports.right) ramp(r * SIDE + (SIDE - 1), -1);
    // 顶面点缀：石柱
    for (let k = 0; k < 4; k++) {
      const s0 = pickStart(roles, (i) => roles[i] === ROLE_WALL && heights[i] > SHELF + 2, ctx.salt + 741 + k);
      if (s0 < 0) break;
      heights[s0] = Math.round((heights[s0] + 1.2) * 4) / 4;
    }
    openPorts(roles, ctx.ports);
    // ★ overridePorts：端口保持缘台高度（相邻高原地块直连）
    return { roles, heights, overridePorts: true };
  },
});

/** ⑥ 325：全平地面 + 高台刻「325」（≈2% 稀疏投放；背景/字各一个固定材质） */
registerPreset({
  key: 'field325', label: '325', weight: 0,    // 不参与区域抽取：独立稀疏规则投放（≈2%，互不靠近）
  build(ctx) {
    const roles = new Uint8Array(N); // 全 PATH（平地）
    const heights = new Float32Array(N).fill(0);
    // 高台：13×9 方台，高 2.5m
    const PLAT = 2.5;
    for (let z = 3; z <= 11; z++) {
      for (let x = 1; x <= 13; x++) {
        const i = z * SIDE + x;
        roles[i] = ROLE_PATH;
        heights[i] = PLAT;
      }
    }
    // 上台坡道（南侧 x=4，3 级 0.8m；只走台面下缘 rows 10~12，不切数字带 5~9）
    const rampH = [0.9, 1.7, PLAT];
    for (let k = 0; k < 3; k++) {
      const i = (12 - k) * SIDE + 4;
      roles[i] = ROLE_PATH;
      heights[i] = Math.round(rampH[k] * 4) / 4;
    }
    // 端口凿通先做——数字最后覆盖绘制（防止凿通/坡道切掉笔画）
    openPorts(roles, ctx.ports);
    const G3 = [0b111, 0b001, 0b011, 0b001, 0b111];
    const G2 = [0b111, 0b001, 0b111, 0b100, 0b111];
    const G5 = [0b111, 0b100, 0b111, 0b001, 0b111];
    const glyph = (g: number[], ox: number, oz = 5): void => {
      for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < 3; c++) {
          if ((g[r] >> (2 - c)) & 1) {
            const i = (oz + r) * SIDE + (ox + c);
            roles[i] = ROLE_WALL;
            heights[i] = PLAT + 0.6;
          }
        }
      }
    };
    glyph(G3, 2);
    glyph(G2, 6);
    glyph(G5, 10);
    // ★ 材质（用户定调）：背景一个材质（沙土）、字一个材质（水泥深色）——
    //   不走组抽取与地面装饰斑块，保证「325」清晰完整
    return {
      roles, heights,
      materials: { ground: 'flat_sand', platform: 'cement_platform' },
      noGroundPatch: true,
    };
  },
});

/** ⑦ 山峰：主峰 + 山肩裙坡（真实高程；可驾驶爬升/绕行） */
registerPreset({
  key: 'peak', label: '山峰', weight: 1.5,      // 地标
  build(ctx) {
    const roles = new Uint8Array(N); // 默认 PATH
    const heights = new Float32Array(N).fill(NaN);
    const near = portNearSet(ctx.ports);
    // 主峰（内区）+ 可选副峰
    const cx0 = 4 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 41) * 7);
    const cz0 = 4 + Math.floor(hash2(ctx.cz, ctx.cx, ctx.salt + 42) * 7);
    const R = 6 + hash2(ctx.cx + 1, ctx.cz, ctx.salt + 43) * 3;       // 半径 6~9 块
    const H = 12 + hash2(ctx.cx, ctx.cz + 1, ctx.salt + 44) * 8;     // 峰高 12~20m
    const peaks = [{ x: cx0, z: cz0, r: R, h: H }];
    if (hash2(ctx.cx, ctx.cz, ctx.salt + 45) < 0.6) {
      peaks.push({
        x: 2 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 46) * 11),
        z: 2 + Math.floor(hash2(ctx.cz, ctx.cx, ctx.salt + 47) * 11),
        r: 3.5 + hash2(ctx.cx, ctx.cz, ctx.salt + 48) * 2.5,
        h: H * 0.6,
      });
    }
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        if (near.has(i)) continue;
        let h = 0;
        for (const p of peaks) {
          const dx = x - p.x, dz = z - p.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          const wob = (vnoise(x * 0.45, z * 0.45, ctx.salt + 49) - 0.5) * 1.6;
          const t = 1 - (d + wob) / p.r;
          if (t > 0) h = Math.max(h, p.h * Math.pow(t, 1.5));
        }
        if (h <= 0.05) continue;
        heights[i] = Math.round(h * 4) / 4;          // 0.25m 台阶
        if (h > 1.2) roles[i] = ROLE_WALL;           // 山体 = 高台材质
      }
    }
    // 碎石点缀（山脚独立岩块）
    for (let k = 0; k < 5; k++) {
      const s0 = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i) && !Number.isFinite(heights[i]), ctx.salt + 451 + k);
      if (s0 < 0) break;
      roles[s0] = ROLE_WALL;
      heights[s0] = 0.8;
    }
    openPorts(roles, ctx.ports);
    // 端口高度归零（跨块顺滑；override 在端口处不生效）
    for (const p of portCells(ctx.ports)) heights[p] = NaN;
    return { roles, heights };
  },
});

/** ⑧ 大峡谷：高原中一条蜿蜒峡谷（一侧陡壁 + 一侧可攀台阶，谷底可走可进出） */
registerPreset({
  key: 'canyon', label: '大峡谷', weight: 1.4,  // 地标
  build(ctx) {
    const roles = new Uint8Array(N);
    const heights = new Float32Array(N).fill(NaN);
    const near = portNearSet(ctx.ports);
    const plateauH = 2.2;
    roles.fill(ROLE_WALL);
    for (let i = 0; i < N; i++) heights[i] = plateauH;
    // 峡谷走向（横穿/纵穿）+ 位置（保证整条谷含台阶都在块内）
    const horiz = hash2(ctx.cx, ctx.cz, ctx.salt + 52) < 0.5;
    const halfW = 1 + (hash2(ctx.cx, ctx.cz, ctx.salt + 53) < 0.5 ? 1 : 0); // 谷底 2~4 宽
    const stepH = 0.72;                 // 台阶级差（< 跳跃峰值 0.8：可跳上，逐级可攀）
    // ★ 2026-09-14 用户定调：峡谷加深——台阶侧 5 → 7 级，谷深 ~3.6m → ~5m
    const banks = 7;
    const floorH = plateauH - banks * stepH; // ≈ -2.84（谷深 ~5m）
    const loPos = halfW + banks + 1;
    const hiPos = SIDE - 1 - (halfW + 1);
    let pos = loPos + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 54) * Math.max(1, hiPos - loPos + 1));
    const span = halfW * 2 + banks + 1;
    for (let step = 0; step < SIDE; step++) {
      if (hash2(step, 0, ctx.salt + 55) < 0.45) pos += hash2(step, 1, ctx.salt + 56) < 0.5 ? -1 : 1;
      pos = Math.min(hiPos, Math.max(loPos, pos));
      for (let d = -(halfW + banks); d <= halfW + 1; d++) {
        const a = pos + d;
        if (a < 0 || a >= SIDE) continue;
        const i = horiz ? a * SIDE + step : step * SIDE + a;
        if (near.has(i)) continue;
        const ad = Math.abs(d);
        let h: number;
        if (d >= 0) {
          // 右侧：谷底 → 陡壁
          h = ad < halfW ? floorH : plateauH;
        } else {
          // 左侧：逐级台阶（谷底 → 高原）
          const perp = Math.max(0, ad - halfW + 1);
          h = Math.max(floorH, plateauH - perp * stepH);
        }
        heights[i] = Math.round(h * 4) / 4;
        roles[i] = h > 0.5 ? ROLE_WALL : ROLE_PATH;
      }
    }
    void span;
    // 谷底点缀（碎石/积水口袋）
    for (let k = 0; k < 3; k++) {
      const s0 = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 571 + k);
      if (s0 < 0) break;
      if (hash2(k, 30, ctx.salt + 57) < 0.5) {
        roles[s0] = ROLE_WALL;
        heights[s0] = floorH + 0.3;   // 谷底碎石（相对谷底，不悬浮）
      } else {
        roles[s0] = ROLE_LIQUID;
        heights[s0] = floorH - 0.4;   // ★ 池底低于谷底（深潭；水面仍为全局 y=0）
      }
    }
    openPorts(roles, ctx.ports);
    for (const p of portCells(ctx.ports)) heights[p] = NaN;
    return { roles, heights };
  },
});

/** ⑨ 孤岛：大面积水域 + 中央主岛 + 小岛/栈桥（可涉水或走桥） */
registerPreset({
  key: 'island', label: '孤岛', weight: 1.3,    // 地标
  build(ctx) {
    const roles = new Uint8Array(N);
    roles.fill(ROLE_LIQUID);
    const heights = new Float32Array(N).fill(NaN); // 水面高度走地块自身
    const near = portNearSet(ctx.ports);
    // 主岛（中央偏内）
    const cx0 = 5 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 61) * 5);
    const cz0 = 5 + Math.floor(hash2(ctx.cz, ctx.cx, ctx.salt + 62) * 5);
    const R = 3.2 + hash2(ctx.cx + 1, ctx.cz + 1, ctx.salt + 63) * 1.8;
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        if (near.has(i)) continue;
        const dx = x - cx0, dz = z - cz0;
        const d = Math.sqrt(dx * dx + dz * dz);
        const wob = (vnoise(x * 0.5, z * 0.5, ctx.salt + 64) - 0.5) * 1.4;
        if (d + wob < R) {
          const t = 1 - (d + wob) / R;
          heights[i] = Math.max(0.4, t * 1.8);   // 岛心缓丘
          roles[i] = t > 0.55 ? ROLE_WALL : ROLE_PATH;
        }
      }
    }
    // 小岛 0~2
    const isles = hash2(cx0, cz0, ctx.salt + 65) < 0.55 ? 1 + Math.floor(hash2(cx0, cz0, ctx.salt + 66) * 2) : 0;
    for (let k = 0; k < isles; k++) {
      const s0 = pickStart(roles, (i) => roles[i] === ROLE_LIQUID && !near.has(i), ctx.salt + 661 + k);
      if (s0 < 0) break;
      const painted = paintCluster(roles, s0, 2 + Math.floor(hash2(k, 21, ctx.salt + 67) * 2), ROLE_PATH, near, ctx.salt + 671 + k);
      if (painted > 0) heights[s0] = 0.5;
    }
    // 栈桥：每个端口向主岛方向铺 1 格宽通路（跨水）
    const bridge = (c: number, sx: number, sz: number): void => {
      let x = sx, z = sz;
      for (let guard = 0; guard < SIDE * 2; guard++) {
        const i = z * SIDE + x;
        roles[i] = ROLE_PATH;
        if (!Number.isFinite(heights[i])) heights[i] = 0.6;
        if (x === cx0 && z === cz0) break;
        if (Math.abs(cx0 - x) > Math.abs(cz0 - z)) x += Math.sign(cx0 - x);
        else z += Math.sign(cz0 - z);
      }
    };
    for (const c of ctx.ports.top) bridge(c, c, 0);
    for (const c of ctx.ports.bottom) bridge((c), c, SIDE - 1);
    for (const r of ctx.ports.left) bridge(r, 0, r);
    for (const r of ctx.ports.right) bridge(r, SIDE - 1, r);
    openPorts(roles, ctx.ports);
    for (const p of portCells(ctx.ports)) heights[p] = NaN;
    return { roles, heights };
  },
});

/** ⑩ 洞穴山丘（2026-09-14 用户定调："坑洞 + 顶上浮空块封顶"）：
 *  山体实心（全平台面），从某个端口向内挖一条隧道 + 洞厅；
 *  洞顶用【浮空岩板】封盖（caveCaps：逐 4m 块顶面 = 山体面 PH）——
 *  地表高度场仍是洞底（可走进去），顶面 = 第二层高度（崖顶可站/可跑，
 *  实体不会掉洞里）；入口段（坡道）露天使玩家能走下去。 */
const CAVE_CLEARANCE = 2.8;   // 洞内净高（岩板底面到洞底）
const CAVE_CAP_THICK = 0.6;   // 岩板厚度
const CAVE_RAMP_STEPS = 7;    // 入口坡道步数（步高 = (PH-PF)/7 ≈ 0.49 ≤ 0.5 可登）
registerPreset({
  key: 'cave', label: '洞穴山丘', weight: 1.2,
  build(ctx) {
    const roles = new Uint8Array(N);
    const heights = new Float32Array(N).fill(NaN);
    const caps = new Float32Array(N).fill(NaN);
    const PH = Math.round((5 + hash2(ctx.cx, ctx.cz, ctx.salt + 81) * 1.5) * 4) / 4; // 山体顶 5~6.5（0.25 台阶）
    const PF = Math.round((PH - (CAVE_CLEARANCE + CAVE_CAP_THICK)) * 4) / 4;         // 洞底
    // 山体实心：全平台（可站），端口凿通保跨块
    roles.fill(ROLE_WALL);
    for (let i = 0; i < N; i++) heights[i] = PH;

    // 入口选边（取该边的一个端口作起点）——隧道从边缘向内
    const side = Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 82) * 4);
    const portsOf = [ctx.ports.top, ctx.ports.bottom, ctx.ports.left, ctx.ports.right][side];
    const pick = portsOf.length > 0
      ? portsOf[Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 83) * portsOf.length)]
      : 7;
    let x: number, z: number, ddx: number, ddz: number;
    if (side === 0) { x = Math.max(2, Math.min(SIDE - 3, pick)); z = 0; ddx = 0; ddz = 1; }
    else if (side === 1) { x = Math.max(2, Math.min(SIDE - 3, pick)); z = SIDE - 1; ddx = 0; ddz = -1; }
    else if (side === 2) { x = 0; z = Math.max(2, Math.min(SIDE - 3, pick)); ddx = 1; ddz = 0; }
    else { x = SIDE - 1; z = Math.max(2, Math.min(SIDE - 3, pick)); ddx = -1; ddz = 0; }

    // 挖隧道：入口 CAVE_RAMP_STEPS 步下坡（露顶），之后平洞（封顶）+ 洞厅
    const totalSteps = CAVE_RAMP_STEPS + 5;
    const perpX = ddz, perpZ = ddx; // 垂直方向（2 格宽）
    const tunnel: { x: number; z: number; h: number }[] = [];
    for (let s = 0; s < totalSteps; s++) {
      // 横向随机游走（蜿蜒），限制在块内
      if (s > 1 && hash2(s, 1, ctx.salt + 84) < 0.4) {
        const d = hash2(s, 2, ctx.salt + 85) < 0.5 ? -1 : 1;
        x += perpX * d;
        z += perpZ * d;
        x = Math.max(1, Math.min(SIDE - 2, x));
        z = Math.max(1, Math.min(SIDE - 2, z));
      }
      const t = Math.min(1, s / CAVE_RAMP_STEPS);
      const h = Math.round((PH + (PF - PH) * t) * 4) / 4;
      for (let w = 0; w < 2; w++) {
        const tx = Math.max(0, Math.min(SIDE - 1, x + perpX * w));
        const tz = Math.max(0, Math.min(SIDE - 1, z + perpZ * w));
        tunnel.push({ x: tx, z: tz, h });
      }
      // 前进
      x += ddx; z += ddz;
      x = Math.max(0, Math.min(SIDE - 1, x));
      z = Math.max(0, Math.min(SIDE - 1, z));
    }
    // 洞厅：隧道尽头 3×3 全平到洞底
    const end = tunnel[tunnel.length - 1];
    for (let zz = -1; zz <= 1; zz++) {
      for (let xx = -1; xx <= 1; xx++) {
        const hx = Math.max(0, Math.min(SIDE - 1, end.x + xx));
        const hz = Math.max(0, Math.min(SIDE - 1, end.z + zz));
        tunnel.push({ x: hx, z: hz, h: PF });
      }
    }
    // 落位：洞底 PATH + 高度；顶面 = 岩板（洞内净高足够才封顶：入口坡道保持露天）
    for (const c of tunnel) {
      const i = c.z * SIDE + c.x;
      roles[i] = ROLE_PATH;
      heights[i] = c.h;
      if (PH - c.h >= CAVE_CLEARANCE + CAVE_CAP_THICK - 0.3) caps[i] = PH;
    }
    openPorts(roles, ctx.ports);
    return {
      roles, heights, caveCaps: caps,
      overridePorts: true,
      materials: { ground: 'cave_floor', platform: 'cave_platform' },
      noGroundPatch: true,
    };
  },
});
