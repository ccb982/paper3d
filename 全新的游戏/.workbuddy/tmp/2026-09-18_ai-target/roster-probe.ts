// 临时探针②：直跑真实 WorldSpawner.spawnRosterShowcase（依赖全部 mock），
// 验证「落地名册陈列」是否真的铺满每个兵种、且不含普瑞赛斯。
import { WorldSpawner, type MobDef, type SpawnDeps } from '../../../src/systems/spawn/WorldSpawner';
import { ENEMY_ROSTER } from '../../../src/config/enemyRoster';
import { computeEnemyScale, computeThreat } from '../../../src/systems/swarm/EnemyScaling';
import { AIR_ALTITUDE_DEFAULT } from '../../../src/systems/swarm/AgentPool';

// ---- 由名册装配假 MobDef（与 WorldMode 的装配同形，只省掉 asset/footSink 实测）----
const mobDefs: MobDef[] = ENEMY_ROSTER.map((spec) => ({
  id: spec.id, name: spec.name,
  asset: { fake: spec.id } as never,
  ai: spec.ai, hp: spec.hp, defense: spec.defense, attackPower: spec.attackPower,
  scale: spec.scale, collisionScale: spec.collisionScale,
  pack: spec.pack, weight: spec.weight, drops: spec.drops,
  groundSink: 0,
  isAir: spec.isAir === true,
  airAltitude: spec.airAltitude ?? AIR_ALTITUDE_DEFAULT,
}));

const spawned: { mobIndex: number; x: number; y: number; z: number; isAir: boolean }[] = [];
const labels: string[] = [];
const warns: string[] = [];

// ---- mock deps ----
const session = {
  dayProgress: { enemies: { quota: 9999, kills: 0, recalled: 0, spawned: 0 } },
  meta: { day: 1 },
  player: { hp: 100, attackPower: 10, defense: 2, maxHp: 100 },
  gacha: { totalPulls: 0 },
} as never;
const scaleInputs = { day: 1, totalPulls: 0, refHp: 100, refAtk: 10, refDef: 2 };
const threat = computeThreat(scaleInputs);

const deps: SpawnDeps = {
  enemies: [], enemyDefs: new WeakMap(), mobDefs, bossEntity: null, bossRun: false,
  threat,
  spawnChunkKey: 999999, scalingInputs: scaleInputs,
  enemyScale: computeEnemyScale(scaleInputs),
  player: { position: { x: 34, y: 0, z: 30 } } as never,
  ship: { position: { x: 30, y: 0, z: 30 }, hp: 100 } as never,
  entities: {} as never,
  swarm: {
    count: 0,
    pool: { count: 0 },
    spawn: (d: never) => {
      const o = d as unknown as { mobIndex: number; x: number; y: number; z: number; isAir: boolean };
      spawned.push({ mobIndex: o.mobIndex, x: o.x, y: o.y, z: o.z, isAir: !!o.isAir });
      return 0;
    },
  } as never,
  swarmDirector: { setThreat: () => undefined } as never,
  chunks: { isBoss4D: false } as never,
  raster: {
    // 全部平地 0 高，无坑水 → 只考察"环带几何 + 兵种覆盖"
    tileDefAt: () => ({ genRole: 'ground' }),
    surfaceHeightAt: () => 0,
    surfaceHeightAtFor: () => 0,
  } as never,
  session,
  scene: {} as never,
  camera: {} as never,
  drones: [],
  worldUIManager: {} as never,
  testChunk: false,
  shipDestroyed: false,
  bossAsset: null,
  showFloatingAt: (_x, _y, _z, text) => { labels.push(text); },
  syncSceneBgm: () => undefined,
  returnToBase: () => undefined,
};

const origWarn = console.warn;
console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };

const sp = new WorldSpawner(deps);
const CX = 30, CZ = 30;
const types = sp.spawnRosterShowcase(CX, CZ);

console.warn = origWarn;

