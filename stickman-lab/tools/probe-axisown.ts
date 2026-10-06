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
 *  D. **角色标签不闪**：20s 内 `loadBearer` / `isFront` 各切换 ≤ 3 次，
 *     且不得同时出现"两条腿都承重""两条腿都是前腿""没有腿承重"。
 *     （抓「同一决策多份实现」—— 承重腿曾有裸比较版、前腿曾在 `snapshot()`
 *      里另写一份 `footL >= footR`，两者都无迟滞 ⇒ UI 标签逐帧闪。）
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
const { AXIS_OWNERSHIP, DEFAULT_BALANCE_PARAMS, NON_AXIS_CHANNELS }
  = await import('../src/core/systems/balance');

const log = console.log;
/** 门禁 F 要读源码文本（唯一性检查），所以需要一个文本读取器 */
const read = (p: string): string => fs.readFileSync(p, 'utf8');
/**
 * ★ 2026-10-06：**去掉注释**再查「单源」。
 *
 *   门禁 D0 用正则 `(?<![.\w])frontLeg\s*\(` 在源码里找「前腿的定义」，
 *   而 `gaitState.ts` 的**注释**里写了 ``frontLeg() 在双脚并齐时…`` ⇒ 命中 ⇒
 *   误报「第 2 处定义」。实测：真正的定义只有 `rigState.ts` 一处。
 *
 *   ⇒ 门禁查的是**代码**，不是注释。（教训与 `tools/probe-*` 里其它几次
 *     「探针自己说谎」同源：断言的匹配面比它想断言的东西大。）
 */
const codeOnly = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')          // 块注释
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');     // 行注释（`://` 保留）
const readCode = (p: string): string => codeOnly(read(p));
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);

let fails = 0;
const bad = (m: string): void => { fails++; log(`  ✗ ${m}`); };
const ok = (m: string): void => log(`  ✓ ${m}`);

// ══ A. 轴归属表自身 ══════════════════════════════════════════════
log('══ A. 轴归属表（AXIS_OWNERSHIP）══');
//
// ★ 2026-10-06 键从 `(关节, 轴)` 换成 `(关节, 轴, 模式)` —— 见 balance.ts
//   顶部那段「表的模型换了」的注释：同模式的第二个写者必须**合并成一行**
//   （`channel` + `extraGates`），而不是靠 `subordinateTo` 硬塞成从属
//   （旧模型实测三处「让位给了空气 / 没有主人 / 声称有主人但没写者」）。
{
  const byMode = new Map<string, string>();
  const allGates = new Set<string>();
  for (const a of AXIS_OWNERSHIP) {
    const k = `${a.joint}/${a.axis}/${a.mode}`;
    const prev = byMode.get(k);
    if (prev) {
      bad(`${k} 有两条记录（${prev} 与 ${a.role}）—— 同一 (轴,模式) 必须合并成一条`);
    }
    byMode.set(k, a.role);
    for (const g of [a.channel, ...(a.extraGates ?? [])]) {
      if (!g) bad(`${k} 的消融门为空串`);
      else allGates.add(g);
    }
  }
  if (!fails) {
    ok(`${AXIS_OWNERSHIP.length} 条记录、${byMode.size} 个 (轴,模式) 唯一`
      + `（${allGates.size} 个消融门：${[...allGates].sort().join(', ')}）`);
  }
}

// ══ A2. 通道名单与 `on('…')` 接线的一致性 ════════════════════════════
//   为什么必须查：**消融名单漏一个通道 ⇒「全消融」不是全消融 ⇒ 门禁 B 测的是
//   假故障**（已发生四次，见 ALL_CHANNELS 上方注释）。这里从源码里把
//   真正被 `on('…')` 消费的名字全抠出来，与 `AXIS_OWNERSHIP` 对账。
log('');
log('══ A2. 通道名单 vs 源码里的 on(…) 接线 ══');
{
  const wired = new Set<string>();
  for (const f of ['src/core/systems/balance.ts', 'src/core/systems/wantedForce.ts',
    'src/core/systems/step.ts']) {
    if (!fs.existsSync(f)) continue;
    const src = readCode(f);
    for (const m of src.matchAll(/\bon\('([a-zA-Z]+)'\)/g)) wired.add(m[1]!);
    // `computeWantedForce` 的 gate 回调里用 `ch === 'lat'` 形式，不是 `on()`
    for (const m of src.matchAll(/ch === '([a-zA-Z]+)'/g)) wired.add(m[1]!);
  }
  // `qpEnable || on('qp')` 这种**反向**语义：名字在表里但默认开着，
  // 必须真的能被 `ablate` 关掉，否则「全消融」关不住它。
  const qpDefaultOn = /qpEnable\s*\|\|\s*on\('qp'\)/.test(read('src/core/systems/balance.ts'));
  if (!qpDefaultOn) {
    bad("找不到 `qpEnable || on('qp')` —— QP 的启用语义变了，「全消融」名单需重新对账");
  } else ok("QP 的启用语义 = `qpEnable || on('qp')`（ablate 含 'qp' 才关得住）");

  // 表里的门 = `channel` ∪ `extraGates`，加上**明确声明不申领轴**的通道
  const inTable = new Set<string>();
  for (const a of AXIS_OWNERSHIP) {
    inTable.add(a.channel);
    for (const g of a.extraGates ?? []) inTable.add(g);
  }
  const nonAxis = new Set(NON_AXIS_CHANNELS.map((n) => n.channel));
  for (const n of NON_AXIS_CHANNELS) {
    if (!n.why) bad(`非轴通道 ${n.channel} 没写理由 ⇒ 无法判断它该不该申领轴`);
  }
  const notInTable = [...wired].filter((c) => !inTable.has(c) && !nonAxis.has(c)).sort();
  const notWired = [...inTable].filter((c) => !wired.has(c) && c !== 'qp').sort();

  if (notInTable.length) {
    bad(`这些通道在源码里被 on(…) 消费，但归属表里没有 ⇒ 表不完整：${notInTable.join(', ')}`);
  } else {
    ok(`表里的门全部在源码里有 on(…) 接线（${[...inTable].sort().join(', ')}）`
      + (nonAxis.size ? `；非轴通道 ${[...nonAxis].join(', ')}` : ''));
  }
  if (notWired.length) {
    // ⚠ 这类是**表在说谎**：声明了通道名，实际没有 `on()` 门 ⇒ ablate 关不掉它。
    bad(`这些通道在表里登记了，但源码里没有任何 on(…) 门`
      + ` ⇒ ablate 对它们无效：${notWired.join(', ')}`);
  } else {
    ok('每个登记的门都有真实的 on(…) 门（ablate 真的能关掉它）');
  }
}

