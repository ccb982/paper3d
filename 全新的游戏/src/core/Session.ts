// ============================================================
// Session.ts —— 存档数据结构
// 只存"舰船上的永恒状态"（基础值）；派生加成由 EffectSystem 在局内统一聚合
// 不存：地图/坐标/战斗临时状态/预计算的加成数值
// ============================================================

// 六区兄弟 = 六种基础合成材料（开荒种子用）
import { SIX_BROTHER_MATERIAL_IDS } from '../config/sixBrothers';
import { relicEffectRegistry, eachOwnedRelic, type RelicEffectConfig, type RelicStatAccumulator } from './RelicEffects';

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
    day: number;                // ★ 当前天数（进度标识；地图种子 = 主种子 × 天数 混合）
    /** ★ 主要种子（新局随机生成、随存档持久）：当天地图 = dailyMapSeed(seed, day)，
     *  同主种子同天恒同图；不同天/不同局不同图 */
    seed: number;
    totalDaysSurvived: number;
    deaths: number;             // ★ 累计死亡次数（遗物 "每次死亡×1.05 全属性" 的驱动）
    createdAt: string;
    lastSavedAt: string;
    /** ★ 已击败普瑞赛斯（通关；之后不再进入四维空间） */
    bossCleared?: boolean;
  };

  // ----- ② ★ 玩家"裸装"基础属性 -----
  player: {
    hp: number;
    maxHp: number;
    attackPower: number;
    defense: number;
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

  // ----- ④ ★ 遗物（原"藏品/局外道具"统一归类 2026-09-11：永久生效、不入背包、只可抽取） -----

  // ----- ⑤ 舰船状态 -----
  ship: {
    hp: number;
    maxHp: number;
    shield: number;
    armor: number;
    /** ★ 油量（每天出击重置为满；航行按时间消耗，耗尽 → 扣半血 + 紧急停靠） */
    fuel: number;
    fuelMax: number;
    /** ★ 舰船本图位置（停靠后 = 出生点；断线/返程持久化） */
    position: { x: number; z: number };
    techTree: string[];
    turrets: TurretState[];
  };

  // ----- ⑦ 抽卡保底 -----
  gacha: {
    pityCounter: number;
    totalPulls: number;
    /** ★ 6★ 普瑞赛斯递增计数（第 n 抽概率 = n/50，必出于第 50 抽） */
    bossPity?: number;
  };

  // ----- ⑧ 每日进度 -----
  dayProgress: {
    hasDepartedToday: boolean;
    /** ★ 当天敌人配额与击杀进度（2026-09-16）。
     *  quota = 击杀可达上限（按威胁档位动态估算，远距回收会扣减）；
     *  kills = 真击杀数（子弹/近战致死、掉深坑致死）；recalled = 已还回的配额数。
     *  跨出击持久（同日多次出击累计）；换日由 resetDayQuota 清 0 重算。 */
    enemies?: {
      quota: number;
      kills: number;
      recalled: number;
    };
    /** ★ 已为哪一天初始化过敌人配额（防同日重复出击把进度清零）。
     *  = session.meta.day 时表示当天配额已就绪；换日不等 → 重新初始化。 */
    everDeparted?: number;
  };

  // ----- ⑨ ★ 遗物（原局外道具：只可抽取、不占背包、无需携带；拥有即全局永久生效） -----
  outOfRun: {
    owned: Record<string, number>; // 遗物 id → 拥有数（重复抽取叠加）
  };

  // ----- ⑩ ★ 剧情状态（对话/事件模块；2026-09-14） -----
  story: {
    /** 对话/事件写入的标记（数值；条件求值只判真假） */
    flags: Record<string, number>;
    /** 事件运行记录：id → { count 完成次数, lastDay 最近完成天 }（once/冷却判定） */
    events: Record<string, { count: number; lastDay: number }>;
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

// ============================================================
// 4. 战斗属性计算（★ 唯一加成入口，完全配置驱动）
// ============================================================

/** ★ 显示用战斗属性（基础×遗物；供属性面板"永久"列参考，实体数值一律走 EffectSystem） */
export interface PlayerCombatStats {
  maxHp: number;
  attackPower: number;
  defense: number;
}

/** 遗物配置（原局外道具：只可抽取、不入背包；拥有即全局永久生效） */
export interface RelicItemConfig {
  id: string;
  name: string;
  rarity: number;
  description: string;
  /**
   * ★ 标识分类（2026-09-15）：决定 UI 上挂什么牌子。
   *   - 'relic'（默认）：遗物 —— 抽卡结果标「遗物」、进遗物面板
   *   - 'boss'：BOSS —— 抽卡结果标「BOSS」、不进遗物计数/遗物列表
   *   注意：两者共用 outOfRun.owned 存储 + RELIC_ITEM_CONFIG 配置（普瑞赛斯就是这样：
   *   她是 6★ Boss，但只要有 iconFrame/texture 就得有个能查名字/图标的地方）。
   */
  kind?: 'relic' | 'boss';
  /** FTX 纹理路径（仅展示用） */
  texture?: string;
  /** ★ 多帧图标：根据拥有数量挑选 FTX 帧（count=拥有数；省略恒为第 0 帧） */
  iconFrame?: (count: number) => number;
  /** ★ 效果列表（每条独立管线；type → RelicEffects 注册表处理器）。
   *  一个遗物可挂多条效果（如"每日属性 + 开局道具"），核心代码零改动。 */
  effects?: RelicEffectConfig[];
}


/** ★ 遗物修正汇总（效果源 'relic' 的原始乘区；EffectSystem 消费） */
export interface RelicStatModifiers {
  mulHp: number;
  mulAtk: number;
  mulDef: number;
  bonusHp: number;
  bonusAtk: number;
  bonusDef: number;
  respawnTimeMul: number;
  /** ★ 生命回复加值（每秒；来源 = 遗物 regen 效果，供实体 flat.hpRegen） */
  bonusRegen: number;
}

/** ★ 汇总遗物修正（computeCombatStats 与 EffectSystem 遗物源共用同一结算） */
export function computeRelicModifiers(
  session: GameSession,
  relicItemConfig?: Record<string, RelicItemConfig>,
): RelicStatModifiers {
  const day = session.meta.day;
  const deaths = session.meta?.deaths ?? 0;
  const acc: RelicStatAccumulator = {
    mulHp: 1, mulAtk: 1, mulDef: 1,
    bonusHp: 0, bonusAtk: 0, bonusDef: 0,
    respawnTimeMul: 1,
    bonusRegen: 0,
  };
  eachOwnedRelic(session, relicItemConfig ?? ({} as Record<string, RelicItemConfig>), (cfg, count) => {
    for (const eff of cfg.effects ?? []) {
      relicEffectRegistry.get(eff.type)?.modifyStats?.(
        { session, day, deaths, count, acc },
        eff,
      );
    }
  });
  return acc;
}

export function computeCombatStats(
  session: GameSession,
  relicItemConfig?: Record<string, RelicItemConfig>,
): PlayerCombatStats {
  const base = session.player;
  const acc = computeRelicModifiers(session, relicItemConfig);

  return {
    maxHp: Math.floor(base.maxHp * acc.mulHp) + acc.bonusHp,
    attackPower: Math.floor(base.attackPower * acc.mulAtk) + acc.bonusAtk,
    defense: Math.floor(base.defense * acc.mulDef) + acc.bonusDef,
  };
}

// ============================================================
// 5. 创建新游戏存档
// ============================================================

/** ★ 主要种子：新局随机生成（1 ~ 2^31-1；随存档持久，地图 = 主种子 × 天数） */
export function newRunSeed(): number {
  return 1 + Math.floor(Math.random() * 0x7ffffffe);
}

/** ★ 当天地图种子 = 主种子 × 天数 混合（确定性 32 位）。
 *  同主种子同天恒同图（重进/回放一致）；不同天/不同局不同图。
 *  RasterMap 生成、外观烘焙、装饰噪声全部以本值为 seed。 */
export function dailyMapSeed(mainSeed: number, day: number): number {
  let h = (Math.imul(mainSeed | 0, 0x9e3779b1) ^ Math.imul(day | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

export function createNewSession(): GameSession {
  const player = createEmptyGrid(4, 6);
  // 开荒种子：六区兄弟（六种基础材料）各一份，背包首行展示
  SIX_BROTHER_MATERIAL_IDS.forEach((id, i) => {
    player[0][i] = { itemId: id, stackSize: 1 };
  });
  return {
    meta: {
      version: '0.2.0',
      day: 1,
      seed: newRunSeed(),
      totalDaysSurvived: 0,
      deaths: 0,
      createdAt: new Date().toISOString(),
      lastSavedAt: new Date().toISOString(),
    },
    player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, slots: Array<null>(SLOT_COUNT).fill(null) },
    inventories: {
      base: createEmptyGrid(30, 30),
      ship: createEmptyGrid(8, 10),
      player,
    },
    ship: {
      hp: 1000, maxHp: 1000, shield: 200, armor: 5,
      fuel: 60, fuelMax: 60,
      position: { x: 50.6, z: 101.6 },
      techTree: [], turrets: [],
    },
    gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
    dayProgress: { hasDepartedToday: false },
    // ★ 开局自带遗物：魔王的黑冠 + 祖宗发射器（维什戴尔的信物）；其余靠卡池抽取
    outOfRun: { owned: { ...STARTER_RELICS } },
    story: { flags: {}, events: {} },
  };
}

/** ★ 开局自带遗物（新局默认；维什戴尔信物） */
export const STARTER_RELICS: Record<string, number> = {
  black_crown: 1,
  zuzong_launcher: 1,
};