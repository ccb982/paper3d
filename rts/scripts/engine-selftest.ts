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
import { MeleeManager } from '../src/systems/swarm/engine/MeleeManager.ts';
import { RangedManager } from '../src/systems/swarm/engine/RangedManager.ts';
import { FlyerManager } from '../src/systems/swarm/engine/FlyerManager.ts';
import { EngineerManager } from '../src/systems/swarm/engine/EngineerManager.ts';
import { TimerManager, type TimerHost } from '../src/systems/swarm/engine/TimerManager.ts';
import { Protect } from '../src/systems/swarm/engine/Protect.ts';
import { interpretLeader } from '../src/systems/swarm/squad/CommandLang.ts';
import { wellFormed, interpretEngine } from '../src/systems/swarm/engine/CommandLang.ts';
import { spreadFix } from '../src/systems/swarm/engine/Spread.ts';
import { validateOrder } from '../src/systems/swarm/engine/OrderValidator.ts';
import { spreadFix } from '../src/systems/swarm/engine/Spread.ts';
import { validateOrder } from '../src/systems/swarm/engine/OrderValidator.ts';
import { OrderWriter, SquadOrderStore } from '../src/systems/swarm/engine/OrderWriter.ts';
import { AttackQueues } from '../src/systems/swarm/engine/AttackQueues.ts';
import { SectorManager } from '../src/systems/swarm/engine/SectorManager.ts';
import { EngineCore } from '../src/systems/swarm/engine/EngineCore.ts';
import { EngineBridge } from '../src/systems/swarm/engine/EngineBridge.ts';
import { SquadCore } from '../src/systems/swarm/squad/SquadCore.ts';
import { decideChain } from '../src/systems/swarm/engine/DecisionChain.ts';
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
  const ctx = { pos, ringMin: 0, ringMax: 0, now: 0 };
  ok(melee.assign(ctx) === 1, '近战分配 1 队');
  const mt = melee.targets.get(11);
  ok(mt !== undefined && Math.abs(mt.x - 12) < 0.01, '近战压到离玩家 ENGAGE=12 处（50→12）');
  ok(ranged.assign(ctx) === 1, '远程分配 1 队');
  const rt = ranged.targets.get(12);
  ok(rt !== undefined && Math.abs(rt.x - 18) < 0.01, '远程保距到射程环（50→18）');
  ok(flyer.assign(ctx) === 1, '飞天分配 1 队');
  const ft = flyer.targets.get(13);
  ok(ft !== undefined && Math.abs(Math.hypot(ft.x, ft.z) - 10) < 0.01, '飞天航线在 10m 圈上');
  // 环内夹取：环 [5, 8] → 近战 12 要夹到 8；环 [5, 20] → 远程 18 不夹
  melee.assign({ pos, ringMin: 5, ringMax: 8, now: 0 });
  ok(Math.abs(Math.hypot(melee.targets.get(11)!.x, melee.targets.get(11)!.z) - 8) < 0.01, '近战目标夹进环上界 8');
  ranged.assign({ pos, ringMin: 5, ringMax: 20, now: 0 });
  ok(Math.abs(Math.hypot(ranged.targets.get(12)!.x, ranged.targets.get(12)!.z) - 18) < 0.01, '远程环内不夹（18 已在带内）');
  // 刷怪执行
  ok(eng.assign(ctx) === 1, '工兵分配（保持站位）');
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
console.log('[5b] CommandLang 复合→原子（解释器）');
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

// ---------- 引擎命令语言（语法 + 解释器） ----------
console.log('[5c] CommandLang 引擎复合句（良构 + 解释器）');
{
  const base = {
    kind: 'protect' as const, source: 'engine' as const, roe: 'engage' as const, seq: 0, ttl: 0,
    target: { x: 0, z: 0 }, anchor: { x: 8, z: 0 }, threat: { x: 0, z: 0 },
  };
  ok(wellFormed(base) === null, 'protect：G/P 齐全 → 良构');
  ok(wellFormed({ ...base, anchor: undefined }) !== null, 'protect：缺 G → 拦下');
  ok(wellFormed({ ...base, threat: undefined }) !== null, 'protect：缺 P → 拦下');
  ok(wellFormed({ ...base, kind: 'act' as never, target: undefined as never }) !== null, 'act：缺 target → 拦下');
  ok(wellFormed({ ...base, roe: 'bad' as never }) !== null, '非法 roe → 拦下');
  const itP = interpretEngine(base);
  ok(itP.op === 'block' && itP.anchor!.x === 8 && itP.threat!.x === 0, 'protect → block（双点原样）');
  const itA = interpretEngine({ ...base, kind: 'act' as never, target: { x: 12, z: 3 } });
  ok(itA.op === 'move' && itA.target.x === 12, 'act → move(target)');
  const itD = interpretEngine({ ...base, kind: 'defend' as never, object: { x: 5, z: 5 } });
  ok(itD.op === 'hold' && itD.target.x === 5, 'defend → hold(object)');
  const itD2 = interpretEngine({ ...base, kind: 'defend' as never, target: { x: 7, z: 7 } });
  ok(itD2.op === 'hold' && itD2.target.z === 7, 'defend 无对象 → hold(原地 target)');
}

