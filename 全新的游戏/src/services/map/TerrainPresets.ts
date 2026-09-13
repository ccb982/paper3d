// ============================================================
// TerrainPresets —— 地形结构预设（chunk 级形态模板；与材质解耦）
// ============================================================
// 定位（2026-09-13 定调）：只负责「精细层之前」的结构生成——
//   ① 区域级抽预设：每 4×4 chunk 一个区域，区域种子决定本区预设（可带边缘过渡）
//   ② 块级预设种子：同一种预设在不同 chunk/区域形态各异（salt 驱动）
//   ③ 输出 = 225 角色槽位（ROLE_*）；材质（TileGroups 选组/调色）仍走原 L2，互不影响
// 下游不变：L3 抽取 / L4 高度与连通 / L5 输出 / 精细层（FaceTable/FaceBuild）全部沿用。
//
// 加新形态 = 注册一个预设（build 返回角色槽位）；不改任何下游代码。
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

export interface TerrainPreset {
  key: string;
  label: string;
  /** 区域抽取权重（0 = 只作测试用，不参与自然生成） */
  weight: number;
  /** 生成角色槽位（225；端口处会被统一凿通） */
  build(ctx: PresetCtx): Uint8Array;
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

/** 区域边长（chunk）：4×4 = 240m 一个形态区域 */
const REGION = 4;

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

/** 该 chunk 的预设（区域一致 + 边缘 20% 过渡） */
export function pickPreset(seed: number, cx: number, cz: number): TerrainPreset {
  const key = ((cx + 32768) * 65536 + (cz + 32768)) ^ seed;
  const cached = presetCache.get(key);
  if (cached) return cached;
  let rx = Math.floor(cx / REGION);
  let rz = Math.floor(cz / REGION);
  const lx = cx - rx * REGION;
  const lz = cz - rz * REGION;
  // 边缘过渡：靠边的 chunk 有概率跟随邻区（形态交界不硬切）
  if (hash2(cx, cz, seed + 9303) < 0.2) {
    const cands: number[] = [];
    if (lx === 0) cands.push(0);            // 左邻
    if (lx === REGION - 1) cands.push(1);   // 右邻
    if (lz === 0) cands.push(2);            // 上邻
    if (lz === REGION - 1) cands.push(3);   // 下邻
    if (cands.length > 0) {
      const c = cands[Math.floor(hash2(cx, cz, seed + 9404) * cands.length)];
      if (c === 0) rx--;
      else if (c === 1) rx++;
      else if (c === 2) rz--;
      else rz++;
    }
  }
  const p = weightedPickPreset(hash2(rx, rz, seed + 9101));
  if (presetCache.size > 4096) presetCache.clear();
  presetCache.set(key, p);
  return p;
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

/** 建筑密度偏置 → 可用墙比例（0.5 = 中性） */
function wallRatio(gen: GroupDef['gen'] | undefined, base: number): number {
  const bias = gen?.densityBias ?? 0;
  return Math.min(0.85, Math.max(0.05, base - bias));
}

// ============================================================
// 内置预设
// ============================================================

/** ① 旷野：大面地面 + 稀疏墙团 + 少量水/坑（蜂群大波的主战场） */
registerPreset({
  key: 'plain', label: '旷野', weight: 2,
  build(ctx) {
    const roles = new Uint8Array(N); // 默认 PATH
    const near = portNearSet(ctx.ports);
    const { water, pit } = hazards(ctx.gen);
    const wallTarget = Math.floor(N * wallRatio(ctx.gen, 0.22) * (0.7 + hash2(ctx.cx, ctx.cz, ctx.salt + 1) * 0.6));
    // 墙团 3~7 格
    let walls = 0;
    for (let k = 0; k < 24 && walls < wallTarget; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 101 + k);
      if (s < 0) break;
      const size = 3 + Math.floor(hash2(k, 1, ctx.salt + 7) * 5);
      walls += paintCluster(roles, s, size, ROLE_WALL, near, ctx.salt + 201 + k);
    }
    // 小水洼 2~4 团
    const waterTarget = Math.floor(3 * water);
    for (let k = 0; k < waterTarget; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 301 + k);
      if (s < 0) break;
      paintCluster(roles, s, 2 + Math.floor(hash2(k, 2, ctx.salt + 11) * 3), ROLE_LIQUID, near, ctx.salt + 401 + k);
    }
    // 小坑 1~3 团
    const pitTarget = Math.floor(2 * pit);
    for (let k = 0; k < pitTarget; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 501 + k);
      if (s < 0) break;
      paintCluster(roles, s, 2 + Math.floor(hash2(k, 3, ctx.salt + 17) * 2), ROLE_PIT, near, ctx.salt + 601 + k);
    }
    openPorts(roles, ctx.ports);
    return roles;
  },
});

