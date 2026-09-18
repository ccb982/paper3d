// 临时探针（离屏验收）：直跑真实 AI 模块，验证「远程兵是否会开火 / 打向哪里」。
// 只 import 纯逻辑模块（behaviors/conditions/AIStateMachine/aiconfig），零 three/零 DOM。
import { readFileSync } from 'node:fs';
import {
  CROSSBOW_AI, WAR_CASTER_AI, AMP_CASTER_AI, REUNION_AI, type AIConfig,
} from '../../../src/systems/ai/aiconfig';
import { AIStateMachine } from '../../../src/systems/ai/AIStateMachine';
import type { BehaviorContext, TargetCandidate } from '../../../src/systems/ai/behaviors';

interface Shot {
  t: number;
  state: string;
  type: string;
  ox: number; oz: number;
  angDeg: number;   // 弹道方向（度）
  trueDeg: number;  // 指向真实目标的方位（度）
  errDeg: number;   // 夹角（>30° = 打空）
  dist: number;     // 出膛时与目标的真实距离
}

interface Trace { t: number; state: string; d: number }

/** 假实体（只实现 behaviors/conditions 真正读到的字段） */
function makeEntity(x: number, z: number) {
  const pos = { x, y: 0, z };
  return {
    entity: { position: pos, id: 7 },
    aiAttackTimer: 0,
    aiSwingDone: false,
    aiTurnTimer: 0,
    aiMoveDir: { x: 0, z: 0 },
    aiWaypoint: null,
    yawBase: 0,
    position: pos,
    moveBy(dx: number, dz: number, dt: number, speed: number) {
      const len = Math.hypot(dx, dz) || 1;
      pos.x += (dx / len) * speed * dt;
      pos.z += (dz / len) * speed * dt;
    },
    hitAnchorY: () => pos.y + 1.0,
  };
}

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) * 180 / Math.PI;
};

/**
 * @param liveCandidates  true = 模拟**修复后**的模式层（候选是每帧原地更新的活对象）
 *                        false = 模拟**修复前**（候选是坐标拷贝）
 */
function run(
  ai: AIConfig,
  playerPath: (t: number) => { x: number; z: number },
  runSeconds: number,
  liveCandidates: boolean,
) {
  const ent = makeEntity(0, 0);
  const sm = new AIStateMachine(ai);
  const shots: Shot[] = [];
  const trace: Trace[] = [];
  /** 活对象槽（同 WorldMode.candSlots 语义） */
  const slot: TargetCandidate = { x: 0, z: 0 };
  let nextTrace = 0;

  const ctx: BehaviorContext = {
    dt: 1 / 60, time: 0, target: null,
    findTarget: () => ({ ...playerPath(ctx.time) }),
    targetCandidates: (): TargetCandidate[] => {
      const p = playerPath(ctx.time);
      if (liveCandidates) {
        slot.x = p.x; slot.z = p.z;  // 原地更新 → ctx.target 跟着走
        return [slot];
      }
      return [{ x: p.x, z: p.z }];   // 每次新对象（旧行为：快照）
    },
    attack: (opts) => {
      const p = playerPath(ctx.time);
      if (opts.type === 'projectile') {
        const ang = Math.atan2(opts.dirZ, opts.dirX);
        const trueDeg = Math.atan2(p.z - opts.z, p.x - opts.x);
        shots.push({
          t: ctx.time, state: sm.stateName, type: opts.type,
          ox: opts.x, oz: opts.z,
          angDeg: ang * 180 / Math.PI, trueDeg: trueDeg * 180 / Math.PI,
          errDeg: angDiff(ang, trueDeg),
          dist: Math.hypot(p.x - opts.x, p.z - opts.z),
        });
      } else {
        shots.push({
          t: ctx.time, state: sm.stateName, type: opts.type, ox: 0, oz: 0,
          angDeg: 0, trueDeg: 0, errDeg: 0, dist: 0,
        });
      }
    },
    focusX: 0, focusZ: 0, focusY: 1.0,
  };

  for (let i = 0; i < runSeconds * 60; i++) {
    ctx.focusX = playerPath(ctx.time).x;
    ctx.focusZ = playerPath(ctx.time).z;
    sm.update(ent as never, ctx);
    if (ctx.time >= nextTrace) {
      nextTrace += 2;
      const p = playerPath(ctx.time);
      trace.push({
        t: ctx.time, state: sm.stateName,
        d: Math.hypot(p.x - ent.position.x, p.z - ent.position.z),
      });
    }
    ctx.time += 1 / 60;
  }
  return { shots: shots.filter((s) => s.type === 'projectile'), trace, ent, sm };
}

