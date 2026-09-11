// ============================================================
// Session.ts —— 存档数据结构
// 只存"舰船上的永恒状态"，所有加成在出击时由 computeCombatStats 统一计算
// 不存：地图/坐标/战斗临时状态/预计算的加成数值
// ============================================================

// 六区兄弟 = 六种基础合成材料（开荒种子用）
import { SIX_BROTHER_MATERIAL_IDS } from '../config/sixBrothers';

// ============================================================
// 1. 基础类型
// ============================================================

/** 单个物品实例（极简，只存引用和数量） */
export interface ItemInstance {
  itemId: string; // 配置表 items.json 的 id
  stackSize: number; // 当前数量（同层合并规则下无上限，一格一类）
}

/** 网格背包：二维数组，null 表示空格 */
export type InventoryGrid = (ItemInstance | null)[][];

/** ★ 出击槽池规格：12 格通用混用池（2 行 × 6 列展示；友军/装备任意混放，一格一个物品） */
export const SLOT_COUNT = 12;
export const SLOT_ROWS = 2;
export const SLOT_COLS = 6;

/** 炮塔状态（舰船固定防御） */
export interface TurretState {
  slotId: number;
  turretId: string;
  ammo: number;
}

// ============================================================
// 2. 游戏存档根对象
// ============================================================

export interface GameSession {
  // ----- ① 元信息 -----
  meta: {
    version: string;
    day: number;                // ★ 当前天数（既是进度标识，也是地图种子来源）
    totalDaysSurvived: number;
    deaths: number;             // ★ 累计死亡次数（局外道具 "每次死亡×1.05 全属性" 的驱动）
    createdAt: string;
    lastSavedAt: string;
  };

  // ----- ② ★ 玩家"裸装"基础属性 -----
  player: {
    hp: number;
    maxHp: number;
    attackPower: number;
    defense: number;
    /** ★ 弹药池（跨场保留 ≈ 随身携带的子弹数；弹药包使用 → 入池，开火 → 出池） */
    ammo: Record<string, number>;
    /** ★ 出击槽池（SLOT_COUNT 格）：友军/装备任意混放；
     *  装备在格即视为已穿戴（全量叠加贴片）；可部署在格即出队。null = 空槽 */
    slots: (string | null)[];
  };

  // ----- ③ ★ 三层背包（L4 队友背包已移除 2026-09-09） -----
  inventories: {
    base: InventoryGrid;        // L1: 舰船基地仓库（30×30）
    ship: InventoryGrid;        // L2: 探索飞船仓库（8×10）
    player: InventoryGrid;      // L3: 玩家自身背包（4×6）
  };

  // ----- ④ ★ 藏品/遗物 -----
  relics: {
    owned: string[];            // 所有藏品 ID
    slots: (string | null)[];   // 槽位（快捷展示）
  };

  // ----- ⑤ ★ 干员 -----
  allies: {
    roster: string[];           // 已招募的干员 id 列表
  };

  // ----- ⑥ 舰船状态 -----
  ship: {
    hp: number;
    maxHp: number;
    shield: number;
    armor: number;
    techTree: string[];
    turrets: TurretState[];
  };

  // ----- ⑦ 抽卡保底 -----
  gacha: {
    pityCounter: number;
    totalPulls: number;
  };

  // ----- ⑧ 每日进度 -----
  dayProgress: {
    hasDepartedToday: boolean;
  };

  // ----- ⑨ ★ 局外道具（只可抽取、不占背包、无需携带；拥有即全局永久生效） -----
  outOfRun: {
    owned: Record<string, number>; // 道具 id → 拥有数（重复抽取叠加）
  };
}

// ============================================================
// 3. 网格工具函数
// ============================================================

