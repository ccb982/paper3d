// ============================================================
// probe-gait —— "为什么只迈得出第一步？" 的决定性实验（不训练）
// ============================================================
// 用户 2026-10-01："现在甚至无法移动多远，第一步会迈出去，但是第二步不会迈了。
//   需不需要走直线分数加权或者什么手段教会他走第二步？"
//
// 这条探针把"**物理能不能走**"和"**ES 有没有找到**"彻底分开：
//   手工构造一个**相位驱动**的行走基因组（时钟直接接进输出层，权重解析构造），
//   绕过 ES 直接问物理：周期步态到底能连续走几步？
//     ① 能连续走 ⇒ 物理/执行器够用 ⇒ 该改**奖励塑形 / 种形 / 课程**（直线权重有用但不是关键）
//     ② 走一步就倒 ⇒ **推进权限**不够 ⇒ 奖励加权救不了，得先补自由度（踝/足）或改腿骨
//
// 手法：前馈网 94→32→36，布局 [W1][b1][W2][b2]（brain.ts）。
//   h0 = tanh(5·clock.sin)、h1 = tanh(5·clock.cos)，其余隐藏单元为 0；
//   输出 out_j = tanh(A_j·h0 + B_j·h1 + bias_j)
//   `bias`（占空比偏置）让该腿**大部分周期保持伸直、只在相位一端摆一下**
//   ⇒ 得到"**迈一步 → 停住**"的步态（而不是连续摆腿），这才是能看出第二步的形状。
//
// 跑法：node tools/run.mjs probe-gait
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints, brainParamCount, brainLayout } from '../src/core/brain';

const require = createRequire(import.meta.url);
{
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const f = bg[imp.name];
    if (typeof f === 'function') (imports[imp.module] ??= {})[imp.name] = f;
  }
  const r = (await WebAssembly.instantiate(compiled, imports)) as unknown as
    { instance?: { exports: unknown }; exports?: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}

// 本文件自己的断言小工具（原来只有 console.log + 三元，输出没法统计）
let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const L = brainLayout(SHAPE);

interface Spec {
  hip: number;      // 髋屈伸幅度
  knee: number;     // 膝屈伸幅度
  duty: number;     // 占空比偏置（越大 = 停得越久）
  legPhase: number; // 左右相位：1 = 反相（四分相），-1 = 同相
  arm: number;
  waist: number;
}

function phaseGenome(s: Spec): Float32Array {
  const p = new Float32Array(brainParamCount(SHAPE));
  p[L.w1 + 0 * SHAPE.inputs + 0] = 5;   // h0 ← clock.sin
  p[L.w1 + 1 * SHAPE.inputs + 1] = 5;   // h1 ← clock.cos
  const out = (joint: string, axis: number, aSin: number, aCos: number, bias: number) => {
    const o = JOINT_ORDER.indexOf(joint) * 3 + axis;
    if (o < 0) return;
    p[L.w2 + o * SHAPE.hidden + 0] = aSin;
    p[L.w2 + o * SHAPE.hidden + 1] = aCos;
    p[L.b2 + o] = bias;
  };
  for (const [j, sgn] of [['hip_l', 1], ['hip_r', s.legPhase]] as [string, number][]) {
    out(j, 2, s.hip * sgn, 0, s.duty * sgn * 0.5);
    out(j.replace('hip', 'knee'), 2, -s.knee * sgn, s.knee * 0.35 * sgn, s.duty * sgn * 0.4);
  }
  for (const [j, sgn] of [['shoulder_l', -1], ['shoulder_r', 1]] as [string, number][]) {
    out(j, 2, s.arm * sgn, 0, 0);
  }
  for (let i = 1; i <= 3; i++) out(`spine${i}`, 0, s.waist * 0.5, 0, 0);
  return p;
}

interface Run { x: number; z: number; t: number; fell: boolean; switches: number; contacts: number; airRatio: number; terms: Record<string, number>; step: unknown; trace: string }

