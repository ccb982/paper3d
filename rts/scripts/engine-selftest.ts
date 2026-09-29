// ============================================================
// engine-selftest —— 蜂群引擎核心自检（P3 起步；npm run test:engine）
// ============================================================
// 覆盖（全部纯模块：无 three / 无浏览器，Node 直跑）：
//   · Positions      位置信息单源（玩家/舰船/小队/最近查询）
//   · SquadManager   每队一条记录 + 自动汇报 + 编成统计 + 过期
//   · 四兵种管理器    编成同步 + 目标分配 + 环内夹取 + 刷怪执行 + dbg
//   · TimerManager   卡死窗口/逃逸/豁免/计时销毁/开火闩锁
//   · Protect        双点下发 + 阻挡校验 + 锚产生
// 用法：npm run test:engine
// ============================================================

import { Positions } from '../src/systems/swarm/engine/Positions.ts';
import { SquadManager } from '../src/systems/swarm/engine/SquadManager.ts';
import { SquadTable } from '../src/systems/swarm/SquadTable.ts';
import { SquadNavigator } from '../src/systems/swarm/SquadNavigator.ts';
import { pickDef, meleeRole } from '../src/systems/spawn/MobPick.ts';
import { MeleeManager } from '../src/systems/swarm/engine/MeleeManager.ts';
import { RangedManager } from '../src/systems/swarm/engine/RangedManager.ts';
import { FlyerManager } from '../src/systems/swarm/engine/FlyerManager.ts';
import { EngineerManager } from '../src/systems/swarm/engine/EngineerManager.ts';
import { TimerManager, type TimerHost } from '../src/systems/swarm/engine/TimerManager.ts';
import { Protect } from '../src/systems/swarm/engine/Protect.ts';
import { interpretLeader } from '../src/systems/swarm/squad/CommandLang.ts';
import { FortifyPlanner, FORTIFY_SECTORS } from '../src/systems/swarm/FortifyPlanner.ts';
import { coverPoint, threePoint } from '../src/systems/swarm/CoverGeom.ts';
import { stepHoldCover, newHoldCoverState } from '../src/systems/swarm/squad/HoldCover.ts';
import { SectorBuilder, SECTOR_COUNT } from '../src/systems/swarm/tactics/SectorBuilder.ts';
import { SquadCreation, type CreationPort } from '../src/systems/swarm/engine/SquadCreation.ts';
import { BattalionManager, BATTALION_SIZE, SQUAD_FULL_COMBAT, SQUAD_FULL_BUILDER } from '../src/systems/swarm/tactics/BattalionManager.ts';
import { localStep, canSegment } from '../src/systems/swarm/nav/LocalStep.ts';
import { currentTargetOf } from '../src/systems/swarm/squad/Anchor.ts';
import { CharacterCore, canShift, CLIMB_STATS } from '../src/entity/base/CharacterCore.ts';
import { SwarmLedger } from '../src/systems/swarm/SwarmLedger.ts';
import { slotPosition, spawnFromMember } from '../src/systems/swarm/tiers/carry.ts';
import { Flux, tierForDistance } from '../src/systems/swarm/tiers/Flux.ts';
import { l1Step } from '../src/systems/swarm/tiers/L1.ts';
import { agentTierAt } from '../src/systems/swarm/tiers/policy.ts';
import type { TierCarry } from '../src/systems/swarm/tiers/contracts.ts';
import type { AgentSnapshot } from '../src/systems/swarm/AgentPool.ts';
import { climbBook } from '../src/entity/base/ClimbBook';
import { edgeStepGreedy, axisStepToward, cellOf } from '../src/systems/swarm/nav/EdgeFollow.ts';
import { addStaticObstacleRect, removeStaticObstacle, coverClimbAt, COVER_CLIMB_MAX } from '../src/services/physics/StaticObstacleRegistry.ts';
import { separationPushes } from '../src/systems/swarm/EntitySeparation.ts';
import { OrderWriter, SquadOrderStore } from '../src/systems/swarm/engine/OrderWriter.ts';
import { AttackQueues } from '../src/systems/swarm/engine/AttackQueues.ts';
import { SectorManager } from '../src/systems/swarm/engine/SectorManager.ts';
import { EngineCore } from '../src/systems/swarm/engine/EngineCore.ts';
import { EngineBridge } from '../src/systems/swarm/engine/EngineBridge.ts';
import { SquadCore } from '../src/systems/swarm/squad/SquadCore.ts';
import type { SquadReport } from '../src/systems/swarm/engine/contracts.ts';
import type { SquadOrder } from '../src/systems/swarm/engine/contracts.ts';
import { STUCK } from '../src/systems/swarm/SwarmConfig.ts';

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string): void => {
  if (cond) {
    pass++;
    console.log('  PASS', name);
  } else {
    fail++;
    console.error('  FAIL', name);
  }
};

// ---------- Positions ----------
console.log('[1] Positions 位置单源');
{
  const pos = new Positions();
  ok(pos.player() === null, '未设置玩家 → null');
  pos.setPlayer(100, 50);
  pos.setShip(-200, 300);
  pos.setSquad(1, 0, 0);
  pos.setSquad(2, 30, 40);
  ok(pos.player()?.x === 100 && pos.player()?.z === 50, '玩家位置可读');
  ok(pos.ship()?.x === -200 && pos.ship()?.z === 300, '舰船位置可读');
  ok(pos.squad(2)?.x === 30, '小队位置可读');
  ok(pos.nearestSquad(28, 42) === 2, '最近小队查询');
  ok(pos.nearestSquad(0, 0, new Set([1])) === 2, '最近小队可排除');
  ok(pos.dbg.squads === 2 && pos.dbg.player && pos.dbg.ship, 'dbg 计数正确');
  pos.removeSquad(2);
  ok(pos.squad(2) === null && pos.dbg.squads === 1, '移除小队');
  ok(pos.squadOf(1)?.x === 0, '统一查询器 squadOf');
}

// ---------- SquadManager ----------
console.log('[2] SquadManager 记录与汇报');
{
  const mgr = new SquadManager();
  mgr.register(1, 'melee', 8, 0);
  mgr.register(2, 'melee', 6, 0);
  mgr.register(3, 'ranged', 5, 0);
  mgr.register(4, 'engineer', 4, 0);
  mgr.register(5, 'flyer', 3, 0);
  ok(mgr.dbg.count === 5, '在册 5 队');
  ok(mgr.dbg.melee === 2 && mgr.dbg.ranged === 1 && mgr.dbg.engineer === 1 && mgr.dbg.flyer === 1, '四兵种计数');
  ok(mgr.countOf('melee') === 2 && mgr.aliveOf() === 26 && mgr.aliveOf('melee') === 14, '编成/存活统计');
  mgr.report({ squadId: 1, x: 10, z: 20, alive: 7, atom: 'march', phase: 'executing' }, 5);
  const r1 = mgr.get(1);
  ok(r1?.x === 10 && r1?.z === 20 && r1?.alive === 7 && r1?.atom === 'march' && r1?.phase === 'executing', '汇报写入记录');
  ok(r1?.reports === 1, '汇报计数');
  ok(mgr.get(99) === undefined, '未登记队不产生记录');
  mgr.tick(5 + 40, 30);
  ok(mgr.dbg.stale === 1, '过期检查（仅已汇报过的队）');
  mgr.remove(5);
  ok(mgr.dbg.count === 4 && mgr.dbg.flyer === 0, '移除同步 dbg');
}

// ---------- 四兵种管理器 ----------
console.log('[3] 四兵种管理器');
{
  const pos = new Positions();
  const mgr = new SquadManager();
  pos.setPlayer(0, 0);
  mgr.register(11, 'melee', 8, 0);
  mgr.register(12, 'ranged', 6, 0);
  mgr.register(13, 'flyer', 4, 0);
  mgr.register(14, 'engineer', 5, 0);
  pos.setSquad(11, 50, 0);
  pos.setSquad(12, 50, 0);
  pos.setSquad(13, 50, 0);
  pos.setSquad(14, 50, 0);
  const melee = new MeleeManager(mgr);
  const ranged = new RangedManager(mgr);
  const flyer = new FlyerManager(mgr);
  const eng = new EngineerManager(mgr);
  melee.sync(); ranged.sync(); flyer.sync(); eng.sync();
  ok(melee.dbg.squads === 1 && ranged.dbg.squads === 1 && flyer.dbg.squads === 1 && eng.dbg.squads === 1, '四管理器编成同步（各拿各的）');
  const ctx = { pos, now: 0 };
  // ★ 管理器无决策权（用户定 2026-09-27，架构第 9 条）：只编成/补兵，不给任何目标；
  //   移动只由引擎命令标签/唯一兜底驱动；开火独立。
  ok(melee.assign(ctx) === 0 && melee.targets.size === 0, '近战管理器只编成、不给目标');
  ok(ranged.assign(ctx) === 0 && ranged.targets.size === 0, '远程管理器只编成、不给目标');
  ok(flyer.assign(ctx) === 0 && flyer.targets.size === 0, '飞天管理器只编成、不给目标');
  // 工兵唯一例外：产出"活源目标（纯数据）"（施工任务）；不含战术决策。
  ok(eng.assign(ctx) === 0, '工兵无端口：不发目标（无命令全交掩体点查询）');
}

// ---------- 兵种选取（用户定 2026-09-27）----------
console.log('[3d] 兵种选取：同 role 权重轮询 + 近战混盾');
{
  const defs = [
    { role: 'assault', weight: 6 }, { role: 'assault', weight: 8 },
    { role: 'assault', elite: true, weight: 12 }, { role: 'assault', squadMode: 'singleton', elite: true, weight: 1 },
    { role: 'shield', weight: 6 }, { role: 'shield', weight: 5 },
  ];
  const acc: { [k: string]: number } = {};
  const seen = new Set<unknown>(); let eliteHit = 0, singleHit = 0;
  for (let i = 0; i < 200; i++) {
    const d = pickDef(defs, 'assault', false, acc)!;
    if (d.elite) eliteHit++;
    if (d.squadMode === 'singleton') singleHit++;
    seen.add(d);
  }
  ok(seen.size === 2 && eliteHit === 0 && singleHit === 0, '同 role 权重轮询：覆盖全部非精英兵种（不含精英/singleton）');
  const e2 = pickDef(defs, 'assault', true, acc);
  ok(!!e2 && e2.elite === true, '精英请求 → 精英兵种');
  const mixAcc = { mix: 0 }; let shield = 0;
  for (let i = 0; i < 100; i++) if (meleeRole(mixAcc, 0.37) === 'shield') shield++;
  ok(shield === 37, '★ 近战混盾：盾占比 0.37 → 100 次恰好 37 只盾（确定性）');
}

// ---------- 队长接任（阵亡/回收同一口）----------
console.log('[3b] 队长接任：任何离场路径都要选举');
{
  const tb = new SquadTable();
  tb.assign(1, 'melee', 0, 0); tb.assign(2, 'melee', 2, 0); tb.assign(3, 'melee', -2, 0);
  const s1 = tb.squadOf(1)!;
  ok(s1.leaderUid === 1, '首位入队即队长');
  const r = tb.remove(1, true);   // 队长阵亡
  ok(!!r && !r.wiped && s1.leaderUid !== 1 && s1.members.has(s1.leaderUid),
    '★ 队长阵亡 → 本队接任（leaderUid ∈ members）');
  const r2 = tb.remove(s1.leaderUid, false);   // 队长被回收（同一口）
  ok(!!r2 && !r2.wiped && s1.leaderUid !== 0 && s1.members.has(s1.leaderUid),
    '★ 队长被回收 → 同样接任（回收不产生无头队）');
}

// ---------- 成员寻路兜底（用户定 2026-09-27；治"莫名其妙静止"）----------
console.log('[3c] memberStep 兜底：无路线/步不出 → 朝队长走/直航');
{
  const nav = new SquadNavigator();   // 未接表：feas/edge 全失败 → 走兜底
  const ms = nav.memberStep(900, 0, 0, 10, 0, 0, null);
  ok(!!ms && ms.direct === true && ms.done === false && Math.abs(ms.dx - 1) < 1e-6 && Math.abs(ms.dz) < 1e-6,
    '★ 双路线失败 → 直航兜底（朝向队长，direct=true）');
  const arr = nav.memberStep(901, 10, 0, 10.0, 0, 0, null);
  ok(!!arr && arr.done === true, '到达半径内 → done（不抖）');
}

