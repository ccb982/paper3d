// ============================================================
// WorldStateCache —— 世界状态持久化（2026-09-19）
// ============================================================
// 目的（用户定调）：**同一个种子不每局重建**——把"玩家造成的世界差异"缓存下来，
//   重进同一天（刷新/回基地再出击/重开页面）时恢复，而不是从零重建。
// 缓存内容：
//   · 地形破坏（挖坑层数 levels；按 chunk 存）——★ 坑洞不重建
//   · 玩家/敌人建的城墙与墙
//   · 召唤友军（祖宗 / 无人机；出击槽友军由配装自然重建，不入缓存）
//   · ★ 小地图已探索记忆（跨天一直保留；每天只换出生点）
// ★ 2026-09-19 二次定调：**植被不入缓存**（每天重建 → 资源可恢复）。
// 存储：独立 localStorage 键（不塞 Session JSON，避免存档膨胀）：
//   `arknights_rogue_world_<seed>`（★ 2026-09-19 持久世界：地图不换天 → 键去掉 day）
// 清理：只保留最近 MAX_ENTRIES 份（LRU）；删档时 clearWorldStates()。
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

/** 召唤友军记录（slotIndex < 0 的道具召唤：祖宗 / 无人机） */
export interface AllyRec {
  kind: 'drone' | 'sentinel';
  x: number; y: number; z: number;
  hp: number;
  itemId: string;
  /** 祖宗站桩基座高（drone 忽略） */
  stationaryBaseY?: number;
}

export interface WorldStateData {
  seed: number;
  /** 挖坑层数（chunkKey → 层数数组） */
  levels: [number, Uint8Array][];
  walls: WallRec[];
  allies: AllyRec[];
  /** ★ 小地图已探索记忆（持久；每天只换出生点） */
  explored?: ExploredMaskState | null;
}

interface WorldStateRec {
  v: 1;
  seed: number;
  savedAt: number;
  levels: [number, string][];
  walls: WallRec[];
  allies: AllyRec[];
  /** 探索记忆：{x0,z0,w,h,count,bits(base64),sparse:number[]} */
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

/** 保存世界状态（编码 levels 为 base64；失败静默——缓存不是关键路径） */
export function saveWorldState(data: WorldStateData): void {
  try {
    const ex = data.explored;
    const rec: WorldStateRec = {
      v: 1,
      seed: data.seed,
      savedAt: Date.now(),
      levels: data.levels.map(([k, lv]) => [k, bytesToB64(lv)]),
      walls: data.walls,
      allies: data.allies,
      explored: ex ? {
        x0: ex.x0, z0: ex.z0, w: ex.w, h: ex.h,
        count: ex.count, bits: bytesToB64(ex.bits), sparse: ex.sparse,
      } : null,
    };
    localStorage.setItem(keyOf(data.seed), JSON.stringify(rec));
  } catch (e) {
    console.warn('[WorldStateCache] 保存失败（忽略）:', e);
  }
}

/** 读取世界状态（同 seed+day）；无/损坏 → null */
export function loadWorldState(seed: number): WorldStateData | null {
  try {
    const raw = localStorage.getItem(keyOf(seed));
    if (!raw) return null;
    const rec = JSON.parse(raw) as WorldStateRec;
    if (rec.v !== 1 || rec.seed !== seed) return null;
    const ex = rec.explored;
    return {
      seed: rec.seed,
      levels: (rec.levels ?? []).map(([k, b]) => [k, b64ToBytes(b)] as [number, Uint8Array]),
      walls: rec.walls ?? [],
      allies: rec.allies ?? [],
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