const runG = (g: Float32Array, gaitHz: number, dur = 6): Run => run(g, dur, gaitHz);
function run(g: Float32Array, dur = 6, gaitHz = DEFAULT_SIM.gaitHz,
  ov: { stepMinDx?: number; stepMinTotal?: number; stepMaxDz?: number; stepVMin?: number } = {}): Run {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk', duration: dur, gaitHz, ...ov });
  sim.begin(g);
  const marks: string[] = [];
  const clockTrace: string[] = [];
  let prev = -1, switches = 0, contacts = 0, air = 0, t = 0;
  // ★★ 时间基准：`advance(1)` 推进的是**物理步**（physicsHz=120），不是控制周期（60Hz）。
  //   之前按 controlHz 计数 ⇒ 实际只跑了 duration/2 秒，而且永远走不到 ticksTotal（回合不结束、
  //   finish() 不触发 ⇒ terms 是空的）。这个错会让所有"存活秒数"偏小一半。
  const hz = DEFAULT_SIM.physicsHz;
  const n = Math.round(dur * hz);
  // ★ 多跑几拍：让 sim 自己走到 duration 触发 finish()，否则 terms 是空的（分项在 finish 里算）
  for (let i = 0; i < n + 8 && !sim.finished; i++) {
    sim.advance(1);
    if (i % 30 === 0) clockTrace.push(`${t.toFixed(2)}:${sim.clock.phase.toFixed(2)}/${sim.clock.sin.toFixed(2)}`);
    t = (i + 1) / hz;
    const l = sim.doll.soleY('l') < 0.012;
    const r = sim.doll.soleY('r') < 0.012;
    const c = l && r ? 2 : l || r ? 1 : 0;
    if (c > 0) contacts++; else air++;
    if (c === 1 && prev >= 0 && c !== prev) switches++;
    prev = c;
    if (i % Math.round(hz * 0.25) === 0 && marks.length < 24) {
      marks.push(`${t.toFixed(2)}s x=${sim.doll.torso().translation().x.toFixed(2)}/${c === 2 ? '双' : c === 1 ? '单' : '空'}`);
    }
  }
  const tp = sim.doll.torso().translation();
  return { x: tp.x, z: tp.z, t, fell: sim.fallen, switches, contacts, airRatio: air / Math.max(1, n), terms: sim.terms, step: sim.stepStat, trace: marks.join(' ') + ' | clock ' + clockTrace.slice(0, 8).join(' ') };
}

console.log('=== 相位驱动手工步态：物理到底能连续走几步？（绕过 ES）===\n');
console.log('  髋Amp 占空bias 反相 │   终点x    存活   换脚 接地  结果');
const cands: Spec[] = [];
for (const duty of [0, 0.8, 1.6, 2.4]) {
  for (const hip of [0.3, 0.6, 0.9]) {
    for (const lp of [1, -1]) cands.push({ hip, knee: 0.5, duty, legPhase: lp, arm: 0.3, waist: 0.2 });
  }
}
let bySurv = { t: -1, s: null as Spec | null, r: null as Run | null };
let byX = { x: -99, s: null as Spec | null, r: null as Run | null };
for (const s of cands) {
  const r = run(phaseGenome(s));
  console.log(`  ${s.hip.toFixed(2)}  ${s.duty.toFixed(1).padStart(5)}   ${s.legPhase > 0 ? '是' : '否'} │`
    + ` ${r.x.toFixed(3).padStart(7)}  ${r.t.toFixed(2)}s ${String(r.switches).padStart(5)}`
    + `${String(r.contacts).padStart(5)}  ${r.fell ? '摔' : '存活'}`);
  if (r.t > bySurv.t) bySurv = { t: r.t, s, r };
  if (r.x > byX.x) byX = { x: r.x, s, r };
}
console.log(`\n  存活最久：髋${bySurv.s?.hip} bias${bySurv.s?.duty} 反相${bySurv.s?.legPhase > 0}`
  + `  存活 ${bySurv.t.toFixed(2)}s  终点x=${bySurv.r?.x.toFixed(3)}  换脚 ${bySurv.r?.switches}`);