// ══ B + C. 跑仿真 ════════════════════════════════════════════════
//
// ★★★ 「全消融」名单**必须从代码里长出来，不能手写**。
//
// 2026-10-06 修（此前手写 8 项，漏了 4 个）：
//   漏 `qp` / `hipStiff` / `postureLoad` / `ankleLat`
//   ⇒ 门禁 B 报「全消融仍在发 τ（25 根轴，τmax=200）」，而那 τ **全部是探针
//     自己漏关的通道产生的**。QP 尤其隐蔽：`qpEnable` 默认 `false`，但接线是
//     `p.qpEnable || on('qp')`（balance.ts:849）⇒ **`ablate` 不含 `'qp'` 就是启用**
//     ⇒ 手写名单漏了它，等于在「全消融」里把 QP 打开了。
//   这是「消融工具说谎」的**第四次**复发（前三次记在 balance.ts 顶部注释），
//   根因都是同一个：名单是人肉维护的。现在改成
//     ① `AXIS_OWNERSHIP` 里出现过的每个 `channel` + `extraGates`（表 = 归属真源）
//     ② `NON_AXIS_CHANNELS` 里声明「不申领轴」的通道
//   的并集；门禁 A2 断言二者与源码一致，所以以后新增通道忘了加名单会**当场报红**。
const ALL_CHANNELS = Object.freeze([...new Set<string>([
  ...AXIS_OWNERSHIP.flatMap((a) => [a.channel, ...(a.extraGates ?? [])]),
  ...NON_AXIS_CHANNELS.map((n) => n.channel),
])].sort());

interface Conflict {
  joint: string;
  /** 轴号（`axis % 3`） */
  axis: number;
  mode: string;
  by: string;
  against: string;
}

interface Result {
  ticks: number;
  yMin: number;
  tauMax: number;
  tauAxes: number[];
  heldAxes: number[];
  /** ★ 结构化冲突（门禁 C 要按 (joint,axis,mode) 查表，不能提前压成字符串） */
  conflicts: Conflict[];
  /** 实际被写过（位置或力矩）的轴，形如 `hip_l/0` */
  written: string[];
  /** 逐轴累计 |τ_out|（N·m）—— 判「某个门到底有没有在出力」用 */
  tauAcc: number[];
  /**
   * ★ 存活时的**跌倒判据来源**。用户 2026-10-06 定：「以头落地为唯一标准」。
   *   `sim.checkFall()` 现在确实只判 `headHitGround()`（sim.ts:1559），
   *   但「唯一标准」这件事必须**每拍都能回读**，否则改坏了没人知道
   *   —— 探针把它和头高一起打出来，任何一次跌倒都能立刻归因。
   */
  fallReason: string;
  headYAtFall: number;
  tiltDegAtFall: number;
  torsoYAtFall: number;
}

function run(bal: Record<string, unknown>, secs: number): Result {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: secs });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    balance: { ...DEFAULT_CONTROLLER.balance, ...bal },
  });
  let tauMax = 0;
  let yMin = 9;
  const tauAxes = new Set<number>();
  const tauAcc: number[] = new Array(ctrl.rs.axisCount).fill(0);
  const heldAxes = new Set<number>();
  const conflicts = new Map<string, Conflict>();
  const written = new Set<string>();
  for (let i = 0; i < Math.round(secs * PHYS_HZ) && !sim.finished; i++) {
    // ★ 2026-10-06：`axisOwner` / `axisConflicts` / `written` 三项**每拍都读**。
    //   原来这些采样在 `if (i % 2 === 0)` 里面，而 `shiftDemandF` 只在
    //   `phase ∈ {SHIFT,DOUBLE} && !handoverOk` 时非零（step.ts:169）
    //   ⇒ 采样点若恰好落在窗口外，块⑤ 写的轴就**整根漏检**。
    //   本次就漏检过（默认路径下 `knee/0`、`hip/0`、`foot/0` 都没进名单）。
    for (let k = 0; k < ctrl.rs.axisCount; k++) {
      const owner = ctrl.rs.axisOwner(k);
      if (owner === 'none' || owner === 'bind') continue;
      written.add(`${sk.joints[Math.floor(k / 3)]!.name}/${k % 3}`);
    }
    for (const c of ctrl.snapshot.axisConflicts) {
      conflicts.set(`${c.joint}/${c.axis % 3} ${c.mode}<-${c.by}`,
        { joint: c.joint, axis: c.axis % 3, mode: c.mode, by: c.by, against: c.against });
    }
    if (i % PHYS_PER_CTRL === 0) {
      // ★ dt 必须是**墙钟真实值**。原来传 `1/60` 而调用频率是 120 Hz
      //   ⇒ Controller 内部所有时间常数快了一倍（见上面「时间单位」的注释）。
      sim.doll.setMotorTargets(ctrl.step(CTRL_DT));
      for (let k = 0; k < ctrl.rs.tauOut.length; k++) {
        const v = Math.abs(ctrl.rs.tauOut[k] ?? 0);
        tauAcc[k] = (tauAcc[k] ?? 0) + v;
        if (v > 0.5) { tauMax = Math.max(tauMax, v); tauAxes.add(k); }
      }
      for (let k = 0; k < ctrl.rs.holdMask.length; k++) if (ctrl.rs.holdMask[k]) heldAxes.add(k);
    }
    sim.advance(1);
    if (i % 6 === 0) yMin = Math.min(yMin, ctrl.snapshot.torsoY);
  }
  return {
    ticks: sim.ticksDone, yMin, tauMax,
    tauAxes: [...tauAxes].sort((a, b) => a - b),
    heldAxes: [...heldAxes].sort((a, b) => a - b),
    conflicts: [...conflicts.values()],
    written: [...written].sort(),
    tauAcc,
    fallReason: sim.fallReason,
    headYAtFall: sim.fallDiag.headY,
    tiltDegAtFall: sim.fallDiag.tiltDeg,
    torsoYAtFall: sim.fallDiag.torsoY,
  };
}

/** 存活秒数 + **跌倒判据**（头落地 = 唯一标准，必须每次都能回读） */
function fmtRun(r: Result): string {
  const s = secsOf(r.ticks).toFixed(2);
  if (r.fallReason === 'head') {
    return `${s}s  头落地@${(r.ticks / 120).toFixed(2)}s  头 y=${r.headYAtFall.toFixed(3)}`
      + `  躯干 y=${r.torsoYAtFall.toFixed(3)}  倾角 ${r.tiltDegAtFall.toFixed(1)}°`;
  }
  return `${s}s  躯干 y=${r.yMin.toFixed(3)}  ${r.fallReason ? `跌倒判据=${r.fallReason}` : '未跌倒（时长上限）'}`;
}

