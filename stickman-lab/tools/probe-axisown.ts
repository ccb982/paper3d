/**
 * ══════════════════════════════════════════════════════════════════
 * probe-axisown.ts —— **轴归属门禁**（`balance.AXIS_OWNERSHIP` 不变量）
 * ══════════════════════════════════════════════════════════════════
 *
 * 这轮重构的三个实测故障，本可以在写完后立刻被这个门禁抓出来：
 *
 *  ① `hip/1` 同时被 `τ=JᵀF`、手写 `kLatHip` 律、`pelvicLift` 三个写者写
 *     ⇒ 后者盖掉前者 ⇒ `maxLateral` 变成**死参数**
 *     （实测 80N→500N，`min|errLat|` 与 `τmax` 逐位相同、恒 30 N·m）。
 *  ② `requestHold(hip/2)+requestHold(knee/2)` 有**两份逐字相同的副本**、
 *     门控不同 ⇒ 任一份都能单独让位掉唯一撑体重的轴 ⇒ 2.35s / 2.45s 塌。
 *  ③ 「平衡全消融」仍然发出 τ[hip/1]=29 N·m 且 2 轴让位
 *     ⇒ **消融工具本身在说谎**，当时所有"是哪一条在搞破坏"的判断都不可信。
 *
 * ── 断言 ────────────────────────────────────────────────────────
 *  A. **轴归属表自身**：每个 (关节,轴) 至多一条**非从属**记录；
 *     从属记录（`subordinateTo`）必须指向一个已登记的角色。
 *  B. **零输出等价**：平衡系统**全消融**时，逐轴 τ ≡ 0、让位数 ≡ 0，
 *     且存活/躯干高度与"完全不经过 Controller"一致。
 *     （这条就是抓 ② ③ 的那一条。）
 *  C. **无轴归属冲突**：默认路径与各挡位下 `snapshot.axisConflicts` 恒为空
 *     （抓 ①）。
 *
 * 用法：node tools/run.mjs probe-axisown
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { AXIS_OWNERSHIP, DEFAULT_BALANCE_PARAMS } = await import('../src/core/systems/balance');

const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);

let fails = 0;
const bad = (m: string): void => { fails++; log(`  ✗ ${m}`); };
const ok = (m: string): void => log(`  ✓ ${m}`);

// ══ A. 轴归属表自身 ══════════════════════════════════════════════
log('══ A. 轴归属表（AXIS_OWNERSHIP）══');
{
  const seen = new Map<string, string>();
  for (const a of AXIS_OWNERSHIP) {
    const k = `${a.joint}/${a.axis}`;
    if (a.subordinateTo) {
      if (!AXIS_OWNERSHIP.some((x) => x.role === a.subordinateTo)) {
        bad(`${k} 从属于不存在的角色 ${a.subordinateTo}`);
      }
      continue;
    }
    const prev = seen.get(k);
    if (prev) bad(`${k} 有两个主记录（${prev} 与 ${a.role}）—— 必须恰好一个`);
    seen.set(k, a.role);
  }
  if (!fails) ok(`${AXIS_OWNERSHIP.length} 条记录，${seen.size} 根轴各有且仅有一个主人`);
}

// ══ B + C. 跑仿真 ════════════════════════════════════════════════
const ALL_CHANNELS = Object.freeze([
  'hip', 'knee', 'torso', 'latwaist', 'pelvicLift', 'stanceExt', 'lat', 'ankleCop',
]);

interface Result {
  ticks: number;
  yMin: number;
  tauMax: number;
  tauAxes: number[];
  heldAxes: number[];
  conflicts: string[];
}

function run(bal: Record<string, unknown>, secs: number): Result {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: secs, driver: 'controller' });
  sim.begin(new Float32Array(sim.params.length));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    balance: { ...DEFAULT_CONTROLLER.balance, ...bal },
  });
  let tauMax = 0;
  let yMin = 9;
  const tauAxes = new Set<number>();
  const heldAxes = new Set<number>();
  const conflicts = new Set<string>();
  for (let i = 0; i < Math.round(secs * 120) && !sim.finished; i++) {
    if (i % 2 === 0) {
      sim.doll.setMotorTargets(ctrl.step(1 / 60));
      for (let k = 0; k < ctrl.rs.tauOut.length; k++) {
        const v = Math.abs(ctrl.rs.tauOut[k] ?? 0);
        if (v > 0.5) { tauMax = Math.max(tauMax, v); tauAxes.add(k); }
      }
      for (let k = 0; k < ctrl.rs.holdMask.length; k++) if (ctrl.rs.holdMask[k]) heldAxes.add(k);
      for (const c of ctrl.snapshot.axisConflicts) {
        conflicts.add(`${c.joint}/${c.axis % 3} ${c.mode}←${c.by} vs ${c.against}`);
      }
    }
    sim.advance(1);
    if (i % 6 === 0) yMin = Math.min(yMin, ctrl.snapshot.torsoY);
  }
  return {
    ticks: sim.ticksDone, yMin, tauMax,
    tauAxes: [...tauAxes].sort((a, b) => a - b),
    heldAxes: [...heldAxes].sort((a, b) => a - b),
    conflicts: [...conflicts],
  };
}

const SECS = 20;

log('');
log('══ B. 零输出等价（全消融 ⇒ 逐轴 τ≡0、让位≡0、且站得住）══');
{
  // 参照：完全不经过 Controller，直接喂零目标
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: SECS, driver: 'controller' });
  sim.begin(new Float32Array(sim.params.length));
  const z = new Float32Array(sk.joints.length * 3);
  let yRef = 9;
  for (let i = 0; i < Math.round(SECS * 120) && !sim.finished; i++) {
    sim.doll.setMotorTargets(z);
    sim.advance(1);
    if (i % 6 === 0) yRef = Math.min(yRef, sim.doll.torso().translation().y);
  }
  const refTicks = sim.ticksDone;
  log(`  参照（零输出，不经 Controller）：${(refTicks / 60).toFixed(2)}s  躯干 y=${yRef.toFixed(3)}`);

  // 消融名必须覆盖 DEFAULT_BALANCE_PARAMS 里所有通道，否则「全关」不是真全关
  log(`  消融名：${ALL_CHANNELS.join(',')}`);
  const r = run({ ablate: ALL_CHANNELS.join(',') }, SECS);
  log(`  全消融：${(r.ticks / 60).toFixed(2)}s  躯干 y=${r.yMin.toFixed(3)}  τmax=${r.tauMax.toFixed(1)} 轴[${r.tauAxes}]  让位[${r.heldAxes}]`);

  if (r.tauMax !== 0 || r.tauAxes.length) bad(`全消融仍在发 τ（轴 ${r.tauAxes}）—— 某条通道没接到 ablate`);
  else ok('全消融 ⇒ 逐轴 τ ≡ 0');

  if (r.heldAxes.length) bad(`全消融仍让位 ${r.heldAxes.length} 轴 —— requestHold 没接到 ablate`);
  else ok('全消融 ⇒ 让位数 ≡ 0');

  if (r.ticks < refTicks) bad(`全消融存活 ${(r.ticks / 60).toFixed(2)}s < 零输出 ${(refTicks / 60).toFixed(2)}s`);
  else ok(`全消融存活 ≥ 零输出（${(r.ticks / 60).toFixed(2)}s vs ${(refTicks / 60).toFixed(2)}s）`);
}

log('');
log('══ C. 轴归属冲突（默认路径与各挡位都应为 0）══');
{
  const cases: [string, Record<string, unknown>][] = [
    ['挡位 I 默认', {}],
    ['挡位 I + 侧向力矩', { torqueControl: true, lateralEnabled: true, maxLateral: 200 }],
    ["挡位 II 纯侧向 τ", { torqueControl: true, lateralEnabled: true }],
    ['挡位 I + 骨盆抬升', { kPelvicLift: 0.06 }],
  ];
  for (const [tag, bal] of cases) {
    const r = run(bal, 8);
    if (r.conflicts.length) {
      bad(`${tag}：${r.conflicts.length} 处同轴异模式 —— ${r.conflicts.slice(0, 3).join(' | ')}`);
    } else {
      ok(`${tag}：0 冲突（τ轴[${r.tauAxes}] 让位[${r.heldAxes}]）`);
    }
  }
}

log('');
if (fails) {
  log(`✗ 轴归属门禁失败 ${fails} 项`);
  process.exit(1);
}
log('★ 轴归属门禁全绿：每轴一个主人，全消融 == 零输出，无同轴异模式');