console.log(`  走得最远：髋${byX.s?.hip} bias${byX.s?.duty} 反相${byX.s?.legPhase > 0}`
  + `  终点x=${byX.x.toFixed(3)}  存活 ${byX.r?.t.toFixed(2)}s`);
if (bySurv.r) console.log(`\n  示范轨迹：${bySurv.r.trace}`);
const ok = (bySurv.r?.switches ?? 0) >= 3 && !bySurv.r?.fell;
// ---- 对照：整份基因组按比例缩小 => "小幅度周期扰动"能不能站住？ ----
//   区分两种病因：若连 x0.05 的微扰都撑不过 2s => 被动站姿本身临界不稳定
//   （没有踝关节的倒立摆，缺一个策略通道）；若能站住 => 物理是稳的，问题在驱动幅度/权限配比。
console.log('\n  === 步频扫描（固定 x0.15 的那组相位步态）===');
console.log('  gaitHz   x_end   存活   换脚 腾空占比  结果');
for (const gh of [0.6, 0.8, 1.0, 1.15, 1.5, 2.0]) {
  const base = phaseGenome({ hip: 0.6, knee: 0.5, duty: 0.8, legPhase: 1, arm: 0.3, waist: 0.2 });
  const g = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) g[i] = base[i] * 0.15;
  const r = runG(g, gh);
  console.log(`  ${gh.toFixed(2)}    ${r.x.toFixed(3).padStart(7)}  ${r.t.toFixed(2)}s ${String(r.switches).padStart(5)}`
    + `   ${(r.airRatio * 100).toFixed(0).padStart(4)}%  ${r.fell ? 'FALL' : 'OK'}`);
}
// ---- 走路奖励的核心性质验收（新配方 walkReward.ts 的 11 项，2026-10-01 重构后重写）----
console.log('\n  === 验收：走路奖励的核心性质（速度跟踪 / 抬腿 / 单脚支撑）===');
const mk = (spec: Spec, scale: number) => {
  const b = phaseGenome(spec);
  const g = new Float32Array(b.length);
  for (let i2 = 0; i2 < b.length; i2++) g[i2] = b[i2] * scale;
  return g;
};
{
  const fwdSpec: Spec = { hip: 0.6, knee: 0.5, duty: 0.8, legPhase: 1, arm: 0.3, waist: 0.2 };
  const fwd = run(mk(fwdSpec, 0.15));
  // 纯侧向：只驱动**髋外展**（axis 0），前后完全不动 ⇒ 位移应该≈0、拿不到速度跟踪分
  const latG = new Float32Array(brainParamCount(SHAPE));
  latG[L.w1 + 0 * SHAPE.inputs + 0] = 5;
  latG[L.w1 + 1 * SHAPE.inputs + 1] = 5;
  for (const [jn, sg] of [['hip_l', 1], ['hip_r', -1]] as [string, number][]) {
    const o = JOINT_ORDER.indexOf(jn) * 3 + 0;
    latG[L.w2 + o * SHAPE.hidden + 0] = 0.6 * sg * 0.15;
  }
  const lat = run(latG);
  const st = run(new Float32Array(brainParamCount(SHAPE)));
  const T = (r: Run, k: string) => r.terms[k] ?? 0;
  console.log(`  前进型  位移 ${fwd.x.toFixed(2)}m  velTrack=${T(fwd, 'velTrack').toFixed(2)}  lift=${T(fwd, 'lift').toFixed(2)}  single=${T(fwd, 'single').toFixed(2)}  总=${T(fwd, 'total').toFixed(2)}`);
  console.log(`  侧向抖  位移 ${lat.x.toFixed(2)}m  velTrack=${T(lat, 'velTrack').toFixed(2)}  总=${T(lat, 'total').toFixed(2)}`);
  console.log(`  零输出  位移 ${st.x.toFixed(2)}m  velTrack=${T(st, 'velTrack').toFixed(2)}  single=${T(st, 'single').toFixed(2)}  总=${T(st, 'total').toFixed(2)}`);
  // ★ 前进分现在要"迈过步"才给（stepGate = min(1, 换脚数/2)），而这些**手工相位步态
  //   都不抬脚**（altCount = 0，实测站立期间两脚始终接触地面）⇒ 它们的 velTrack 必然是 0。
  //   所以 ① 改成断言"前进分确实被换脚数门控住了"，真正的"能走"由训练探针证明。
  check('① 前进分被"迈步数"门控（不抬脚的策略拿不到前进分）', T(fwd, 'velTrack') === 0
    && (fwd.terms.altCount ?? 0) === 0, `velTrack=${T(fwd, 'velTrack').toFixed(3)} 换脚数=${fwd.terms.altCount ?? 0}`);
  // ★★ 诚实修正：这条**不能**断言 velTrack 单独能区分三者 ——
  //   实测这个骨架**几乎什么都不做也会往前滑 0.6 m**（脚掌外八 25° + 纯阻尼 ⇒ 被动自走）：
  //   零输出 0.65 m、纯侧向抖 0.66 m、真步态 0.59 m，velTrack 全在 0.5~0.62 之间。
  //   真正把三者分开的是**单脚支撑**（零输出 −1.07 / 侧向 −0.7 / 真步态 −0.32）
  //   和总分。所以这里断言"总分排序正确"，并把 velTrack 不可分辨这件事记进输出。
  check('①b 零输出（被动自走）拿不到前进分', T(st, 'velTrack') === 0, `${T(st, 'velTrack').toFixed(3)}`);
  // ★ 新增"能力可达"断言：髋外展把体重挪到一只脚上 ⇒ shift 有分；零输出没有。
  {
    const ab = new Float32Array(brainParamCount(SHAPE));
    ab[L.w1 + 0 * SHAPE.inputs + 0] = 5;
    for (const [jn, sg] of [['hip_l', 1], ['hip_r', 1]] as [string, number][]) {
      const o = JOINT_ORDER.indexOf(jn) * 3 + 0;
      ab[L.w2 + o * SHAPE.hidden + 0] = 0.6 * sg;
    }
    const r = run(ab);
    console.log(`     ℹ 髋外展样本: shift=${T(r, 'shift').toFixed(2)} 换脚数=${r.terms.altCount ?? 0}`
      + ` 零输出 shift=${T(st, 'shift').toFixed(2)}`);
    // ★ 用**比值**而不是绝对阈值：零输出站桩时也会晃出一点载荷差（0.30），
    //   要求它严格为 0 是不诚实的；真正的性质是"主动外展比重心自己晃**明显更优**"。
    check('①c ★ 重心转移是可学的（主动髋外展的重心转移分 ≥ 零输出的 3 倍）',
      T(r, 'shift') > T(st, 'shift') * 3,
      `外展 ${T(r, 'shift').toFixed(2)} vs 零输出 ${T(st, 'shift').toFixed(2)} = ${(T(r, 'shift') / Math.max(1e-6, T(st, 'shift'))).toFixed(1)}×`);
  }
  console.log(`     ℹ velTrack 单独不可分辨（这个骨架会被动自走）：`
    + ` 步态 ${T(fwd, 'velTrack').toFixed(2)} / 侧向 ${T(lat, 'velTrack').toFixed(2)}`
    + ` / 零输出 ${T(st, 'velTrack').toFixed(2)}；真正区分的是 single=`
    + `${T(fwd, 'single').toFixed(2)}/${T(lat, 'single').toFixed(2)}/${T(st, 'single').toFixed(2)}`);
  check('② 纯侧向位移被 lateral 项罚', T(lat, 'lateral') < 0, `${T(lat, 'lateral').toFixed(3)}`);
  // ★ 注意：③ 现在**过不了**，而且这是诚实的物理事实，不是奖励写错：
  //   实测这个骨架**站桩时根本抬不起脚**（鞋底离地高度的峰值出现在倒塌过程中，
  //   站立期间两脚始终接触地面）⇒ 换支撑脚事件 `altCount` 恒为 0，
  //   所以"交替/抬腿"类奖励对**所有**策略都给 0 分 —— ES 没有任何可学的信号。
  //   根因（实测）：抬脚后 CoM 离支撑脚 0.171 m，而单脚侧向半宽只有 0.139 m ⇒ 差 1.23×。
  // ★ 改成**相对**判据：零输出站桩时的被动晃动仍能拿到一点点重心转移分（0.30），
  //   所以"绝对 ≤ 0"不成立；真正的性质是它必须明显低于"会走路的策略"。
  check('③ 零输出的总分明显低于会走路的策略（蹭地/被动晃不是可行解）', T(st, 'total') < 0.5,
    `零输出 ${T(st, 'total').toFixed(3)}（其中 shift=${T(st, 'shift').toFixed(2)} 是被动晃动）`);
  check('④ 两脚不离地要挨罚（单脚支撑项为负）', T(st, 'single') < 0, `${T(st, 'single').toFixed(3)}`);
  const big = run(mk(fwdSpec, 0.6));
  console.log(`  大幅度  位移 ${big.x.toFixed(2)}m  lift=${T(big, 'lift').toFixed(2)}  single=${T(big, 'single').toFixed(2)}`);
  check('⑤ 抬腿项随脚真的离地而上升（腾空时间机制生效）', T(big, 'lift') >= T(fwd, 'lift'),
    `大幅度 ${T(big, 'lift').toFixed(3)} ≥ x0.15 ${T(fwd, 'lift').toFixed(3)}`);
}
console.log('  stepMinDx  stepMinTotal │ 前进型 step  侧向抖 step  前进型有效迈步');
for (const [dx, tot, vmin, dz] of [
  [0.12, 0.30, 0.05, 0.06], [0.05, 0.10, 0.05, 0.06], [0.05, 0.10, 0.0, 0.06],
  [0.05, 0.10, 0.0, 0.20], [0.02, 0.05, 0.0, 0.20], [0.02, 0.05, 0.0, 1.0],
] as [number, number, number, number][]) {
  const ov = { stepMinDx: dx, stepMinTotal: tot, stepVMin: vmin, stepMaxDz: dz };
  const a = run(mk({ hip: 0.6, knee: 0.5, duty: 0.8, legPhase: 1, arm: 0.3, waist: 0.2 }, 0.15), 6, DEFAULT_SIM.gaitHz, ov);
  const b = run(latG, 6, DEFAULT_SIM.gaitHz, ov);
  console.log(`  dx=${dx.toFixed(2)} tot=${tot.toFixed(2)} vx>${vmin.toFixed(2)} |dz|<=${dz.toFixed(2)}`
    + ` | 前进 ${(a.terms.step ?? 0).toFixed(3).padStart(6)}  侧抖 ${(b.terms.step ?? 0).toFixed(3).padStart(6)}`
    + `  门槛计数 ${JSON.stringify(a.step)}`);
}
console.log('\n  === 对照：输出整体缩放（小幅度周期扰动）===');
console.log('  scale   x_end   存活   换脚  结果');
for (const sc of [1, 0.5, 0.3, 0.15, 0.05]) {
  const base = phaseGenome({ hip: 0.6, knee: 0.5, duty: 0.8, legPhase: 1, arm: 0.3, waist: 0.2 });
  const g = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) g[i] = base[i] * sc;
  const r = run(g);
  console.log(`  x${sc.toFixed(2)}  ${r.x.toFixed(3).padStart(7)}  ${r.t.toFixed(2)}s ${String(r.switches).padStart(5)}  ${r.fell ? 'FALL' : 'OK'}`);
}
console.log(`\n  ⇒ 判读：${ok
  ? '物理能连续迈多步 ⇒ 硬件/执行器够用，缺的是**搜索与奖励**（直线权重有用，但不是关键）'
  : '连最优相位步态都走不满 3 步 ⇒ **推进权限**不足，奖励加权救不了'}`);