// ---------- Spread / OrderValidator ----------
console.log('[6] 同兵种散开 + 发令统一校验链');
{
  // Spread（切向）：同兵种两点在径向上滑开，径向距离不变；异兵种不约束
  const fixed = spreadFix([
    { id: 1, role: 'melee', x: 50, z: 0 },
    { id: 2, role: 'melee', x: 50, z: 8 },
    { id: 3, role: 'ranged', x: 50, z: 5 },
  ], { x: 0, z: 0 });
  const g1 = fixed.find((f) => f.id === 1)!;
  const g2 = fixed.find((f) => f.id === 2)!;
  const g3 = fixed.find((f) => f.id === 3)!;
  ok(Math.abs(Math.hypot(g1.x, g1.z) - 50) < 0.01 && Math.abs(Math.hypot(g2.x, g2.z) - Math.hypot(50, 8)) < 0.01, '切向推开：径向距离（r）严格不变');
  ok(Math.abs(g2.z - g1.z) > 30, '切向拉开间距（8m → 30m+）');
  ok(g3.moved === 0, '异兵种不约束');
  const fixed2 = spreadFix([
    { id: 1, role: 'melee', x: 0, z: 0 },
    { id: 2, role: 'melee', x: 10, z: 0 },
    { id: 3, role: 'ranged', x: 5, z: 0 },
  ]);
  const f1 = fixed.find((f) => f.id === 1)!;
  const f2 = fixed.find((f) => f.id === 2)!;
  const f3 = fixed.find((f) => f.id === 3)!;
  ok(Math.abs(Math.hypot(f1.x - f2.x, f1.z - f2.z) - 40) < 0.01, '同兵种 10m → 错开到 40m');
  ok(f1.moved > 0 && f2.moved > 0, '对称推开（两边都动）');
  const far = spreadFix([
    { id: 1, role: 'melee', x: 0, z: 0 },
    { id: 2, role: 'melee', x: 100, z: 0 },
  ]);
  ok(far[0].moved === 0 && far[1].moved === 0, '已 ≥40m 不动');
  // OrderValidator ①：50m → 夹到环 30 + 建议防御
  const v1 = validateOrder(1, 50, 0, { px: 0, pz: 0, ringMin: 0, ringMax: 30, role: 'melee', siblings: [] });
  ok(Math.abs(v1.x - 30) < 0.01 && v1.clamped, '① 超上限夹到环上（50→30）');
  ok(v1.suggest === 'defend', '① 到事态函数上限 → 建议防御');
  const v2 = validateOrder(1, 20, 0, { px: 0, pz: 0, ringMin: 0, ringMax: 30, role: 'melee', siblings: [] });
  ok(!v2.clamped && v2.suggest === null, '① 环内不夹');
  // ② 密度：与同兵种兄弟 10m → 错开（各推 15，自己到 -15）
  const v3 = validateOrder(9, 50, 0, {
    px: 0, pz: 0, ringMin: 0, ringMax: 0, role: 'melee',
    siblings: [{ id: 8, role: 'melee', x: 50, z: 8 }],
  });
  ok(v3.spread && Math.abs(Math.hypot(v3.x, v3.z) - 50) < 0.01 && Math.abs(v3.z) > 3, '② 与兄弟太近 → 切向错开（径向 r 不变）');
  // ③ 可达
  const v4 = validateOrder(1, 20, 0, {
    px: 0, pz: 0, ringMin: 0, ringMax: 0, role: 'melee', siblings: [],
    canReach: () => false,
  });
  ok(!v4.ok && !v4.reachable, '③ 不可达 → 不发令');
}

