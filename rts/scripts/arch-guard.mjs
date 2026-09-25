// ============================================================
// arch-guard —— RTS 架构护栏（移植自 全新的游戏/scripts/arch-guard.mjs，2026-09-24）
// 用法：npm run guard
// ============================================================
// 检查四类问题：
//   ① 文件膨胀：单文件超 LINE_LIMIT 行（KNOWN_BIG 只警告、不失败；HARD_CAP 硬失败）
//   ② 命令单源：board.issue 唯一写口 = SquadTactics；issueOrder 只从蜂群引擎出
//   ③ 迁移不回潮：main.ts 不得重新长出已迁出的刷怪函数；索敌候选必须是活对象
//   ④ 配置真源同步：遗物三处登记 / BGM 表与类型 / 敌军名册素材与掉落 / isAir 配对
// 只用正则读文本，不 import TS（无需构建）。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('src');
const LINE_LIMIT = 1200;
/** 硬天花板：任何文件都不许超过这个行数（KNOWN_BIG 也照样失败）——
 *  已知债务可以"还没还"，但不许一边欠债一边继续长 */
const HARD_CAP = 3800;
/** 已知大文件（技术债务）：只警告，不算失败 —— 修好后从表里删掉 */
const KNOWN_BIG = new Set([
  'modes/WorldMode.ts',                  // 迁移残骸：main.ts 已内联世界，搬完即删
  'services/map/ChunkManager.ts',
  'ui/base/GachaOverlay.ts',
  'services/map/decor/MapEntityDecorBase.ts',
  'services/map/TerrainMaterial.ts',
  'vendor/player/fluid/FluidSolver.ts',
  'systems/swarm/SwarmCommander.ts',     // 蜂群收口期债务：环形/夹环/兜底/涉水都在这里
]);

const errors = [];
const warns = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');
/** 去注释行（防止注释里的调用点/函数名误判） */
const codeOf = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const srcOf = new Map(files.map((p) => [rel(p), fs.readFileSync(p, 'utf8')]));

// ---------- ① 文件膨胀 ----------
const big = files
  .map((p) => ({ rel: rel(p), n: fs.readFileSync(p, 'utf8').split('\n').length }))
  .filter((f) => f.n > LINE_LIMIT)
  .sort((a, b) => b.n - a.n);
for (const f of big) {
  const msg = `${f.rel} = ${f.n} 行（上限 ${LINE_LIMIT}）`;
  if (KNOWN_BIG.has(f.rel)) warns.push(`已知债务 ${msg}`);
  else errors.push(`文件膨胀 ${msg}`);
}
for (const f of big) {
  if (f.n > HARD_CAP) errors.push(`硬天花板 ${f.rel} = ${f.n} 行（>${HARD_CAP}，先拆再写）`);
}

