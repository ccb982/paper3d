/** _tmp-foot-jitter.ts —— 脚抖动度量 + 写手消融（单腿保持窗 liftDone+0.05~+1.5s）
 *  度量：脚刚体 v_y/v_z RMS、角速度 RMS（x/y/z）、fz 均值/min/max、fz<50N 帧数、fz 波动主频（过零）
 *  消融：base | padOff(整个FootPad停) | padNoTorque(只停FootPad踝力矩,留arch) | braceOff(撑住反射停) | archOff(arch电机停)
 *  用法：node tools/run.mjs _tmp-foot-jitter [base|padOff|padNoTorque|braceOff|archOff]
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
const dr = (ctl.warner as unknown as { drive: { commandMusclePair: (i: number, c: number, ref: number) => void } }).drive;

if (ABL === 'padOff') ctl.pad.enabled = false;
if (ABL === 'ankPairRef') {
  // 支撑踝 pair 去弹簧（ref=当前角→纯阻尼）：判定 23Hz 环是不是 pair 刚度起的
  const o = dr.commandMusclePair.bind(dr) as (i: number, c: number, ref: number) => void;
  dr.commandMusclePair = (i, c, ref) => {
    const d = body.dofs[i]!;
    if (/^foot_r$/.test(d.name) && (d.axis === 0 || d.axis === 2)) return o(i, c, d.angle);
    return o(i, c, ref);
  };
}
if (ABL === 'ankC25') {
  // 支撑踝 pair 保留弱弹簧（C 限 0.25）——对比"纯阻尼"与"硬弹簧"
  const o = dr.commandMusclePair.bind(dr) as (i: number, c: number, ref: number) => void;
  dr.commandMusclePair = (i, c, ref) => {
    const d = body.dofs[i]!;
    if (/^foot_r$/.test(d.name) && (d.axis === 0 || d.axis === 2)) return o(i, Math.min(c, 0.25), ref);
    return o(i, c, ref);
  };
}
if (ABL === 'ankPairOff') {
  const o = dr.commandMusclePair.bind(dr) as (i: number, c: number, ref: number) => void;
  dr.commandMusclePair = (i, c, ref) => {
    const d = body.dofs[i]!;
    if (/^foot_r$/.test(d.name) && (d.axis === 0 || d.axis === 2)) return o(i, 0, ref);
    return o(i, c, ref);
  };
}
if (ABL === 'padStepOff') (ctl.pad as unknown as { step: () => void }).step = () => {};
if (ABL === 'padLowFz') {
  // FootPad 的 tf=−fz·dx 里 fz 用低通值（参数化泵诊治试验）：flex 轴改用 −fz_lp·dx
  let v = ctl.sensors.feet[1]!.fz;
  const flex = body.dofByName('foot_r', 2);
  const eo = w.executor.addTorque.bind(w.executor);
  w.executor.addTorque = (i: number, t: number) => {
    const st = new Error().stack ?? '';
    if (/FootPad\.step/.test(st)) {
      const a = 1 - Math.exp(-(1 / 240) / 0.03);
      v += (ctl.sensors.feet[1]!.fz - v) * a;
      if (i === flex) return eo(i, -v * ctl.pad.getTarget('r').dx);
    }
    eo(i, t);
  };
}
if (ABL === 'braceOff') (ctl.lean as unknown as { applySupportBrace: () => void }).applySupportBrace = () => {};
if (ABL === 'archOff') {
  const bo = body.setEngineMotorTarget.bind(body);
  void bo;
  (body as unknown as { setEngineMotorTarget: () => void }).setEngineMotorTarget = () => {};
}
if (ABL === 'padNoTorque') {
  const eo = w.executor.addTorque.bind(w.executor);
  w.executor.addTorque = (i: number, t: number) => {
    const st = new Error().stack ?? '';
    if (/FootPad\.step/.test(st)) return;
    eo(i, t);
  };
}

const fi = body.indexByKey.get('foot_r')!;
let tLift = -1, n = 0;
let sqVy = 0, sqVz = 0, sqWx = 0, sqWy = 0, sqWz = 0;
let sumFz = 0, minFz = 1e9, maxFz = -1e9, nAir = 0;
let prevFz = 0, zc = 0;
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) { if (isLiftDone()) tLift = t; continue; }
  const dtL = t - tLift;
  if (dtL < 0.05 || dtL > 1.5) continue;
  const rb = body.bodies[fi]!;
  const v = rb.linvel(); const av = rb.angvel();
  n++;
  sqVy += v.y * v.y; sqVz += v.z * v.z;
  sqWx += av.x * av.x; sqWy += av.y * av.y; sqWz += av.z * av.z;
  const fz = ctl.sensors.feet[1]!.fz;
  sumFz += fz; minFz = Math.min(minFz, fz); maxFz = Math.max(maxFz, fz);
  if (fz < 50) nAir++;
  if (Math.sign(fz - sumFz / n) !== Math.sign(prevFz - sumFz / n) && Math.abs(fz - sumFz / n) > 30) zc++;
  prevFz = fz;
}
const rms = (x: number): number => Math.sqrt(x / Math.max(1, n));
console.log(
  `${ABL.padEnd(12)} | 脚 v_y RMS=${(rms(sqVy) * 100).toFixed(1)} v_z RMS=${(rms(sqVz) * 100).toFixed(1)} cm/s |` +
  ` ω RMS x=${rms(sqWx).toFixed(1)} y=${rms(sqWy).toFixed(1)} z=${rms(sqWz).toFixed(1)} rad/s |` +
  ` fz ${(sumFz / n).toFixed(0)}[${minFz.toFixed(0)},${maxFz.toFixed(0)}] 近零帧=${nAir}/${n} | fz波动 ${(zc / 2 / 1.45).toFixed(0)}Hz`,
);