// ════════════════════════════════════════════════════════════════════════
// ★★★ 时间单位（2026-10-06 修，**错 2 倍**）
//
//   `Sim` 的 `physicsHz = 240` / `controlHz = 120`（sim.ts:223-225）。
//   `this.tick++` 在**控制拍**末尾（sim.ts:901，`stages = physicsHz/controlHz = 2`
//   ⇒ 每 2 个物理步加一次），且 `ticksTotal = duration * controlHz`
//   ⇒ **`ticksDone` 的单位是「控制拍 @120Hz」，不是秒。**
//
//   原探针三处都按 60Hz 算，于是：
//     · 存活秒数 `ticks/60`      ⇒ **虚高一倍**（8.97s 实为 4.49s）
//     · 外层循环 `secs*120` 次 `advance(1)` ⇒ 每 `advance` 只推进 1/240 s
//       ⇒ 请求 20 s 实际只跑了 **10 s**（跑不满就退出）
//     · `ctrl.step(1/60)` 每 2 个物理步调一次 = 墙钟 **120 Hz**
//       ⇒ 却传 dt=1/60 ⇒ Controller 认为时间过了 1/60 s，实际只过 1/120 s
//       ⇒ **控制器内部所有时间常数快了一倍**：`loadFilt`（τ=60 ms 低通）、
//         `updateComTransfer`、速度环形缓冲、`slewLimit × dt` 全部受影响。
//
//   ⇒ 「站了 X 秒」这个数在修好之前**不可信**。既然敌人就是存活秒数，
//     先把尺子修对。
// ════════════════════════════════════════════════════════════════════════
const PHYS_HZ = DEFAULT_SIM.physicsHz;    // 240
const CTRL_HZ = DEFAULT_SIM.controlHz;    // 120
/** `ticksDone` → 秒 */
const secsOf = (ticks: number): number => ticks / CTRL_HZ;
/** 每个控制拍 = `PHYS_HZ/CTRL_HZ` 个物理步 */
const PHYS_PER_CTRL = Math.max(1, Math.round(PHYS_HZ / CTRL_HZ));
/** 传给 `ctrl.step()` 的真实墙钟 dt */
const CTRL_DT = 1 / CTRL_HZ;

const SECS = 20;

// ════════════════════════════════════════════════════════════════════════
// ★ **头落地 = 跌倒的唯一标准**（用户 2026-10-06 重申）
//
//   `sim.checkFall()` 现在确实只判 `doll.headHitGround()`（sim.ts:1559），
//   躯干高度与倾角只进诊断、不参与判定；自碰撞是关的
//   （`GROUPS_SELF` 只和地面碰，ragdoll.ts:50）⇒ 头不可能碰到自己的胸口。
//   ⇒ 判据本身是对的。**但它必须每拍可回读** —— 否则哪天被改坏，
//   "存活 X 秒" 这个数字会悄悄换掉含义，而所有基于它的判断跟着作废。
//
//   所以下面每一条存活数字都带 `fallReason`，且任何一次非 `head` 的终止
//   都直接判红：那说明有人加了第二条判据。
// ════════════════════════════════════════════════════════════════════════
function checkHeadOnlyCriterion(r: Result, tag: string): void {
  if (!r.fallReason) { ok(`${tag}：跑到时长上限，头未落地`); return; }
  if (r.fallReason === 'head') ok(`${tag}：跌倒判据 = 头落地（唯一标准）`);
  else bad(`${tag}：跌倒判据 = "${r.fallReason}" —— 不是头落地！`
    + '有人加了第二条判据，"存活秒数"的含义已经变了');
}

log('');
log('══ B. 零输出等价（全消融 ⇒ 逐轴 τ≡0、让位≡0、且站得住）══');
{
  // 参照：完全不经过 Controller，直接喂零目标
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
  sim.begin(new Float32Array(sim.paramCount));
  const z = new Float32Array(sk.joints.length * 3);
  let yRef = 9;
  for (let i = 0; i < Math.round(SECS * PHYS_HZ) && !sim.finished; i++) {
    sim.doll.setMotorTargets(z);
    sim.advance(1);
    if (i % 6 === 0) yRef = Math.min(yRef, sim.doll.torso().translation().y);
  }
  const refTicks = sim.ticksDone;
  log(`  参照（零输出，不经 Controller）：${secsOf(refTicks).toFixed(2)}s  躯干 y=${yRef.toFixed(3)}`
    + `  判据=${sim.fallReason || '未落地'}`);
  if (sim.fallReason && sim.fallReason !== 'head') {
    bad(`零输出参照的跌倒判据 = "${sim.fallReason}"，不是头落地`);
  }

  // 消融名必须覆盖 DEFAULT_BALANCE_PARAMS 里所有通道，否则「全关」不是真全关
  log(`  消融名：${ALL_CHANNELS.join(',')}`);
  const r = run({ ablate: ALL_CHANNELS.join(',') }, SECS);
  log(`  全消融：${fmtRun(r)}  τmax=${r.tauMax.toFixed(1)} 轴[${r.tauAxes}] 让位[${r.heldAxes}]`);
  checkHeadOnlyCriterion(r, '全消融');

  if (r.tauMax !== 0 || r.tauAxes.length) bad(`全消融仍在发 τ（轴 ${r.tauAxes}）—— 某条通道没接到 ablate`);
  else ok('全消融 ⇒ 逐轴 τ ≡ 0');

  if (r.heldAxes.length) bad(`全消融仍让位 ${r.heldAxes.length} 轴 —— requestHold 没接到 ablate`);
  else ok('全消融 ⇒ 让位数 ≡ 0');

  if (r.ticks < refTicks) bad(`全消融存活 ${secsOf(r.ticks).toFixed(2)}s < 零输出 ${secsOf(refTicks).toFixed(2)}s`);
  else ok(`全消融存活 ≥ 零输出（${secsOf(r.ticks).toFixed(2)}s vs ${secsOf(refTicks).toFixed(2)}s）`);
}

