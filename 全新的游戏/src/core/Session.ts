// ============================================================
// Session.ts —— 存档数据结构
// 只存"舰船上的永恒状态"，所有加成在出击时由 computeCombatStats 统一计算
// 不存：地图/坐标/战斗临时状态/预计算的加成数值
// ============================================================

// ============================================================
// 1. 基础类型
// ============================================================

/** 单个物品实例（极简，只存引用和数量） */
export interface ItemInstance {
  itemId: string; // 配置表 items.json 的 id
  stackSize: number; // 当前堆叠数量（1 ~ maxStack）
}

/** 网格背包：二维数组，null 表示空格 */
export type InventoryGrid = (ItemInstance | null)[][];

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
    createdAt: string;
    lastSavedAt: string;
  };

  // ----- ② ★ 玩家"裸装"基础属性 -----
  player: {
    hp: number;
    maxHp: number;
    attackPower: number;
    defense: number;
  };

  // ----- ③ ★ 四层背包 -----
  inventories: {
    base: InventoryGrid;        // L1: 舰船基地仓库（30×30）
    ship: InventoryGrid;        // L2: 探索飞船仓库（8×10）
    player: InventoryGrid;      // L3: 玩家自身背包（4×6）
    allies: Record<string, InventoryGrid>; // L4: 队友背包
  };

  // ----- ④ ★ 藏品/遗物 -----
  relics: {
    owned: string[];            // 所有藏品 ID
    slots: (string | null)[];   // 槽位（快捷展示）
  };

  // ----- ⑤ 友军/干员 -----
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

/** 新增物品到网格（自动堆叠，否则放空位） */
export function addItemToGrid(
  grid: InventoryGrid,
  itemId: string,
  stackSize: number,
  maxStack: number = 99,
): boolean {
  // 1. 先堆叠到已有同物品堆
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const slot = grid[r][c];
      if (slot && slot.itemId === itemId && slot.stackSize < maxStack) {
        const space = maxStack - slot.stackSize;
        if (space >= stackSize) {
          slot.stackSize += stackSize;
          return true;
        } else {
          slot.stackSize = maxStack;
          stackSize -= space;
        }
      }
    }
  }

  // 2. 放空位
  while (stackSize > 0) {
    const pos = findEmptySlot(grid);
    if (!pos) return false;
    const put = Math.min(stackSize, maxStack);
    grid[pos.row][pos.col] = { itemId, stackSize: put };
    stackSize -= put;
  }
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

/** 移动物品在网格间（从源网格拿取 count 个，放到目标网格） */
export function moveItemBetweenGrids(
  srcGrid: InventoryGrid,
  dstGrid: InventoryGrid,
  itemId: string,
  count: number,
  maxStack: number = 99,
): boolean {
  if (!removeItemFromGrid(srcGrid, itemId, count)) return false;
  if (!addItemToGrid(dstGrid, itemId, count, maxStack)) {
    // 回滚
    addItemToGrid(srcGrid, itemId, count, maxStack);
    return false;
  }
  return true;
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

export function computeCombatStats(
  session: GameSession,
  relicConfig: Record<string, RelicConfigEntry>,
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
  return {
    meta: {
      version: '0.1.0',
      day: 1,
      totalDaysSurvived: 0,
      createdAt: new Date().toISOString(),
      lastSavedAt: new Date().toISOString(),
    },
    player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2 },
    inventories: {
      base: createEmptyGrid(30, 30),
      ship: createEmptyGrid(8, 10),
      player: createEmptyGrid(4, 6),
      allies: {},
    },
    relics: {
      owned: ['black_crown'],
      slots: Array(5).fill(null),
    },
    allies: { roster: [] },
    ship: { hp: 1000, maxHp: 1000, shield: 200, armor: 5, techTree: [], turrets: [] },
    gacha: { pityCounter: 0, totalPulls: 0 },
    dayProgress: { hasDepartedToday: false },
  };
}