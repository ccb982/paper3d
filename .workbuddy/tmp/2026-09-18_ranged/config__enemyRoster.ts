// ============================================================
// enemyRoster —— 敌军名册（唯一真源）
// ============================================================
// ★ 2026-09-18 建立：此前"加兵种"要改两处（main.ts 加载 + WorldMode.MOB_BLUEPRINTS），
//   且 **WorldMode 用 `MOB_BLUEPRINTS[i % 3]` 按取模分配数值** —— 素材一多，
//   第 4/5/6… 个敌人会循环复用前三条数值（新敌人拿到错误的 AI/血量/掉落），
//   这是"注册新敌军"最容易踩的坑。现改为**一一对应名册**：加敌人只改本文件。
//
// 加一个敌军 = 本文件加一条：
//   ① 把帧包丢进 `public/characters/enemies/`（文件名写进 `file`）
//   ② 本文件加一条（id / name / file / ai / 数值 / 包组 / 权重 / 掉落）
//   零其他改动 —— 加载与 mobDefs 派生都从这里遍历。
//
// ★ 只 `import type` AIConfig（类型擦除，不进运行时依赖链）；AI 常量来自
//   `systems/ai/aiconfig.ts`（该文件零 import，无循环风险）。
// ============================================================

import type { AIConfig } from '../systems/ai/aiconfig';
import type { FtxAsset } from '../vendor/player/FtxAsset';
import {
  ROCK_BUG_AI, REUNION_AI, LAOJIE_AI,
  ROCK_GIANT_AI, WAR_CASTER_AI, AMP_CASTER_AI, CROSSBOW_AI,
  SEA_MONSTER_AI, BOMBER_AI, SHIELD_GUARD_AI, SARKAZ_SWORDSMAN_AI,
} from '../systems/ai/aiconfig';

/** 一条敌军配置（= MobDef 去掉 asset，加上素材定位信息） */
export interface EnemySpec {
  /** ★ 稳定键：日志 / 调试 / 存档迁移用；改中文名不动它 */
  id: string;
  /** 显示名（击杀播报 / 调试面板） */
  name: string;
  /** `public/characters/enemies/` 下的帧包文件名（含扩展名） */
  file: string;
  ai: AIConfig;
  hp: number;
  /** 防御（减法减伤） */
  defense: number;
  /** 攻击力加成（叠加在 AI 近战伤害上） */
  attackPower: number;
  /** 世界缩放（体型；也影响贴地锚点） */
  scale: number;
  /** 碰撞半径缩放 */
  collisionScale: number;
  /** 集群规模（一次落点生成几只） */
  pack: number;
  /** 随机抽取权重（相对值；越大越常见） */
  weight: number;
  /** 击杀掉落（每项独立掷概率） */
  drops: { itemId: string; chance: number; min: number; max: number }[];
  /** ★ 接地微调（世界单位；**叠加**在自动测量的底部余量之上；正 = 压得更深，负 = 抬高）。
   *  99% 的素材不用填 —— 底部留白由 FootAnchor 自动量出。只在两种情况下用：
   *    ① 美术底部留了"脚下的影子/尘土"仍在 bbox 内 → 需要再压一点；
   *    ② 本来就该悬空的单位（飞行/漂浮）→ 给负值。
   *  缺省 0。 */
  groundSink?: number;
}

/** 素材目录（public 下） */
export const ENEMY_DIR = '/characters/enemies/';

/** 已加载的敌军素材（id ↔ asset；按 id 回查名册，**不依赖加载顺序**） */
export interface EnemyAssetEntry {
  id: string;
  asset: FtxAsset;
}

/**
 * ★ 敌军名册（数组顺序 = 加载顺序 = mobIndex；mobIndex 是代理池/图集/掉落的回查键）
 * 设计口径：炮灰成群、重装高防低攻、远程拉开距离打、精英高速高攻脆、
 *          小 boss 极高血+大攻击圈。
 */
