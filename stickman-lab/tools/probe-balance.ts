// probe-balance —— 身体平衡扣分项 + "以脚为准的距离" + 头高有效性闸门
// （用户 2026-10-02："加个身体不平衡扣分项"、"移动距离应该以脚的移动为准"、
//   "那种快倒下导致的距离增加根本不应该算进去"、"头和脚竖直距离很近才算得分有效"、
//   "人在走路的时刻都是身体平衡的，这个至关重要，必须找文献"）
//
// 判据来自文献：全身体角动量 WBAM 在正常走路里被高度调节到 L(t)≈0
// （Herr et al. 2008，段间抵消侧向 ~95% / 前后 ~70% / 垂向 ~80%），
// 质心矩枢 CMP 全程不离开支撑面、与实测 CoP 距离只有足长的 14±2%。
//
// 本探针做三件事：
// ① **标定** WBAM 归一化尺度：用"已知站得住"的镇定器实测它的 |WBAM|，
//    取 90 分位当 1.0 ⇒ 惩罚力度不再是一个说不清来源的魔法数。
// ② 验证判据能**区分**：镇定器（平衡）必须明显低于"往前扑"的情形。
// ③ 验证"以脚为准"：往前扑时 **torsoDist ≫ footDist**，且 `flopRatio` 把这件事暴露出来。

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints, brainParamCount } from '../src/core/brain';
import { BalanceJudge, wholeBodyAngularMomentum, HEAD_MIN, HEAD_MAX } from '../src/core/balance';
import { readCom, newCom } from '../src/core/posture';
import { BEST_BALANCER, balancerGenome, phaseGenomeFor, BEST_PHASE, CAPTURE_GAIT } from '../src/core/phaseSeed';
import { runCaptureTeacher, type CaptureParams } from '../src/core/teacher';

const require = createRequire(import.meta.url);
{
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = (bgNs as unknown as Record<string, unknown>)[i.name];
    if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f;
  }
  const r = (await WebAssembly.instantiate(c, imp)) as unknown as
    { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}

let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};
const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const DUR = 6;

console.log('=== 1. 标定 WBAM 尺度（用"已知站得住"的镇定器）===\n');
{
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR });
  sim.begin(balancerGenome(shape, BEST_BALANCER));
  const com = newCom(), l = new Float64Array(3);
  const samples: number[] = [];
  while (!sim.finished) {
    sim.advance(1);
    readCom(sim.doll, com);
    wholeBodyAngularMomentum(sim.doll, com, l);
    samples.push(Math.hypot(l[0]!, l[1]!, l[2]!));
  }
  BalanceJudge.calibrate(samples);
  const s = [...samples].sort((a, b) => a - b);
  const p50 = s[Math.floor(s.length * 0.5)]!, p90 = s[Math.floor(s.length * 0.9)]!;
  console.log(`  镇定器 |WBAM| 中位 ${p50.toFixed(2)} · 90分位 ${p90.toFixed(2)} kg·m²/s`);
  console.log(`  ⇒ 归一化尺度定为 WBAM_NORM = ${BalanceJudge.setNorms ? '' : ''}${(p90).toFixed(2)}`
    + `（"平衡"= 1.0，惩罚的是相对它的恶化）`);
  check('镇定器的 |WBAM| 有合理量级（不是 0 也不是天文数字）',
    p50 > 1e-3 && p50 < 200, `中位 ${p50.toFixed(2)}`);
  check('标定成功（尺度非零）', p90 > 1e-3, `WBAM_NORM=${p90.toFixed(2)}`);
}