// ---- 场景：玩家站着不动 6s（足够被发现 + 进入攻击态），然后瞬移 40m 外 ----
const P0 = { x: 0, z: 8 };
const P1 = { x: 0, z: -32 };
const path = (t: number) => (t < 6 ? P0 : P1);

function report(label: string, ai: AIConfig, live: boolean) {
  const r = run(ai, path, 14, live);
  console.log(`\n=== ${label} | 候选=${live ? '活对象(修复后)' : '坐标拷贝(修复前)'} ===`);
  console.log('  轨迹 ' + r.trace.map((x) => `${x.t.toFixed(0)}s:${x.state}@${x.d.toFixed(1)}m`).join('  '));
  console.log(`  开火 ${r.shots.length} 次`);
  // 玩家移动之后（t>6）的开火 —— 这一段最能说明问题
  const after = r.shots.filter((s) => s.t > 6.2);
  if (after.length === 0) {
    console.log('  玩家离开后：0 次开火（正确：脱战）');
  } else {
    const avgErr = after.reduce((a, s) => a + s.errDeg, 0) / after.length;
    const maxErr = Math.max(...after.map((s) => s.errDeg));
    const far = Math.max(...after.map((s) => s.dist));
    console.log(
      `  玩家离开后：${after.length} 次开火，平均偏角 ${avgErr.toFixed(1)}°，`
      + `最大 ${maxErr.toFixed(1)}°，最远在 ${far.toFixed(1)}m 处射击`,
    );
  }
}

report('弩手 CROSSBOW_AI', CROSSBOW_AI, false);
report('弩手 CROSSBOW_AI', CROSSBOW_AI, true);
report('战争术士 WAR_CASTER_AI', WAR_CASTER_AI, true);

// ============================================================
// ★ 回归验证：祖宗嘲讽优先级（用户明确"这是设计，因为它有索敌"）
//   场景：祖宗在 30m（超出弩手 aggro 14m，但在嘲讽半径 40m 内）、玩家在 5m。
//   期望：敌人**越过近处的玩家**去追祖宗 —— 嘲讽半径（候选自带 radius）优先于通用视野半径。
//   对"坐标拷贝/活对象"两种候选各跑一遍：两条都应通过 ⇒ 证明本次修复没碰这条优先级。
// ============================================================
const TAUNT_R = 40;
function tauntCheck(live: boolean): { state: string; targetX: number; targetZ: number }[] {
  const ent = makeEntity(0, 0);
  const sm = new AIStateMachine(CROSSBOW_AI);
  const seen: { state: string; targetX: number; targetZ: number }[] = [];
  const sentinel = { x: 0, z: 30, radius: TAUNT_R };  // 祖宗（带嘲讽半径）
  const player = { x: 0, z: 5 };                       // 玩家（近得多）
  const pSlot = { x: 0, z: 0 };
  const sSlot = { x: 0, z: 0, radius: TAUNT_R };
  const ctx: BehaviorContext = {
    dt: 1 / 60, time: 0, target: null,
    findTarget: () => ({ ...player }),
    // 候选顺序 = 祖宗 > 玩家（与 WorldMode.enemyTargetCandidates 同形）
    targetCandidates: () => {
      if (live) {
        sSlot.x = sentinel.x; sSlot.z = sentinel.z;
        pSlot.x = player.x; pSlot.z = player.z;
        return [sSlot, pSlot];
      }
      return [{ x: sentinel.x, z: sentinel.z, radius: TAUNT_R }, { x: player.x, z: player.z }];
    },
    attack: () => undefined,
    focusX: 0, focusZ: 0, focusY: 1.0,
  };
  for (let i = 0; i < 60 * 6; i++) {
    sm.update(ent as never, ctx);
    seen.push({ state: sm.stateName, targetX: ctx.target?.x ?? NaN, targetZ: ctx.target?.z ?? NaN });
    ctx.time += 1 / 60;
  }
  return seen;
}