// ---------- 账本：恒等式 + 回收分桶 + beginDay 存活重计（用户定 2026-09-27） ----------
console.log('[4b] 账本口径：spawned = alive+kills+recalled+removed / 回收按原因分桶');
{
  const led = new SwarmLedger();
  led.noteSpawn(5);
  led.reportCasualty(1);
  led.noteRecall(1, 'stuck');
  led.noteRecall(1, 'recycled');
  led.noteRemoved(1);
  ok(led.spawned === led.alive + led.kills + led.recalled + led.removed,
    '★ 恒等式：spawned = alive + kills + recalled + removed');
  ok(led.recallBy.stuck === 1 && led.recallBy.recycled === 1, '★ 回收按原因分桶（stuck/recycled）');
  // ★ 累计上限（用户定 2026-09-27）：回收不退款
  const led2 = new SwarmLedger();
  const threat2 = { assaultsPerDay: [2, 3], assaultWaves: [1, 2], waveCount: [4, 6], ambientInterval: 20 } as never;
  led2.beginDay(threat2, 12, 0);
  led2.releaseCap = led2.total;
  // 非总攻：维持"场上=上限"；回收退款 → 再补
  led2.releaseCap = Math.max(1, Math.floor(led2.total / 2));
  led2.noteSpawn(led2.releaseCap);
  ok(!led2.canSpawn(), '★ 场上到上限（非总攻）→ 停');
  led2.noteRecall(1, 'stuck');
  ok(led2.canSpawn(), '★ 回收退款 → **再补**（维持上限）');
  led2.noteSpawn(1);
  // 总攻：cap=total → 放光全部配额（deployed = 生成 − 回收退款）
  led2.releaseCap = led2.total;
  led2.noteSpawn(Math.max(0, led2.total - led2.deployed));
  ok(led2.deployed >= led2.total && !led2.canSpawn(), '★ 总攻 → 放光全部配额');
  // 总攻期"卡死回收→再补"照常（回收退款）
  led2.noteRecall(1, 'stuck');
  ok(led2.canSpawn(), '★ 总攻期：卡死回收 → 再补（机制正常）');
  led2.noteSpawn(1);
  // 击杀消耗配额：deployed=alive+kills 不变 → 吃满后不再补
  led2.reportCasualty(Math.max(0, led2.alive));
  ok(!led2.canSpawn(), '★ 兵力耗尽（击杀吃满配额）→ 不再补');

  const threat = { assaultsPerDay: [2, 3], assaultWaves: [1, 2], waveCount: [4, 6], ambientInterval: 20 } as never;
  led.beginDay(threat, 12, 3);
  ok(led.spawned === 3 && led.alive === 3 && led.recalled === 0,
    '★ beginDay：在场存活重计入 spawned/alive（否则 recalled>spawned 漂移）');
}

// ---------- TimerManager ----------
console.log('[4] TimerManager 统一计时');
{
  const live = new Map<number, { x: number; z: number }>();
  const exempt = new Set<number>();
  const expired: string[] = [];
  const host: TimerHost = {
    roster: () => [...live.keys()],
    posOf: (uid) => live.get(uid) ?? null,
    exemptOf: (uid) => (exempt.has(uid) ? 'garrison' : null),
    onExpire: (uid, why) => expired.push(`${uid}:${why}`),
  };
  const tm = new TimerManager(host);
  live.set(1, { x: 0, z: 0 });
  live.set(2, { x: 100, z: 100 });
  let t = 0;
  for (let i = 0; i < STUCK.HOLD_S + 3; i++) {
    t += 1;
    live.set(2, { x: 100 + i, z: 100 });   // 2 号在远处但一直移动（净位移 > BBOX_R）
    tm.tick(t);
  }
  ok(expired.includes('1:stuck'), `静止 ${STUCK.HOLD_S}s → 卡死回收`);
  ok(!expired.includes('2:stuck'), '有净位移 → 不回收');
  live.delete(2);                       // 离场：roster 不再含它
  tm.tick(++t);
  ok(!expired.includes('2:stuck'), '离场（不在 roster）不产生回收');
  ok(tm.dbg.expiredTotal >= 1, 'dbg.expiredTotal 累计计数');
  // 逃逸：窗口内走出包围盒 → 不回收
  expired.length = 0;
  live.set(3, { x: 0, z: 0 });
  tm.tick(++t);
  for (let i = 0; i < STUCK.HOLD_S + 3; i++) {
    live.set(3, { x: i * 2, z: 0 });
    tm.tick(++t);
  }
  ok(!expired.includes('3:stuck'), '有实际位移 → 不回收');
  // 豁免：驻守
  expired.length = 0;
  live.set(4, { x: 0, z: 0 });
  exempt.add(4);
  for (let i = 0; i < STUCK.HOLD_S + 3; i++) tm.tick(++t);
  ok(!expired.includes('4:stuck') && tm.dbg.exempt > 0, '驻守豁免');
  exempt.delete(4);
  // 开火闩锁
  tm.allowFire(5, true);
  ok(tm.canFire(5), '开火许可置位');
  tm.forget(5);
  ok(!tm.canFire(5), '离场清理闩锁');
  tm.allowFire(6, true);
  tm.allowFire(6, false);
  ok(!tm.canFire(6), '撤除开火许可');
}

// ---------- Protect ----------
console.log('[5] Protect 保护命令（引擎只给 G/P 双点）');
{
  const pos = new Positions();
  const protect = new Protect();
  pos.setPlayer(0, 0);
  pos.setSquad(21, 8, 0);   // 被保护队队长 G
  pos.setSquad(22, 5, 0);   // 保护者 B（在 P→G 线上）
  protect.assign(22, 21, 8, 0);
  ok(protect.dbg.links === 1, '保护关系登记');
  protect.refresh(pos.squadOf, 0, 0);
  const l = protect.linkOf(22);
  ok(l?.gx === 8 && l?.px === 0, 'G/P 双点已提供（信息单源）');
  ok(l?.anchor.x === 8 && l?.anchor.z === 0, '保护锚 = G（引擎下发；不代算调整点）');
  // 保护者偏离 → 双点照旧（队长自算阻挡）
  pos.setSquad(22, 5, 6);
  protect.refresh(pos.squadOf, 0, 0);
  ok(protect.linkOf(22)?.anchor.x === 8, '偏离也照发 G（队长自主校验）');
  const spec = protect.orderSpecOf(22);
  ok(spec?.kind === 'protect' && spec.anchor.x === 8, '保护令草案带锚（G5）');
  // 被保护队丢失 → stale
  pos.removeSquad(21);
  protect.refresh(pos.squadOf, 0, 0);
  ok(protect.dbg.stale === 1, '目标丢失 → stale');
  protect.release(22);
  ok(protect.dbg.links === 0, '解除保护关系');
}

// ---------- 复合 → 原子（队长层条件表） ----------
console.log('[5b] CommandLang 复合→原子（解释器；标签执行实现保留）');
{
  const mk = (over: Partial<Parameters<typeof interpretLeader>[0]['order']>) => ({
    squadId: 1, issuedAt: 0, until: 0, source: 'engine' as const, notBefore: 0,
    pathGoalX: 0, pathGoalZ: 0, pathAt: 0, pathFailedAt: 0,
    order: { kind: 'protect' as const, target: { x: 8, z: 0 }, threatX: 0, threatZ: 0, ...over },
  });
  // protect：P(0,0) G(8,0) B 在线上 standoff 带内 → 已挡住 → 驻守原地
  const on = interpretLeader(mk({}) as never, 6, 0, null);
  ok(on.atom === 'garrison' && on.x === 6, 'protect：已挡住 → 驻守（不挪窝）');
  // protect：B 偏到 (6,6) → 未挡住 → 行动到调整点（P→G 线上）
  const off = interpretLeader(mk({}) as never, 6, 6, null);
  ok(off.atom === 'act' && Math.abs(off.z) < 0.01, 'protect：偏了 → 行动到调整点（线上）');
  // protect：B 太远 (40,0)（P 距 40 > 带）→ 行军
  const far = interpretLeader(mk({}) as never, 40, 0, null);
  ok(far.atom === 'march', 'protect：离 P 太远 → 行军');
  // act：距离三分
  const act = { ...mk({ kind: 'act' as never, target: { x: 100, z: 0 } }) };
  ok(interpretLeader(act as never, 0, 0, null).atom === 'march', 'act：>40 → 行军');
  ok(interpretLeader(act as never, 80, 0, null).atom === 'act', 'act：20 → 行动');
  ok(interpretLeader(act as never, 99.5, 0, null).atom === 'garrison', 'act：到位 → 驻守');
}

// ---------- 施工目标获取契约（FortifyPlanner.targetOf） ----------
console.log('[5d] FortifyPlanner 取点契约（扇区内 ∧ 带内 ∧ 可达 ∧ 次高回退）');
{
  const fp = new FortifyPlanner();
  const cx = 0, cz = 0, rLo = 20, rHi = 44;
  const needAt = (x: number): number => 1 + (x + 100) * 0.001;   // 全有效；x 越大分越高
  for (let i = 0; i < FORTIFY_SECTORS; i++) fp.refreshOne(cx, cz, rLo, rHi, needAt);
  ok(fp.safety[0] === (fp.candidates[0][0] as { score: number }).score, '峰值分 = 候选首位分（单源）');
  const pick = fp.targetOf(cx, cz, 0, rLo, rHi, 0.6, () => true) as { x: number; z: number; score: number };
  const ang = (Math.atan2(pick.z, pick.x) + Math.PI * 2) % (Math.PI * 2);
  const d = Math.hypot(pick.x, pick.z);
  ok(ang >= 0 && ang < Math.PI / 4, '取点在扇区内（角度 [0,45°)）');
  ok(d >= rLo - 1 && d <= rHi + 1, '取点在带内（半径）');
  // 高位不可达 → 扇区内次高可达
  const topX = pick.x;
  const second = fp.targetOf(cx, cz, 0, rLo, rHi, 0.6, (x) => x < topX - 1e-6) as { x: number; z: number };
  const sAng = (Math.atan2(second.z, second.x) + Math.PI * 2) % (Math.PI * 2);
  ok(second.x < topX && sAng >= 0 && sAng < Math.PI / 4, '高位不可达 → 次高可达（仍在扇区内）');
  // 带内全不可达 → null（**不许出带兜底**；带外可达也不许返回）
  ok(fp.targetOf(cx, cz, 0, rLo, rHi, 0.6, (x, z) => Math.hypot(x, z) > rHi) === null, '带内全不可达 → null（无越界兜底）');
  // 仅扇区外可达 → null（**不许出扇区**）
  ok(fp.targetOf(cx, cz, 0, rLo, rHi, 0.6, (_x, z) => {
    let a2 = Math.atan2(z, _x); if (a2 < 0) a2 += Math.PI * 2;
    return a2 >= Math.PI / 4;
  }) === null, '仅扇区外可达 → null（不许出扇区）');
  // 未刷新扇区：无候选 → null
  const fp2 = new FortifyPlanner();
  ok(fp2.targetOf(cx, cz, 2, rLo, rHi, 0.6, () => true) === null, '未刷新扇区 → null（不猜点）');
  // ★ 朝前方（用户定 2026-09-27）：给 from → 优先“比工兵更靠舰”的点（工事向前推进）
  const fp3 = new FortifyPlanner();
  // 两个确定性候选：前方低分 (12,4) / 后方高分 (40,4)
  const need2 = (x: number, z: number): number | null =>
    (x === 12 && z === 4) ? 0.7 : (x === 40 && z === 4) ? 0.95 : null;
  for (let i = 0; i < FORTIFY_SECTORS; i++) fp3.refreshOne(0, 0, 4, 44, need2);
  const noFrom = fp3.targetOf(0, 0, 0, 4, 44, 0.6, () => true)!;
  const withFrom = fp3.targetOf(0, 0, 0, 4, 44, 0.6, () => true, undefined, { x: 30, z: 0 })!;
  ok(Math.hypot(noFrom.x, noFrom.z) > 32, '无 from：仍按需求分（选后方高分点）');
  ok(Math.hypot(withFrom.x - 12, withFrom.z - 4) < 0.01, '★ 朝前方：有 from → 优先舰侧更近点（施工向舰推进）');
}