/** 创建空网格 */
export function createEmptyGrid(rows: number, cols: number): InventoryGrid {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

/** 深拷贝网格 */
export function cloneGrid(grid: InventoryGrid): InventoryGrid {
  return grid.map((row) => row.map((slot) => (slot ? { ...slot } : null)));
}

/** 统计网格中的物品总数 */
export function countItemsInGrid(grid: InventoryGrid): number {
  let count = 0;
  for (const row of grid) {
    for (const slot of row) {
      if (slot !== null) count++;
    }
  }
  return count;
}

/** 网格尺寸期望配置 */
export const GRID_DIMENSIONS: Record<string, { rows: number; cols: number }> = {
  base: { rows: 30, cols: 30 },
  ship: { rows: 8, cols: 10 },
  player: { rows: 4, cols: 6 },
};

/**
 * 修复网格尺寸（迁移旧数据到新网格）
 * 防止 createEmptyGrid 调整行列数后旧存档静默越界
 */
export function migrateGrid(
  grid: InventoryGrid | undefined | null,
  expectedRows: number,
  expectedCols: number,
  label: string,
): InventoryGrid {
  if (!grid || !Array.isArray(grid) || grid.length === 0) {
    console.warn(`[迁移] ${label} 网格为空/无效，重建 ${expectedRows}x${expectedCols}`);
    return createEmptyGrid(expectedRows, expectedCols);
  }
  const actualRows = grid.length;
  const actualCols = grid[0]?.length ?? 0;
  if (actualRows === expectedRows && actualCols === expectedCols) {
    return grid; // 尺寸一致，无需迁移
  }
  console.warn(
    `[迁移] ${label} 尺寸不匹配 (${actualRows}x${actualCols} → ${expectedRows}x${expectedCols})，迁移物品`,
  );
  const newGrid = createEmptyGrid(expectedRows, expectedCols);
  for (let r = 0; r < Math.min(actualRows, expectedRows); r++) {
    const srcRow = grid[r];
    if (!srcRow) continue;
    for (let c = 0; c < Math.min(srcRow.length, expectedCols); c++) {
      const item = srcRow[c];
      if (item) {
        newGrid[r][c] = { ...item };
      }
    }
  }
  return newGrid;
}

/** 在网格中查找特定物品的第一个位置 */
export function findItemInGrid(
  grid: InventoryGrid,
  itemId: string,
): { row: number; col: number; item: ItemInstance } | null {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const slot = grid[r][c];
      if (slot && slot.itemId === itemId) {
        return { row: r, col: c, item: slot };
      }
    }
  }
  return null;
}

/** 找第一个空位 */
export function findEmptySlot(grid: InventoryGrid): { row: number; col: number } | null {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === null) {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

/**
 * 新增物品到网格（★ 同层合并语义：一格一类，数量无上限，插入即合并）
 * 已有该物品 → 数量直接累加；否则占用一个空格。空格不足则失败。
 */
export function addItemToGrid(grid: InventoryGrid, itemId: string, stackSize: number): boolean {
  if (stackSize <= 0) return true;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const slot = grid[r][c];
      if (slot && slot.itemId === itemId) {
        slot.stackSize += stackSize;
        return true;
      }
    }
  }
  const pos = findEmptySlot(grid);
  if (!pos) return false;
  grid[pos.row][pos.col] = { itemId, stackSize };
  return true;
}

/** 从网格中移除指定数量的物品 */
export function removeItemFromGrid(
  grid: InventoryGrid,
  itemId: string,
  count: number,
): boolean {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const slot = grid[r][c];
      if (slot && slot.itemId === itemId) {
        if (slot.stackSize > count) {
          slot.stackSize -= count;
          return true;
        } else {
          count -= slot.stackSize;
          grid[r][c] = null;
          if (count <= 0) return true;
        }
      }
    }
  }
  return false;
}

/** 移动物品在网格间（从源网格拿取 count 个，放到目标网格，目标自动合并） */
export function moveItemBetweenGrids(
  srcGrid: InventoryGrid,
  dstGrid: InventoryGrid,
  itemId: string,
  count: number,
): boolean {
  if (count <= 0) return true;
  if (!removeItemFromGrid(srcGrid, itemId, count)) return false;
  if (!addItemToGrid(dstGrid, itemId, count)) {
    // 回滚
    addItemToGrid(srcGrid, itemId, count);
    return false;
  }
  return true;
}

/**
 * ★ 网格内自由整理：交换两格内容（拖拽组织背包）。
 *   目标空 = 移动；两格同类 = 数量合并到目标格（维持"一格一类"不变量）。
 * 返回是否发生变更。
 */
export function swapGridCells(
  grid: InventoryGrid,
  r1: number, c1: number, r2: number, c2: number,
): boolean {
  if (r1 === r2 && c1 === c2) return false;
  const a = grid[r1]?.[c1] ?? null;
  const b = grid[r2]?.[c2] ?? null;
  if (!a && !b) return false;
  if (a && b && a.itemId === b.itemId) {
    b.stackSize += a.stackSize;
    grid[r1][c1] = null;
    return true;
  }
  grid[r1][c1] = b;
  grid[r2][c2] = a;
  return true;
}

/**
 * ★ 同层合并归一（旧存档迁移用）：
 * 把网格中重复 itemId 合并为 1 格（数量求和），其余格置空。
 * 合并只会减少占用，返回是否发生过合并。
 */
export function mergeDuplicatesInGrid(grid: InventoryGrid): boolean {
  const seen = new Map<string, { row: number; col: number }>();
  let changed = false;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const slot = grid[r][c];
      if (!slot) continue;
      const keeper = seen.get(slot.itemId);
      if (keeper) {
        const keeperSlot = grid[keeper.row][keeper.col];
        if (keeperSlot) {
          keeperSlot.stackSize += slot.stackSize;
        }
        grid[r][c] = null;
        changed = true;
      } else {
        seen.set(slot.itemId, { row: r, col: c });
      }
    }
  }
  return changed;
}

