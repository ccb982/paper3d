// ============================================================
// WorldStateCache —— 世界 / 地图持久化（v2，2026-09-19 彻底重构）
// ============================================================
// 设计（用户定调）：**每个存档一张持久地图**；每天随机出生点；植被每天重建；
//   其余不重建（坑洞 / 地形记录 / 已探索 / 地图标记 / 墙 / 召唤友军）。
//
// 单一记录（按主种子）：`arknights_rogue_world_<seed>`
//   v2 字段：
//     · levels      挖坑层数（chunkKey → 层数数组；b64）
//     · mapRecords  地形记录（chunkKey → blockTypes；大地图回放用；b64）
//     · explored    小地图已探索记忆（稠密位图 + 稀疏格；b64）
//     · markers     玩家地图标记（x/z/label/color）
//     · walls       玩家城墙 / 墙
//     · enemyWalls  敌人施工的掩体/墙（**独立记录**：不占玩家墙上限、不吃玩家墙光环；
//                   实体类型 EnemyCoverEntity）
//     · allies      召唤友军（仅祖宗：留存回位+休眠，接触唤醒；无人机跟随玩家不入缓存；出击槽友军由配装重建）
//
// 写入时机：WorldMode exit / beforeunload / 周期自动保存（15s）
// 清理：LRU 保留最近 MAX_ENTRIES 份；删档 clearWorldStates()
// 失败静默：缓存不是关键路径（容量/隐私模式等都不应影响游戏）
// ============================================================

import type { ExploredMaskState } from '../services/map/ExploredMask';
import { cellKeyOf, cellKeyToXZ } from '../services/map/RasterMap';
import { CHUNK_SIZE } from '../services/map/ChunkGenerator';

/** 城墙/墙记录（对应 CoverEntity 的持久化面） */
export interface WallRec {
  x: number; y: number; z: number;
  heading: number;
  variant: 'cover' | 'wall';
  hp: number;
  owner: 'player' | 'enemy';
}

/** 召唤友军记录（仅祖宗；kind 保留兼容旧档读取，旧档 drone 记录恢复时丢弃） */
export interface AllyRec {
  kind: 'drone' | 'sentinel';
  x: number; y: number; z: number;
  hp: number;
  itemId: string;
  /** 祖宗站桩基座高（drone 忽略） */
  stationaryBaseY?: number;
}

/** 地图标记记录 */
export interface MarkerRec {
  x: number; z: number;
  label: string;
  color: string;
}

export interface WorldStateData {
  seed: number;
  /** 挖坑层数（chunkKey → 层数数组） */
  levels: [number, Uint8Array][];
  /** ★ 地形记录（chunkKey → blockTypes；大地图回放） */
  mapRecords: [number, Uint8Array][];
  walls: WallRec[];
  /** ★ 敌人施工的掩体/墙（独立记录；与玩家墙分开存档） */
  enemyWalls: WallRec[];
  allies: AllyRec[];
  /** ★ 小地图已探索记忆（持久；每天只换出生点） */
  explored?: ExploredMaskState | null;
  /** ★ 玩家地图标记（跨模式/跨天保留） */
  markers: MarkerRec[];
}

interface WorldStateRec {
  v: 2;
  seed: number;
  savedAt: number;
  levels: [number, string][];
  mapRecords: [number, string][];
  walls: WallRec[];
  /** ★ 敌人墙（旧档无此字段 → 空数组；旧的混存记录在恢复时按 owner 分流） */
  enemyWalls?: WallRec[];
  allies: AllyRec[];
  markers: MarkerRec[];
  explored?: {
    x0: number; z0: number; w: number; h: number;
    count: number; bits: string; sparse: number[];
    /** ★ 稀疏格按 chunk 聚合的 60×60 位图（新档；旧档无此字段 → 回退 sparse 数组） */
    chunks?: [string, string][];
  } | null;
}

const KEY_PREFIX = 'arknights_rogue_world_';
/** 最多保留的世界缓存份数（LRU：按 savedAt 淘汰最旧） */
const MAX_ENTRIES = 4;

function keyOf(seed: number): string {
  return `${KEY_PREFIX}${seed}`;
}