// ---------- 短寻路 LocalStep（S1 新契约） ----------
console.log('[5e] LocalStep 短寻路（语义安全→可行性；终点精确；无解 null；爬坡显式）');
{
  type G = Parameters<typeof localStep>[0];
  const mk = (over: Partial<G> = {}): G => ({
    canStep: () => true,
    climbAt: () => false,
    dropAt: () => 0,
    waterAt: () => false,
    heightAt: () => 0,
    scoreAt: () => 0,
    ...over,
  });
  // ① 开阔：按 ≤SEG_MAX 推进；迭代可精确到目标
  const open = mk();
  const st1 = localStep(open, 0, 0, 30, 0);
  ok(!!st1 && st1.next.x <= 10.01 && st1.next.x > 5 && Math.abs(st1.next.z) <= 2.1, '开阔：推进（≤SEG_MAX，方向正确）');
  ok(!!st1 && st1.climb === false, '开阔：无爬坡标注');
  let cx = 0, cz = 0, iter = 0;
  for (; iter < 12; iter++) { const st = localStep(open, cx, cz, 30, 0); if (!st) break; cx = st.next.x; cz = st.next.z; }
  ok(iter < 12 && Math.hypot(30 - cx, cz) <= 1.5, '迭代可达：终点精确（≤ARRIVE）');
  // ② 中间墙（x≈12、|z|≤20 禁穿）→ 绕行（不硬撞）
  const wall = mk({
    canStep: (x, z, dx) => {
      const nx = x + dx * 4;
      if (dx > 0 && x < 12 && nx >= 12 && Math.abs(z) <= 20) return false;
      if (dx < 0 && x >= 12 && nx < 12 && Math.abs(z) <= 20) return false;
      return true;
    },
  });
  const det = localStep(wall, 0, 0, 30, 0);
  ok(!!det && Math.abs(det.next.z) > 0.5, '遇墙：绕行（有横向分量）');
  // ③ 四周围死 → 无解 null
  const box = mk({ canStep: (x, z) => !(x > -8 && x < 8 && z > -8 && z < 8) });
  ok(localStep(box, 0, 0, 30, 0) === null, '无解 → null（不近似、不打转）');
  // ④ 爬坡显式（第一跳即跨爬坡位 → 结果标 climb；段校验同样标）
  const climbG = mk({ climbAt: (x, _z, dx) => dx > 0 && x >= 2 && x < 12 });
  const stC = localStep(climbG, 0, 0, 30, 0);
  ok(!!stC && stC.climb === true, '爬坡：结果显式标注 climb=true');
  ok(canSegment(climbG, 0, 0, 12, 0).climb === true, '爬坡：段校验显式标注 climb');
  // ⑤ 斜向禁上坡（canSegment 否决）
  const uphill = mk({ heightAt: (x) => x * 0.5 });
  ok(canSegment(uphill, 0, 0, 4, 4).ok === false, '斜向禁上坡（段校验否决）');
  // ⑥ 语义风险：两点之间有高险带（x∈(4,12) 且 |z|<6）→ 绕开（偏好、非硬禁）
  const risky = mk({ scoreAt: (x, z) => (x > 4 && x < 12 && Math.abs(z) < 6 ? -10 : 0) });
  const stR = localStep(risky, 0, 0, 20, 0);
  ok(!!stR && Math.abs(stR.next.z) > 1, '语义风险：绕开高险带（偏好生效）');
  // ⑦ 不可走段 → canSegment 否决
  const blocked = mk({ canStep: () => false });
  ok(canSegment(blocked, 0, 0, 4, 0).ok === false && localStep(blocked, 0, 0, 30, 0) === null, '不可走：段校验否决 → null');
}

// ---------- 锚点/前瞻（S3a：路由驱动，不跳绕行点） ----------
console.log('[5f] Anchor 路由推进（S3a）');
{
  const mk = (path: { x: number; z: number; climb?: boolean }[] | undefined) => ({
    squadId: 1, issuedAt: 0, until: 0, source: 'engine' as const, notBefore: 0,
    pathGoalX: 0, pathGoalZ: 0, pathAt: 0, pathFailedAt: 0,
    order: { kind: 'act' as const, target: { x: 167, z: 15 }, path },
    corridor: path,
  });
  const st = mk([{ x: 174, z: 22 }, { x: 167, z: 15 }]);
  const n1 = currentTargetOf(st as never, 172, 26);
  ok(!!n1 && Math.abs(n1.x - 174) < 0.01 && Math.abs(n1.z - 22) < 0.01, 'S3a：取下一个绕行点（不被目标吃掉）');
  const n2 = currentTargetOf(st as never, 174.5, 21.5);
  ok(!!n2 && Math.abs(n2.x - 167) < 0.01 && Math.abs(n2.z - 15) < 0.01, 'S3a：到绕行点后推进到终点');
  const n3 = currentTargetOf(st as never, 167.2, 15.2);
  ok(!!n3 && Math.abs(n3.x - 167) < 0.01 && Math.abs(n3.z - 15) < 0.01, 'S3a：末点=目标（精确）');
  const n4 = currentTargetOf(mk(undefined) as never, 0, 0);
  ok(!!n4 && n4.x === 167 && n4.z === 15, 'S3a：无路由 → 队令目标');
}

// ---------- 移动内核按表判墙（B3） ----------
console.log('[5g] CharacterCore 判墙/凭证式上坡（用户定 2026-09-26）');
{
  const mkProbe = (weld: boolean, rise: number, runAt: [number, number] | null = [0, 0]) => ({
    heightAt: (x: number) => (x >= 0.5 ? rise : 0),
    wetAt: () => false,
    slopeGradAt: () => (weld ? { gx: 1, gz: 0, mag: 1 } : null),
    isWeldEdge: () => weld,
    layerAt: (x: number) => (x >= 0.5 ? rise : 0),
    topAt: (x: number) => (x >= 0.5 ? rise : 0),
    climbPoint: (x: number, z: number, dx: number, dz: number) => {
      void x; void z; void dx; void dz;
      return runAt && weld ? { x: runAt[0], z: runAt[1], ux: 1, uz: 0, width: 3 } : null;
    },
  });
  const run = (probe: ReturnType<typeof mkProbe>, cred: boolean, dirX = 1, dirZ = 0) => {
    const core = new CharacterCore();
    return core.step({
      x: 0, y: 0, z: 0, dt: 0.1, dirX, dirZ, speed: 2,
      climbOrdered: cred, blockCliffClimb: true, climbAnyTerrain: false,
      hx: 0.4, hz: 0.4, suspended: false,
    }, probe as never, 0);
  };
  ok(run(mkProbe(false, 2), false).dx <= 0, '硬边大落差：墙（只下不上；贴壁修正可外推）');
  ok(run(mkProbe(false, 0.5), false).dx > 0, '硬边小落差(≤0.6)：可走（无视）');
  // ★ 凭证式上坡（用户定）：人在上坡点 + 持凭证 → 方可沿法线爬
  const cred = run(mkProbe(true, 2), true);
  ok(cred.dx > 0 && cred.climbing === true, '在上坡点 + 持凭证 → 沿法线爬');
  const noCred = run(mkProbe(true, 2), false);
  ok(noCred.climbing === false, '无凭证 → 不爬（没有自主上坡）');
  const offPoint = run(mkProbe(true, 2, [5, 0]), true);
  ok(offPoint.climbing === false, '★ 传送带：离坡点太远（区外）→ 不抓');
  const inZone = run(mkProbe(true, 2, [2, 0]), true);
  ok(inZone.climbing === true && inZone.dx > 0, '★ 传送带：进区（不必在点）→ 自动抓取上送（沿 +n）');
  const centering = run(mkProbe(true, 2, [2, 1]), true);
  ok(centering.climbing === true && centering.dz > 0, '★ 传送带：横向强制回中（向中线收）');
  const nearPoint = run(mkProbe(true, 2, [0.4, 0]), true);
  ok(nearPoint.dx > 0 && nearPoint.climbing === true, '已在点（≤0.6m）→ 起步');
  // ★ 爬完坡：到落点本帧 landed=true（触发强制重寻路；用户定 2026-09-26）
  const coreL = new CharacterCore();
  const pr2 = mkProbe(true, 2);
  coreL.step({ x: 0, y: 0.5, z: 0, dt: 0.1, dirX: 1, dirZ: 0, speed: 2,
    climbOrdered: true, climbPt: { x: 0, z: 0, ux: 1, uz: 0, w: 3 },
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false }, pr2 as never, 0);
  const land = coreL.step({ x: 3.5, y: 2.0, z: 0, dt: 0.1, dirX: 1, dirZ: 0, speed: 2,
    climbOrdered: true, climbPt: { x: 0, z: 0, ux: 1, uz: 0, w: 3 },
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false }, pr2 as never, 0.1);
  ok(land.landed === true, '★ 爬到落点本帧 landed=true（强制重寻路钩子）');
  // ★ 在顶上（无会话）：持证也**不再被爬坡走位拽回**（旧：deep→沿 -n 后退）
  const coreT = new CharacterCore();
  const topStep = coreT.step({ x: 3.5, y: 2.0, z: 0, dt: 0.1, dirX: 0, dirZ: 0, speed: 2,
    climbOrdered: true, climbPt: { x: 0, z: 0, ux: 1, uz: 0, w: 3 },
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false }, pr2 as never, 0);
  ok(topStep.dx === 0 && topStep.climbing === false, '★ 已在顶上：不再被“深入坡面”误判拽回下坡');
  // ★ 飞行：自由路径（硬墙也不拦） + 高度不被地形改写（用户定 2026-09-26）
  const coreF = new CharacterCore();
  const flyStep = coreF.step({ x: 0, y: 5, z: 0, dt: 0.1, dirX: 1, dirZ: 0, speed: 2,
    climbOrdered: true, blockCliffClimb: true, climbAnyTerrain: false,
    hx: 0.4, hz: 0.4, suspended: false, flying: true }, mkProbe(false, 2) as never, 0);
  ok(flyStep.dx > 0 && flyStep.gy === 5 && flyStep.climbing === false,
    '★ 飞行：硬墙不拦、高度不被地形改写（自由路径）');

// ---------- 上坡点统一管理 + 10s 兜底（用户定 2026-09-26） ----------
console.log('[5g2] 上坡点认领制 + 5s 兜底强制上送');
{
  const mkProbe3 = (weld: boolean, rise: number, runAt: [number, number] | null = [0, 0]) => ({
    heightAt: (x: number) => (x >= 0.5 ? rise : 0),
    wetAt: () => false,
    slopeGradAt: () => (weld ? { gx: 1, gz: 0, mag: 1 } : null),
    isWeldEdge: () => weld,
    layerAt: (x: number) => (x >= 0.5 ? rise : 0),
    topAt: (x: number) => (x >= 0.5 ? rise : 0),
    climbPoint: (x: number, z: number, dx: number, dz: number) => {
      void x; void z; void dx; void dz;
      return runAt && weld ? { x: runAt[0], z: runAt[1], ux: 1, uz: 0, width: 3 } : null;
    },
  });
  const uid = 77;
  const mkInp = (dt: number, over: Record<string, unknown> = {}) => ({
    x: -2, y: 0, z: 0, dt, dirX: 1, dirZ: 0, speed: 2, uid,
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false, ...over,
  });
  const pr = mkProbe3(true, 2, [0, 0]);
  const core = new CharacterCore();
  let last = core.step(mkInp(0.5) as never, pr as never, 0);
  for (let i = 0; i < 9; i++) last = core.step(mkInp(0.5) as never, pr as never, 0);   // 共 4.5s（首帧仅记锚；计从第二帧起）
  ok(last.climbing === false && climbBook.claimed(uid) === null, '4.5s 未到：无凭证也不上送（不误抓）');
  last = core.step(mkInp(0.5) as never, pr as never, 0);   // 5.0s
  ok(last.climbing === true, '★ 5s 兜底：任何兵（无凭证）移动中卡点满 5s → 强制上送');
  ok(climbBook.claimed(uid) !== null, '★ 认领制：抓上即认领（该点独属，别的点不抢）');
  const land = core.step(mkInp(0.5, { x: 3.5, y: 2 }) as never, pr as never, 1);
  ok(land.landed === true && climbBook.claimed(uid) === null, '★ 到落点释放认领（允许新一段接管）');
  const core2 = new CharacterCore();
  let l2 = core2.step({ x: 0, y: 0, z: 0, dt: 0.5, dirX: 0, dirZ: 0, speed: 0, uid: 78,
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false } as never, pr as never, 0);
  for (let i = 0; i < 30; i++) l2 = core2.step({ x: 0, y: 0, z: 0, dt: 0.5, dirX: 0, dirZ: 0, speed: 0, uid: 78,
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false } as never, pr as never, 0);
  ok(l2.climbing === false, '★ 站桩（驻守/施工）不计时：永不被兜底误送');
  // ★ 加强（用户定 2026-09-26）：大半径（14m）+ 反反复复重试（1.5s）+ 已在上面不送
  const f0 = CLIMB_STATS.forced;
  const core3 = new CharacterCore();
  const in3 = (x: number, y = 0, over: Record<string, unknown> = {}) => ({
    x, y, z: 0, dt: 0.5, dirX: 1, dirZ: 0, speed: 2, uid: 79,
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false, ...over,
  });
  let s3 = core3.step(in3(-10) as never, pr as never, 0);
  for (let i = 0; i < 10; i++) s3 = core3.step(in3(-10) as never, pr as never, 0);   // 5s（首帧记锚）
  ok(s3.dx > 0 && s3.climbing === false && CLIMB_STATS.forced > f0,
    '★ 兜底加强：14m 大半径内也算卡（远离旧入区）→ 引导朝坡点走');
  const grab = core3.step(in3(-1) as never, pr as never, 0);   // 引导走进 6m → 抓
  ok(grab.climbing === true, '★ 引导走进抓取半径 → 传送带抓上');
  // ★ 重试：弃约后回来 1.5s 内再送（不重等 10s）
  const core4 = new CharacterCore();
  const in4 = (x: number, over: Record<string, unknown> = {}) => ({
    x, y: 0, z: 0, dt: 0.5, dirX: 1, dirZ: 0, speed: 2, uid: 80,
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false, ...over,
  });
  let s4 = core4.step(in4(-2) as never, pr as never, 0);
  for (let i = 0; i < 10; i++) s4 = core4.step(in4(-2) as never, pr as never, 0);
  ok(s4.climbing === true, '首次兜底起爬（5s）');
  core4.step(in4(-100) as never, pr as never, 1);   // 被拉离 → 弃约
  let s4b = core4.step(in4(-2) as never, pr as never, 1.5);
  for (let i = 0; i < 4; i++) s4b = core4.step(in4(-2) as never, pr as never, 1.5 + (i + 1) * 0.5);
  ok(s4b.climbing === true, '★ 反反复复：弃约后回来 1.5s 即重试上送（不再等 5s）');
  // ★ 已在上面（脚高于坡顶）→ 永不误送
  const core5 = new CharacterCore();
  const pr5 = mkProbe3(true, 2, [0, 0]);
  let s5 = core5.step({ x: 3, y: 2.5, z: 0, dt: 0.5, dirX: 1, dirZ: 0, speed: 2, uid: 81,
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false } as never, pr5 as never, 0);
  for (let i = 0; i < 30; i++) s5 = core5.step({ x: 3, y: 2.5, z: 0, dt: 0.5, dirX: 1, dirZ: 0, speed: 2, uid: 81,
    blockCliffClimb: true, climbAnyTerrain: false, hx: 0.4, hz: 0.4, suspended: false } as never, pr5 as never, 0);
  ok(s5.climbing === false, '★ 已在上面（脚高于坡顶）→ 兜底永不误送');
}
}