// ---------- OrderWriter ----------
console.log('[8] OrderWriter 唯一发令器');
{
  const store = new SquadOrderStore();
  const w = new OrderWriter(store);
  const mk = (kind: SquadOrder['kind'], x: number, z: number): SquadOrder => ({
    kind, source: 'engine', target: { x, z }, roe: 'engage', seq: 1, ttl: 10,
  });
  ok(w.issue(1, mk('act', 10, 0), { now: 0 }), '首次发令成功');
  ok(store.get(1) !== undefined, '写入唯一写口（SquadOrderStore）');
  ok(w.issue(1, mk('act', 10, 0), { now: 1 }), '同签名重发允许');
  ok(!w.issue(1, mk('defend', 20, 0), { now: 2 }), '换令但进度低 → 拦截');
  ok(w.dbg.kept === 1, 'dbg.kept 计数');
  w.advance(1, 0.6, 0);
  ok(w.issue(1, mk('defend', 20, 0), { now: 3 }), '进度 ≥50% → 允许换令');
  w.advance(1, 0.1, 30);
  ok(w.issue(1, mk('protect', 5, 0), { now: 4 }), '静止 ≥25s → 允许换令');
  w.advance(1, 0.1, 0);
  ok(w.issue(1, mk('act', 99, 0), { now: 5, intervention: true }), '干预令旁路稳定门');
  ok(w.issue(1, mk('act', 77, 0), { now: 6, player: true }), '玩家令旁路');
  ok(w.issue(1, mk('act', 55, 0), { now: 7, wounded: true }), '重伤旁路');
  ok(w.dbg.bypass >= 3, 'dbg.bypass 计数');
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
  const empty = sec.emptySectors();
  ok(empty.length === 1 && empty[0] === 2, '空区统计');
  ok(sec.refillOf(2, 1) === 1, '空区补派数');
  ok(sec.refillOf(0, 1) === 0, '有队不补派');
  sec.setSafety(0, 0.9);
  sec.setSafety(1, 0.2);
  const safe = sec.safeSectors(0.8);
  ok(safe.length === 1 && safe[0] === 0, '很安全的区（调区依据）');
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
  bridge.dbg.ringMax = 60;
  bridge.shadow = true;   // ★ 影子模式仅调试用（默认 false = 真下发）；本用例显式开启
  bridge.tick(0.6, 1);   // 2Hz → 触发一拍
  ok(bridge.dbg.ticks === 1, '桥接节拍触发');
  ok(bridge.squads.dbg.count === 3, '小队已登记（perceive）');
  ok(bridge.pos.squad(1)?.x === 50, '位置进单源 Positions');
  ok(bridge.melee.dbg.assigned === 2 && bridge.ranged.dbg.assigned === 1, '四管理器各拿各的（decide）');
  // 影子模式：命令只进本地 store，不 emit
  ok(emitted.length === 0, '影子模式不发实机命令');
  ok(bridge.writer.dbg.issued >= 1, '命令经唯一发令器下发（本地）');
  // 近战 2 队同兵种太近 → 下发目标（校验后）应被切向错开（间距 ≥40）
  const o1 = bridge.writer.store.get(1)!.order.target;
  const o2 = bridge.writer.store.get(2)!.order.target;
  const a1 = Math.atan2(o1.z, o1.x);
  const a2 = Math.atan2(o2.z, o2.x);
  let da = Math.abs(a1 - a2);
  if (da > Math.PI) da = Math.PI * 2 - da;
  const rAvg = (Math.hypot(o1.x, o1.z) + Math.hypot(o2.x, o2.z)) * 0.5;
  // ★ 行进目标点 = 径向 r（兵种策略）⊗ 切向 θ（同兵种间距）：只解 θ、r 严格不变。
  //   r=12 < MIN/2 → 弦长上限 = r1+r2 = 24m，切向拉满 π → 弧长 π·12 ≈ 37.7m（本用例断言 ≥35）。
  ok(da * rAvg >= 35, `同兵种切向间距（弧长 ${(da * rAvg).toFixed(1)}m）已拉开`);
  ok(Math.abs(Math.hypot(o1.x, o1.z) - 12) < 0.01 && Math.abs(Math.hypot(o2.x, o2.z) - 12) < 0.01,
    '切向散开不改径向（r 严格不变）');
  // 环夹取：90 → 60（环上限）
  const t3 = bridge.ranged.targets.get(3)!;
  ok(Math.hypot(t3.x, t3.z) <= 60.01, '远程目标夹进环（≤60）');
  // 实机模式：emit 真下发
  bridge.shadow = false;
  bridge.tick(0.6, 2.2);
  ok(emitted.length >= 1, '实机模式 emit 下发');
  ok(bridge.writer.dbg.issued >= 1, '发令器台账');
  // 玩家命令：随随便便就能下（同一发令器 + player 旁路 + 只给队长）
  const pOk = bridge.playerOrder(1, 'regroup', { x: 5, z: 5 });
  ok(pOk && bridge.writer.store.get(1)!.order.source === 'player', '玩家命令经唯一发令器直达队长');
  ok(bridge.writer.store.get(1)!.order.kind === 'regroup', '玩家命令内容生效');
  ok(bridge.writer.store.get(1)!.order.ttl === 30 * 12, '玩家令 TTL = 30 游戏分钟');
  // ★ 执行板续期（旧链已删）：玩家令在身 → 决策为空，但执行板每拍仍同步现令（不掉令）
  bridge.tick(0.6, 2.8);
  ok(bridge.dbg.refreshed >= 1, '执行板续期计数（无新令也不丢执行令）');
  // ★ 玩家令 TTL 到期 → 释放，交回引擎（不能永久锁死该队）
  bridge.tick(0.6, 2.8 + 30 * 12 + 1);
  ok(bridge.writer.store.get(1)?.order.source === 'engine', '玩家令到期 → 交回引擎决策');
  // 被打反应：玩家打 3 队 → 登记保护（保护者=最近的其他队）
  const live2 = { ...live, playerAttacking: () => 3 };
  const b2 = new EngineBridge(live2);
  b2.tick(0.6, 1);
  ok(b2.protect.dbg.links === 1, '玩家打小队 → 引擎登记保护关系');
}