export const ENEMY_ROSTER: EnemySpec[] = [
  // ---------- 原始三兵种（2026-09-09 数值定稿，勿动） ----------
  {
    id: 'rock_bug', name: '原石虫',
    file: '原石虫，杂兵.ftx3.gz',
    ai: ROCK_BUG_AI,
    hp: 22, defense: 0, attackPower: 0,
    scale: 1.6, collisionScale: 1.1, pack: 4, weight: 6,
    drops: [{ itemId: 'polyester', chance: 0.35, min: 1, max: 1 }],
  },
  {
    id: 'reunion', name: '整合运动人员',
    file: '整合运动人员，杂兵.ftx3.gz',
    ai: REUNION_AI,
    hp: 75, defense: 3, attackPower: 2,
    scale: 2, collisionScale: 1.25, pack: 1, weight: 6,
    drops: [
      { itemId: 'polyester', chance: 0.3, min: 1, max: 1 },
      { itemId: 'device', chance: 0.8, min: 1, max: 2 },
    ],
  },
  {
    id: 'laojie', name: '牢杰',
    file: '牢杰，杂兵.ftx3.gz',
    ai: LAOJIE_AI,
    hp: 45, defense: 0, attackPower: 12,
    scale: 2, collisionScale: 1.25, pack: 1, weight: 12,
    drops: [{ itemId: 'device', chance: 0.95, min: 1, max: 3 }],
  },

  // ---------- 2026-09-18 新增 ----------
  // 海怪：中血中速的两只小队；潮汐味（★ 目前仍刷在陆地 —— 刷怪闸门排除 liquid 地块，
  //   要真"从水里爬上来"得改 WorldSpawner 的落点闸门，见文末 TODO）
  {
    id: 'sea_monster', name: '海怪',
    file: '海怪，小兵.ftx3.gz',
    ai: SEA_MONSTER_AI,
    hp: 90, defense: 2, attackPower: 3,
    scale: 2.3, collisionScale: 1.3, pack: 2, weight: 8,
    drops: [
      { itemId: 'raw_rock', chance: 0.5, min: 1, max: 2 },
      { itemId: 'ketone', chance: 0.2, min: 1, max: 1 },
    ],
  },
  // 萨卡兹大剑手：主力近战，"较强的杂兵"——血厚于牢杰、攻低于牢杰、速度居中
  {
    id: 'sarkaz_swordsman', name: '萨卡兹大剑手',
    file: '萨卡兹大剑手，较强的杂兵.ftx3.gz',
    ai: SARKAZ_SWORDSMAN_AI,
    hp: 70, defense: 1, attackPower: 6,
    scale: 2.2, collisionScale: 1.25, pack: 1, weight: 7,
    drops: [
      { itemId: 'device', chance: 0.6, min: 1, max: 2 },
      { itemId: 'sugar', chance: 0.4, min: 1, max: 1 },
    ],
  },
  // 盾卫：重装。极慢 + 高防高血 + 低攻 —— 打不动它但它也打不动你，典型的"耗时间"
  {
    id: 'shield_guard', name: '盾卫',
    file: '盾卫，重装.ftx3.gz',
    ai: SHIELD_GUARD_AI,
    hp: 160, defense: 10, attackPower: 1,
    scale: 2.4, collisionScale: 1.4, pack: 1, weight: 5,
    drops: [
      { itemId: 'iron_grain', chance: 0.9, min: 1, max: 2 },
      { itemId: 'raw_rock', chance: 0.5, min: 1, max: 1 },
    ],
  },
  // 远程弩手：最轻的远程，射速快、伤害低（远程兵的最低档）
  {
    id: 'crossbow', name: '远程弩手',
    file: '远程弩手小怪.ftx3.gz',
    ai: CROSSBOW_AI,
    hp: 34, defense: 0, attackPower: 2,
    scale: 1.9, collisionScale: 1.1, pack: 1, weight: 7,
    drops: [
      { itemId: 'polyester', chance: 0.6, min: 1, max: 1 },
      { itemId: 'sugar', chance: 0.3, min: 1, max: 1 },
    ],
  },
  // 扩音术士：中档远程，比弩手痛、比战争术士慢
  {
    id: 'amp_caster', name: '扩音术士',
    file: '扩音术士，远程.ftx3.gz',
    ai: AMP_CASTER_AI,
    hp: 40, defense: 0, attackPower: 2,
    scale: 2.0, collisionScale: 1.15, pack: 1, weight: 5,
    drops: [
      { itemId: 'sugar', chance: 0.5, min: 1, max: 1 },
      { itemId: 'device', chance: 0.35, min: 1, max: 1 },
    ],
  },
  // 战争术士：重火力。最远射程 + 最高单发，但血薄移速慢 —— 优先点掉的目标
  {
    id: 'war_caster', name: '战争术士',
    file: '战争术士，重火力.ftx3.gz',
    ai: WAR_CASTER_AI,
    hp: 55, defense: 0, attackPower: 6,
    scale: 2.1, collisionScale: 1.2, pack: 1, weight: 3,
    drops: [
      { itemId: 'ketone', chance: 0.35, min: 1, max: 1 },
      { itemId: 'device', chance: 0.7, min: 1, max: 2 },
    ],
  },
  // 爆炸飞行怪：最快 + 极脆 + 单发最痛（自爆型）。★ 目前无空中层 → 走地面寻路
  {
    id: 'bomber', name: '爆炸飞行怪',
    file: '爆炸飞行怪.ftx3.gz',
    ai: BOMBER_AI,
    hp: 26, defense: 0, attackPower: 4,
    scale: 1.9, collisionScale: 1.1, pack: 1, weight: 4,
    drops: [
      { itemId: 'iron_grain', chance: 0.6, min: 1, max: 1 },
      { itemId: 'device', chance: 0.5, min: 1, max: 1 },
    ],
  },
  // 原石虫巨人：小 boss。极低频 + 极高血 + 大攻击圈 + 最高掉落
  {
    id: 'rock_giant', name: '原石虫巨人',
    file: '原石虫巨人，小boss.ftx3.gz',
    ai: ROCK_GIANT_AI,
    hp: 320, defense: 6, attackPower: 8,
    scale: 3.6, collisionScale: 1.9, pack: 1, weight: 1,
    drops: [
      { itemId: 'iron_grain', chance: 1.0, min: 2, max: 3 },
      { itemId: 'device', chance: 1.0, min: 3, max: 5 },
      { itemId: 'ketone', chance: 0.8, min: 1, max: 2 },
    ],
  },
];

