/**
 * ══════════════════════════════════════════════════════════════════
 * probe-rocking.ts —— **抑制"绕棱 rocking"**：让 CoP 变成可用信号
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06：「做吧，先把这个链路打通」。
 *
 * 病灶（`probe-footpush` 实测）：脚在**共面接触块之间逐拍翻号**
 *   （内 509 N <-> 外 305 N），单脚 CoP 每 1/60 s 跳 ~180 mm
 *   ⇒ 对 CoM 的力矩 ±300 N·m 是白噪声 ⇒ 「脚发力带动全身倾斜」做不到。
 *
 * ── 评价指标（**不再是存活时间**，而是信号质量）──────────────
 *   `flip`  = Σ|Δ(内-外侧柱差)| / 拍数  —— 载荷翻号的幅度（N/拍）
 *   `dCop`  = Σ|Δ CoP_x| / 拍数          —— CoP 逐拍跳幅（mm/拍）
 *   `dM`    = std(ΔM_pitch)              —— 对 CoM 力矩的抖动（N·m/拍）
 *   `copOK` = CoP 有效拍占比（%）
 *   目标：三项都降一个量级，且 `copOK` 高。
 *
 * ── 扫描的旋钮 ────────────────────────────────────────────────
 *   · `contactNaturalFrequency`（默认 30 Hz）：**降低** ⇒ 接触变软 ⇒
 *     载荷分配由**穿透深度**（连续）决定，而不是 LCP 挑解（静不定）；
 *   · `contactDampingRatio`（默认 5）：配合软接触用；
 *   · `numSolverIterations`（默认 4）：提高 ⇒ 解更收敛；
 *   · `footAngularDamping`（默认 12）。
 *
 * 用法：node tools/run.mjs probe-rocking
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
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const log = (s: string) => console.log(s);
const SECS = 0.6, HZ = 60;   // ⚠ 短窗（0.6s）：只测**还站着**那段，避免坠落噪声主导

interface Stat { flip: number; dCop: number; dM: number; copOK: number; secs: number; fall: string }

function run(ov: Record<string, unknown>, tune: {
  freq?: number; erp?: number; iters?: number; small?: boolean; linearErr?: number;
}): Stat {
  const sk = buildSkeleton(DEFAULT_CONFIG);
  const sim = new Sim(sk, shapeForJoints(sk.joints.length),
    { ...DEFAULT_SIM, mode: 'stand', duration: SECS, doll: ov as never });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
    balance: DEFAULT_CONTROLLER.balance,
  });
  const d = sim.doll;
  d.setContactTuning(tune);                        // ★ 接触参数（必须在开跑前设）
  let prevCol = 0, prevCop = 0, prevM = 0;
  let n = 0, copOK = 0, sumFlip = 0, sumDCop = 0;
  const dMs: number[] = [];
  for (let i = 0; i < SECS * 120 && !sim.finished; i++) {
    if (i % 2 === 0) d.setMotorTargets(ctrl.step(1 / 60));
    sim.advance(1);
    if (i % 2 !== 0) continue;
    const gc = ctrl.rs.groundChain;
    if (!gc) continue;
    n++;
    // 只统计**两脚都着地**的拍（单脚时另一脚 CoP 无效，会污染统计）
    if (gc.l.copValid) copOK++;
    const col = (gc.r.colIn - gc.r.colOut);        // 右脚内-外侧柱差（翻号的主角）
    const cop = gc.r.copValid ? gc.r.copZ : 0;
    const fz = gc.l.fz + gc.r.fz;
    const M = (gc.copX - ctrl.rs.com.x) * fz;      // 对 CoM 的俯仰力矩
    if (n > 3) {
      sumFlip += Math.abs(col - prevCol);
      sumDCop += Math.abs(cop - prevCop) * 1000;
      dMs.push(Math.abs(M - prevM));
    }
    prevCol = col; prevCop = cop; prevM = M;
  }
  const mean = dMs.length ? dMs.reduce((a, b) => a + b, 0) / dMs.length : 0;
  const varv = dMs.length ? dMs.reduce((a, b) => a + (b - mean) ** 2, 0) / dMs.length : 0;
  return {
    flip: n > 3 ? sumFlip / (n - 3) : 0,
    dCop: n > 3 ? sumDCop / (n - 3) : 0,
    dM: Math.sqrt(varv),
    copOK: (100 * copOK) / Math.max(1, n),
    secs: sim.ticksDone / 60,
    fall: sim.fallReason || '未倒',
  };
}

log('══ 绕棱 rocking 抑制扫描（指标：翻号幅度 / CoP 跳幅 / 力矩抖动）══');
log('   基准（Rapier 默认：freq=30Hz damping=5 iters=4）');
{
  const ip = ((): { freq: number; erp: number; iters: number; small: boolean } => {
    const sk0 = buildSkeleton(DEFAULT_CONFIG);
    const s0 = new Sim(sk0, shapeForJoints(sk0.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 0.1 });
    return s0.doll.contactTuning();
  })();
  log(`   实测默认值：freq=${ip.freq}Hz  erp=${ip.erp}  iters=${ip.iters}  smallSteps=${ip.small}`);
  const sk0 = buildSkeleton(DEFAULT_CONFIG);
  const s0 = new Sim(sk0, shapeForJoints(sk0.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 0.1 });
  log('   `contact_natural_frequency` 的类型 = ' + s0.doll.contactPropType('contact_natural_frequency')
    + '　（number = 数据字段；function = 方法，得调用）');
}
log('');
log('   配置                                翻号N/拍  CoP跳mm/拍  力矩抖N·m  CoP有效%  存活');

// ★ 病灶重新定位（实测载荷数据）：翻号是**内侧柱(arch/mfoot 刚体) <-> 外侧柱(foot 刚体)**
//   ⇒ 是**弓在上下颠**（引擎电机 K=400/B=2 与载荷互推），不是脚整体摇滚。
//   ⇒ 扫弓的刚度/阻尼 + 鞋底块的接触。
const CASES: [string, Record<string, unknown>, {
  freq?: number; erp?: number; iters?: number; small?: boolean; linearErr?: number;
}][] = [
  ['基准（archK=400 B=2）', {}, {}],
  ['archK=1000（更硬）', { archStiffness: 1000 }, {}],
  ['archK=150（更软）', { archStiffness: 150 }, {}],
  ['archB=20（更阻尼）', { archDamping: 20 }, {}],
  ['archB=50', { archDamping: 50 }, {}],
  ['archK=150 + B=50', { archStiffness: 150, archDamping: 50 }, {}],
  ['archK=1000 + B=50', { archStiffness: 1000, archDamping: 50 }, {}],
  ['archK=150+B=50+脚阻尼30', { archStiffness: 150, archDamping: 50, footAngularDamping: 30 }, {}],
];
const rows: { tag: string; st: Stat }[] = [];
for (const [tag, ov, tune] of CASES) {
  const st = run(ov, tune);
  rows.push({ tag, st });
  log(`   ${tag.padEnd(26)} ${st.flip.toFixed(0).padStart(8)} ${st.dCop.toFixed(1).padStart(10)}`
    + ` ${st.dM.toFixed(1).padStart(10)} ${st.copOK.toFixed(0).padStart(8)}`
    + `  ${st.secs.toFixed(2)}s`);
}
log('');
{
  const b = rows[0]!.st;
  const best = rows.slice(1).reduce((a, r) => (r.st.flip < a.st.flip ? r : a), rows[1]!);
  log(`   判读：基准翻号 ${b.flip.toFixed(0)} N/拍、CoP 跳 ${b.dCop.toFixed(0)} mm/拍、力矩抖 ${b.dM.toFixed(0)} N·m`);
  log(`   最优：${best.tag} ⇒ 翻号 ${best.st.flip.toFixed(0)}（${(100 * best.st.flip / Math.max(1, b.flip)).toFixed(0)}%）`
    + `、CoP 跳 ${best.st.dCop.toFixed(0)}、力矩抖 ${best.st.dM.toFixed(0)}`);
  const ok = best.st.flip < b.flip * 0.3 && best.st.dM < b.dM * 0.3;
  log(`   ⇒ ${ok ? '★ **打通了**：翻号与力矩抖动都降到基准的 30% 以下' : '✗ 还没打通（最优也只降到 30% 以上）'}`);
}