log('');
log('══ C. 轴归属冲突（默认路径与各挡位）══');
//
// ★ 2026-10-06：原断言是「`axisConflicts` 恒为空」，**在当前设计下永远不可能绿**。
//
//   原因：`claimAxis`（rigState.ts）只在「同一根轴被两种模式申领」时记冲突。
//   而归属表里 `hip/2`、`hip/0`、`foot/2`、`knee/2`、脊柱各轴**恰恰声明了**
//   「同一根轴、两种模式」这种并联（pos 位置环 + tau 力矩通道，
//   在 `driveMotors` 里**相加**后按 τmax 饱和，不存在谁覆盖谁）
//   —— 按定义就会冲突。⇒ 断言与表**按构造互斥**。
//
//   正确的判据不是「有没有冲突」，而是「**有没有未声明的冲突**」：
//   · 表里该轴**同时有 pos 与 tau 记录** ⇒ **声明过的并联**，合法
//   · 表里该轴只有一种模式 ⇒ **未声明的双写**，架构错误
//   两者必须分开计数，否则要么永远红、要么被白名单放掉真错误。
//
// ⚠ 2026-10-06 表的键换成 (轴, 模式) 之后，这条判据顺带变严了：
//   「声明」不再靠 `subordinateTo` 挂一条从属记录，而是**该轴真的有另一模式的记录**。
{
  const norm = (n: string): string => n.replace(/_\w+$/, '');
  /** 该轴声明过的模式集合（表里出现过就算声明过） */
  const declared = new Map<string, Set<string>>();
  for (const a of AXIS_OWNERSHIP) {
    const k = `${norm(a.joint)}/${a.axis}`;
    let s = declared.get(k);
    if (!s) { s = new Set(); declared.set(k, s); }
    s.add(a.mode);
  }

  const cases: [string, Record<string, unknown>][] = [
    ['挡位 I 默认', {}],
    ['挡位 I + 侧向力矩', { torqueControl: true, lateralEnabled: true, maxLateral: 200 }],
    ["挡位 II 纯侧向 τ", { torqueControl: true, lateralEnabled: true }],
    ['挡位 I + 骨盆抬升', { kPelvicLift: 0.06 }],
  ];
  for (const [tag, bal] of cases) {
    const r = run(bal, 8);
    const undeclared: string[] = [];
    const okDeclared: string[] = [];
    for (const c of r.conflicts) {
      const key = `${norm(c.joint)}/${c.axis}`;
      // ★ 2026-10-06 加**跨系统**判据（附录 D.4 的可执行版本）。
      //
      //   表里 pos 与 tau 都有 ≠ 并联合法。判据必须是**谁在写**：
      //     · 同一 SystemId（balance）在同一轴上 pos+tau = 设计如此
      //       （位置环与 `τ=JᵀF` 在 `driveMotors` 里**相加**后按 τmax 饱和）
      //       ⇒ 合法并联；
      //     · **不同 SystemId**（balance 的 tau × step 的 pos）是附录 D.4
      //       明令禁止的「平衡抢迈步系统的轴」⇒ 必须报红，
      //       直到 balance 学会**让位**（那是 D.7 第 1 项）。
      const crossSystem = c.by !== 'balance' || c.against !== 'balance';
      if (declared.get(key)?.has(c.mode) && !crossSystem) {
        okDeclared.push(`${c.joint}/${c.axis} ${c.mode}<-${c.by}`);
      } else if (crossSystem) {
        undeclared.push(`${c.joint}/${c.axis} ${c.mode}<-${c.by} vs ${c.against}`
          + '（跨系统同轴异模式 ⇒ D.4 要求 balance 让位，未让位）');
      } else {
        undeclared.push(`${c.joint}/${c.axis} ${c.mode}<-${c.by} vs ${c.against}`);
      }
    }
    // ★ 敌人本体：**站不到 2s**。每种配置都必须报存活秒数 + 跌倒判据。
    log(`  ${tag}：${fmtRun(r)}`);
    checkHeadOnlyCriterion(r, tag);
    if (undeclared.length) {
      bad(`${tag}：${undeclared.length} 处**未声明**的同轴异模式 —— ${undeclared.slice(0, 4).join(' | ')}`);
    } else {
      ok(`${tag}：0 处未声明冲突`
        + `（声明过的并联 ${okDeclared.length} 处${okDeclared.length ? '：' + [...new Set(okDeclared)].slice(0, 4).join(' | ') : ''}）`
        + `  τ轴[${r.tauAxes}] 让位[${r.heldAxes}]`);
    }
  }
}

log('');
log('══ D0. ★ 状态机是「纯判据」：不得下发任何关节目标 ══');
//
// 用户 2026-10-06：「状态机不需要每拍给目标。」
//   ⇒ 这条定调必须**可执行**，否则半年后又变成"状态机顺手也发了点指令"。
//
// 判据：`gaitState.ts` 的**代码**（剥掉注释）里不得出现任何关节需求接口。
//   ⚠ 必须剥注释再匹配 —— 否则注释里写一句"这里本来是 requestAngle"就误报。
{
  const SRC = 'src/core/gaitState.ts';
  const code = readCode(SRC);
  const FORBID = [
    'requestAngle', 'requestTorque', 'addTorque', 'forceTorque',
    'requestHold', 'clearHold', 'requestSwingLeg', 'requestSwingLegAngle',
    'requestSwingLegTorque', 'requestWaistSlot',
  ];
  const hit = FORBID.filter((f) => code.includes(f));
  if (hit.length) {
    bad(`状态机源码里出现了关节需求接口：${hit.join(', ')}`
      + ' —— 「状态机不下发目标」这条定调被破坏了');
  } else {
    ok(`状态机是纯判据：${FORBID.length} 个关节需求接口一个都没出现`);
  }
  // 状态机**必须**输出这 6 项（文档 §7 的「穷举就这 6 项」）
  const MUST = ['rs.state', 'rs.stateT', 'rs.verified', 'rs.violations',
    'rs.loadBearer', 'rs.locked'];
  const miss = MUST.filter((m) => !code.includes(m));
  if (miss.length) bad(`状态机没写这些输出：${miss.join(', ')}`);
  else ok(`状态机输出齐全（${MUST.join(', ')}）`);
}