/** id → spec（O(1) 回查；WorldMode 按 id 装配 mobDefs） */
export const ENEMY_BY_ID: Map<string, EnemySpec> = new Map(
  ENEMY_ROSTER.map((s) => [s.id, s]),
);

/** ★ 兜底数值：素材有 id 但名册查不到时用它（保证 mobDefs 无空洞、下标即 mobIndex）。
 *  取"整合运动人员"= 中等血/防/攻，任何定位都不会太离谱；再不行退名册第一条。 */
export const ENEMY_FALLBACK: EnemySpec = ENEMY_BY_ID.get('reunion') ?? ENEMY_ROSTER[0]!;

/** 该行兵种的素材 URL（encodeURI：文件名含中文与全角逗号） */
export function enemyAssetUrl(spec: EnemySpec): string {
  return encodeURI(ENEMY_DIR + spec.file);
}

// ============================================================
// TODO（名册已登记但引擎尚未支持的形态；需要时按此顺序补）
//   ① 真弹道：现在"远程"= 大 attackRange 的瞬时命中（无弹道视觉）。
//      要子弹得加 behaviors 的 `rangedShot` + 给敌对阵营分配 bulletAsset。
//   ② 空中层（爆炸飞行怪）：`isAir`/`altitude` 需进 AgentSnapshot SoA +
//      独立空中寻路（《蜂群架构.md》§25）——现按地面单位跑。
//   ③ 海怪下水：WorldSpawner 落点闸门排除 `genRole === 'liquid'`。
// ============================================================