// ---------- 方案 A：格边跟随（移动消费格边图） ----------
console.log('[5h] EdgeFollow 格边跟随（方案 A：轴对齐 + canStep；斜向分解；无路 null）');
{
  const mk = (blocked: Set<string> = new Set(), h = 0) => ({
    canStep: (x: number, z: number, dx: number, dz: number) => {
      const c = cellOf(x, z);
      return !blocked.has(`${c.cx},${c.cz}>${dx},${dz}`);
    },
    heightAt: () => h,   // ★ H2：层高（默认同层）
  });
  // ★ 轴步原语（活件：路线游标跟随 / 成员贪心共用）
  const s1 = axisStepToward(mk(), 2, 2, 10, 3);
  ok(!!s1 && s1.dx === 1 && s1.dz === 0, '轴步：x 分量主导 → 走东一格');
  const s2 = axisStepToward(mk(new Set(['0,0>1,0'])), 2, 2, 10, 3);
  ok(!!s2 && s2.dx === 0 && s2.dz === 1, 'x 轴被禁 → 退而走 z 轴');
  ok(axisStepToward(mk(new Set(['0,0>1,0', '0,0>0,1'])), 2, 2, 10, 3) === null, '两轴都禁 → null（不硬穿）');
  const s4 = axisStepToward(mk(), 2, 2, 3, 10);
  ok(!!s4 && s4.dx === 0 && s4.dz === 1, 'z 分量主导 → 走南一格');
  const s5 = axisStepToward(mk(), 2, 2, 6, 6);
  ok(!!s5 && ((s5.dx === 1 && s5.dz === 0) || (s5.dx === 0 && s5.dz === 1)), '斜向 → 分解为轴对齐单步');
  const s6 = edgeStepGreedy(mk(), 2, 2, 0, 3, 3);
  ok(s6 === null, '贪心：同格 → null（交软跟随）');
  // ★ 坡面轴优先（用户定 2026-09-26）：可爬坡轴不被“分量更大”抢走
  const mkClimb = { ...mk(), climbAt: (_x: number, _z: number, _dx: number, dz: number) => dz !== 0 };
  const s7 = axisStepToward(mkClimb, 2, 2, 10, 3);
  ok(!!s7 && s7.dx === 0 && s7.dz === 1, '坡面轴优先：z 可爬 → 先走 z（哪怕 x 分量更大）');
  ok(axisStepToward(mk(), 2, 2, 0, 0) === null, '目标=自身 → null');
}

// ---------- H2：跨层位移闸门 ----------
console.log('[5i] canShift 跨层位移闸门（H2：推挤/步进/贴地同规则）');
{
  const probeAt = (hAt: (x: number) => number) => ({
    heightAt: (x: number) => hAt(x), wetAt: () => false,
    slopeGradAt: () => null, isWeldEdge: () => false, layerAt: (x: number) => hAt(x),
  });
  ok(canShift(probeAt((x) => (x >= 2 ? 0.4 : 0)) as never, 0, 0, 0, 4, 0, 0.6) === true, '上升 0.4m ≤ 台阶 → 允许');
  ok(canShift(probeAt((x) => (x >= 2 ? 2 : 0)) as never, 0, 0, 0, 4, 0, 0.6) === false, '上升 2m > 台阶 → 禁止（不借位移越层）');
  ok(canShift(probeAt((x) => (x >= 2 ? -3 : 0)) as never, 0, 0, 0, 4, 0, 0.6) === true, '下降 → 允许');
}

// ---------- OrderWriter ----------
console.log('[8] OrderWriter 唯一发令器');
{
  const store = new SquadOrderStore();
  const w = new OrderWriter(store);
  const mk = (kind: SquadOrder['kind'], x: number, z: number): SquadOrder => ({
    kind, source: 'engine', target: { x, z }, seq: 1, ttl: 10,
  });
  ok(w.issue(1, mk('act', 10, 0), { now: 0 }), '首次发令成功');
  ok(store.get(1) !== undefined, '写入唯一写口（SquadOrderStore）');
  ok(!w.issue(1, mk('act', 10, 0), { now: 1 }), '★ 限制发放（用户定）：同签名重发被拒（不再每帧续期写板）');
  ok(!w.issue(1, mk('defend', 20, 0), { now: 2 }), '换令但进度低 → 拦截');
  ok(w.dbg.kept === 2, 'dbg.kept 计数（同签名拒发 + 进度低揦截）');
  w.advance(1, 0.6, 0);
  ok(w.issue(1, mk('defend', 20, 0), { now: 3 }), '进度 ≥50% → 允许换令');
  w.advance(1, 0.1, 30);
  ok(w.issue(1, mk('protect', 5, 0), { now: 4 }), '静止 ≥25s → 允许换令');
  w.advance(1, 0.1, 0);
  ok(w.issue(1, mk('act', 77, 0), { now: 6, player: true }), '玩家令旁路');
  ok(w.dbg.bypass >= 1, 'dbg.bypass 计数（玩家令旁路）');
}

// ---------- AttackQueues ----------
console.log('[9] AttackQueues 攻击队列（1Hz + 最近实体去重 + 开火闩锁）');
{
  const q = new AttackQueues();
  const latch = new TimerManager({ roster: () => [], posOf: () => null, exemptOf: () => null, onExpire: () => {} });
  q.setOwner('player', 0, 0);
  q.setOwner('ship', 100, 0);
  const ents = [
    { uid: 1, x: 10, z: 0 },   // 近玩家 → player
    { uid: 2, x: 90, z: 0 },   // 近舰船 → ship
    { uid: 3, x: 60, z: 0 },   // 玩家 60 / 舰船 40 → ship
  ];
  q.update(ents, () => true, latch);
  ok(q.ownerOfUid(1) === 'player', '最近实体入队（uid1 → player）');
  ok(q.ownerOfUid(2) === 'ship' && q.ownerOfUid(3) === 'ship', '去重：一个敌人只在一个队列');
  ok(q.membersOf('player').length === 1 && q.membersOf('ship').length === 2, '队列成员正确');
  ok(latch.canFire(1) && latch.canFire(2) && latch.canFire(3), '开火许可闩锁置位');
  ok(q.dbg.allowed === 3, 'dbg.allowed 计数');
  q.update([{ uid: 1, x: 80, z: 0 }, { uid: 2, x: 90, z: 0 }, { uid: 3, x: 60, z: 0 }], () => true, latch);
  ok(q.ownerOfUid(1) === 'ship' && q.dbg.moved >= 1, '跨队列迁移被记录');
  q.update(ents, (uid) => uid !== 2, latch);
  ok(latch.canFire(2) === false && q.dbg.revoked >= 1, '条件不满足 → 撤许可');
  q.update([{ uid: 1, x: 10, z: 0 }], () => true, latch);
  ok(latch.canFire(3) === false, '离场者撤许可');
  ok(q.dbg.members === 1, 'dbg.members 更新');
}

// ---------- SectorManager ----------
console.log('[10] SectorManager 扇形防区');
{
  const sec = new SectorManager();
  sec.build(4);   // 0° 90° 180° 270°
  const leaders = new Map<number, { x: number; z: number }>([
    [1, { x: 10, z: 0 }],    // 0° → 扇区 0
    [2, { x: 0, z: 10 }],    // 90° → 扇区 1
    [3, { x: 0, z: -10 }],   // 270° → 扇区 3
  ]);
  sec.tick((id) => leaders.get(id) ?? null, 0, 0, [1, 2, 3]);
  ok(sec.sectorOf(1) === 0 && sec.sectorOf(2) === 1 && sec.sectorOf(3) === 3, '各队归到最近扇区');
  const c = sec.centerOf(0, 0, 0, 30);
  ok(Math.abs(c.x - 30) < 0.01 && Math.abs(c.z) < 0.01, '扇区中心点（调区目标）');
}

// ---------- EngineCore ----------
console.log('[11] EngineCore 相位 tick');
{
  const order: string[] = [];
  const core = new EngineCore({
    perceive: () => order.push('perceive'),
    situation: () => order.push('situation'),
    decide: () => order.push('decide'),
    write: () => order.push('write'),
    debug: () => order.push('debug'),
  });
  core.tick(0.6, 1);
  ok(order.join(',') === 'perceive,situation,decide,write,debug', '固定相位顺序');
  ok(core.dbg.ticks === 1, '2Hz 节拍触发一次');
  core.tick(0.1, 1.1);
  ok(core.dbg.ticks === 1, '未到节拍不触发');
  core.tick(0.5, 1.6);
  ok(core.dbg.ticks === 2, '累计到节拍再触发');
  core.setHz(1);
  ok(core.dbg.hz === 1, '节拍可调');
}

