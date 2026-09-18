// ============================================================
// arch-guard —— 架构护栏（防止项目无序膨胀）
// 用法：npm run guard
// ============================================================
// 检查三类问题：
//   ① 文件膨胀：单文件超 LINE_LIMIT 行（超标文件在 KNOWN_BIG 里只警告、不失败）
//   ② 不变量退化：WorldMode 的 phase 直接赋值必须只有 1 处（setPhase 内部），
//      syncSceneBgm 调用点不能超过上限 —— 防止"每处手写副作用"卷土重来
//   ③ 配置真源不同步：遗物三处登记 / BGM 表与手写 BgmKey 联合类型
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
  'modes/WorldMode.ts',
  'services/map/ChunkManager.ts',
  'ui/base/GachaOverlay.ts',
  'vendor/player/fluid/FluidSolver.ts',
  'services/map/decor/MapEntityDecorBase.ts',
  'services/map/TerrainMaterial.ts',
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
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// ---------- ① 文件膨胀 ----------
const big = files
  .map((p) => ({ rel: path.relative(SRC, p).replace(/\\/g, '/'), n: fs.readFileSync(p, 'utf8').split('\n').length }))
  .filter((f) => f.n > LINE_LIMIT)
  .sort((a, b) => b.n - a.n);
for (const f of big) {
  const msg = `${f.rel} = ${f.n} 行（上限 ${LINE_LIMIT}）`;
  if (KNOWN_BIG.has(f.rel)) warns.push(`已知债务 ${msg}`);
  else errors.push(`文件膨胀 ${msg}`);
}
// 硬天花板：欠债可以，继续长不行
for (const f of big) {
  if (f.n > HARD_CAP) errors.push(`硬天花板 ${f.rel} = ${f.n} 行（>${HARD_CAP}，先拆再写）`);
}