/** ② 湖盆：中央大水体 + 环岸 + 少量岛 */
registerPreset({
  key: 'lake', label: '湖盆', weight: 1.5,
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

/** ③ 台地：成片高台 + 其间峡道（断崖天际线） */
registerPreset({
  key: 'plateau', label: '台地', weight: 1.5,
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    const target = Math.floor(N * wallRatio(ctx.gen, 0.52));
    let walls = 0;
    for (let k = 0; k < 20 && walls < target; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 111 + k);
      if (s < 0) break;
      const size = 8 + Math.floor(hash2(k, 7, ctx.salt + 12) * 14);
      walls += paintCluster(roles, s, size, ROLE_WALL, near, ctx.salt + 211 + k);
    }
    // 峡道保障：横向/纵向各留 1~2 条通路（防大台地全堵）
    const dir = hash2(ctx.cx, ctx.cz, ctx.salt + 13) < 0.5;
    const lanes = 1 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 14) * 2);
    for (let k = 0; k < lanes; k++) {
      const line = 2 + Math.floor(hash2(k, 8, ctx.salt + 15) * (SIDE - 4));
      for (let j = 0; j < SIDE; j++) {
        const i = dir ? line * SIDE + j : j * SIDE + line;
        if (!near.has(i)) roles[i] = ROLE_PATH;
      }
    }
    openPorts(roles, ctx.ports);
    return roles;
  },
});

/** ④ 山脊：平行条带（走向随块种子） */
registerPreset({
  key: 'ridges', label: '山脊', weight: 1.5,
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    const vert = hash2(ctx.cx, ctx.cz, ctx.salt + 16) < 0.5;
    const period = 3 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 17) * 2); // 3~4 格周期
    for (let a = 0; a < SIDE; a++) {
      const band = ((a + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 18) * period)) % period);
      const isWall = band < period - 1; // 留 1 格通路
      for (let b = 0; b < SIDE; b++) {
        const i = vert ? b * SIDE + a : a * SIDE + b;
        if (near.has(i)) continue;
        roles[i] = isWall ? ROLE_WALL : ROLE_PATH;
      }
    }
    // 缺口（每 2 条脊开 1~2 个 2 格缺口，避免长墙锁死）
    for (let k = 0; k < 6; k++) {
      const a = Math.floor(hash2(k, 9, ctx.salt + 19) * SIDE);
      const b = Math.floor(hash2(k, 10, ctx.salt + 20) * (SIDE - 2));
      for (let d = 0; d < 2; d++) {
        const i = vert ? (b + d) * SIDE + a : a * SIDE + (b + d);
        if (!near.has(i)) roles[i] = ROLE_PATH;
      }
    }
    openPorts(roles, ctx.ports);
    return roles;
  },
});

/** ⑤ 遗迹：房间阵列（墙线 + 门洞） */
registerPreset({
  key: 'ruins', label: '遗迹', weight: 1,
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

/** ⑥ 坑原：大片地面 + 密集坑簇（危险高原） */
registerPreset({
  key: 'pitfield', label: '坑原', weight: 1,
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

/** ⑦ 梯田：横向台带（高度档位由 L4 噪声分带形成层叠） */
registerPreset({
  key: 'terraces', label: '梯田', weight: 1,
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    const bandH = 2 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 26) * 2); // 台带宽 2~3
    const pathH = 1 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 27) * 2); // 通路带 1~2
    const period = bandH + pathH;
    const phase = Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 28) * period);
    for (let z = 0; z < SIDE; z++) {
      const inBand = ((z + phase) % period) < bandH;
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        if (near.has(i)) continue;
        roles[i] = inBand ? ROLE_WALL : ROLE_PATH;
      }
    }
    // 台带纵向缺口
    for (let k = 0; k < 5; k++) {
      const x = Math.floor(hash2(k, 13, ctx.salt + 29) * SIDE);
      for (let z = 0; z < SIDE; z++) {
        const i = z * SIDE + x;
        if (!near.has(i)) roles[i] = ROLE_PATH;
      }
    }
    openPorts(roles, ctx.ports);
    return roles;
  },
});