console.log('\n=== 2. 以脚为准的距离 vs 躯干位移 ===\n');
interface Row {
  n: string; foot: number; torso: number; flop: number; valid: number; imb: number;
  wbamMax: number; headMin: number; fell: boolean;
  imbMean: number; imbBad: number; imbAlive: number; imbW: number;
}
/** 最近一次求值出来的全部分项（给"站立类门禁"定位是谁在白送分） */
let lastTerms: Record<string, number> = {};
function row(name: string, g: Float32Array | null, teacher?: CaptureParams): Row {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / (teacher?.T ?? CAPTURE_GAIT.T) });
  if (teacher) { sim.begin(new Float32Array(sim.params.length)); runCaptureTeacher(sk, sim, teacher, { dur: DUR, clockDriven: true }); }
  else { sim.begin(g!); while (!sim.finished) sim.advance(1); }
  const t = sim.terms;
  lastTerms = t as unknown as Record<string, number>;
  return {
    n: name, foot: sim.distance, torso: sim.torsoDistance, flop: t.flopRatio ?? 0,
    valid: t.validRatio ?? 0, imb: t.imbalance ?? 0, wbamMax: t.wbamMax ?? 0,
    headMin: t.headRatioMin ?? 1, fell: sim.fallen,
    imbMean: t.imbMean ?? 0, imbBad: t.imbBadFrac ?? 0, imbAlive: t.imbAlive ?? 0, imbW: t.imbW ?? 0,
    terms: t as unknown as Record<string, number>,
  };
}
const FB: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau, kLat: 0, kLatV: 0, kLatSwing: 0,
};
const zero = new Float32Array(brainParamCount(shape));
const rand = new Float32Array(brainParamCount(shape));
for (let i = 0; i < rand.length; i++) rand[i] = Math.sin(i * 0.37) * 0.25;
const rows: Row[] = [
  row('捕获点 teacher', null, FB),
  row('镇定器（平衡）', balancerGenome(shape, BEST_BALANCER)),
  row('相位种子步态', phaseGenomeFor(sk.joints.length, { ...BEST_PHASE, amp: 0.35 })),
  row('零输出（会自己倒）', zero),
  row('随机基因组', rand),
];
console.log('  ' + '对象'.padEnd(20) + '脚距离  躯干位移  扑/脚比  有效帧  不平衡  |WBAM|max  最低头高  倒');
for (const r of rows) {
  console.log('  ' + r.n.padEnd(18) + r.foot.toFixed(3).padStart(7) + r.torso.toFixed(3).padStart(9)
    + r.flop.toFixed(3).padStart(9) + (r.valid * 100).toFixed(0).padStart(7) + '%'
    + r.imb.toFixed(2).padStart(9) + r.wbamMax.toFixed(1).padStart(10) + (r.headMin * 100).toFixed(0).padStart(9) + '%'
    + (r.fell ? '  是' : '  否'));
  console.log('      ↳ 分解: imbMean=' + r.imbMean.toFixed(3) + ' badHeadFrac=' + r.imbBad.toFixed(3)
    + ' aliveAvg=' + r.imbAlive.toFixed(3) + ' w=' + r.imbW);
  // ★ 把**所有**分项打出来：站立类门禁（posture/gait）要求"零输出总分很低"，
  //   而新加的项有可能在站着的时候白送分 —— 必须能一眼看出是哪一项。
  {
    const t = lastTerms;
    void t;
  }
  {
    const parts = Object.entries(r.terms).filter(([, v]) => typeof v === 'number' && Math.abs(v) > 0.005)
      .sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number))
      .map(([k, v]) => `${k}=${(v as number).toFixed(2)}`);
    console.log('      ↳ 分项: ' + parts.join(' '));
  }
}
console.log('');
const flop = rows[3]!;
const bal = rows[1]!;
check('★ 距离以脚为准：零输出"自己倒"时脚距离远小于躯干位移',
  flop.foot < flop.torso, `脚 ${flop.foot.toFixed(3)} vs 躯干 ${flop.torso.toFixed(3)}`);
check('★ "扑出去的距离"（躯干走了但脚没走）被单独暴露出来', flop.flop > 0.3,
  `${flop.flop.toFixed(3)} m`);
// ⚠ 头高单独不够用：实测摔倒时**先前倾**、头几乎不掉（头高比全程 100%），
//   所以有效性判据里加了躯干倾角条件（MAX_PITCH）。这一条盯的就是它有没有真的起作用。
check('★ 有效性闸门在工作：前扑倒下时有效帧 < 100%', flop.valid < 0.95,
  `${(flop.valid * 100).toFixed(0)}%`);
check('★ 站得住的人有效帧 = 100%（闸门不会误伤平衡）', bal.valid > 0.99,
  `${(bal.valid * 100).toFixed(0)}%`);
check('★ 平衡的个体（镇定器）不平衡扣分更小', bal.imb > flop.imb,
  `镇定器 ${bal.imb.toFixed(2)} vs 零输出 ${flop.imb.toFixed(2)}`);
check('★ 头高参考：站住的个体头高比接近 1', bal.headMin > 0.95, `${(bal.headMin * 100).toFixed(0)}%`);
check('★ 头高有效区间常量是合理的', HEAD_MIN > 0.7 && HEAD_MAX < 1.2 && HEAD_MIN < HEAD_MAX,
  `[${HEAD_MIN}, ${HEAD_MAX}]`);

console.log('');
console.log(FAILS === 0 ? '★ balance 全绿' : `★ balance 有 ${FAILS} 条 FAIL`);
if (FAILS > 0) process.exitCode = 1;