log('══ D. 角色标签稳定性（承重腿 / 前腿不得闪）══');
//
// ★ 2026-10-06：**删除**「前腿切换 >3 ⇒ snapshot() 与 frontLeg() 不是同一份实现」
//   这条断言的**成因**。它已被推翻：`snapshot()` 现在就调 `frontLeg()`
//   （rigState.ts:1197，单源），而 `frontLeg()`（rigState.ts:762-775）里
//   「并齐时保持上一拍」的迟滞是 2026-10-05 专门为**同一成因**加的，
//   并且当时的记录写着「修好后 20s 只切 1~3 次」。
//   ⇒ 切换次数超标**不能再推出「有第二份实现」**，它现在只说明
//     **3mm 死区对当前姿态下的真实几何漂移不够**（角色站着不动，Δx 在 ±1mm 内晃）。
//   下面改成直接断言「单源」这件事本身，而不是从切换次数反推。
{
  // D0：单源断言 —— 「前腿」的判定在源码里必须只有一处
  const SRC_D = ['src/core/rigState.ts', 'src/ui/hud.ts', 'src/core/controller.ts',
    'src/core/sim.ts', 'src/core/systems/step.ts', 'src/core/systems/balance.ts',
    'src/core/gaitState.ts'];
  // 定义 = `frontLeg(` 且前面不是 `.`（调用是 `.frontLeg(`）
  const frontDefs = SRC_D.filter((f) => fs.existsSync(f)
    && /(?<![.\w])frontLeg\s*\(/.test(readCode(f)));
  if (frontDefs.length !== 1) {
    bad(`「前腿」的**定义**应恰好 1 处，实际 ${frontDefs.length} 处：${frontDefs.join(', ') || '无'}`);
  } else {
    ok(`前腿判定唯一（${frontDefs[0]}），snapshot() 读的是它`);
  }
  // 快照必须真的用它，而不是自己另写一份裸比较
  const rsSrc = read('src/core/rigState.ts');
  const snapBody = rsSrc.slice(rsSrc.indexOf('snapshot(limitHit'));
  if (/\bfrontLeg\(\)/.test(snapBody)) ok('snapshot() 内部调用 frontLeg()（不是第二份比较）');
  else bad('snapshot() 里找不到 frontLeg() 调用 —— 可能又写了一份裸比较');

  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
  let n = 0, swB = 0, swF = 0, pb = '', pf = '';
  const viol: string[] = [];
  const dx: number[] = [];
  // ★ 2026-10-06：断言从「切换次数 ≤3」改成「**每次切换都必须有最小驻留**」。
  //   旧断言隐含假设「角色站着不动」；现在状态机真的会带着它走
  //   （默认路径从 1.21s 变成 8.00s 不倒），前后腿每走一步就合法地换一次
  //   ⇒ 计数超标不再是缺陷信号。**抖动**的判据是「驻留过短」，这才是要防的。
  const minDwellB: number[] = [];
  const minDwellF: number[] = [];
  let lastB = -1e9, lastF = -1e9;
  for (let i = 0; i < Math.round(SECS * PHYS_HZ) && !sim.finished; i++) {
    if (i % PHYS_PER_CTRL === 0) {
      sim.doll.setMotorTargets(ctrl.step(CTRL_DT));
      const s = ctrl.snapshot;
      const L = s.legs.l, R = s.legs.r;
      const b = String(s.loadBearer);
      const f = L.isFront ? 'l' : 'r';
      const tSec = i / CTRL_HZ;
      if (b !== pb) { swB++; pb = b; minDwellB.push(tSec - lastB); lastB = tSec; }
      if (f !== pf) { swF++; pf = f; minDwellF.push(tSec - lastF); lastF = tSec; }
      if (L.isBearer && R.isBearer) viol.push(`t=${(i / PHYS_HZ).toFixed(2)} 两条腿同时标承重`);
      if (!L.isBearer && !R.isBearer) viol.push(`t=${(i / PHYS_HZ).toFixed(2)} 没有腿被标承重`);
      if (L.isFront === R.isFront) viol.push(`t=${(i / PHYS_HZ).toFixed(2)} 两条腿同为主前`);
      // ★ 记录 Δx：切换次数超标时用它区分「死区不够」与「第二份实现」。
      //   若 |Δx| 始终远小于死区 3mm，说明角色没真在换前腿 ⇒ 是标签在抖。
      dx.push(Math.abs(ctrl.rs.soleX.l - ctrl.rs.soleX.r) * 1000);
      n++;
    }
    sim.advance(1);
  }
  const dxMax = dx.length ? Math.max(...dx) : 0;
  const dxMed = dx.length ? [...dx].sort((a, b) => a - b)[dx.length >> 1]! : 0;
  log(`  ${SECS}s / ${n} 拍：承重腿切换 ${swB} 次，前腿切换 ${swF} 次`
    + `  |Δx| 中位 ${dxMed.toFixed(1)}mm / 最大 ${dxMax.toFixed(1)}mm（死区 3mm）`);

  // 最小驻留 = 抖动判据。0.15s 略低于最短驻留 0.20s，容忍采样误差。
  const minB = minDwellB.length ? Math.min(...minDwellB) : 9;
  const minF = minDwellF.length ? Math.min(...minDwellF) : 9;
  if (minB < 0.15) bad(`承重腿切换的最短驻留只有 ${minB.toFixed(3)}s（<0.15s）⇒ 是抖动不是行走`);
  else ok(`承重腿无抖动（切换 ${swB} 次，最短驻留 ${minB.toFixed(2)}s）`);

  if (minF < 0.15) {
    bad(`前腿切换的最短驻留只有 ${minF.toFixed(3)}s（<0.15s）`
      + `⇒ 3mm 死区不够（|Δx| 最大 ${dxMax.toFixed(1)}mm）`);
  } else {
    ok(`前腿无抖动（切换 ${swF} 次，最短驻留 ${minF.toFixed(2)}s；`
      + `|Δx| 最大 ${dxMax.toFixed(0)}mm ⇒ 角色真的在换前腿，次数由步态决定）`);
  }

  if (viol.length) bad(`角色一致性违例 ${viol.length} 条：${viol.slice(0, 2).join(' | ')}`);
  else ok('角色一致性（承重/前后）无违例');
}

log('');
log('══ E. 每根被写过的轴都必须在 AXIS_OWNERSHIP 里登记 ══');
//
// ★ 2026-06-06 两处加固：
//   ① `run()` 原来只在 `i % 2 === 0` 采样 ⇒ 每 2 个物理拍才看一次，
//      而 `shiftDemandF` 只在 SHIFT/DOUBLE 且交接未成时非零（step.ts:169）
//      ⇒ 8s 窗口里若恰好错过，整根轴**漏检**。本次就漏检过
//      （块⑤ 在默认路径发的 `knee/0`、`hip/0`、`foot/0` 全没进名单）。
//      现在 `run()` **每拍**都记 owner，并把窗口拉到 12s。
//   ② 归并时把**腿侧去掉**再查表（`hip_l/2` → `hip/2`）是对的，
//      但不能因此丢掉「左右两侧都被写了」这个事实 —— 并集里分别保留。
{
  const { axisRole, ANKLE_ABSENT } = await import('../src/core/systems/balance');
  const seenAxes = new Map<string, string>();
  const allWritten = new Set<string>();
  const CASES_E: [string, Record<string, unknown>][] = [
    ['挡位 I 默认', {}],
    ['挡位 II 纯侧向 τ', { torqueControl: true, lateralEnabled: true }],
    ['挡位 I + 骨盆抬升', { kPelvicLift: 0.06 }],
    // ★ 新增：`shiftDemandF != 0` 的窗口 —— 块⑤ `τ=JᵀF` 只在
    //   `phase ∈ {SHIFT, DOUBLE} && !handoverOk` 时发。8s 内若交接已完成
    //   就永远不发，那根轴就查不到。`lateralEnabled:true` 让它尽早 arm。
    ['横向驱动窗口（块⑤）', { torqueControl: true, lateralEnabled: true, kPelvicLift: 0 }],
  ];
  for (const [tag, bal] of CASES_E) {
    const rr = run(bal, 12);
    for (const w of rr.written) {
      allWritten.add(w);
      const key = w.replace(/_[lr]$/, '');
      if (!seenAxes.has(key)) seenAxes.set(key, tag);
    }
  }
  const unregistered = [...seenAxes.keys()].filter((k) => {
    const m = /^(\w+?)_?[lr]?\/(\d)$/.exec(k);
    if (!m) return true;
    return axisRole(m[1]!, Number(m[2])) === undefined;
  });
  log(`  实际写过的轴（去腿侧后）：${[...seenAxes.keys()].sort().join(', ')}`);
  if (unregistered.length) {
    bad(`这些轴被写了但没在 AXIS_OWNERSHIP 登记：${unregistered.join(', ')}`);
  } else {
    ok(`全部已登记（经 ${seenAxes.size} 根轴、${CASES_E.length} 种配置、每拍采样验证）`);
  }

  // `ANKLE_ABSENT`：本 rig 骨架里没有踝关节 ⇒ 踝 CoP 通道恒不执行。
  //   一旦有人给骨架加了踝，这个断言会失败，强制他在 AXIS_OWNERSHIP 里登记
  //   （否则就会重演"通道存在但没人知道它归谁"的老问题）。
  // ★ 2026-10-04 修：原来匹配的是 `w.startsWith('ankle')`，但踝的**关节名其实叫
  //   `foot_l` / `foot_r`**（`JOINT_ORDER` 里的踝就是 foot_*）⇒ 这条断言从来没生效过。
  //   实测：骨架早已 `ankleEnabled = true`、踝轴也确实被写，门禁 E 却仍判绿。
  const ankleWritten = [...allWritten].filter((w) => /^(foot|midfoot)_[lr]$/.test(w));
  if (ANKLE_ABSENT && ankleWritten.length) {
    bad(`声明 ANKLE_ABSENT=true，但踝轴被写了：${ankleWritten.join(', ')}`);
  } else if (ANKLE_ABSENT) {
    ok('ANKLE_ABSENT 与实际一致（无踝轴被写）；骨架一旦加踝，此处会强制登记');
  }

  // ★★ E2：**双向**对账 QP 的轴集合与归属表。
  //
  //   为什么必须单独查：力矩通道走 `addTorque`（rigState.ts），**不调 `claimAxis`**
  //   ⇒ QP 写的轴从不做模式声明 ⇒ 上面「被写过的轴都要登记」永远查不到它；
  //   而反过来「表里登记了但没人写」也无法从运行时观测得到（QP 对某些轴解出
  //   的 τ 恒为 0，例如力臂几乎为零的扭转轴），**不能**要求每根都被写到。
  //   ⇒ 判据改成**代码 ↔ 表**的一致性：`wholeBodyQp.QP_AXIS_SPEC`（唯一真源）
  //   的每一根轴都必须在表里登记为 `tau` 且带 `qp` 门；反过来表里带 `qp` 门的
  //   轴也必须在 QP 的轴集合里（否则那行登记就是多余的谎）。
  const { QP_AXIS_SPEC } = await import('../src/core/systems/wholeBodyQp');
  const qpSpec: string[] = [];
  for (const g of QP_AXIS_SPEC) for (const ax of g.axes) qpSpec.push(`${g.joint}/${ax}`);
  const tableHas = (jn: string, ax: number): boolean => AXIS_OWNERSHIP.some(
    (a) => a.joint === jn && a.axis === ax && a.mode === 'tau'
      && (a.channel === 'qp' || (a.extraGates ?? []).includes('qp')));
  const missInTable = qpSpec.filter((k) => {
    const m = /^(\w+)\/(\d)$/.exec(k)!;
    return !tableHas(m[1]!, Number(m[2]));
  });
  const qpInTable = AXIS_OWNERSHIP
    .filter((a) => a.channel === 'qp' || (a.extraGates ?? []).includes('qp'))
    .map((a) => `${a.joint}/${a.axis}`);
  const extraInTable = qpInTable.filter((k) => !qpSpec.includes(k));
  if (missInTable.length) {
    bad(`QP 会写但表里没登记为 tau+qp 的轴：${missInTable.join(', ')}（双写 ⇒ axisConflicts）`);
  } else if (extraInTable.length) {
    bad(`表里登记了 qp 门但 QP 不写的轴：${extraInTable.join(', ')}（表在说谎）`);
  } else {
    ok(`QP 轴集合与表**双向一致**（${qpSpec.length} 根：${qpSpec.join(', ')}）`);
  }

  // E3：QP 在运行时**真的**在出力。
  //   ⚠ 原来用 owner label 判（找 `全链QP/…`），**测不到** ——
  //     `addTorque` 刻意**不换** `system`/`label`（保留首个写者，见 rigState 注释），
  //     而 `hip/2`、`knee/2`、`foot/2` 上永远先有别的写者 ⇒ 那串 label 永不出现。
  //     （又一个「探针自己说谎」：这次是匹配面**太窄**。）
  //   ⇒ 改用**行为判据**：关掉 `qp` 门，逐轴累计 |τ| 必须变。
  //     逐位相同 ⇒ QP 根本没接上（或解恒为 0）。
  const qpOn = run({}, 4);
  const qpOff = run({ ablate: 'qp' }, 4);
  const diffs = qpOn.tauAcc.map((v, i) => Math.abs(v - (qpOff.tauAcc[i] ?? 0)));
  const changed = diffs.map((d, i) => [i, d] as [number, number])
    .filter(([, d]) => d > 1e-3).sort((a, b) => b[1] - a[1]);
  if (!changed.length) {
    bad('关掉 `qp` 门后逐轴累计 |τ| 逐位不变 ⇒ QP 根本没接上（或解恒为 0）');
  } else {
    const top = changed.slice(0, 3)
      .map(([i, d]) => `${sk.joints[Math.floor(i / 3)]!.name}/${i % 3}:Δ${d.toFixed(1)}`);
    ok(`关掉 qp 后逐轴累计 |τ| 改变 ⇒ QP 真的在出力（${changed.length} 根轴，最大 ${top.join(' ')}）`);
  }
}

log('');
log('══ F. 唯一性：相位 / 角色标签只有一份定义 ══');
{
  const files = ['src/core/gaitState.ts', 'src/ui/hud.ts', 'src/core/rigState.ts',
    'src/core/controller.ts', 'src/core/sim.ts', 'src/main.ts'];
  // F1：相位标签表只能有一份定义（内容相同的第二份 = "同一事实两处定义"）
  const defs: string[] = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const s = read(f);
    if (/(?:STATE_LABEL|PHASE_LABEL)[^=]*=\s*\{[\s\S]{0,200}?DOUBLE:/.test(s)) defs.push(f);
  }
  if (defs.length > 1) bad(`相位标签表有 ${defs.length} 份定义：${defs.join(', ')}`);
  else if (defs.length === 1) ok(`相位标签表唯一（${defs[0]}）`);
  else bad('找不到状态标签表定义（STATE_LABEL）');

  // F2：`rs.phase` / `rs.locked` 的写入者只能有 gaitState 一个模块
  const writers = new Set<string>();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const s = read(f);
    // ⚠ `\s*=` 会把**比较** `rs.phase === 'STEP'` 也算成写入（`===` 的首字符就是 `=`）
    //   ⇒ 必须排除 `==` / `===` / `=>`，只认真赋值。
    const n = (s.match(/\brs\.(phase|phaseT|locked)\w*\s*=(?![=>])/g) || []).length;
    if (n) writers.add(`${f}(${n})`);
  }
  const nonGs = [...writers].filter((w) => !w.startsWith('src/core/gaitState.ts'));
  if (nonGs.length) bad(`rs.phase / rs.locked 被这些模块写：${nonGs.join(', ')} —— 状态机必须独占`);
  else ok('rs.phase / rs.locked 只有 gaitState 写');

  // F3：driver 不得**真的 import** 已删除的模块（注释里提历史名是允许的）
  const deadMods = ['teacher', 'balanceHold', 'stepSystem', 'gaitEvents', 'normGait'];
  const deadFiles = deadMods.filter((m) => !fs.existsSync(`src/core/${m}.ts`));
  const liveRefs: string[] = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    for (const m of deadMods) {
      // 只认 import 语句，不认注释里的历史说明
      if (new RegExp(`from ['"][^'"]*/${m}['"]`).test(read(f))) {
        liveRefs.push(`${f} → ${m}`);
      }
    }
  }
  if (liveRefs.length) {
    bad(`仍 import 已删除的模块：${liveRefs.join(', ')}`);
  } else {
    ok(`无指向已删模块的 import（已删：${deadFiles.join(', ') || '无'}）`);
  }
}