// ---------- EngineBridge（影子模式） ----------
console.log('[12] EngineBridge 实机接线桥（影子模式）');
{
  const emitted: SquadOrder[] = [];
  const live = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 200, z: 0 }),
    squads: () => [
      { id: 1, role: 'melee' as const, x: 50, z: 0, alive: 8 },
      { id: 2, role: 'melee' as const, x: 55, z: 0, alive: 6 },   // 与 1 同兵种太近 → 应被切向错开
      { id: 3, role: 'ranged' as const, x: 90, z: 0, alive: 5 },
    ],
    emit: (o: SquadOrder) => emitted.push(o),
  };
  const bridge = new EngineBridge(live);
  bridge.dbg.ringMax = 200;   // ★ 初始：小队在环内（正常锚位）
  bridge.shadow = true;   // ★ 影子模式仅调试用（默认 false = 真下发）；本用例显式开启
  bridge.tick(0.6, 1);   // 2Hz → 触发一拍
  ok(bridge.dbg.ticks === 1, '桥接节拍触发');
  ok(bridge.squads.dbg.count === 3, '小队已登记（perceive）');
  ok(bridge.pos.squad(1)?.x === 50, '位置进单源 Positions');
  ok(bridge.melee.dbg.assigned === 0 && bridge.ranged.dbg.assigned === 0, '★ 管理器只编成、不产目标（架构第 9 条）');
  // 影子模式：命令只进本地 store，不 emit
  ok(emitted.length === 0, '影子模式不发实机命令');
  ok(bridge.writer.dbg.issued >= 1, '命令经唯一发令器下发（本地）');
  // ★ 唯一兜底（定稿第 8 条）：无管理器目标 → 行军段（朝舰推一段 ≤30m）
  const o1 = bridge.writer.store.get(1)!.order;
  const o2 = bridge.writer.store.get(2)!.order;
  ok(o1.state === 'march' && o1.target.x > 50 && o1.target.x <= 81, '★ 兜底：首拍行军段（朝舰 ≤30m）');
  ok(o2.state === 'march', '★ 兜底：所有队同口径（无选位/间距机制）');
  // 实机模式：玩家令直达队长（emit）
  bridge.shadow = false;
  bridge.tick(0.6, 2.2);
  const pOk2 = bridge.playerOrder(2, 'garrison', { x: 5, z: 5 });
  ok(pOk2 && emitted.length >= 1, '实机模式 emit 下发（玩家令直达队长）');
  ok(bridge.writer.dbg.issued >= 1, '发令器台账');
  // 玩家命令：随随便便就能下（同一发令器 + player 旁路 + 只给队长）
  const pOk = bridge.playerOrder(1, 'regroup', { x: 5, z: 5 });
  ok(pOk && bridge.writer.store.get(1)!.order.source === 'player', '玩家命令经唯一发令器直达队长');
  ok(bridge.writer.store.get(1)!.order.kind === 'regroup', '玩家命令内容生效');
  ok(bridge.writer.store.get(1)!.order.ttl === 0, '★ 命令无 TTL（用户定）');
  // ★ 稳态不重发（定稿第 3 条）：玩家令在身 → 引擎不覆盖、不逐拍重发
  bridge.tick(0.6, 2.8);
  ok(bridge.writer.store.get(1)?.order.source === 'player', '★ 玩家令不过期（执行板不再逐拍重发）');
  // ★ 玩家令 TTL 到期 → 释放，交回引擎（不能永久锁死该队）
  bridge.tick(0.6, 2.8 + 30 * 12 + 1);
  ok(bridge.writer.store.get(1)?.order.source === 'player', '★ 玩家令不过期（直到被替换）');
}

// ---------- SquadCore（队长侧） ----------
console.log('[13] SquadCore 队长核心（接令/距离分流/汇报）');
{
  const reports: SquadReport[] = [];
  const core = new SquadCore(1, 'melee', {
    report: (r) => reports.push(r),
    alive: () => 8,
  });
  core.accept({ kind: 'act', source: 'engine', target: { x: 100, z: 0 }, seq: 1, ttl: 0 });
  core.tick(0.5);
  ok(core.atom === 'march', '距离长（100 > 40）→ 行军（长寻路）');
  ok(reports.length === 1 && reports[0].squadId === 1 && reports[0].atom === 'march', '汇报走唯一接收器');
  core.x = 80;
  core.tick(0.5);
  ok(core.atom === 'act', '距离短（20 ≤ 40）→ 行动（短跳）');
  core.x = 99.5;
  core.tick(0.5);
  ok(core.phase === 'done' && core.dbg.done === 1, '到位 → done');
  core.accept({ kind: 'march', source: 'player', target: { x: 300, z: 0 }, seq: 2, ttl: 0 });
  const before = reports.length;
  core.tick(0.5);
  ok(reports.length === before + 1 && core.atom === 'march', '远程令：兜底按距离推进（仍汇报）');
  ok(core.current()?.source === 'player', '玩家令可被队长接收（同源）');
}

// ---------- 玩家手动命令（小队 / 引擎级 / 范围） ----------
console.log('[14] 玩家手动命令');
{
  const emitted: SquadOrder[] = [];
  const live = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 100, z: 0 }),
    squads: () => [
      { id: 1, role: 'melee' as const, x: 10, z: 0, alive: 8 },
      { id: 2, role: 'melee' as const, x: 200, z: 0, alive: 6 },
      { id: 3, role: 'ranged' as const, x: 12, z: 0, alive: 5 },
    ],
    emit: (o: SquadOrder) => emitted.push(o),
  };
  const br = new EngineBridge(live);
  br.shadow = false;
  br.tick(0.6, 1);
  ok(br.playerOrder(1, 'garrison', { x: 5, z: 5 }), '玩家小队命令（指定队）');
  ok(br.writer.store.get(1)!.order.source === 'player', '来源=玩家（旁路稳定门）');
  const n = br.playerOrderAll('defend', { x: 0, z: 0 });
  ok(n === 3, `玩家引擎级命令（全体 ${n}/3 队）`);
  let allDefend = true;
  for (const r of br.squads.all()) if (br.writer.store.get(r.id)!.order.kind !== 'defend') allDefend = false;
  ok(allDefend, '全体收到防御令');
  const m = br.playerOrderNear('regroup', { x: 0, z: 0 }, 50);
  ok(m === 2, `范围命令只覆盖近队（${m}/3）`);
  ok(br.writer.store.get(2)!.order.kind === 'defend', '远处队未被范围命令覆盖');
  ok(emitted.length >= 3, '实机模式 emit 下发');
}

// ---------- 接线补全：攻击队列 + 统一计时 ----------
console.log('[15] 接线补全（攻击队列 1Hz + 统一计时挂相位）');
{
  const live = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 100, z: 0 }),
    squads: () => [{ id: 1, role: 'melee' as const, x: 10, z: 0, alive: 8 }],
    enemies: () => [
      { uid: 1, x: 10, z: 0 },
      { uid: 2, x: 90, z: 0 },
      { uid: 3, x: 85, z: 0 },   // 舰船 15m 内 → 在射程
      { uid: 4, x: 500, z: 500 },
    ],
  };
  const br = new EngineBridge(live);
  br.tick(0.6, 1);
  ok(br.queues.dbg.members === 4, '攻击队列已入队（4 敌）');
  ok(br.queues.ownerOfUid(1) === 'player' && br.queues.ownerOfUid(2) === 'ship', '最近实体入队（去重）');
  ok(br.timers.canFire(1) && br.timers.canFire(2) && br.timers.canFire(3), '射程内开火闩锁置位');
  ok(br.timers.canFire(4) === false, '超射程不开火');
  let t = 1;
  for (let i = 0; i < 30; i++) { t += 1; br.tick(1.0, t); }
  ok(br.timers.dbg.expiredTotal >= 1 || br.dbg.last.includes('expire'), '静止实体到期（统一计时生效）');
}

// ---------- 战术侧：扇区构建 + 大队管理器（《RTS架构.md》§2.12） ----------
console.log('[5j] SectorBuilder / BattalionManager（用户定 2026-09-26）');
{
  const sb = new SectorBuilder();
  const shipY = 6;
  // 地形（连通性用）：
  //  · 与舰相连的高原：h=6，条带 x∈(-34, 40) ∧ |z| ≤ 16（跨 chunk -1/0，相连）；
  //  · 高原内凹陷：(10,-10) 单格 h=2（被高原包住）；
  //  · 断开的小丘：x∈[-42,-38] ∧ |z| ≤ 6 → h=8（与高原隔着 h=0 壕沟）；
  //  · 其余低地 h=0。
  const surf = (x: number, z: number) => {
    if (x >= -42 && x <= -38 && Math.abs(z) <= 6) return 8;
    if (x > -34 && x < 40 && Math.abs(z) <= 16) {
      if (x === 10 && z === -10) return 2;
      return 6;
    }
    return 0;
  };
  const blk = (x: number, z: number) => x === 0 && z === -24;   // 低地阻断点
  sb.buildAll(0, 0, shipY, 4, 42, surf, blk);
  ok(sb.sectors.length === SECTOR_COUNT, '全环 8 扇区（用户定）');
  const s7 = sb.sectors[7]!;   // x>0,z<0：含高原（连通）+低地
  ok(s7.points.length > 0, '连通高原之外仍有可部署点');
  ok(s7.points.every((p) => p.h !== 6), '★ 与主角相连的高原整片排除（超出所在 chunk 也排；用户定 2026-09-27②）');
  ok(!sb.sectors.some((s) => s.points.some((p) => p.x === 10 && p.z === -10)), '被高原包住的坑洞一并排除');
  ok(sb.sectors.some((s) => s.points.some((p) => p.h === 8 && p.high === true)), '★ 断开的小丘照常占领并标 high（优先占位）');
  ok(!sb.sectors.some((s) => s.points.some((p) => p.x === 0 && p.z === -24)), '阻断点（坑/水/硬墙）不进可部署面');
  // ★ 没有舰船 → 不做连通排除（正常占领）
  const sb0 = new SectorBuilder();
  sb0.buildAll(0, 0, null, 4, 42, surf, blk);
  ok(sb0.sectors[7]!.points.some((p) => p.h === 6), '没有舰船 → 不排除（正常占领）');
  const mains = sb.selectMain(2);
  ok(mains.length === 2, 'selectMain(k)：选出 ≤k 个可部署扇区');
  ok(sb.selectMain(99).length <= SECTOR_COUNT, 'main 数夹在 [1, 8]');

  const bm = new BattalionManager();
  const squads = [
    { id: 1, role: 'melee' as const, alive: 12, x: 0, z: 0 },
    { id: 2, role: 'melee' as const, alive: 12, x: 0, z: 0 },
    { id: 3, role: 'melee' as const, alive: 8, x: 0, z: 0 },
    { id: 4, role: 'ranged' as const, alive: 5, x: 0, z: 0 },
    { id: 5, role: 'engineer' as const, alive: 2, x: 0, z: 0 },
  ];
  bm.refresh(squads);
  for (const s of squads) ok(bm.situation.get(s.id)!.full === (s.role === 'engineer' ? SQUAD_FULL_BUILDER : SQUAD_FULL_COMBAT), `满编口径：${s.role}`);
  bm.regroup();
  ok(bm.battalions.every((b) => b.alive <= BATTALION_SIZE), `大队 ≤${BATTALION_SIZE} 人（不拆小队）`);
  ok(bm.battalions.reduce((n, b) => n + b.squadIds.length, 0) === squads.length, '编制打包不丢小队');
  bm.deploy([0, 1]);
  ok([...bm.deployPlan.values()].every((s) => s === 0 || s === 1), '部署只投主攻扇区');
  const meleeAt0 = [...bm.deployPlan].filter(([sid, sec]) => sec === 0 && bm.situation.get(sid)!.role === 'melee').length;
  const meleeAt1 = [...bm.deployPlan].filter(([sid, sec]) => sec === 1 && bm.situation.get(sid)!.role === 'melee').length;
  ok(meleeAt0 <= bm.quotaOf('melee') && meleeAt1 <= bm.quotaOf('melee'), '同区同类小队不超配额（不重复往一个扇区堆兵）');
  const gaps = bm.gaps([0, 1]);
  ok([...gaps.values()].every((g) => [...g.values()].every((n) => n >= 0)), '缺口表（扇区×兵种，供随打随补）非负');
}