function bytesToB64(u8: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * ★ 探索稀疏格 → 按 chunk 聚合的 60×60 位图（2026-11-14 修 QuotaExceeded）：
 *   旧格式把稀疏格直接存 JSON 数字数组，28 万格 ≈ 2.3MB；探索是"开雾圆盘"
 *   ⇒ chunk 内高度稠密，聚合后每个满 chunk 只要 4.8KB（原 28.8KB），通常省 5~6 倍。
 */
function encodeSparseChunks(sparse: number[]): [string, string][] {
  const map = new Map<string, Uint8Array>();
  for (const k of sparse) {
    const c = cellKeyToXZ(k);
    const cx = Math.floor(c.x / CHUNK_SIZE);
    const cz = Math.floor(c.z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let bits = map.get(key);
    if (!bits) {
      bits = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
      map.set(key, bits);
    }
    bits[(c.z - cz * CHUNK_SIZE) * CHUNK_SIZE + (c.x - cx * CHUNK_SIZE)] = 1;
  }
  const out: [string, string][] = [];
  for (const [key, bits] of map) out.push([key, bytesToB64(bits)]);
  return out;
}

/** 探索 chunk 位图 → 稀疏格键列表（与 encodeSparseChunks 互逆） */
function decodeSparseChunks(chunks: [string, string][]): number[] {
  const out: number[] = [];
  for (const [key, b64] of chunks) {
    const comma = key.indexOf(',');
    const cx = Number(key.slice(0, comma));
    const cz = Number(key.slice(comma + 1));
    const bits = b64ToBytes(b64);
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (bits[lz * CHUNK_SIZE + lx]) out.push(cellKeyOf(cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz));
      }
    }
  }
  return out;
}

/** ★ 完整档曾因配额失败 → 本页面后续直接走降级档（避免每次重算 5MB 大串再抛异常） */
let degradedOnce = false;

/**
 * ★ 坑洞掩码压缩（2026-11-14 用户定调「chunk 掩码压缩，等需要用了解压拿出来改」）：
 *   levels 是 60×60 的层数掩码（3600B，绝大多数是 0），直接 b64 每块 4.8KB；
 *   游程编码后「没挖过」的块只剩几个字符，挖过的块通常也 < 200B。
 *   格式：`r:` + b64(游程流) / `b:` + b64(原始) / 无前缀 = 旧档原始 b64。
 *   游程流每段 3B：value(1B) + 长度(2B LE)。
 */
function encodeLevelsMask(lv: Uint8Array): string {
  const runs: number[] = [];
  let i = 0;
  while (i < lv.length) {
    const v = lv[i];
    let j = i + 1;
    while (j < lv.length && lv[j] === v) j++;
    const n = j - i;
    runs.push(v, n & 0xff, (n >> 8) & 0xff);
    i = j;
  }
  // 游程流不划算（每格都在变）→ 原样存
  if (runs.length >= lv.length) return 'b:' + bytesToB64(lv);
  return 'r:' + bytesToB64(new Uint8Array(runs));
}

/** 坑洞掩码解压（见 encodeLevelsMask；len = CHUNK_SIZE²） */
function decodeLevelsMask(s: string, len: number): Uint8Array {
  if (s.startsWith('r:')) {
    const src = b64ToBytes(s.slice(2));
    const out = new Uint8Array(len);
    let o = 0;
    for (let i = 0; i + 2 < src.length; i += 3) {
      const v = src[i];
      const n = src[i + 1] | (src[i + 2] << 8);
      if (o + n >= len) {
        out.fill(v, o, len);
        break;
      }
      out.fill(v, o, o + n);
      o += n;
    }
    return out;
  }
  return b64ToBytes(s.startsWith('b:') ? s.slice(2) : s);
}

/** 保存世界状态（v2）。★ 容量降级链（2026-09-19）：完整 → 丢地形记录 → 丢探索位图 →
 *  最小集（坑洞/墙/友军/标记）。任何一级成功即返回；全失败才告警（缓存非关键路径）。 */