// ---------- ② 不变量退化 ----------
const wm = read('modes/WorldMode.ts');
const count = (s, re) => (s.match(re) || []).length;
const phaseAssign = count(wm, /this\.phase = /g);
const setPhaseCalls = count(wm, /this\.setPhase\(/g);
const bgmCalls = count(wm, /syncSceneBgm\(\)/g);
if (phaseAssign !== 1) {
  errors.push(`WorldMode: this.phase 直接赋值 ${phaseAssign} 处（必须 = 1，即 setPhase 内部）`);
}
if (setPhaseCalls < 3) {
  errors.push(`WorldMode: setPhase 调用仅 ${setPhaseCalls} 处 —— 有赋值点绕过收口了吗？`);
}
if (bgmCalls > 8) {
  errors.push(`WorldMode: syncSceneBgm 调用 ${bgmCalls} 处（>8 = 又不收口了）`);
}
// ★ 已迁出的刷怪子系统不许回潮（2026-09-18 P1）
const MOVED_OUT = ['scanAndSpawnWaves', 'spawnDirectorWave', 'spawnWaveNear', 'pickMob',
  'demoteFarEnemies', 'updateShipGroupWarning', 'agentMelee', 'nearestTauntSentinel',
  'spawnStressAgents', 'mobAgentStats', 'spawnOne', 'quotaAllows', 'promoteAgent',
  'createEnemyEntity', 'spawnAtRandomPointInChunk', 'refreshEnemyScale', 'spawnBoss',
  'onBossDefeated'];
for (const name of MOVED_OUT) {
  if (new RegExp(`^\\s{2}(?:private |public )?${name}\\s*\\(`, 'm').test(wm)) {
    errors.push(`WorldMode: ${name} 又长回去了（应留在 systems/spawn/WorldSpawner）`);
  }
}

// ★ 索敌候选必须是"活对象"（2026-09-18 实测踩点）
//   `ctx.target` 只在 **patrol 的 seePlayer** 里被赋值 —— chase/attack 期间不再重跑索敌。
//   所以候选对象必须是"每帧原地更新 x/z 的活对象"（WorldMode.candSlots）。
//   一旦退回坐标字面量 `{ x: …, z: … }`，ctx.target 就退化成"看见那一刻的坐标快照"，
//   而 inRange / outOfRange / loseTarget 全按快照判定：
//     · 远程兵 attackFinished → chase（持续开火）→ 永不回 patrol → 永不重新索敌
//       → **永久锁死在旧坐标朝空气射击**（离屏实测：玩家跑到 38m 外，弹道偏角 145°）；
//     · 近战兵只是靠"打完回 patrol"侥幸重新索敌，同样在追鬼影。
{
  const candStart = wm.indexOf('private enemyTargetCandidates');
  const candBody = candStart < 0 ? '' : wm.slice(candStart, wm.indexOf('\n  }', candStart));
  if (!candBody) {
    errors.push('WorldMode: 找不到 enemyTargetCandidates（方法被改名/移除？本项护栏需同步更新）');
  } else {
    if (/out\.push\(\s*\{/.test(candBody)) {
      errors.push('enemyTargetCandidates: 推入了**坐标字面量** → ctx.target 退化成快照（远程兵会朝空气射击）');
    }
    if (!/candSlots/.test(candBody)) {
      errors.push('enemyTargetCandidates: 没引用活对象槽 candSlots（索敌候选必须是活对象）');
    }
  }
}

// ---------- ③ 配置真源同步 ----------
// 遗物：relics.ts / ItemIconRegistry.ts / gachaPool.json 三处必须一致
const relicSrc = read('config/relics.ts');
const iconSrc = read('services/item/ItemIconRegistry.ts');
const pool = JSON.parse(fs.readFileSync(path.join(SRC, 'config/gachaPool.json'), 'utf8'));

const relicIds = new Set(
  [...relicSrc.matchAll(/^\s{2}'?([a-z0-9_]+)'?:\s*\{/gm)].map((m) => m[1]),
);
// 图标两条来源：① FTX_ICON_SOURCES 表（`key: '/fx/...'`）② registerDynamicIcon('id', ...)
const ftxBlock = (iconSrc.match(/FTX_ICON_SOURCES[^=]*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';
const iconIds = new Set([
  ...[...ftxBlock.matchAll(/^\s{2}([a-zA-Z0-9_]+):/gm)].map((m) => m[1]),
  ...[...files.flatMap((p) => [...fs.readFileSync(p, 'utf8').matchAll(/registerDynamicIcon\(\s*'([^']+)'/g)].map((m) => m[1]))],
]);
// ★ 抽卡池分档存放（outOfRunItems / boss 档等，可能嵌套），递归收全部 id
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
  for (const id of relicIds) {
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

// 敌军名册：config/enemyRoster.ts 的 file 必须在 public 下存在、掉落 id 必须在 items.json
//   （★ "注册了新敌军但名字对不上" 是最常见的静默失败：素材在、名册有、文件名差一个字
//     → 加载时被 try/catch 吞掉，游戏里只是"这个兵种永远不出现"）
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
// 反向：目录里的帧包有没有漏登记（只查 .ftx3.gz；Boss 等 .scene.zip 走独立通道）
if (fs.existsSync(enemyDir) && rosterFiles.length) {
  for (const f of fs.readdirSync(enemyDir)) {
    if (!f.endsWith('.ftx3.gz')) continue;
    if (!rosterFiles.includes(f)) warns.push(`enemyRoster: public 下有未登记帧包 ${f}（不会生成）`);
  }
}

// ---------- ★ 空中层（2026-09-18）：名册 isAir 必须配套 ----------
// 静默失败类：设了 `isAir: true` 却忘了 `airAltitude` → 落到引擎兜底高度（2.6m），
//   数值看着"生效了"但完全不是设计值；反过来给地面兵写 airAltitude 也是白写。
// 检查法：按 `id: 'xxx'` 切块，逐块判 isAir / airAltitude 是否成对。
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

// ---------- 输出 ----------
const total = files.reduce((n, p) => n + fs.readFileSync(p, 'utf8').split('\n').length, 0);
console.log(`[arch-guard] ${files.length} 个 TS 文件 / ${total} 行`);
console.log(`[arch-guard] phase 赋值 ${phaseAssign} 处 / setPhase ${setPhaseCalls} 处 / syncSceneBgm ${bgmCalls} 处`);
console.log(`[arch-guard] 遗物 ${relicIds.size} 件 / 图标 ${iconIds.size} / 池内 ${poolIds.size}`);
console.log(`[arch-guard] 敌军 ${rosterFiles.length} 种（名册真源 config/enemyRoster.ts）`);
for (const w of warns) console.warn(`  warn  ${w}`);
for (const e of errors) console.error(`  FAIL  ${e}`);
if (errors.length) {
  console.error(`[arch-guard] ${errors.length} 项不通过`);
  process.exit(1);
}
console.log(`[arch-guard] OK（${warns.length} 项已知债务警告）`);