// ============================================================
// 4. 战斗属性计算（★ 唯一加成入口，完全配置驱动）
// ============================================================

export interface PlayerCombatStats {
  hp: number;
  maxHp: number;
  attackPower: number;
  defense: number;
}

export interface RelicConfigEntry {
  id: string;
  name: string;
  type: 'carry' | 'permanent';
  description: string;
  effect?: {
    attackBonus?: number;
    defenseBonus?: number;
    hpBonus?: number;
    multiplier?: number;
    flatBonus?: {
      attackBonus?: number;
      defenseBonus?: number;
      hpBonus?: number;
    };
  };
}

/** 局外道具配置（只可抽取、不入背包；拥有即全局永久生效） */
export interface OutOfRunItemConfig {
  id: string;
  name: string;
  rarity: number;
  description: string;
  /** FTX 纹理路径（仅展示用） */
  texture?: string;
  effect?: {
    /** 每次死亡全属性 ×perDeathMultiplier（乘方累积：×（1.05 ^ 死亡次数×拥有数）） */
    perDeathMultiplier?: number;
    /** 每天全属性 ×perDayMultiplier（乘方累积：×（1.01 ^ 天数×拥有数）） */
    perDayMultiplier?: number;
  };
}

export function computeCombatStats(
  session: GameSession,
  relicConfig: Record<string, RelicConfigEntry>,
  outOfRunConfig?: Record<string, OutOfRunItemConfig>,
): PlayerCombatStats {
  const base = session.player;
  const owned = session.relics.owned;
  const day = session.meta.day;

  let bonusAttack = 0, bonusDefense = 0, bonusMaxHp = 0;
  let multiplier = 1;

  for (const id of owned) {
    const cfg = relicConfig[id];
    if (!cfg) continue;
    if (cfg.type === 'carry') {
      bonusAttack += cfg.effect?.attackBonus || 0;
      bonusDefense += cfg.effect?.defenseBonus || 0;
      bonusMaxHp += cfg.effect?.hpBonus || 0;
    } else if (cfg.type === 'permanent') {
      if (cfg.effect?.multiplier) {
        multiplier *= Math.pow(cfg.effect.multiplier, day);
      }
      bonusAttack += cfg.effect?.flatBonus?.attackBonus || 0;
      bonusDefense += cfg.effect?.flatBonus?.defenseBonus || 0;
      bonusMaxHp += cfg.effect?.flatBonus?.hpBonus || 0;
    }
  }

  // ---- ★ 局外道具：每天/每次死亡 全属性乘方累积（与藏品 multiplier 相乘） ----
  const ownedOut = session.outOfRun?.owned ?? {};
  const deaths = session.meta?.deaths ?? 0;
  for (const [id, count] of Object.entries(ownedOut)) {
    const cfg = outOfRunConfig?.[id];
    if (!cfg || (count ?? 0) <= 0) continue;
    if (cfg.effect?.perDayMultiplier) {
      multiplier *= Math.pow(cfg.effect.perDayMultiplier, day * count);
    }
    if (cfg.effect?.perDeathMultiplier) {
      multiplier *= Math.pow(cfg.effect.perDeathMultiplier, deaths * count);
    }
  }

  return {
    hp: base.hp,
    maxHp: Math.floor(base.maxHp * multiplier) + bonusMaxHp,
    attackPower: Math.floor(base.attackPower * multiplier) + bonusAttack,
    defense: Math.floor(base.defense * multiplier) + bonusDefense,
  };
}

// ============================================================
// 5. 创建新游戏存档
// ============================================================

export function createNewSession(): GameSession {
  const player = createEmptyGrid(GRID_DIMENSIONS.player.rows, GRID_DIMENSIONS.player.cols);
  // 开荒种子：六区兄弟（六种基础材料）各一份，背包首行展示
  SIX_BROTHER_MATERIAL_IDS.forEach((id, i) => {
    player[0][i] = { itemId: id, stackSize: 1 };
  });
  return {
    meta: {
      version: '0.2.0',
      day: 1,
      totalDaysSurvived: 0,
      deaths: 0,
      createdAt: new Date().toISOString(),
      lastSavedAt: new Date().toISOString(),
    },
    player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array<null>(SLOT_COUNT).fill(null) },
    inventories: {
      base: createEmptyGrid(30, 30),
      ship: createEmptyGrid(8, 10),
      player,
    },
    relics: {
      owned: [],
      slots: Array(5).fill(null),
    },
    allies: { roster: [] },
    ship: { hp: 1000, maxHp: 1000, shield: 200, armor: 5, techTree: [], turrets: [] },
    gacha: { pityCounter: 0, totalPulls: 0 },
    dayProgress: { hasDepartedToday: false },
    outOfRun: { owned: { black_crown: 1 } },
  };
}