// ---------- 被动爬掩体（用户定 2026-09-27）：无需凭证，靠近+朝它 → 给爬越段 ----------
console.log('[5l] 被动爬掩体：靠近就爬 / 太高不爬 / 背向不爬');
{
  addStaticObstacleRect(90001, 10, 1.0, 0, 1.5, 1, 0.9, 0, true);   // 顶=1.9（脚0 → rise 1.9 可爬）
  const away = coverClimbAt(11.5, 0, 0, 1, 0);
  ok(away === null, '★ 背对掩体（目标在身后）→ 不爬');
  const run = coverClimbAt(8.0, 0, 0, 1, 0);
  ok(!!run && run.passive === true && run.top > 1.5 && Math.abs(run.ux - 1) < 1e-6 && run.lx > 10,
    '★ 靠近+朝掩体 → 被动爬越段（法线=前进方向、落点在对面、带顶高）');
  addStaticObstacleRect(90002, 30, COVER_CLIMB_MAX, 0, 1.5, 1, 0.9, 0, true);   // 顶 = COVER_CLIMB_MAX + 0.9 → rise 超限
  ok(coverClimbAt(28.2, 0, 0, 1, 0) === null, '★ 顶太高（>COVER_CLIMB_MAX）→ 不爬（留给规划绕行）');
  // ★ 长墙（中心远在 4m 外）：最近点法识别，落点刚好过墙
  addStaticObstacleRect(90003, 60, 1.0, 0, 4, 0.3, 0.9, 0, true);   // 墙 x∈[56,64], z∈[-0.3,0.3], 顶=1.9
  const wall = coverClimbAt(63.5, 1.2, 0, 0, -1);
  ok(!!wall && wall.lz > -1.5 && Math.abs(wall.lx - 63.5) < 0.2,
    '★ 长墙端部靠近 → 最近点起爬、落点刚好过墙（不被中心距离误判）');
  removeStaticObstacle(90001);
  removeStaticObstacle(90002);
  removeStaticObstacle(90003);
}

// ---------- 完全没命令 → 兜底段进-巡逻（用户定 2026-09-27） ----------
console.log('[12j] 无现令无决策 → 兜底接管（"被回收=没命令"第一类）');
{
  const sq = { id: 4, role: 'melee' as const, x: 100, z: 0, alive: 6, phase: 'executing' };
  const live = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 200, z: 0 }),
    squads: () => [sq],
    emit: () => { /* */ },
    canReach: () => true,
  };
  const br = new EngineBridge(live);
  br.shadow = true;
  br.dbg.ringMin = 0;
  br.dbg.ringMax = 200;
  const mgr = (br as unknown as { melee: { assign: (c: unknown) => void; targets: Map<number, { x: number; z: number }> } }).melee;
  mgr.assign = () => { /* 不产决策 */ };
  mgr.targets.clear();
  br.tick(1, 1);
  const o = br.writer.store.get(4)?.order;
  ok(!!o && !!o.target && o.target.x > 100, '★ 无现令无决策 → 兜底接管（朝舰推进一段）');
}

// ---------- 碰撞侧向让路（用户定 2026-09-27）：两人相遇施加相反侧向力 ----------
console.log('[5m] 侧向让路：对向碰撞 → 侧向力相反（且径向仍解重叠）');
{
  const bodies = [
    { x: 0, z: 0, y: 0, r: 0.5, dx: 1, dz: 0 },     // A 向 +x，B 在其右前
    { x: 0.8, z: 0, y: 0, r: 0.5, dx: -1, dz: 0 },  // B 向 -x（对向）
  ];
  const p = separationPushes(bodies);
  ok((p.z[0] as number) > 0.001 && (p.z[1] as number) < -0.001, '★ 对向碰撞 → 两侧向力相反（各走各的右侧）');
  ok((p.x[0] as number) < -0.001 && (p.x[1] as number) > 0.001, '★ 径向分量仍等大反向（解重叠）');
}

// ---------- §3.G 工兵保护-支援（用户定 2026-09-29） ----------
console.log('[12m] §3.G：保护配对 / 残则换 / 被打后撤+支援');
{
  const emitted: SquadOrder[] = [];
  let hitEng = false;
  const mk = (id: number, role: 'engineer' | 'melee', x: number, z: number, alive: number, full: number) =>
    ({ id, role, x, z, alive, full, hpRatio: 1 });
  const eng = mk(10, 'engineer', 100, 0, 3, 3);
  const A = mk(11, 'melee', 90, 0, 12, 12);
  const B = mk(12, 'melee', 110, 0, 12, 12);
  const C = mk(13, 'melee', 170, 0, 12, 12);
  const live = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 200, z: 0 }),
    posture: () => 0.5,
    squads: () => [eng, A, B, C],
    underAttack: (id: number) => hitEng && id === 10,
    clampRing: (x: number, z: number) => ({ x, z }),
    emit: (o: SquadOrder) => emitted.push(o),
  };
  const br = new EngineBridge(live);
  br.tick(0.6, 1);
  const p1 = br.writer.store.get(11)?.order;
  ok(p1?.state === 'protect' && Math.abs(p1.target.x - 100) < 1, '★ 创建即配保护（最近近战 A；G=工兵位）');
  A.alive = 5;   // 12 → 5 ≤ 50% = 残
  br.tick(0.6, 8);
  const p2 = br.writer.store.get(12)?.order;
  ok(p2?.state === 'protect' && Math.abs(p2.target.x - 100) < 2, '★ 保护队残 → 5s 内换最近健康近战 B');
  hitEng = true;
  br.tick(0.6, 9);
  const engO = br.writer.store.get(10)!.order;
  ok(engO.state === 'march' && engO.target.x > 125 && engO.target.x <= 131, '★ 工兵被打 → march 远离袭击者 30m');
  const sup = br.writer.store.get(13)?.order;
  ok(sup?.state === 'march' && Math.hypot(sup.target.x - 100, sup.target.z) < 2, '★ 支援：最近健康近战 C 赶来工兵位');
  hitEng = false;
  br.tick(0.6, 20);
  const rel = (br as unknown as { supportOf: Map<number, number> }).supportOf;
  ok(rel.size === 0, '★ 威胁解除 → 支援关系解除（归建兜底）');
}

// ---------- I15 掩体检测（§3.C；用户定 2026-09-29） ----------
console.log('[12n] CoverGeom：通用三点检测（任意 舰/敌人/掩体 点）');
{
  const threat = { x: 200, z: 0 };   // 可传舰，也可传敌人
  const u = { x: 100, z: 0 };
  const p = coverPoint(threat, u, 1.6);
  ok(Math.abs(p.x - 101.6) < 0.01 && Math.abs(p.z) < 0.01, '落点 = 受护点朝威胁 1.6m（在 威胁↔受护 之间）');
  ok(threePoint(threat, u, p), '三点检测：掩体在威胁侧、共线 → 过');
  ok(!threePoint(threat, u, { x: 98.4, z: 0 }), '掩体在受护点背后 → 不过（写反会在这里被抓）');
  ok(!threePoint(threat, u, { x: 101.6, z: 3 }), '侧偏 3m（不共线）→ 不过');
  ok(threePoint(threat, u, { x: 101, z: 1 }), '共线容差内（垂距 1.0）→ 过');
  ok(!threePoint(threat, u, { x: 130, z: 0 }), '离受护点太远（>4.5m）→ 不过');
}

// ---------- §3.C 掩护施工（用户定 2026-09-29） ----------
console.log('[12o] §3.C 掩护施工：查询保护对象位置 → 建造点（前部共线）');
{
  const mk = (id: number, role: 'engineer' | 'ranged', x: number, z: number) =>
    ({ id, role, x, z, alive: 6, full: 6, hpRatio: 1 });
  const eng = mk(10, 'engineer', 100, 0);
  const rng = mk(20, 'ranged', 120, 0);
  const port = {
    band: () => ({ rLo: 0, rHi: 60 }),
    ship: () => ({ x: 200, z: 0 }),
    needAt: () => 1,
    canReach: () => true,
    assault: () => true,
    noNewBuild: () => false,
    aliveOfSquad: () => 6,
    refreshSector: () => {},
    pickSpot: () => null,
    canDig: () => true,
    cover: () => {},
    dig: () => {},
    markDirty: () => {},
  };
  const live = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 200, z: 0 }),
    assault: () => true,
    squads: () => [eng, rng],
    engineer: () => port as never,
    emit: () => { /* */ },
  };
  const br = new EngineBridge(live);
  br.tick(0.6, 1);
  const wp = br.wardSpotOf(10);
  ok(!!wp && Math.abs(wp.x - 121.6) < 0.6 && Math.abs(wp.z) < 0.01, '★ 建造点 = 保护对象前部 1.6m（朝舰、与舰共线）');
  const o = br.writer.store.get(10)?.order;
  ok(o?.state === 'march' && o.mission === 'build', '★ 保护状态：工兵 march（寻路）到建造点');
  br.wardCoverDone(10, wp!.x, wp!.z);
  br.tick(0.6, 2);
  ok(br.wardSpotOf(10) === null, '★ 掩体已成且对象未移动 → 抑制重复产点');
  // ★ 反向场景（用户抓的 bug）：舰(0,0)、玩家远在舰反侧(400,0)、工兵(90,0) 比 ward(100,0) 更靠舰
  //   → 受护点=工兵，落点须在其**朝舰侧**（88.4），而不是 ward 的舰侧（98.4）=工兵背后。
  const eng2 = { id: 30, role: 'engineer' as const, x: 90, z: 0, alive: 3, full: 3, hpRatio: 1 };
  const rng2 = { id: 31, role: 'ranged' as const, x: 100, z: 0, alive: 6, full: 6, hpRatio: 1 };
  const live2 = {
    player: () => ({ x: 400, z: 0 }),
    ship: () => ({ x: 0, z: 0 }),
    assault: () => true,
    squads: () => [eng2, rng2],
    engineer: () => ({ ...port, ship: () => ({ x: 0, z: 0 }) } as never),
    emit: () => { /* */ },
  };
  const br2 = new EngineBridge(live2);
  br2.tick(0.6, 1);
  const wp2 = br2.wardSpotOf(30);
  ok(!!wp2 && Math.abs(wp2.x - 88.4) < 0.6 && wp2.x < 90,
    '★ 与舰共线：落点=更靠舰者(工兵)朝舰侧 1.6m（不再造到工兵背后）');
}

// ---------- 驻守=队长状态：自主掩体循环（用户定 2026-09-29） ----------
console.log('[12p] 驻守状态：自主掩体循环（藏→毁→撤→再进）');
{
  const ship = { x: 0, z: 0 };
  const st = newHoldCoverState(0);
  const covers = [{ x: 98, z: 0 }, { x: 110, z: 0 }, { x: 88, z: 0 }];
  const t1 = stepHoldCover(st, 0, { x: 120, z: 0 }, ship, covers);
  ok(st.phase === 'hide' && st.cover?.x === 88 && Math.abs(t1.x - 89.6) < 0.1, '★ 藏：选更靠舰的掩体、躲其背舰侧');
  const t2 = stepHoldCover(st, 1, { x: 89.6, z: 0 }, ship, [{ x: 98, z: 0 }, { x: 110, z: 0 }]);
  ok(st.phase === 'hide' && st.cover?.x === 110 && Math.abs(t2.x - 111.6) < 0.1, '★ 毁：改躲更远（更安全）掩体');
  const t3 = stepHoldCover(st, 20, { x: 111.6, z: 0 }, ship, [{ x: 98, z: 0 }, { x: 110, z: 0 }]);
  ok(st.phase === 'hide' && st.cover?.x === 98 && Math.abs(t3.x - 99.6) < 0.1, '★ 进：藏够 15s → 再向舰前移一个掩体');
  const t4 = stepHoldCover(st, 50, { x: 99.6, z: 0 }, ship, []);
  ok(st.phase === 'retreat' && t4.x > 109, '★ 无掩体 → 背舰脱离（后撤）');
  // ★ 玩家靠近（用户定 2026-09-29）：参照换玩家 + 掩体检测校核；不达标 → 绕掩体找"真被挡"点
  const cf = (_tx: number, _tz: number, _x: number, z: number) => z >= 1.5;   // 仅 +z 侧真被挡
  const st2 = newHoldCoverState(0);
  const t5 = stepHoldCover(st2, 0, { x: 111.6, z: 0 }, ship, [{ x: 100, z: 0 }],
    { player: { x: 95, z: 0 }, coverFrom: cf });
  ok(st2.phase === 'hide' && t5.z >= 1.4, '★ 玩家靠近：掩体检测调整（确保真藏在掩体后）');
}

