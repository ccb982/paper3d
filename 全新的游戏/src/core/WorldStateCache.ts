// ============================================================
// WorldStateCache —— 世界状态持久化（2026-09-19）
// ============================================================
// 目的（用户定调）：**同一个种子不每局重建**——把"玩家造成的世界差异"缓存下来，
//   重进同一天（刷新/回基地再出击/重开页面）时恢复，而不是从零重建。
// 缓存内容：
//   · 地形破坏（挖坑层数 levels；按 chunk 存）——★ 坑洞不重建
//   · 玩家/敌人建的城墙与墙
//   · 召唤友军（祖宗 / 无人机；出击槽友军由配装自然重建，不入缓存）
// ★ 2026-09-19 二次定调：**植被不入缓存**（每天重建 → 资源可恢复）。
// 存储：独立 localStorage 键（不塞 Session JSON，避免存档膨胀）：
//   `arknights_rogue_world_<seed>_<day>`
// 清理：只保留最近 MAX_ENTRIES 份（LRU）；删档时 clearWorldStates()。
// ============================================================

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
  day: number;
  /** 挖坑层数（chunkKey → 层数数组） */
  levels: [number, Uint8Array][];
  walls: WallRec[];
  allies: AllyRec[];
}

interface WorldStateRec {
  v: 1;
  seed: number;
  day: number;
  savedAt: number;
  levels: [number, string][];
  walls: WallRec[];
  allies: AllyRec[];
}

const KEY_PREFIX = 'arknights_rogue_world_';
/** 最多保留的世界缓存份数（LRU：按 savedAt 淘汰最旧） */
const MAX_ENTRIES = 4;

function keyOf(seed: number, day: number): string {
  return `${KEY_PREFIX}${seed}_${day}`;
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
    const rec: WorldStateRec = {
      v: 1,
      seed: data.seed,
      day: data.day,
      savedAt: Date.now(),
      levels: data.levels.map(([k, lv]) => [k, bytesToB64(lv)]),
      walls: data.walls,
      allies: data.allies,
    };
    localStorage.setItem(keyOf(data.seed, data.day), JSON.stringify(rec));
  } catch (e) {
    console.warn('[WorldStateCache] 保存失败（忽略）:', e);
  }
}

/** 读取世界状态（同 seed+day）；无/损坏 → null */
export function loadWorldState(seed: number, day: number): WorldStateData | null {
  try {
    const raw = localStorage.getItem(keyOf(seed, day));
    if (!raw) return null;
    const rec = JSON.parse(raw) as WorldStateRec;
    if (rec.v !== 1 || rec.seed !== seed || rec.day !== day) return null;
    return {
      seed: rec.seed,
      day: rec.day,
      levels: (rec.levels ?? []).map(([k, b]) => [k, b64ToBytes(b)] as [number, Uint8Array]),
      walls: rec.walls ?? [],
      allies: rec.allies ?? [],
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