// ---- 断言 ----
let fail = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? '✓' : '★ 失败'} ${msg}`);
  if (!ok) fail++;
};

console.log('=== 落地名册陈列 · 离屏断言 ===');
console.log(`名册 ${mobDefs.length} 种 → 铺出 ${types} 种，个体 ${spawned.length} 只，标签 ${labels.length} 条`);

check(types === mobDefs.length, `兵种覆盖：${types}/${mobDefs.length}`);
check(spawned.length === mobDefs.reduce((a, d) => a + d.pack, 0),
  `个体数 = Σpack = ${mobDefs.reduce((a, d) => a + d.pack, 0)}`);
check(!mobDefs.some((d) => d.id === 'priestess'), '名册里没有普瑞赛斯（结构性排除）');
check(labels.length === types, `每个铺出的兵种都有头顶名字（${labels.length}/${types}）`);
check(labels.every((l) => mobDefs.some((d) => d.name === l)), '标签文本 = 名册显示名');

// 环带几何：每个"窝心"(k=0) 都应落在 [radius*0.72*0.9, radius*1.28*1.1] 带内
const rs = spawned.map((s) => Math.hypot(s.x - CX, s.z - CZ));
const rMin = Math.min(...rs), rMax = Math.max(...rs);
check(rMin >= 16 * 0.72 - 2.01 && rMax <= 16 * 1.28 + 2.01,
  `落点都在环带内：r ∈ [${rMin.toFixed(1)}, ${rMax.toFixed(1)}]（环带 11.5~20.5，+同伴散布 ±2）`);

// 空中层
const airIdx = mobDefs.map((d, i) => (d.isAir ? i : -1)).filter((i) => i >= 0);
const airSpawned = spawned.filter((s) => airIdx.includes(s.mobIndex));
check(airSpawned.length === airIdx.length, `空中兵种 ${airIdx.length} 种都铺出`);
check(airSpawned.every((s) => s.isAir && Math.abs(s.y - AIR_ALTITUDE_DEFAULT) < 1e-6 || s.y > 0),
  `空中兵种 y = 悬停高度（war_caster 3.2 / bomber 1.8）：${airSpawned.map((s) => `${mobDefs[s.mobIndex].id}=${s.y}`).join(' ')}`);
check(spawned.filter((s) => !s.isAir).every((s) => s.y === 0), '地面兵种 y = 地表高度(0)');
// 名册顺序 = mobIndex（图集/掉落回查键）
check(spawned.every((s) => mobDefs[s.mobIndex] !== undefined), 'mobIndex 全部可回查名册');
check(mobDefs[0].id === 'rock_bug' && mobDefs[mobDefs.length - 1].id === 'rock_giant',
  `顺序 = 名册顺序（${mobDefs[0].id} … ${mobDefs[mobDefs.length - 1].id}）`);

// ---- 附带体检：L2 代理口径 vs L3 实体口径（mobAgentStats 只认 meleeSwing）----
console.log('\n=== L2 代理近战口径（mobAgentStats）vs AI 声明 ===');
for (const d of mobDefs) {
  const st = sp.mobAgentStats(d);
  let declared = '—';
  for (const s of Object.values(d.ai.states)) {
    for (const b of s.behaviors) {
      if (b.name === 'meleeSwing' || b.name === 'rangedShot') {
        declared = `${b.name}: dmg=${b.params?.damage} range=${b.params?.range ?? '(无)'}`;
      }
    }
  }
  const flag = declared.startsWith('rangedShot') ? '  ← 代理走默认 8/1.8' : '';
  console.log(`  ${d.id.padEnd(18)} 代理 dmg=${st.damage} range=${st.range}  |  AI ${declared}${flag}`);
}

console.log(`\n警告 ${warns.length} 条${warns.length ? '：' + warns.join(' | ') : ''}`);
console.log(fail === 0 ? '\n全部断言通过 ✓' : `\n${fail} 项失败 ✗`);
if (fail) process.exitCode = 1;