console.log('\n=== 祖宗嘲讽优先级回归（弩手 aggro=14m / 嘲讽半径=40m）===');
{
  let fail = 0;
  for (const live of [false, true]) {
    const seen = tauntCheck(live);
    const chased = seen.filter((s) => s.state !== 'patrol');
    // 目标应为祖宗 (0,30)，而不是玩家 (0,5)
    const onSentinel = chased.length > 0 && chased.every((s) => Math.abs(s.targetZ - 30) < 1e-6);
    const godParent = chased.length === 0;
    console.log(
      `  候选=${live ? '活对象' : '坐标拷贝'}：进入追击 ${chased.length} 帧，`
      + `状态 ${[...new Set(seen.map((s) => s.state))].join('/')}，`
      + `目标 z=${chased.length ? chased[chased.length - 1].targetZ : '(未锁)'}`
      + ` → ${onSentinel ? '✓ 越过玩家追祖宗' : godParent ? '★ 未触发索敌' : '★ 追的是玩家（优先级被破坏）'}`,
    );
    if (!onSentinel) fail++;
  }
  console.log(fail === 0
    ? '  ✓ 嘲讽优先级两种候选下都成立（本次修复未触碰该设计）'
    : '  ★ 嘲讽优先级异常');
  if (fail) process.exitCode = 1;
}