export function saveWorldState(data: WorldStateData): void {
  // ★ 探索稀疏格只编码一次（降级链复用；否则每次重试都重扫 28 万格）
  const exploredChunks = data.explored ? encodeSparseChunks(data.explored.sparse) : null;
  const build = (withRecords: boolean, withExplored: boolean): WorldStateRec => {
    const ex = withExplored ? data.explored : null;
    return {
      v: 2,
      seed: data.seed,
      savedAt: Date.now(),
      levels: data.levels.map(([k, lv]) => [k, encodeLevelsMask(lv)]),
      mapRecords: withRecords ? data.mapRecords.map(([k, bt]) => [k, bytesToB64(bt)]) : [],
      walls: data.walls,
      enemyWalls: data.enemyWalls,
      allies: data.allies,
      markers: data.markers,
      explored: ex ? {
        x0: ex.x0, z0: ex.z0, w: ex.w, h: ex.h,
        count: ex.count, bits: bytesToB64(ex.bits),
        sparse: [], // ★ 新档不再写原始稀疏数组（体积大头）；读取端走 chunks
        chunks: exploredChunks ?? [],
      } : null,
    };
  };
  const attempts: [boolean, boolean][] = degradedOnce
    ? [[false, true], [false, false]]
    : [[true, true], [false, true], [false, false]];
  for (let i = 0; i < attempts.length; i++) {
    const [recs, exp] = attempts[i];
    try {
      if (i > 0) {
        // ★ 关键修复（2026-11-14）：降级重试前先删旧值 —— 否则旧的 ~5MB 记录仍占配额，
        //   最小集（几百 KB）也会因「旧值 + 新值 > 上限」永远写不进去（QuotaExceeded 死循环）。
        localStorage.removeItem(keyOf(data.seed));
      }
      const rec = build(recs, exp);
      const json = JSON.stringify(rec);
      localStorage.setItem(keyOf(data.seed), json);
      console.info(
        `[世界缓存] 保存 seed=${data.seed} 坑洞=${data.levels.length} 地形记录=${recs ? data.mapRecords.length : 0}`
        + ` 探索=${exp && data.explored ? data.explored.count : 0} 标记=${data.markers.length} 墙=${data.walls.length}`
        + ` 敌墙=${data.enemyWalls.length}`
        + ` 体积=${(json.length / 1024).toFixed(0)}KB`,
      );
      return;
    } catch (e) {
      if (recs && exp) degradedOnce = true; // 完整档已不可能 → 本页面后续直接降级
      console.warn('[世界缓存] 保存降级重试（丢记录/探索）:', e);
    }
  }
  console.warn('[世界缓存] 保存失败（已降级到最小集仍失败）');
}

/** 读取世界状态（同 seed）；无/损坏 → null。v1 旧记录只迁移 levels。 */
export function loadWorldState(seed: number): WorldStateData | null {
  try {
    const raw = localStorage.getItem(keyOf(seed));
    if (!raw) return null;
    const rec = JSON.parse(raw) as WorldStateRec | (Partial<WorldStateRec> & { v: 1 });
    if (!rec || rec.seed !== seed) return null;
    const ex = rec.explored;
    console.info(
      `[世界缓存] 读取 seed=${seed} 坑洞=${(rec.levels ?? []).length} 地形记录=${(rec.mapRecords ?? []).length}`
      + ` 探索=${ex ? ex.count : 0} 标记=${(rec.markers ?? []).length}`,
    );
    return {
      seed: rec.seed,
      levels: (rec.levels ?? []).map(([k, b]) => [k, decodeLevelsMask(b, CHUNK_SIZE * CHUNK_SIZE)] as [number, Uint8Array]),
      mapRecords: (rec.mapRecords ?? []).map(([k, b]) => [k, b64ToBytes(b)] as [number, Uint8Array]),
      walls: rec.walls ?? [],
      enemyWalls: rec.enemyWalls ?? [],
      allies: rec.allies ?? [],
      markers: rec.markers ?? [],
      explored: ex ? {
        x0: ex.x0, z0: ex.z0, w: ex.w, h: ex.h,
        count: ex.count, bits: b64ToBytes(ex.bits),
        // ★ 新档走 chunk 位图；旧档回退原始稀疏数组
        sparse: ex.chunks && ex.chunks.length > 0
          ? decodeSparseChunks(ex.chunks)
          : (ex.sparse ?? []),
      } : null,
    };
  } catch (e) {
    console.warn('[WorldStateCache] 读取失败（忽略）:', e);
    return null;
  }
}

/** LRU 清理：最多 MAX_ENTRIES 份，且总量不超过 3MB（给 localStorage 5MB 配额留余量） */
export function pruneWorldStates(max = MAX_ENTRIES): void {
  try {
    const entries: { key: string; savedAt: number; size: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(KEY_PREFIX)) continue;
      const raw = localStorage.getItem(k) ?? '';
      let savedAt = 0;
      try {
        savedAt = (JSON.parse(raw) as { savedAt?: number }).savedAt ?? 0;
      } catch { /* 损坏项按最旧处理 */ }
      entries.push({ key: k, savedAt, size: raw.length });
    }
    if (entries.length <= 1) return;
    entries.sort((a, b) => b.savedAt - a.savedAt);
    let total = 0;
    for (let i = 0; i < entries.length; i++) {
      total += entries[i].size;
      // ★ 至少保留最新一份；超过份数或总量超 3MB 就从这里往后全删
      if (i >= max || (i > 0 && total > 3 * 1024 * 1024)) {
        for (let j = i; j < entries.length; j++) localStorage.removeItem(entries[j].key);
        break;
      }
    }
  } catch { /* 忽略 */ }
}

/** 清空全部世界缓存（删档 / ?wipe=1） */
export function clearWorldStates(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* 忽略 */ }
}