// ---------- 工兵重做：预约制 + 每拍复检 + 看门狗 + 补兵（用户定 2026-09-26） ----------
console.log('[6] EngineerManager 重做（认区=大队管理器 / 预约 / 看门狗 / 补兵）');
{
  // ① 建造位置查询：exclude 跳过被预约/拉黑的点（防多队同点）
  const fp = new FortifyPlanner();
  const cands = [{ x: 12, z: 0, score: 0.9 }, { x: 14, z: 0, score: 0.8 }, { x: 16, z: 0, score: 0.7 }];
  for (const c of cands) fp.candidates[0]!.push({ ...c });
  fp.scanned[0] = true;
  const first = fp.targetOf(0, 0, 0, 0, 30, 0.5);
  ok(first?.x === 12, '查询：扇区内需求最高可达点');
  const excluded = fp.targetOf(0, 0, 0, 0, 30, 0.5, undefined, (x) => x === 12);
  ok(excluded?.x === 14, '查询：exclude（预约/黑名单）跳过已占点 → 不再多队同点');
  const outBand = fp.targetOf(0, 0, 0, 20, 30, 0.5);
  ok(outBand?.x === 12, '查询：带内无件 → 带外兜底（分到区就去造；用户定 2026-09-26）');

  // ② 工兵管理器：预约唯一 + 看门狗拉黑换点 + 补兵请求
  const sm = new SquadManager();
  sm.register(21, 'engineer', 1, 0);
  sm.register(22, 'engineer', 1, 0);
  const pos = new Positions();
  pos.setSquad(21, 50, 50);
  pos.setSquad(22, 50, 50);
  let spawnReq = 0;
  const wiped = new Set<number>();
  const pool = [{ x: 12, z: 0, score: 0.9 }, { x: 14, z: 0, score: 0.8 }];
  const port = {
    band: () => ({ rLo: 0, rHi: 30 }),
    ship: () => ({ x: 0, z: 0 }),
    needAt: () => 1,
    canReach: () => true,
    assault: () => false,
    noNewBuild: () => false,
    aliveOfSquad: (id: number) => (wiped.has(id) ? 0 : 1),
    refreshSector: () => {},
    pickSpot: (_sec: number, _lo: number, _hi: number, _reach: (x: number, z: number) => boolean, exclude?: (x: number, z: number) => boolean) =>
      pool.find((p) => !(exclude?.(p.x, p.z) ?? false)) ?? null,
    canDig: () => true,
    cover: () => {},
    dig: () => {},
    markDirty: () => {},
    requestSpawn: () => { spawnReq++; return true; },
  };
  const eng2 = new EngineerManager(sm, () => port as never);
  eng2.sync();
  const ctx2 = { pos, ringMin: 0, ringMax: 0, now: 0 };
  eng2.assign(ctx2);
  const t21 = eng2.targets.get(21)!, t22 = eng2.targets.get(22)!;
  ok(t21 && t22 && !(t21.x === t22.x && t21.z === t22.z), '★ 分区：两队不同区拿不同件（不重合）');
  ok(Math.abs(t21.x - 12) < 0.6 && Math.abs(t21.z) < 0.6, '管理器只告知掩体点（站位/朝向归队长）');
  ok(eng2.fortDbg.spawned >= 3, '★ 统一编制：进图即建 = 缺了即补（有活空区入局即按配额补齐）');
  // ★ 补队：曾用分区的小队没了 → 补一支新小队（3 只成队）
  sm.remove(22);
  eng2.sync();
  ctx2.now = 4;
  eng2.assign(ctx2);
  ok(eng2.fortDbg.spawned >= 3, '★ 曾用分区小队没了 → 补新小队（3 只成队）');
  // ★ 预制配额：全部分区无活（无件）→ **不建队**（绝不建发呆的工兵）
  const portNull = { ...port, pickSpot: () => null };
  const eng3 = new EngineerManager(sm, () => portNull as never);
  eng3.sync();
  const ctx3 = { pos, ringMin: 0, ringMax: 0, now: 100 };
  eng3.assign(ctx3);
  ok(eng3.fortDbg.spawned === 0, '★ 预制配额：无活分区 → 不建队（不建发呆工兵）');
  // ★ 无到件计时（用户定 2026-09-29）：队长原地不动 60s → 不拉黑/不换点（可行即去造）
  const tBefore = eng2.targets.get(21);
  for (let s = 3; s <= 63; s++) { ctx2.now = s; eng2.assign(ctx2); }
  const tAfter = eng2.targets.get(21);
  ok(!!tBefore && !!tAfter && tBefore.x === tAfter.x && tBefore.z === tAfter.z,
    '★ 无到件计时：可行即去造（60s 未到不拉黑/不换点）');
}

// ---------- 统一创建接口：只建本兵种 ∧ 只在对应防区（《战术侧架构.md》§3.D / I11） ----------
console.log('[12] SquadCreation 创建接口（role/sector 语法）');
{
  const calls: { role: string; x: number; z: number }[] = [];
  let alive = 0;
  const port: CreationPort = {
    mainSectors: () => [0, 5],
    aliveInSector: () => alive,
    anchorOf: (sec) => (sec === 0 ? { x: 10, z: 0 } : null),
    spawn: (role, x, z) => { calls.push({ role, x, z }); return true; },
  };
  const sc = new SquadCreation('melee', 6);
  sc.tick(0, port, 25);
  ok(calls.length === 3, '缺就补：一次投放 3 只成队');
  ok(calls.every((c) => c.role === 'melee'), '语法①：只建本兵种');
  ok(calls.every((c) => Math.abs(c.z) < 1e-6 && c.x >= 8.4), '语法②：只在对应防区锚点创建');
  const n1 = calls.length;
  sc.tick(5, port, 25);
  ok(calls.length === n1, '在途记账：宽限期内不重复投放（幂等）');
  sc.tick(30, port, 25);
  ok(calls.length === n1 + 3, '宽限到期仍无队（没到）→ 重试（同一条路）');
  // ★ 补兵优先：有缺编队（fillTarget）→ 在**队长身旁**投放（并入，队长指挥）
  const fillCalls: { x: number; z: number }[] = [];
  const portF: CreationPort = {
    mainSectors: () => [0],
    aliveInSector: () => 2,
    anchorOf: () => ({ x: 99, z: 99 }),
    unitTarget: () => 6,
    fillTarget: () => ({ x: 33, z: 0, gap: 2 }),
    spawn: (role, x, z) => { fillCalls.push({ x, z }); return true; },
  };
  const scF = new SquadCreation('melee', 6);
  scF.tick(0, portF, 25);
  ok(fillCalls.length === 2 && fillCalls.every((c) => Math.abs(c.x - 33) <= 1.5), '★ 补兵自动化：新兵在队长身旁投放（并入队伍=队长指挥）');
  const sc2 = new SquadCreation('ranged', 3);
  const before = calls.length;
  sc2.tick(0, { mainSectors: () => [5], aliveInSector: () => 0, anchorOf: () => null, spawn: port.spawn });
  ok(calls.length === before, '非对应防区（无锚点）→ 拒建');
  // 满编循环：每波 3 只，直到 6 人满编（成员然后并队）
  alive = 3;
  const sc3 = new SquadCreation('melee', 6);
  const b3 = calls.length;
  sc3.tick(0, port, 25);
  ok(calls.length === b3 + 3, '满编循环：缺 3 → 补 3');
  alive = 6;
  sc3.tick(100, { ...port, aliveInSector: () => 6 }, 25);
  ok(calls.length === b3 + 3, '满编后不再放');
}

// ---------- 补兵下沉到兵种管理器：策略在管理器（节拍），机制在 SquadCreation ----------
console.log('[12b] 兵种管理器补兵（节拍策略在管理器）');
{
  const sm2 = new SquadManager();
  const pos2 = new Positions();
  let calls: { role: string; x: number; z: number }[] = [];
  const mkPort = (posture: number): CreationPort => ({
    mainSectors: () => [0],
    aliveInSector: () => 0,
    anchorOf: () => ({ x: 5, z: 0 }),
    spawn: (role, x, z) => { calls.push({ role, x, z }); return true; },
    posture: () => posture,
  });
  let portP = mkPort(0);
  const mm = new MeleeManager(sm2, () => portP);
  mm.sync();
  mm.assign({ pos: pos2, ringMin: 0, ringMax: 0, now: 0 });
  ok(calls.length === 3 && calls.every((c) => c.role === 'melee'), '近战管理器：补兵走本管理器接口（只建本兵种）');
  calls = [];
  mm.assign({ pos: pos2, ringMin: 0, ringMax: 0, now: 5 });
  ok(calls.length === 0, '★ 节拍在管理器：p=0 → slow 15s，宽限内不重投');
  mm.assign({ pos: pos2, ringMin: 0, ringMax: 0, now: 16 });
  ok(calls.length === 3, '★ 节拍到期 → 再补（同一条路）');
  calls = [];
  portP = mkPort(1);   // p=1 → fast 3s
  const mm2 = new MeleeManager(sm2, () => portP);
  mm2.sync();
  mm2.assign({ pos: pos2, ringMin: 0, ringMax: 0, now: 0 });
  calls = [];
  mm2.assign({ pos: pos2, ringMin: 0, ringMax: 0, now: 4 });
  ok(calls.length === 3, '★ 事态驱动：p=1 → fast 3s，更频繁');
}

// ---------- 总攻阶段：50m 环生成（用户定 2026-09-26） ----------
console.log('[12c] 总攻：50m 环生成 + 满编上限');
{
  const calls: { x: number; z: number }[] = [];
  const portA: CreationPort = {
    mainSectors: () => [0],
    aliveInSector: () => 0,
    anchorOf: () => ({ x: 999, z: 999 }),          // 平时锚（不该被用）
    unitTarget: () => 12,
    assault: () => true,
    assaultAnchor: () => ({ x: 50, z: 0 }),        // 总攻：距舰 50m
    fillTarget: () => ({ x: 0, z: 0, gap: 9 }),    // 总攻不得并队（不贴舰）
    spawn: (role, x, z) => { calls.push({ x, z }); return true; },
    posture: () => 1,
  };
  const scA = new SquadCreation('melee', 12);
  scA.tick(0, portA, 3);
  ok(calls.length === 6 && calls.every((c) => c.x >= 48 && c.x <= 58 && c.z === 0),
    '★ 总攻：在距舰 50m 环部署（不并入现役队、不用平时锚）');
}

// ---------- 总攻：去掉其他指令，强制全体寻路到舰（用户定 2026-09-26） ----------
console.log('[12d] 总攻：强制令全体到舰（绕稳定门）');
{
  const emitted2: SquadOrder[] = [];
  const liveA = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 200, z: 0 }),
    assault: () => true,
    squads: () => [
      { id: 1, role: 'melee' as const, x: 50, z: 0, alive: 8 },
      { id: 2, role: 'ranged' as const, x: 80, z: 30, alive: 5 },
      { id: 3, role: 'engineer' as const, x: 60, z: -20, alive: 3 },
    ],
    emit: (o: SquadOrder) => emitted2.push(o),
  };
  const br = new EngineBridge(liveA);
  br.shadow = true;
  br.tick(0.6, 1);
  const o1 = br.writer.store.get(1)!.order;
  const o2 = br.writer.store.get(2)!.order;
  ok(o1.kind === 'patrol' && o1.state === 'assault' && o2.state === 'assault'
    && br.writer.store.get(3) === undefined,
    '★ 总攻：近战/远程=assault（远程先行军→到点驻守）；工兵无件→不发令');
  // ★ 目标=舰旁吸附点（用户定 2026-09-27 修）：无条件吸附，目标距舰 ≤10m（不再恒等于舰点）
  ok(Math.hypot(o1.target.x - 200, o1.target.z) <= 10, '★ 总攻：近战目标 = 舰旁可站点（≤10m）');
  br.writer.store.set(2, {
    order: { kind: 'garrison', source: 'engine', target: { x: 1, z: 1 }, seq: 0, ttl: 0 },
    phase: 'executing', progress: 0, stillS: 0, issuedAt: 1,
  });
  br.tick(0.6, 1.2);
  ok(br.writer.store.get(2)!.order.state === 'assault' && br.writer.store.get(2)!.order.kind === 'patrol',
    '★ 远程：总攻先行军（绕稳定门强制；到点转驻守）');
  // ★ 总攻强制覆盖所有人（含玩家手动令；用户定 2026-09-26）
  br.writer.store.set(1, {
    order: { kind: 'regroup', source: 'player', target: { x: 7, z: 7 }, seq: 0, ttl: 99 },
    phase: 'executing', progress: 1, stillS: 0, issuedAt: 1,
  });
  br.tick(0.6, 1.4);
  ok(br.hasFirePermit(7) === false, '开火许可查询：未授权 = false');
  br.timers.allowFire(7, true);
  ok(br.hasFirePermit(7) === true, '★ 开火许可查询：授权 = true（判官豁免消费）');
  ok(br.writer.store.get(1)!.order.kind === 'patrol' && Math.hypot(br.writer.store.get(1)!.order.target.x - 200, br.writer.store.get(1)!.order.target.z) <= 10,
    '★ 总攻强制覆盖玩家手动令（无例外）');
}