log('');
log('══ G. 两台状态机的收敛（词汇映射必须全覆盖且自洽）══');
{
  const { PHASE_TO_SCORING, SCORING_TO_STANCE, phaseStance } =
    await import('../src/core/gaitState');
  // ★ 2026-10-06 状态改名并重排（DOUBLE/LOAD/PUSH/LIFT/SWING，见 `架构_v2` §3）
  const CTRL = ['DOUBLE', 'LOAD', 'PUSH', 'LIFT', 'SWING'] as const;
  const SCORE = ['both', 'step', 'adjust'] as const;

  // G1：每个控制相位都必须有映射（漏一个 = 两台机器对同一时刻说法不同）
  const missing = CTRL.filter((p) => PHASE_TO_SCORING[p] === undefined);
  if (missing.length) bad(`这些控制相位没有映射到计分相位：${missing.join(', ')}`);
  else ok(`${CTRL.length} 个控制相位全部有映射`);

  // G2：映射目标必须是合法的计分相位
  const badTarget = CTRL.filter((p) => !SCORE.includes(PHASE_TO_SCORING[p]!));
  if (badTarget.length) bad(`映射到了非法计分相位：${badTarget.join(', ')}`);
  else ok('映射目标全部合法');

  // G3：★ `phaseStance()` 必须与映射表一致（这就是"同一物理时刻同一个说法"）
  //     控制侧的物理事实：`LIFT`/`SWING` 是**单支撑**（摆动腿离地）；
  //     `DOUBLE`/`LOAD`/`PUSH` 是**双脚**（`PUSH` 是双脚支撑期内的蹬离）。
  const EXPECT: Record<string, string> = {
    DOUBLE: 'double', LOAD: 'double', PUSH: 'double',
    LIFT: 'single', SWING: 'single',
  };
  const wrong = CTRL.filter((p) => phaseStance(p) !== EXPECT[p]);
  if (wrong.length) {
    bad(`phaseStance 与控制侧语义不符：${wrong.map((p) => `${p}=${phaseStance(p)}(应 ${EXPECT[p]})`).join(', ')}`);
  } else {
    ok('phaseStance 与控制侧语义一致（DOUBLE/LOAD/PUSH=双，LIFT/SWING=单）');
  }

  // G4：计分三相必须都有支撑分类
  const noStance = SCORE.filter((s) => SCORING_TO_STANCE[s] === undefined);
  if (noStance.length) bad(`这些计分相位没有支撑分类：${noStance.join(', ')}`);
  else ok(`${SCORE.length} 个计分相位全部有支撑分类`);

  // G5：「真单支撑」判据 —— 状态只能在**一个**地方推进，读取必须纯
  //   ⚠ 判据用「有没有 `.` 前缀」区分**定义**与**调用**，不靠剥注释 ——
  //     剥注释的写法曾被 ragdoll.ts 里某个 `/*` 弄坏（把后面全吃掉），
  //     门禁自己先假失败了一次。
  const SRC = ['src/core/ragdoll.ts', 'src/core/gaitState.ts', 'src/core/sim.ts',
    'src/core/rigState.ts', 'src/core/controller.ts', 'src/core/systems/step.ts',
    'src/core/systems/balance.ts'];
  // 定义 = `advanceStance(` 且**前面不是 `.`**（调用是 `.advanceStance(`）
  const definedIn = SRC.filter((f) => fs.existsSync(f)
    && /(?<![.\w])advanceStance\s*\(/.test(read(f)));
  if (definedIn.length !== 1) {
    bad(`"真单支撑"的**定义**应恰好 1 处，实际 ${definedIn.length} 处：${definedIn.join(', ') || '无'}`);
  } else {
    ok(`定义唯一（${definedIn[0]}）`);
  }
  // 推进（调用）点可以有多个，但必须都显式带 `dt`
  const callers = SRC.filter((f) => fs.existsSync(f) && /\.advanceStance\s*\(/.test(read(f)));

  // ★ 关键不变量：**读的地方不得推进状态**。
  //   踩过的坑：把 `stanceIsSingleSupport()`（读时推进）直接放进奖励表达式 ⇒
  //   "读诊断"产生副作用 ⇒ 奖励求值顺序一变滤波器状态就分叉
  //   （实测 probe-fitness 的首次不一致从第 21 代提前到第 13 代）。
  if (fs.existsSync('src/core/sim.ts') && /stanceIsSingleSupport/.test(read('src/core/sim.ts'))) {
    bad('sim.ts 的奖励路径里仍出现"读时推进"的 stanceIsSingleSupport —— 必须改成纯读取 stanceSingleNow');
  } else {
    ok('奖励路径是纯读取（stanceSingleNow），无"读时推进"副作用');
  }
  if (callers.includes('src/core/sim.ts') && callers.includes('src/core/controller.ts')) {
    ok(`两条路径都在固定拍上推进（${callers.length} 个调用点：${callers.map((f) => f.replace('src/core/', '')).join(', ')}）`);
  } else {
    bad(`推进未被两条路径都接入（调用点：${callers.join(', ') || '无'}）`);
  }

  // G6：两条路径都真的读了它（不然只是"有个统一判据"却没人用）
  const ctrlUses = read('src/core/controller.ts').includes('stanceSingleNow');
  const rsHas = /stanceSingle\s*=\s*false/.test(read('src/core/rigState.ts'));
  if (ctrlUses && rsHas) ok('控制侧已接入收敛判据（controller → rigState.stanceSingle）');
  else bad(`收敛判据未被控制侧接入（controller=${ctrlUses} rigState字段=${rsHas}）`);
}

log('');
log('══ H. 步态周期只有一个真源，且「下限 ≤ 目标」══');
{
  const { STEP_CYCLE_SEC, DEFAULT_GAIT_CONFIG } = await import('../src/core/gaitState');
  const { TARGET_CYCLE, MIN_CYCLE } = await import('../src/core/stability');
  const floor = DEFAULT_GAIT_CONFIG.stepIntervalSec;

  log(`  真源 STEP_CYCLE_SEC = ${STEP_CYCLE_SEC}s（ES 节拍目标）`);
  log(`  下限 stepIntervalSec = ${floor}s（控制路径 X6）`);
  log(`  stability.TARGET_CYCLE = ${TARGET_CYCLE}s   MIN_CYCLE = ${MIN_CYCLE}s`);

  // H1：奖励侧必须引用真源，不能自己写死
  if (TARGET_CYCLE === STEP_CYCLE_SEC) ok(`TARGET_CYCLE 引用真源（=${STEP_CYCLE_SEC}）`);
  else bad(`TARGET_CYCLE=${TARGET_CYCLE} ≠ STEP_CYCLE_SEC=${STEP_CYCLE_SEC} —— 又写死了一份`);

  if (MIN_CYCLE === floor) ok(`MIN_CYCLE 引用控制下限（=${floor}）`);
  else bad(`MIN_CYCLE=${MIN_CYCLE} ≠ stepIntervalSec=${floor} —— 又写死了一份`);

  // H2：★ 不变式：下限 ≤ 目标。否则"至少隔 1.6s"与"打算 1.0s 换一次"互相矛盾。
  if (floor <= STEP_CYCLE_SEC) ok(`不变式成立：下限 ${floor} ≤ 目标 ${STEP_CYCLE_SEC}`);
  else bad(`矛盾：下限 ${floor}s > 目标 ${STEP_CYCLE_SEC}s（ES 会被安全下限绑住，反之亦然）`);

  // ── H3（2026-10-04 架构收敛后重写）──────────────────────────────
  //   原来查 `commander.ts` 的 `stepPeriod` 是否引用 `STEP_CYCLE_SEC`。
  //   `commander.ts` / `gaitPhase.ts` / `modules.ts` 三个**并行状态机文件已删除**
  //   （sim.ts 曾自持 `GaitPhaseMachine` + `GaitCommander` + `ModuleSet`，
  //     与 `gaitState.ts` 并行逐拍推进 ⇒ 摆动腿/相位门禁/循环信用三处判据分叉）。
  //   ⇒ 现在检查「**相位只有 gaitState 一个来源**」这条更强的架构不变式。
  const simS = read('src/core/sim.ts');
  const parallelImports = ['gaitPhase', 'commander', 'modules'].filter(
    (m) => new RegExp(`from\s*'\./${m}'`).test(simS),
  );
  if (parallelImports.length === 0) ok('sim.ts 不再 import 任何并行状态机模块');
  else bad(`sim.ts 仍 import 并行状态机：${parallelImports.join(', ')}`);

  if (/this\.gp|this\.cmd|this\.mod/.test(simS)) {
    bad('sim.ts 仍持有并行状态机实例（this.gp / this.cmd / this.mod）');
  } else ok('sim.ts 无并行状态机实例');

  if (/attachRigState/.test(simS) && /attachRigState\(this\.rs\)/.test(read('src/core/controller.ts'))) {
    ok('reward 的相位/摆动腿来源 = gaitState（Controller 注入 RigState）');
  } else bad('sim.ts 未接入 gaitState 的 RigState —— 相位仍有两套来源');

  // 步态周期真源仍在 gaitState
  if (/export const STEP_CYCLE_SEC/.test(read('src/core/gaitState.ts'))) {
    ok('步态周期真源 STEP_CYCLE_SEC 在 gaitState.ts');
  } else bad('STEP_CYCLE_SEC 不在 gaitState.ts');

  // H4：ES 路径只能 import **常数**，不得引入控制侧状态（否则两条路径耦合）
  const simStateImports = /import\s*\{[^}]*GaitState[^}]*\}/.test(simS);
  const stabStateImports = /import\s*\{[^}]*GaitState[^}]*\}/.test(read('src/core/stability.ts'));
  if (simStateImports || stabStateImports) {
    bad('ES 路径 import 了控制侧的 GaitState 类 —— 只允许 import 常数');
  } else {
    ok('ES 路径只 import 常数（无运行时耦合）');
  }
}

log('');
if (fails) {
  log(`✗ 轴归属门禁失败 ${fails} 项`);
  process.exit(1);
}
log('★ 轴归属门禁全绿：每轴一个主人，全消融 == 零输出，无同轴异模式，角色标签不闪');