// ============================================================
// ★★ 嘲讽「能否真的咬住」扫描（重做版）
//
//   ⚠️ 上一版指标（"首次进 chase 后连续帧数"）把 patrol↔chase 的
//      minStay=3s 抖动混进了信号，读不出结论 —— 作废。版二改成三个无歧义量：
//        minDist    20s 内与祖宗的最近距离（= 到底有没有真的冲过去）
//        reachedAtk 是否进过 attack（= 真的能打到它）
//        chase%     chase 帧占比
//
//   祖宗是站桩友军（`stationary=true`）→ 位置固定，不引入漂移；
//   `findTarget → null` 关掉 wander 的"偏向玩家"分量，否则敌人会被那点偏置
//   慢慢拉离祖宗，把"嘲讽能不能咬住"和"游走往哪飘"两件事搅在一起。
// --------------------------------------------
//   机制预期（读 aiconfig.mobAI 的状态机）：
//     嘲讽半径 40m 只决定"看得见"（seePlayer / retarget 入口）；
//     而 chase 里的 loseTarget 用的是**敌人自己的 loseRadius** ⇒
//     若 loseRadius < D，进 chase 的下一帧就因超距被踢回 patrol（minStay 3s）→
//     每 3 秒只能推进 1 帧 chaseSpeed（≈5cm）→ 永远追不到。
//   本扫描就是验证这条推断。
// ============================================================
/** 可复现随机（LCG 顶掉 Math.random）：同一种子 → 同一结果 */
function seedRandom(seed: number): void {
  let s = seed >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function tauntEngage(ai: AIConfig, D: number, runSeconds = 20) {
  const ent = makeEntity(0, 0);
  const sm = new AIStateMachine(ai);
  const slot: TargetCandidate = { x: 0, z: D, radius: TAUNT_R };
  let minDist = Infinity;
  let chaseFrames = 0;
  let reachedAtk = false;
  const seen = new Set<string>();
  const ctx: BehaviorContext = {
    dt: 1 / 60, time: 0, target: null,
    findTarget: () => null,        // ★ 关掉游走偏向，隔离嘲讽信号
    targetCandidates: () => [slot],
    attack: () => undefined,
    focusX: 0, focusZ: D, focusY: 1.0,
  };
  for (let i = 0; i < runSeconds * 60; i++) {
    sm.update(ent as never, ctx);
    seen.add(sm.stateName);
    if (sm.stateName === 'chase') chaseFrames++;
    if (sm.stateName === 'attack') reachedAtk = true;
    minDist = Math.min(minDist, Math.hypot(ent.position.x - slot.x, ent.position.z - slot.z));
    ctx.time += 1 / 60;
  }
  return { minDist, chaseFrames, reachedAtk, states: [...seen].join('/') };
}

console.log('\n=== 祖宗嘲讽「能否真的咬住」扫描 · 每档 12 个种子取均值（固定种子，可复现）===');
console.log('    祖宗站桩在 (0,D)；嘲讽半径 40m；敌人从 (0,0) 起。判据 = 20s 内有没有贴上去打');
{
  const cases: { name: string; ai: AIConfig; lose: number }[] = [
    { name: '弩手        ', ai: CROSSBOW_AI, lose: 24 },
    { name: '扩音术士    ', ai: AMP_CASTER_AI, lose: 26 },
    { name: '战争术士    ', ai: WAR_CASTER_AI, lose: 34 },
    { name: '整合运动人员', ai: REUNION_AI, lose: 12 },
  ];
  const Ds = [8, 14, 20, 26, 32, 38];
  console.log(`  ${'兵种'.padEnd(12)} lose   ${Ds.map((d) => `${d}m`.padStart(11)).join('')}`);
  let firstBad: { name: string; lose: number; bite: number } | null = null;
  for (const c of cases) {
    const cells: string[] = [];
    let reported = false;
    for (const D of Ds) {
      let biteCount = 0, sumMin = 0, sumChase = 0;
      const N = 12;
      for (let k = 0; k < N; k++) {
        seedRandom(1000 + k * 7919);
        const r = tauntEngage(c.ai, D);
        if (r.reachedAtk) biteCount++;
        sumMin += r.minDist;
        sumChase += r.chaseFrames;
      }
      const minAvg = sumMin / N;
      const bite = biteCount / N;
      if (!reported && bite < 0.99) {
        firstBad = { name: c.name.trim(), lose: c.lose, bite };
        reported = true;
      }
      cells.push(
        `${(bite >= 0.99 ? '咬住' : bite <= 0.01 ? '★松口' : `${Math.round(bite * 100)}%`)}/${minAvg.toFixed(0)}m`
          .padStart(11),
      );
    }
    console.log(`  ${c.name} ${String(c.lose).padStart(3)}   ${cells.join('')}`);
  }
  console.log('  单元格 = 「贴上并进 attack 的种子比例 / 20s 内与祖宗的最近距离均值」');
  console.log('          咬住 = 12/12 都打到了；★松口 = 12/12 都没打到（说明被 loseRadius 卡在门外）');
  if (firstBad) {
    const fb = firstBad as { name: string; lose: number; bite: number };
    console.log(
      `  ★ 首个"开始咬不住"的档：${fb.name} loseRadius=${fb.lose}（只 ${Math.round(fb.bite * 100)}% 打到）`
      + ' → 与 loseRadius 同量级 ⇒ 嘲讽半径 40m 是入口，实际够不够得着由敌人自己的 loseRadius 决定',
    );
  }
}

// ---- 静态断言：模式层必须给"活对象"，不能再退回坐标拷贝 ----
const src = readFileSync(
  new URL('../../../src/modes/WorldMode.ts', import.meta.url), 'utf8',
);
const start = src.indexOf('private enemyTargetCandidates');
const body = src.slice(start, src.indexOf('\n  }', start));
const pushLiteral = /out\.push\(\s*\{/.test(body);
const pushesSlot = /out\.push\(s\)/.test(body);
console.log('\n=== 源码不变量断言（WorldMode.enemyTargetCandidates）===');
console.log(`  方法体长度 ${body.length} 字符`);
console.log(`  推入坐标字面量 out.push({ ... }) ？ ${pushLiteral ? '★ 是（回归！会退化成快照）' : '否 ✓'}`);
console.log(`  推入活对象槽 out.push(s) ？        ${pushesSlot ? '是 ✓' : '★ 否（未找到）'}`);
if (pushLiteral || !pushesSlot) {
  console.error('  ✗ 不变量被破坏：候选不再是活对象 → ctx.target 会冻结成坐标快照');
  process.exitCode = 1;
} else {
  console.log('  ✓ 活对象不变量成立');
}
