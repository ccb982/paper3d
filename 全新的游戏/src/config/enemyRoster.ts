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
import type { UnitAttackType, UnitRole, MobTactics } from '../entity/SwarmUnit';
import {
  ROCK_BUG_AI, REUNION_AI, LAOJIE_AI,
  ROCK_GIANT_AI, WAR_CASTER_AI, AMP_CASTER_AI, CROSSBOW_AI,
  SEA_MONSTER_AI, BOMBER_AI, SHIELD_GUARD_AI, SARKAZ_SWORDSMAN_AI,
} from '../systems/ai/aiconfig';

/** 一条敌军配置（= MobDef 去掉 asset，加上素材定位信息） */
export interface EnemySpec {
  /** ★ 稳定键：日志 / 调试 / 存档迁移用；改中文名不动它 */
  id: string;
  /** ★ 兵种角色（同质编队/小队属性依据；缺省 grunt） */
  role?: UnitRole;
  /** ★ 攻击类型（缺省 melee；远程显式给 ranged） */
  attackType?: UnitAttackType;
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
  /** ★ 空中单位（2026-09-18 落地）：**独立空中层**
   *  —— 不参与地面寻路（不看流场/不绕坑/不涉水）、不会掉坑判死、
   *  以 `airAltitude`（相对地表）悬停，并带轻微上下浮动。
   *  两条渲染路径都按此抬升：L2 代理（`SwarmBatch.sync`）与 L3 实体（`WorldMode.clampCharacter`）。
   *  见《RTS架构.md》§7。 */
  isAir?: boolean;
  /** 空中悬停高度（米，**相对地表**；缺省引擎兜底 `AIR_ALTITUDE_DEFAULT`，见 AgentPool）。
   *  仅 `isAir` 有效。 */
  airAltitude?: number;
  /** ★ 自爆标签（爆炸飞行怪；基类字段） */
  suicide?: boolean;
  /** ★ 编制模式：normal = 同质小队 4~12；singleton = 1 单位 1 小队（Boss/小 boss） */
  squadMode?: 'normal' | 'singleton';
  /** ★ 精英标签（大队概率额外携带；2026-09-19） */
  elite?: boolean;
  /** ★ 单例且不降格（Boss：永保 active，不因距离降格回代理） */
  noDemote?: boolean;
  /** ★ 施工能力（2026-09-20）：会挖战壕/造掩体的兵种。
   *  ★ 与 role 解耦：后勤不一定能施工、杂兵也可以兼任施工（用户定调）。 */
  canBuild?: boolean;
  /** ★ 逐兵种战术配置（2026-09-21 用户定调：兵种战术独立化）。
   *  解析：通用战术 ← 小队属性战术 ← **本字段** ← 施工标签 override。 */
  tactics?: MobTactics;
  /** ★ 始终面对相机（2026-09-18）：L3 贴片是否强制 billboard。
   *  缺省 = 自动检测：素材**没有「后」帧** → 强制 billboard（否则转身 180° 会露出
   *  背面空白/镜像）；有「后」帧 = 双向贴片（相机侧换帧 + 转身）。 */
  billboard?: boolean;
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
    role: 'assault', attackType: 'melee',
    // ★ 逐兵种战术：虫群两翼包抄
    tactics: { engine: { mode: 'flank', chase: true, retreatHp: 0.25 } },
    ai: ROCK_BUG_AI,
    hp: 22, defense: 0, attackPower: 0,
    scale: 1.6, collisionScale: 1.1, pack: 4, weight: 6,
    drops: [{ itemId: 'polyester', chance: 0.35, min: 1, max: 1 }],
  },
  {
    id: 'reunion', name: '整合运动人员',
    file: '整合运动人员，杂兵.ftx3.gz',
    role: 'shield', attackType: 'melee',
    // ★ 施工能力：杂兵兼任施工（挖战壕/造掩体；与 role 解耦）
    canBuild: true,
    // ★ 逐兵种战术：施工优先（死守不退）
    tactics: { engine: { mode: 'build', chase: false, screenDist: 0 }, unit: { lowHp: 'fight' } },
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
    role: 'assault', attackType: 'melee', elite: true,
    // ★ 逐兵种战术：精英突击（低血才撤）
    tactics: { engine: { mode: 'flank', chase: true, retreatHp: 0.15 } },
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
    role: 'assault', attackType: 'melee',
    // ★ 逐兵种战术：正面压迫
    tactics: { engine: { mode: 'press', chase: true, retreatHp: 0.2 } },
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
    role: 'logistics', attackType: 'melee',
    // ★ 逐兵种战术：后方集结
    tactics: { engine: { mode: 'regroup', chase: false, retreatHp: 0.55 } },
    ai: SARKAZ_SWORDSMAN_AI,
    hp: 70, defense: 1, attackPower: 6,
    scale: 2.2, collisionScale: 1.25, pack: 1, weight: 6,
    drops: [
      { itemId: 'device', chance: 0.6, min: 1, max: 2 },
      { itemId: 'sugar', chance: 0.4, min: 1, max: 1 },
    ],
  },
  // 盾卫：重装。极慢 + 高防高血 + 低攻 —— 打不动它但它也打不动你，典型的"耗时间"
  {
    id: 'shield_guard', name: '盾卫',
    file: '盾卫，重装.ftx3.gz',
    role: 'shield', attackType: 'melee',
    // ★ 逐兵种战术：前出掩护、死守不退
    tactics: { engine: { mode: 'screen', chase: true, retreatHp: 0 }, unit: { lowHp: 'fight' } },
    ai: SHIELD_GUARD_AI,
    hp: 160, defense: 10, attackPower: 1,
    scale: 2.4, collisionScale: 1.4, pack: 1, weight: 5,
    drops: [
      { itemId: 'iron_grain', chance: 0.9, min: 1, max: 2 },
      { itemId: 'raw_rock', chance: 0.5, min: 1, max: 1 },
    ],
  },
  // 远程弩手：最轻的远程，射速快、伤害低（远程兵的最低档）
  // ★ 2026-09-18：体型上调一档（1.9 → 2.6，碰撞同比例）—— 用户"放大一下弩手，就是远程杂兵"
  {
    id: 'crossbow', name: '远程弩手',
    file: '远程弩手小怪.ftx3.gz',
    role: 'ranged', attackType: 'ranged',
    // ★ 逐兵种战术：掩体后驻守（射程 50 → 站 45）
    tactics: { engine: { mode: 'garrison', chase: false, standoff: 45, preferCover: true, retreatHp: 0.35 } },
    ai: CROSSBOW_AI,
    hp: 34, defense: 0, attackPower: 2,
    scale: 2.6, collisionScale: 1.45, pack: 1, weight: 7,
    drops: [
      { itemId: 'polyester', chance: 0.6, min: 1, max: 1 },
      { itemId: 'sugar', chance: 0.3, min: 1, max: 1 },
    ],
  },
  // 扩音术士：中档远程，比弩手痛、比战争术士慢
  {
    id: 'amp_caster', name: '扩音术士',
    file: '扩音术士，远程.ftx3.gz',
    role: 'ranged', attackType: 'ranged',
    // ★ 逐兵种战术：掩体后驻守（射程 52 → 站 48）
    tactics: { engine: { mode: 'garrison', chase: false, standoff: 48, preferCover: true, retreatHp: 0.35 } },
    ai: AMP_CASTER_AI,
    hp: 40, defense: 0, attackPower: 2,
    scale: 2.0, collisionScale: 1.15, pack: 1, weight: 5,
    drops: [
      { itemId: 'sugar', chance: 0.5, min: 1, max: 1 },
      { itemId: 'device', chance: 0.35, min: 1, max: 1 },
    ],
  },
  // 战争术士：重火力。最远射程 + 最高单发，但血薄移速慢 —— 优先点掉的目标
  // ★ 2026-09-18：体型 ×2（2.1 → 4.2，碰撞同比例）—— 用户定调"敌人太小、战争术士放大两倍"
  // ★ 2026-09-18：加入**空中层**（悬停 3.2m 高空放火球；真弹道见 aiconfig WAR_CASTER_AI）
  {
    id: 'war_caster', name: '战争术士',
    file: '战争术士，重火力.ftx3.gz',
    role: 'ranged', attackType: 'ranged',
    // ★ 逐兵种战术：掩体后驻守（射程 55 → 站 50）
    tactics: { engine: { mode: 'garrison', chase: false, standoff: 50, preferCover: true, retreatHp: 0.4 } },
    ai: WAR_CASTER_AI,
    hp: 55, defense: 0, attackPower: 6,
    scale: 4.2, collisionScale: 2.4, pack: 1, weight: 3,
    isAir: true, airAltitude: 3.2,
    drops: [
      { itemId: 'ketone', chance: 0.35, min: 1, max: 1 },
      { itemId: 'device', chance: 0.7, min: 1, max: 2 },
    ],
  },
  // 爆炸飞行怪：最快 + 极脆 + 单发最痛（自爆型）。
  // ★ 2026-09-18：加入**空中层**（贴地 1.8m 低空扑脸；此前"无空中层"→ 走地面，已改）
  //   TODO：§25 的"只盘旋不缠斗 + 落点延迟引信轰炸"尚未实现 → 目前仍以贴脸挥击结算。
  {
    id: 'bomber', name: '爆炸飞行怪',
    file: '爆炸飞行怪.ftx3.gz',
    role: 'flyer', attackType: 'bombard', suicide: true,
    // ★ 逐兵种战术：轰炸直扑（自爆不撤）
    tactics: { engine: { mode: 'press', chase: true, retreatHp: 0 }, unit: { lowHp: 'fight' } },
    ai: BOMBER_AI,
    hp: 26, defense: 0, attackPower: 4,
    scale: 1.9, collisionScale: 1.1, pack: 1, weight: 4,
    isAir: true, airAltitude: 1.8,
    drops: [
      { itemId: 'iron_grain', chance: 0.6, min: 1, max: 1 },
      { itemId: 'device', chance: 0.5, min: 1, max: 1 },
    ],
  },
  // 原石虫巨人：小 boss。极低频 + 极高血 + 大攻击圈 + 最高掉落
  {
    id: 'rock_giant', name: '原石虫巨人',
    file: '原石虫巨人，小boss.ftx3.gz',
    role: 'assault', attackType: 'melee',
    squadMode: 'singleton', noDemote: true, elite: true,
    // ★ 逐兵种战术：小 boss 正面压迫（死战不退）
    tactics: { engine: { mode: 'press', chase: true, retreatHp: 0 }, unit: { lowHp: 'fight' } },
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
//   ① 真弹道：**已完成**（2026-09-18，`MobAIParams.ranged` + camp 路由 → arrow/fireball 池）。
//   ② 空中层：**基础层已完成**（2026-09-18）—— `isAir`/`airAltitude` 已进 AgentPool SoA、
//      独立于地面寻路（直线导航）、悬停渲染（L2 实例矩阵 / L3 clampCharacter）。
//      未做：§25 的"飞行兵只轰炸不缠斗"完整 sortie 循环（盘旋→投弹→延迟引信爆炸→返场），
//      目前飞行兵仍以贴脸挥击/法球结算。
//   ③ 海怪下水：WorldSpawner 落点闸门排除 `genRole === 'liquid'`。
//      ★ 注意：空中单位已豁免该闸门（可刷在水/坑上方），别把豁免连带删掉。
// ============================================================
