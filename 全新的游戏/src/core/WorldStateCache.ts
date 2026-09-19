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
//     · walls       城墙 / 墙
//     · allies      召唤友军（仅祖宗：留存回位+休眠，接触唤醒；无人机跟随玩家不入缓存；出击槽友军由配装重建）
//
// 写入时机：WorldMode exit / beforeunload / 周期自动保存（15s）
// 清理：LRU 保留最近 MAX_ENTRIES 份；删档 clearWorldStates()
// 失败静默：缓存不是关键路径（容量/隐私模式等都不应影响游戏）
// ============================================================

import type { ExploredMaskState } from '../services/map/ExploredMask';

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
  allies: AllyRec[];
  markers: MarkerRec[];
  explored?: {
    x0: number; z0: number; w: number; h: number;
    count: number; bits: string; sparse: number[];
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

/** 保存世界状态（v2）。★ 容量降级链（2026-09-19）：完整 → 丢地形记录 → 丢探索位图 →
 *  最小集（坑洞/墙/友军/标记）。任何一级成功即返回；全失败才告警（缓存非关键路径）。 */
export function saveWorldState(data: WorldStateData): void {
  const build = (withRecords: boolean, withExplored: boolean): WorldStateRec => {
    const ex = withExplored ? data.explored : null;
    return {
      v: 2,
      seed: data.seed,
      savedAt: Date.now(),
      levels: data.levels.map(([k, lv]) => [k, bytesToB64(lv)]),
      mapRecords: withRecords ? data.mapRecords.map(([k, bt]) => [k, bytesToB64(bt)]) : [],
      walls: data.walls,
      allies: data.allies,
      markers: data.markers,
      explored: ex ? {
        x0: ex.x0, z0: ex.z0, w: ex.w, h: ex.h,
        count: ex.count, bits: bytesToB64(ex.bits), sparse: ex.sparse,
      } : null,
    };
  };
  const attempts: [boolean, boolean][] = [[true, true], [false, true], [false, false]];
  for (const [recs, exp] of attempts) {
    try {
      const rec = build(recs, exp);
      const json = JSON.stringify(rec);
      localStorage.setItem(keyOf(data.seed), json);
      console.info(
        `[世界缓存] 保存 seed=${data.seed} 坑洞=${data.levels.length} 地形记录=${recs ? data.mapRecords.length : 0}`
        + ` 探索=${exp && data.explored ? data.explored.count : 0} 标记=${data.markers.length} 墙=${data.walls.length}`
        + ` 体积=${(json.length / 1024).toFixed(0)}KB`,
      );
      return;
    } catch (e) {
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
      levels: (rec.levels ?? []).map(([k, b]) => [k, b64ToBytes(b)] as [number, Uint8Array]),
      mapRecords: (rec.mapRecords ?? []).map(([k, b]) => [k, b64ToBytes(b)] as [number, Uint8Array]),
      walls: rec.walls ?? [],
      allies: rec.allies ?? [],
      markers: rec.markers ?? [],
      explored: ex ? {
        x0: ex.x0, z0: ex.z0, w: ex.w, h: ex.h,
        count: ex.count, bits: b64ToBytes(ex.bits), sparse: ex.sparse ?? [],
      } : null,
    };
  } catch (e) {
    console.warn('[WorldStateCache] 读取失败（忽略）:', e);
    return null;
  }
}

/** LRU 清理：只保留最近 MAX_ENTRIES 份世界缓存 */
export function pruneWorldStates(max = MAX_ENTRIES): void {
  try {
    const entries: { key: string; savedAt: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(KEY_PREFIX)) continue;
      let savedAt = 0;
      try {
        savedAt = (JSON.parse(localStorage.getItem(k) ?? '{}') as { savedAt?: number }).savedAt ?? 0;
      } catch { /* 损坏项按最旧处理 */ }
      entries.push({ key: k, savedAt });
    }
    if (entries.length <= max) return;
    entries.sort((a, b) => b.savedAt - a.savedAt);
    for (let i = max; i < entries.length; i++) localStorage.removeItem(entries[i].key);
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
