/** _tmp-pelvis-source.ts —— 盆骨侧向力来源归属（只读探针）
 *  双窗对照：W1=双支撑静立(t 0.5~1.5s)；W2=单腿保持(liftDone+0.05~+0.40s)
 *  度量：盆骨 F_z=m·a_z(绝对均值/RMS/峰值/主频)、盆骨 v_z 抖动、支撑脚 fz、大腿世界倾角
 *  用法：node tools/run.mjs _tmp-pelvis-source [base|hipR0|hipL0|hipYaw|swingAll|spine0|hipR0off]
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const ABL = ARGS[0] ?? 'base';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const dr = (ctl.warner as unknown as { drive: any }).drive;

const freezePair = (pred: (name: string, axis: number) => boolean): void => {
  const o = dr.commandMusclePair.bind(dr);
  dr.commandMusclePair = (i: number, c: number, ref: number) => {
    const d = body.dofs[i]!;
    if (pred(d.name, d.axis)) return o(i, c, d.angle);
    return o(i, c, ref);
  };
};
const setAbl = (): void => {
  if (ABL === 'hipR0') freezePair((n, a) => n === 'hip_r' && a === 0);
  if (ABL === 'hipL0') freezePair((n, a) => n === 'hip_l' && a === 0);
  if (ABL === 'spine0') freezePair((n, a) => /^spine/.test(n) && a === 0);
  if (ABL === 'swingAll') freezePair((n) => /_l$/.test(n));
  if (ABL === 'hipR0off') {
    const o = dr.commandMusclePair.bind(dr);
    dr.commandMusclePair = (i: number, c: number, ref: number) => {
      const d = body.dofs[i]!;
      if (d.name === 'hip_r' && d.axis === 0) return o(i, 0, ref);
      return o(i, c, ref);
    };
  }
  if (ABL === 'hipYaw') {
    const o = dr.setTorque.bind(dr);
    dr.setTorque = (i: number, t: number) => {
      const d = body.dofs[i]!;
      if (/^hip_/.test(d.name) && d.axis === 1) return o(i, 0);
      return o(i, t);
    };
  }
  if (ABL === 'noDrive') w.driveEnabled = false;   // 决定性：控制器全关（只留物理/接触）
  if (ABL === 'legR') freezePair((n) => /^(hip_r|knee_r|foot_r)$/.test(n));   // 支撑腿全轴纯C
};

const tIdx = body.indexByKey.get('torso')!;
const mPel = body.bodies[tIdx]!.mass();
const tauOf = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? w.executor.ledger[i]!.applied : 0; };

interface Acc {
  n: number; sumAbs: number; sumNet: number; sq: number; peak: number;
  zc: number; prevAz: number;
  sumV: number; sqV: number;
  sumFz: number; sqFz: number; fzMin: number; fzMax: number;
  sumTilt: number;
  bodySq: Map<string, number>; bodyN: number;
  // 相关量：F_z vs fz / 髋力矩；盆骨竖直速度
  sFzF: number; sFz2: number; sF2: number;
  sThF: number; sTh2: number; sTh: number;
  sapV: number; sFVz: number;
}
const mk = (): Acc => ({ n: 0, sumAbs: 0, sumNet: 0, sq: 0, peak: 0, zc: 0, prevAz: 0, sumV: 0, sqV: 0, sumFz: 0, sqFz: 0, fzMin: 1e9, fzMax: -1e9, sumTilt: 0, bodySq: new Map(), bodyN: 0, sFzF: 0, sFz2: 0, sF2: 0, sThF: 0, sTh2: 0, sTh: 0, sapV: 0, sFVz: 0 });
const W1 = mk(), W2 = mk();
let prevVz = 0;

const CHAIN = ['mfoot_r', 'arch_r', 'foot_r', 'shin_r', 'thigh_r', 'torso', 'spine2', 'spine3', 'spine4', 'head'];

const hipI = body.dofByName('hip_r', 2), kneeI = body.dofByName('knee_r', 2);
const thighTilt = (): number => {
  const a = body.dofs[hipI]!.anchorWorld, b = body.dofs[kneeI]!.anchorWorld;
  return Math.atan2(b[2]! - a[2]!, -(b[1]! - a[1]!)) * 180 / Math.PI;
};
const feed = (acc: Acc): void => {
  const v = body.bodies[tIdx]!.linvel().z;
  const az = (v - prevVz) / w.dt;
  prevVz = v;
  if (acc.n === 0) { acc.n++; acc.prevAz = az; return; }   // 首样本只做初始化
  acc.n++;
  const F = mPel * az;
  acc.sumAbs += Math.abs(F); acc.sumNet += F; acc.sq += F * F; acc.peak = Math.max(acc.peak, Math.abs(F));
  if (Math.sign(az) !== Math.sign(acc.prevAz) && Math.abs(az) > 1) acc.zc++;
  acc.prevAz = az;
  acc.sumV += v; acc.sqV += v * v;
  const fz = ctl.sensors.feet[1]!.fz;
  acc.sumFz += fz; acc.sqFz += fz * fz; acc.fzMin = Math.min(acc.fzMin, fz); acc.fzMax = Math.max(acc.fzMax, fz);
  acc.sumTilt += thighTilt();
  acc.bodyN++;
  for (const k of CHAIN) {
    const i = body.indexByKey.get(k); if (i === undefined) continue;
    const v = body.bodies[i]!.linvel().z;
    acc.bodySq.set(k, (acc.bodySq.get(k) ?? 0) + v * v);
  }
  // 相关量
  const th = tauOf('hip_r', 0);
  acc.sFzF += fz * F; acc.sFz2 += fz * fz; acc.sF2 += F * F;
  acc.sThF += th * F; acc.sTh2 += th * th; acc.sTh += th;
  const pelV = body.bodies[tIdx]!.linvel();
  acc.sapV += pelV.y * pelV.y;   // 盆骨竖直速度平方
};

let tLift = -1, started = false;
const DUR1 = 1.0;
const W2S = Number(process.env.W2S ?? 0.02);
const W2D = Number(process.env.W2D ?? 0.10);
const DUR2 = W2D;
let prevPvz = 0, zcPv = 0, prevHz = 0, zcH = 0, sqWy = 0, sqWx = 0, ny = 0;
let sqPvx = 0, sqPvz = 0;
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  const t = s * w.dt;
  if (t >= 0.5 && t <= 0.5 + DUR1) feed(W1);   // W1：双支撑静立
  w.advance(1);
  if (tLift < 0) {
    if (!isLiftDone()) continue;
    tLift = t;
    setAbl();
    started = true;
    prevVz = body.bodies[tIdx]!.linvel().z;
    const pv = body.bodies[tIdx]!.linvel(); prevPvz = pv.z; sqPvx = 0; sqPvz = 0;
    const hd = body.bodies[body.indexByKey.get('head')!]!.linvel(); prevHz = hd.z;
    continue;
  }
  if (!started) continue;
  const dtL = t - tLift;
  if (dtL >= W2S && dtL <= W2S + DUR2) {
    feed(W2);
    const pv = body.bodies[tIdx]!.linvel();
    if (Math.sign(pv.z) !== Math.sign(prevPvz) && Math.abs(pv.z) > 0.02) zcPv++;
    prevPvz = pv.z;
    sqPvx += pv.x * pv.x; sqPvz += pv.z * pv.z;
    const hd = body.bodies[body.indexByKey.get('head')!]!.linvel();
    if (Math.sign(hd.z) !== Math.sign(prevHz) && Math.abs(hd.z) > 0.02) zcH++;
    prevHz = hd.z;
    const av = body.bodies[tIdx]!.angvel();
    sqWy += av.y * av.y; sqWx += av.x * av.x; ny++;
  }
}

const report = (tag: string, a: Acc, dur: number): string => {
  const n = Math.max(1, a.n - 1);
  const rmsF = Math.sqrt(a.sq / n), rmsV = Math.sqrt(Math.max(0, a.sqV / n - (a.sumV / n) ** 2));
  const rmsFz = Math.sqrt(Math.max(0, a.sqFz / n - (a.sumFz / n) ** 2));
  return `${tag}: F_z |均值|=${(a.sumAbs / n).toFixed(0)} 净=${(a.sumNet / n).toFixed(0)} RMS=${rmsF.toFixed(0)} 峰=${a.peak.toFixed(0)}N 主频≈${(a.zc / 2 / dur).toFixed(0)}Hz | 盆v_z RMS=${(rmsV * 100).toFixed(1)}cm/s | fz=${(a.sumFz / n).toFixed(0)}±${rmsFz.toFixed(0)}N[${a.fzMin.toFixed(0)},${a.fzMax.toFixed(0)}] | 大腿世界倾=${(a.sumTilt / n).toFixed(1)}°`;
};
console.log(`ABL=${ABL}`);
console.log(report('W1双支撑', W1, DUR1));
console.log(report('W2单腿  ', W2, DUR2));
const chainLine = (tag: string, a: Acc): string =>
  `${tag}: ` + CHAIN.map((k) => `${k}=${(Math.sqrt((a.bodySq.get(k) ?? 0) / Math.max(1, a.bodyN)) * 100).toFixed(1)}`).join(' ') + ' cm/s(v_z RMS)';
console.log(chainLine('W1链', W1));
console.log(chainLine('W2链', W2));
console.log(`W2轴/频: 盆v_x RMS=${(Math.sqrt(sqPvx / Math.max(1, ny)) * 100).toFixed(1)}cm/s 盆v_z RMS=${(Math.sqrt(sqPvz / Math.max(1, ny)) * 100).toFixed(1)}cm/s | 盆ωy RMS=${(Math.sqrt(sqWy / Math.max(1, ny)) * 57.3).toFixed(0)}°/s ωx=${(Math.sqrt(sqWx / Math.max(1, ny)) * 57.3).toFixed(0)}°/s | v_z过零: 盆=${zcPv}次 头=${zcH}次 / ${DUR2}s → ${(zcPv / 2 / DUR2).toFixed(0)} / ${(zcH / 2 / DUR2).toFixed(0)} Hz`);
const corr = (a: Acc, sx: number, sy: number, sxy: number, sxx: number, syy: number): string => {
  const n = Math.max(1, a.n - 1);
  const num = n * sxy - sx * sy;
  const den = Math.sqrt(Math.max(1e-9, n * sxx - sx * sx) * Math.max(1e-9, n * syy - sy * sy));
  return (num / den).toFixed(2);
};
console.log(`W2相关: corr(F_z, 支撑脚fz)=${corr(W2, W2.sumFz, W2.sumNet, W2.sFzF, W2.sqFz, W2.sq)} | corr(F_z, hipR0τ)=${corr(W2, W2.sTh, W2.sumNet, W2.sThF, W2.sTh2, W2.sq)} | 盆骨v_y RMS=${(Math.sqrt(W2.sapV / Math.max(1, W2.n - 1)) * 100).toFixed(1)}cm/s`);
console.log(`W1相关: corr(F_z, 支撑脚fz)=${corr(W1, W1.sumFz, W1.sumNet, W1.sFzF, W1.sqFz, W1.sq)} | 盆骨v_y RMS=${(Math.sqrt(W1.sapV / Math.max(1, W1.n - 1)) * 100).toFixed(1)}cm/s`);