// ---------- 兜底发令（用户定 2026-09-27：绝不留下"无令站死"） ----------
console.log('[12e] 无现令 + 校验不过 → 兜底发令');
{
  const emitted3: SquadOrder[] = [];
  const liveC = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 200, z: 0 }),
    squads: () => [{ id: 1, role: 'melee' as const, x: 260, z: 0, alive: 8 }],
    emit: (o: SquadOrder) => emitted3.push(o),
    canReach: () => false,   // 可达校验永远不过
  };
  const br = new EngineBridge(liveC);
  br.shadow = true;
  br.tick(0.6, 1);
  ok(!!br.writer.store.get(1), '★ 无现令且不可达 → 仍发一条（兜底，防无令站死）');
  const o = br.writer.store.get(1)!.order;
  ok(o.kind === 'defend' || o.kind === 'act' || o.kind === 'march', '兜底令类型合法');
}

// ---------- 兜底命令机制（用户定 2026-09-27：发呆就重发/换目标） ----------
console.log('[12f] 工兵无件：不发任何兜底（全交给掩体点查询）');
{
  const emitted: SquadOrder[] = [];
  const liveS = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 200, z: 0 }),
    squads: () => [{ id: 1, role: 'engineer' as const, x: 100, z: 0, alive: 3, phase: 'executing', stillS: 20 }],
    emit: (o: SquadOrder) => emitted.push(o),
    canReach: () => true,
  };
  const br = new EngineBridge(liveS);
  br.shadow = true;
  br.tick(0.6, 1);
  // ★ 用户定 2026-09-29：工兵**无命令全交给掩体点查询**；无件 → **不发兜底**（站住，等下一件）。
  ok(br.writer.store.get(1) === undefined, '★ 工兵无件 → 不发任何兜底（不参与行军↔巡逻）');
}

// ---------- 段进循环（用户定 2026-09-27：推进一段 → 巡逻 → 再推进） ----------
console.log('[12g] 段进循环：向舰推进一段 → 巡逻 → 再推进');
{
  const SX = 200, SZ = 0;
  const sq = { id: 1, role: 'melee' as const, x: 100, z: 0, alive: 8, phase: 'executing' };
  const live = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: SX, z: SZ }),
    squads: () => [sq],
    emit: () => { /* */ },
    canReach: () => true,
  };
  const br = new EngineBridge(live);
  br.shadow = true;
  br.dbg.ringMin = 20;
  br.dbg.ringMax = 200;   // 环内正常态（避开总攻冲锋分支）
  br.tick(0.6, 1);
  const o1 = br.writer.store.get(1)!.order;
  ok(o1.kind === 'act' && o1.target.x > 100 && o1.target.x <= 131, '★ 段进：待命 → 首拍向舰推进一段（≤30m）');
  sq.x = o1.target.x; sq.z = o1.target.z; sq.phase = 'done';
  br.tick(0.6, 2);
  ok(br.writer.store.get(1)!.order.state === 'patrol', '★ 段到（core done）→ 转巡逻（mission=patrol）');
  sq.phase = 'executing';
  br.tick(0.6, 2 + 11);
  const o3 = br.writer.store.get(1)!.order;
  ok(o3.kind === 'act' && o3.target.x > o1.target.x + 5, '★ 巡逻到期 → 再推进一段（更靠舰）');
}

// ---------- 段进上限（用户定 2026-09-27）：到事态活动带前缘 → 不推进，就地巡逻 ----------
console.log('[12h] 段进上限：到事态活动带前缘（ringMin）→ 就地巡逻，不再向舰推进');
{
  const sq = { id: 2, role: 'melee' as const, x: 100, z: 0, alive: 8, phase: 'executing' };
  const live = {
    player: () => ({ x: 0, z: 0 }),
    ship: () => ({ x: 200, z: 0 }),
    squads: () => [sq],
    emit: () => { /* */ },
    canReach: () => true,
  };
  const br = new EngineBridge(live);
  br.shadow = true;
  br.dbg.ringMin = 95;    // 活动带前缘：距舰不得 < 95（当前 d=100 → 只允许前进 5m）
  br.dbg.ringMax = 200;
  br.tick(0.6, 1);
  const a1 = br.writer.store.get(2)!.order;
  ok(a1.kind === 'act' && Math.abs(a1.target.x - 105) < 1, '★ 前缘 95：首段只推进到前缘（不越带）');
  sq.x = a1.target.x; sq.z = a1.target.z; sq.phase = 'done';
  br.tick(0.6, 12);   // 段到 → 巡逻（锚在 105）
  const a2 = br.writer.store.get(2)!.order;
  ok(a2.state === 'patrol', '★ 段到 → 转巡逻');
  br.tick(0.6, 25);   // 巡逻到期 → advancePoint 应因前缘返回 null → 续巡逻、不推进
  const a3 = br.writer.store.get(2)!.order;
  ok(a3.state === 'patrol' && Math.abs(a3.target.x - 105) < 1.5,
    '★ 到前缘：advancePoint=null → 就地巡逻（不再向舰推进）');
  live.squads = () => [];
  br.tick(0.6, 90);
  ok((br as unknown as { plan: Map<number, unknown> }).plan.size === 0, '★ 小队消失 → 段进计划项清理（无残留）');
}


// ============================================================
// [13] 分档交接（tiers）：carry 零丢失换算 + Flux 隐藏/收纳编排
// ============================================================
{
  const mkLeader = (uid: number, x: number, z: number): AgentSnapshot => ({
    mobIndex: 0, x, y: 0, z, hp: 80, maxHp: 100, defense: 2, attackPower: 5,
    speed: 3, meleeDamage: 10, meleeRange: 1.6, scale: 1, tier: 2, yaw: 0,
    uid,
  } as AgentSnapshot);
  const carry: TierCarry = {
    squadId: 1, role: 'melee', squadType: 'assault', mobIndex: 0, alive: 3,
    leader: mkLeader(1, 100, 50),
    members: [
      { uid: 1, hp: 80, maxHp: 100, slotRank: 0 },
      { uid: 2, hp: 60, maxHp: 100, slotRank: 1 },
      { uid: 3, hp: 40, maxHp: 100, slotRank: 2 },
    ],
  };
  // carry 换算
  const p0 = slotPosition(carry, 0);
  ok(p0.x === 100 && p0.z === 50, '★ 交接：slot0 = 队长位置（落位公式同源）');
  const d1 = spawnFromMember(carry, { uid: 7, hp: 33, maxHp: 100, slotRank: 1 });
  ok(d1.uid === 7 && d1.hp === 33 && d1.maxHp === 100 && d1.formSlot === 1 && d1.isLeader === false,
    '★ 交接：名册→池物化零丢失（uid/血/槽位）');
  ok(d1.aggro !== undefined && d1.wanderSpeed !== undefined, '★ 交接：池必填项补默认（aggro/wanderSpeed）');

  // Flux 编排（假端口：实体表带 hidden 标记；对象仓＝stash；池＝pool）
  const ents = new Map<number, { snap: AgentSnapshot; hidden: boolean }>();
  const stash = new Map<number, AgentSnapshot>();
  const pool = new Map<number, AgentSnapshot>();
  const flux = new Flux({
    hasEntity: (uid) => ents.has(uid),
    hideEntity: (uid) => { const e = ents.get(uid); if (!e) return false; e.hidden = true; return true; },
    showEntity: (uid) => { const e = ents.get(uid); if (!e) return false; e.hidden = false; return true; },
    stashEntity: (uid) => {
      const e = ents.get(uid); if (!e) return null;
      ents.delete(uid); stash.set(uid, e.snap);
      return { hp: e.snap.hp, maxHp: e.snap.maxHp };
    },
    unstashEntity: (uid) => {
      const sn = stash.get(uid); if (!sn) return false;
      stash.delete(uid); ents.set(uid, { snap: sn, hidden: false }); return true;
    },
    hasInPool: (uid) => pool.has(uid),
    takeFromPool: (uid) => { const v = pool.get(uid) ?? null; pool.delete(uid); return v; },
    putToPool: (data) => {
      const uid = (data as AgentSnapshot).uid ?? 0;
      if (uid <= 0) return false;
      pool.set(uid, data as AgentSnapshot); return true;
    },
  });
  for (const m of carry.members) ents.set(m.uid, { snap: mkLeader(m.uid, 100, 50), hidden: false });
  ok(flux.demoteToL2(carry) && [...ents.values()].every((e) => e.hidden), '★ 交接：L3→L2 只隐藏不销毁（对象保留）');
  ok(flux.demoteToL2(carry) && ents.size === 3, '★ 交接：L3→L2 幂等');
  ok(flux.promoteToL3(carry) && [...ents.values()].every((e) => !e.hidden), '★ 交接：L2→L3 显示复用（不重建）');
  ok(flux.collapseToL1(carry) && ents.size === 0 && stash.size === 3, '★ 交接：L2→L1 收纳进对象仓（不销毁）');
  ok(carry.members[1]!.hp === 80, '★ 交接：收纳时名册按实体实况回填');
  ok(flux.expandFromL1(carry) && ents.size === 3 && stash.size === 0, '★ 交接：L1→L2 取出复用（对象仓优先）');
  ok(flux.expandFromL1(carry) && ents.size === 3, '★ 交接：L1→L2 幂等');
}
{
  // ★ 创建分档（自动转换口）：阈值单源 SWARM.L3_RADIUS / L2_RADIUS
  ok(tierForDistance(50) === 'L3' && tierForDistance(200) === 'L2' && tierForDistance(400) === 'L1',
    '★ 创建分档：按距离自动选 L3/L2/L1（阈值单源）');
}

{
  // ★ P-L1 预留名册：远队只放队长，其余成员记预留（升档物化）
  const tbl = new SquadTable();
  const sq = tbl.assign(1, 'melee' as never, 0, 0, 0);
  tbl.reserve(sq.id, 2, 77);
  const r = tbl.takeReserved(sq.id);
  ok(r.n === 2 && r.hp === 77, '★ P-L1：预留名册 记/取（数量+血量）');
  ok(tbl.takeReserved(sq.id).n === 0, '★ P-L1：预留取走即清零（幂等）');
}

{
  // ★ L1 移动：格级可行步进（纯函数；轴对齐 → 另一轴 → 原地）
  const carry = {
    squadId: 1, role: 'melee', squadType: 'assault', mobIndex: 0, alive: 1,
    leader: { mobIndex: 0, x: 100, y: 0, z: 100, hp: 80, maxHp: 100, defense: 2, attackPower: 5, speed: 3, meleeDamage: 10, meleeRange: 1.6, scale: 1, tier: 1, yaw: 0, uid: 1 } as AgentSnapshot,
    members: [],
  } as TierCarry;
  const a = l1Step(carry, 200, 100, { canStep: () => true });
  ok(a.x === 104 && a.z === 100, '★ L1：可行 → 轴对齐走一格（4m）');
  const b = l1Step(carry, 200, 100, { canStep: () => false });
  ok(b.x === 100 && b.z === 100, '★ L1：不可行 → 原地');
}

{
  // ★ 公共分档口径：同时检查多参照，取半径内等级最大（最近胜出）
  const ship = { x: 0, z: 0 }, player = { x: 400, z: 0 };
  ok(agentTierAt(200, 0, [ship, player]) === 2, '★ 分档：舰心半径内 → L2（地板）');
  ok(agentTierAt(600, 0, [ship, player]) === 2, '★ 分档：玩家半径内 → L2（相机/玩家参照）');
  ok(agentTierAt(900, 0, [ship, player]) === 1, '★ 分档：全部参照外 → L1');
}

console.log(`\n引擎自检: ${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