// ---------- SquadCore（队长侧） ----------
console.log('[13] SquadCore 队长核心（接令/距离分流/汇报）');
{
  const reports: SquadReport[] = [];
  const core = new SquadCore(1, 'melee', {
    nav: {
      longPath: (x, z) => (x > 200 ? -1 : Math.hypot(x, z) + 10),
      canHop: () => true,
    },
    report: (r) => reports.push(r),
    alive: () => 8,
  });
  core.accept({ kind: 'act', source: 'engine', target: { x: 100, z: 0 }, roe: 'engage', seq: 1, ttl: 0 });
  core.tick(0.5);
  ok(core.atom === 'march', '距离长（100 > 40）→ 行军（长寻路）');
  ok(core.dbg.long === 1, '长寻路被调用');
  ok(reports.length === 1 && reports[0].squadId === 1 && reports[0].atom === 'march', '汇报走唯一接收器');
  core.x = 80;
  core.tick(0.5);
  ok(core.atom === 'act', '距离短（20 ≤ 40）→ 行动（短跳）');
  ok(core.dbg.short === 1, '短跳被调用');
  core.x = 99.5;
  core.tick(0.5);
  ok(core.phase === 'done' && core.dbg.done === 1, '到位 → done');
  core.accept({ kind: 'march', source: 'player', target: { x: 300, z: 0 }, roe: 'engage', seq: 2, ttl: 0 });
  const before = reports.length;
  core.tick(0.5);
  ok(reports.length === before + 1 && core.dbg.long === 1, '长寻路不可达 → 不推进（仍汇报，等引擎换点）');
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

// ---------- DecisionChain 显式优先链 ----------
console.log('[16] DecisionChain（玩家>重伤>事态>干预>常规）');
{
  const base = {
    playerOrder: false, hpRatio: 1, atRingMax: false, underAttack: false,
    intervention: null, routine: { x: 10, z: 0 }, retreat: { x: -30, z: -30 },
  };
  ok(decideChain({ ...base, playerOrder: true }) === null, '① 玩家令在身 → 引擎不产令');
  const w = decideChain({ ...base, hpRatio: 0.4 });
  ok(w?.source === 'wounded' && w.kind === 'march' && w.target?.x === -30 && w.target?.z === -30, '② 整队危急 → 向**后**撤（远离战场）');
  ok(decideChain({ ...base, hpRatio: 0.4, retreat: null }) === null, '② 无后撤点 → 不产令（保持现状）');
  const s1 = decideChain({ ...base, atRingMax: true });
  ok(s1?.source === 'situation' && s1.kind === 'defend', '③ 到上限 → 防御');
  const s2 = decideChain({ ...base, underAttack: true });
  ok(s2?.kind === 'protect', '③ 被打 → 保护');
  const iv = decideChain({ ...base, intervention: { x: 99, z: 0 } });
  ok(iv?.source === 'intervention' && iv.target?.x === 99, '④ 干预优先于常规');
  const rt = decideChain(base);
  ok(rt?.source === 'routine' && rt.kind === 'act', '⑤ 常规部署');
  ok(decideChain({ ...base, routine: null }) === null, '全不成立 → null（保持现状）');
  // 优先级：重伤 > 事态 > 干预
  ok(decideChain({ ...base, hpRatio: 0.2, atRingMax: true, intervention: { x: 1, z: 1 } })?.source === 'wounded', '重伤压过事态/干预');
  ok(decideChain({ ...base, atRingMax: true, intervention: { x: 1, z: 1 } })?.source === 'situation', '事态压过干预');
}

console.log(`\n引擎自检: ${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