/** ⑧ 峡道：2~3 条宽走廊穿过墙区（险要地形） */
registerPreset({
  key: 'corridor', label: '峡道', weight: 1,
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

/** ⑨ 迷宫（原结构层；保留为预设之一，密度吃组偏置） */
registerPreset({
  key: 'maze', label: '迷宫', weight: 1.5,
  build(ctx) {
    const density = hash2(ctx.cx, ctx.cz, ctx.seed + 1818);
    let targetPassageRatio = 0.3 + density * 0.4;
    targetPassageRatio = Math.min(0.75, Math.max(0.25, targetPassageRatio + (ctx.gen?.densityBias ?? 0)));
    const passage = generateMaze(ctx.seed, ctx.cx, ctx.cz, ctx.ports, targetPassageRatio);
    return structureSlots(ctx.seed, ctx.cx, ctx.cz, passage, ctx.ports, ctx.gen);
  },
});

// ============ 迷宫内核（原 ChunkGenerator L1；随机盐逐位保留） ============

function generateMaze(seed: number, cx: number, cz: number, ports: Ports, targetPassageRatio: number): Uint8Array {
  const passage = new Uint8Array(N);
  const frontier: number[] = [];
  const allPorts = portCells(ports);
  for (const p of allPorts) {
    if (passage[p]) continue;
    passage[p] = 1;
    for (const nb of gridNeighbors(p)) {
      if (!passage[nb]) frontier.push(nb);
    }
  }

  let mazeSeed = (hash2(cx, cz, seed + 505) * 1000000) | 0;
  const targetCount = Math.floor(N * targetPassageRatio);

  while (frontier.length > 0) {
    mazeSeed = (mazeSeed + 1) % 1000000;
    const fi = Math.floor(hash2(mazeSeed, 0, seed + 606) * frontier.length);
    const cur = frontier[fi];
    const nbrs = gridNeighbors(cur);
    const roadNbrs = nbrs.filter((nb) => passage[nb]);
    if (roadNbrs.length > 0) {
      passage[cur] = 1;
      for (const nb of nbrs) {
        if (!passage[nb] && !frontier.includes(nb)) frontier.push(nb);
      }
    }
    frontier[fi] = frontier[frontier.length - 1];
    frontier.pop();

    let roadCount = 0;
    for (let i = 0; i < N; i++) if (passage[i]) roadCount++;
    if (roadCount >= targetCount) break;
  }
  return passage;
}

function structureSlots(
  seed: number, cx: number, cz: number,
  passage: Uint8Array, ports: Ports,
  gen?: GroupDef['gen'],
): Uint8Array {
  const roles = new Uint8Array(N);
  const portSet = new Set<number>(portCells(ports));

  for (let i = 0; i < N; i++) {
    if (passage[i]) roles[i] = ROLE_PATH;
  }
  for (const p of portSet) roles[p] = ROLE_PATH;

  const wallSet = new Set<number>();
  for (let i = 0; i < N; i++) {
    if (!passage[i] && !portSet.has(i)) wallSet.add(i);
  }
  if (wallSet.size === 0) return roles;

  let wallPool = [...wallSet];
  let terrSeed = (hash2(cx, cz, seed + 1010) * 1000000) | 0;
  for (let i = wallPool.length - 1; i > 0; i--) {
    terrSeed = (terrSeed + 1) % 1000000;
    const j = Math.floor(hash2(terrSeed, 0, seed + 1111) * (i + 1));
    const t = wallPool[i];
    wallPool[i] = wallPool[j];
    wallPool[j] = t;
  }

  const used = new Uint8Array(N);
  const total = wallPool.length;

  function growCluster(sizeMin: number, sizeMax: number): number[] {
    let seedCell = -1;
    for (const c of wallPool) {
      if (!used[c]) { seedCell = c; break; }
    }
    if (seedCell === -1) return [];
    const targetSize = Math.min(sizeMin + Math.floor(hash2(terrSeed, 0, seed + 1313) * (sizeMax - sizeMin + 1)), total);
    const cluster: number[] = [];
    const frontier: number[] = [seedCell];
    const visited = new Set<number>([seedCell]);
    while (frontier.length > 0 && cluster.length < targetSize) {
      terrSeed = (terrSeed + 1) % 1000000;
      const fi = Math.floor(hash2(terrSeed, 0, seed + 1414) * frontier.length);
      const cur = frontier[fi];
      frontier[fi] = frontier[frontier.length - 1];
      frontier.pop();
      if (used[cur] || portSet.has(cur)) continue; // ★ 集群不漫到端口
      cluster.push(cur);
      used[cur] = 1;
      for (const nb of gridNeighbors(cur)) {
        if (!visited.has(nb) && !used[nb] && !portSet.has(nb)) {
          visited.add(nb);
          frontier.push(nb);
        }
      }
    }
    return cluster;
  }

  const rp = gen ?? { waterMul: 1, pitMul: 1 };
  const targetWater = Math.floor(total * 0.15 * rp.waterMul);
  const targetPit = Math.floor(total * 0.15 * rp.pitMul);

  let waterCount = 0;
  while (waterCount < targetWater) {
    const rem = targetWater - waterCount;
    const cluster = growCluster(Math.min(3, rem), Math.min(6, rem));
    for (const c of cluster) { roles[c] = ROLE_LIQUID; waterCount++; }
    if (cluster.length === 0) break;
  }
  let pitCount = 0;
  while (pitCount < targetPit) {
    const rem = targetPit - pitCount;
    const cluster = growCluster(Math.min(2, rem), Math.min(4, rem));
    for (const c of cluster) { roles[c] = ROLE_PIT; pitCount++; }
    if (cluster.length === 0) break;
  }

  let platformCount = 0;
  const targetPlatform = Math.floor(total * 0.45);
  for (const c of wallPool) {
    if (used[c]) continue;
    if (platformCount < targetPlatform) {
      roles[c] = ROLE_WALL;
      used[c] = 1;
      platformCount++;
    }
  }
  return roles;
}