// ---------- ② 命令单源（旧黑板已删；回潮防护） ----------
// 命令单源现由 G1/G2 保证（engine/OrderWriter 唯一写口）；旧 board.issue / issueOrder 不允许回潮
const boardWriters = [...srcOf].filter(([, s]) => /\.board\.issue\(/.test(codeOf(s))).map(([r]) => r);
if (boardWriters.length > 0) {
  errors.push(`命令单源：旧 board.issue 回潮（${boardWriters.join(', ')}）——命令只经 engine/OrderWriter`);
}
for (const [r, s] of srcOf) {
  if (/\.issueOrder\(/.test(codeOf(s))) errors.push(`命令单源：${r} 调旧 issueOrder（已删；应走 engine/OrderWriter）`);
}

// ---------- ③ 迁移不回潮 ----------
// 刷怪/生成子系统已迁出 main.ts（现居 systems/spawn/WorldSpawner.ts）
const mainSrc = codeOf(srcOf.get('main.ts') ?? '');
const MOVED_OUT = ['scanAndSpawnWaves', 'spawnDirectorWave', 'spawnWaveNear', 'pickMob',
  'demoteFarEnemies', 'updateShipGroupWarning', 'agentMelee', 'nearestTauntSentinel',
  'spawnStressAgents', 'mobAgentStats', 'spawnOne', 'quotaAllows', 'promoteAgent',
  'createEnemyEntity', 'spawnAtRandomPointInChunk', 'refreshEnemyScale', 'spawnBoss',
  'onBossDefeated'];
for (const name of MOVED_OUT) {
  if (new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`).test(mainSrc)) {
    errors.push(`main.ts: ${name} 又长回来了（应留在 systems/spawn/WorldSpawner）`);
  }
}
// 索敌候选必须是"活对象"（TargetCandidates.ts）：推坐标字面量 → ctx.target 退化成快照
{
  const tc = codeOf(srcOf.get('modes/world/TargetCandidates.ts') ?? '');
  if (!tc) {
    warns.push('TargetCandidates.ts 不存在（改名/移除？本项护栏需同步更新）');
  } else {
    if (/out\.push\(\s*\{/.test(tc)) errors.push('TargetCandidates: 推入了坐标字面量 → 索敌目标退化成快照');
    if (!/slots\[/.test(tc)) errors.push('TargetCandidates: 没引用活对象槽 slots（索敌候选必须是活对象）');
  }
}

// ---------- ④ 配置真源同步 ----------
// 遗物：relics.ts / ItemIconRegistry.ts / gachaPool.json 三处必须一致
const relicSrc = read('config/relics.ts');
const iconSrc = read('services/item/ItemIconRegistry.ts');
const pool = JSON.parse(fs.readFileSync(path.join(SRC, 'config/gachaPool.json'), 'utf8'));

const relicIds = new Set(
  [...relicSrc.matchAll(/^\s{2}'?([a-z0-9_]+)'?:\s*\{/gm)].map((m) => m[1]),
);
const ftxBlock = (iconSrc.match(/FTX_ICON_SOURCES[^=]*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';
const iconIds = new Set([
  ...[...ftxBlock.matchAll(/^\s{2}([a-zA-Z0-9_]+):/gm)].map((m) => m[1]),
  ...[...files.flatMap((p) => [...fs.readFileSync(p, 'utf8').matchAll(/registerDynamicIcon\(\s*'([^']+)'/g)].map((m) => m[1]))],
]);
const poolIds = new Set();
(function collect(node) {
  if (Array.isArray(node)) return node.forEach(collect);
  if (node && typeof node === 'object') {
    if (typeof node.id === 'string') poolIds.add(node.id);
    for (const v of Object.values(node)) collect(v);
  }
})(pool);

if (relicIds.size === 0) {
  warns.push('relics.ts 没解析出条目（正则可能失效，请人工确认）');
} else {
  // ★ kind:'boss' 的池内条目不是遗物（无图标面板；旧项目在 main.ts 里 registerDynamicIcon，
  //   rts 世界模式未接抽卡 UI → 只提示，接回时补注册）
  const bossIds = new Set();
  const relicMarks = [...relicSrc.matchAll(/^\s{2}'?([a-z0-9_]+)'?:\s*\{/gm)];
  for (let k = 0; k < relicMarks.length; k++) {
    const from = relicMarks[k].index;
    const to = k + 1 < relicMarks.length ? relicMarks[k + 1].index : relicSrc.length;
    if (/kind:\s*'boss'/.test(relicSrc.slice(from, to))) bossIds.add(relicMarks[k][1]);
  }
  for (const id of relicIds) {
    if (bossIds.has(id)) { warns.push(`BOSS 档 ${id}: 不在遗物图标表（rts 未接抽卡/遗物 UI）`); continue; }
    if (!iconIds.has(id)) errors.push(`遗物 ${id}: ItemIconRegistry.FTX_ICON_SOURCES 未登记（图标会空白）`);
    if (!poolIds.has(id)) warns.push(`遗物 ${id}: gachaPool.outOfRunItems 未登记（抽不到）`);
  }
}

// BGM：表键与手写 BgmKey 联合类型必须一致（漏改 = TS2353，已踩两次）
const bgmSrc = read('config/bgm.ts');
const tableKeys = new Set([...bgmSrc.matchAll(/^\s{2}'?([a-zA-Z]+)'?:\s*\[?/gm)].map((m) => m[1]));
const m = bgmSrc.match(/type BgmKey\s*=([^;]+);/);
if (m) {
  const typeKeys = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  for (const k of tableKeys) if (!typeKeys.has(k)) errors.push(`bgm.ts: 表有 ${k}，BgmKey 联合类型漏了`);
  for (const k of typeKeys) if (!tableKeys.has(k)) errors.push(`bgm.ts: BgmKey 有 ${k}，表里没有`);
}

// 敌军名册：file 必须在 public 下存在、掉落 id 必须在 items.json（静默失败类）
const rosterSrc = read('config/enemyRoster.ts');
const itemsSrc = JSON.parse(fs.readFileSync(path.join(SRC, 'config/items.json'), 'utf8'));
const itemIds = new Set((itemsSrc.items ?? []).map((i) => i.id));

const rosterFiles = [...rosterSrc.matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1]);
const rosterIds = [...rosterSrc.matchAll(/^\s{4}id:\s*'([^']+)'/gm)].map((m) => m[1]);
if (rosterFiles.length === 0) {
  warns.push('enemyRoster.ts 没解析出 file（正则可能失效，请人工确认）');
}
const enemyDir = path.join(process.cwd(), 'public/characters/enemies');
for (const f of rosterFiles) {
  if (!fs.existsSync(path.join(enemyDir, f))) {
    errors.push(`enemyRoster: 素材缺失 public/characters/enemies/${f}`);
  }
}
for (const d of rosterSrc.matchAll(/itemId:\s*'([^']+)'/g)) {
  if (!itemIds.has(d[1])) errors.push(`enemyRoster: 掉落 id "${d[1]}" 不在 items.json`);
}
if (rosterIds.length !== new Set(rosterIds).size) {
  errors.push('enemyRoster: 有重复的 id（mobIndex 回查会错位）');
}
if (fs.existsSync(enemyDir) && rosterFiles.length) {
  for (const f of fs.readdirSync(enemyDir)) {
    if (!f.endsWith('.ftx3.gz')) continue;
    if (!rosterFiles.includes(f)) warns.push(`enemyRoster: public 下有未登记帧包 ${f}（不会生成）`);
  }
}

// 空中层：名册 isAir 必须配套 airAltitude（静默用兜底高度 = 数值不是设计值）
{
  const idMarks = [...rosterSrc.matchAll(/^\s{4}id:\s*'([^']+)'/gm)];
  const airIds = [];
  for (let k = 0; k < idMarks.length; k++) {
    const from = idMarks[k].index;
    const to = k + 1 < idMarks.length ? idMarks[k + 1].index : rosterSrc.length;
    const block = rosterSrc.slice(from, to);
    const isAir = /isAir:\s*true/.test(block);
    const hasAlt = /airAltitude:\s*[\d.]+/.test(block);
    if (isAir && !hasAlt) errors.push(`enemyRoster: "${idMarks[k][1]}" 设了 isAir 却没给 airAltitude（会静默用兜底高度）`);
    if (!isAir && hasAlt) errors.push(`enemyRoster: "${idMarks[k][1]}" 不是空中单位却写了 airAltitude（无效配置）`);
    if (isAir) airIds.push(idMarks[k][1]);
  }
  if (airIds.length) console.log(`[arch-guard] 空中层 ${airIds.length} 种：${airIds.join(', ')}`);
}

// ---------- ⑤ 重写铁律 G1~G9（只查新目录；旧代码按 P1~P4 逐期搬入） ----------
// 《蜂群重写计划.md》§5.1：新模块从第一天起必须满足；旧路径迁移期豁免。
const NEW_DIRS = ['systems/swarm/engine/', 'systems/swarm/squad/', 'systems/swarm/nav/', 'entity/base/'];
const newFiles = [...srcOf].filter(([r]) => NEW_DIRS.some((d) => r.startsWith(d)));
if (newFiles.length) {
  /** G1 单一发令器：所有引擎命令只经 OrderWriter 下发 */
  // 允许经唯一发令器调用（writer.issue）；禁止绕过写口直呼
  const ENGINE_ISSUE = /\.(?:issueChecked|issueOrder)\(|(?<!writer)\.issue\(/;
  /** G2 队令单写口：orderStore/orders 的 set/write 只许 engine/OrderWriter.ts */
  const STORE_WRITE = /(?:orderStore|orders)\.(?:set|write)\s*\(/;
  /** G3 成员指令：directive 列只许 squad/（队长层）写 */
  const DIRECTIVE_WRITE = /directive\w*\s*\[[^\]]*\]\s*=/;
  /** G4 信息单源：世界位置只许 engine/ 读（禁直读 spawn/hooks） */
  const WORLD_READ = /(?:hooks\.(?:playerX|playerZ|shipX|shipZ)|spawn\.[xz]\b)/;
  /** G5 保护锚专用：squad/ 不得写 anchor */
  const ANCHOR_WRITE = /\banchor\s*[:=]/;
  /** G6 时间尺度：engine/ 与 squad/ 禁裸 performance.now()（now 从 tick 参数传入） */
  const NOW_CALL = /performance\.now\(\)/;
  /** G7 寻路不改地形：nav/ 禁写地形表列 */
  const TABLE_WRITE = /(?:weld|climb|dropAt)\s*\[[^\]]*\]\s*=/;
  for (const [r, s] of newFiles) {
    const c = codeOf(s);
    const inEngine = r.startsWith('systems/swarm/engine/');
    const inSquad = r.startsWith('systems/swarm/squad/');
    const inNav = r.startsWith('systems/swarm/nav/');
    // G1 单一发令器（用户定）：所有引擎命令只经 OrderWriter 下发
    if (r !== 'systems/swarm/engine/OrderWriter.ts' && ENGINE_ISSUE.test(c)) {
      errors.push(`G1 ${r}: 命令必须经唯一发令器 engine/OrderWriter.ts 下发（issueChecked/issueOrder/issue）`);
    }
    if (r !== 'systems/swarm/engine/OrderWriter.ts' && STORE_WRITE.test(c)) errors.push(`G2 ${r}: 队令单写口只许 engine/OrderWriter.ts`);
    if (!inSquad && DIRECTIVE_WRITE.test(c)) errors.push(`G3 ${r}: 成员指令（directive 列）只许 squad/ 写`);
    if (!inEngine && WORLD_READ.test(c)) errors.push(`G4 ${r}: 世界位置由引擎提供（禁直读 spawn/hooks）`);
    if (inSquad && r !== 'systems/swarm/squad/State.ts' && ANCHOR_WRITE.test(c)) errors.push(`G5 ${r}: 保护锚（anchor）只属于引擎的保护令`);
    if ((inEngine || inSquad) && NOW_CALL.test(c)) errors.push(`G6 ${r}: 命令/规划层禁裸 performance.now()（now 从参数传入）`);
    // ★ 表构建器 PassTable.ts 是表的所有者（建表即写表列）；G7 约束的是**寻路算法**不改地形
    if (inNav && r !== 'systems/swarm/nav/PassTable.ts' && TABLE_WRITE.test(c)) errors.push(`G7 ${r}: nav/ 只读地形表，禁写裁决/高度`);
    const n = s.split('\n').length;
    if (n > 800) errors.push(`G8 ${r} = ${n} 行（重写目标 ≤800）`);
    if (/(?:Manager|AttackQueues|TimerManager)\.ts$/.test(r) && !/readonly dbg\b/.test(c) && !/extends\s+RoleManager\b/.test(c)) {
      errors.push(`G9 ${r}: 管理器必须暴露 readonly dbg（探针/UI 契约；继承 RoleManager 亦可）`);
    }
  }
}

// ---------- 输出 ----------
const total = files.reduce((n, p) => n + fs.readFileSync(p, 'utf8').split('\n').length, 0);
console.log(`[arch-guard] ${files.length} 个 TS 文件 / ${total} 行`);
console.log(`[arch-guard] 命令写点 ${boardWriters.length} 处（board.issue）/ 大文件 ${big.length} 个`);
console.log(`[arch-guard] 重写新目录 ${newFiles.length} 文件（G1~G9 生效）`);
console.log(`[arch-guard] 遗物 ${relicIds.size} 件 / 图标 ${iconIds.size} / 池内 ${poolIds.size}`);
console.log(`[arch-guard] 敌军 ${rosterFiles.length} 种（名册真源 config/enemyRoster.ts）`);
for (const w of warns) console.warn(`  warn  ${w}`);
for (const e of errors) console.error(`  FAIL  ${e}`);
if (errors.length) {
  console.error(`[arch-guard] ${errors.length} 项不通过`);
  process.exit(1);
}
console.log(`[arch-guard] OK（${warns.length} 项已知债务警告）`);
