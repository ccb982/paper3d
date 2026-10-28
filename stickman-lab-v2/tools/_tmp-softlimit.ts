/** _tmp-softlimit: 软限位设计的物理约束底数
 *  ① 每个 DoF 的 inertia / inertiaLow / τmax / 限位 / 目标角(baseAng) / 实测偏差分布
 *  ② 显式积分稳定窗口：kd ≤ 0.8·2·I_low/dt（drive 的 Bmax 口径）
 *     力矩上限：τmax（执行器）/ 关节限位冲量通道
 *  ③ 静态力矩需求（captureSquatBase 的 base 值）
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { baseAng } from '../src/core/servo/baseTable';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;
const dt = w.dt;
const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();

// 偏差统计（对 baseAng 目标角）
const devHist = new Map<string, number[]>();
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (court.t < 2.05) continue;   // 只统计释放后
  for (const d of body.dofs) {
    if (!/^(hip|knee|foot|spine|neck)/.test(d.name)) continue;
    const ref = baseAng(d.name, d.axis);
    if (ref === undefined) continue;
    const key = `${d.name}/${d.axis}`;
    if (!devHist.has(key)) devHist.set(key, []);
    devHist.get(key)!.push((d.angle - ref) * 57.3);
  }
}

console.log(`\n════ 软限位设计底数（dt=${(dt * 1000).toFixed(2)}ms）════`);
console.log('DoF        | 惯量 I    I_low  | τmax  | 限位(°)          | base静态τ | 目标角°  | 偏差(°): 均值/最大 | kd稳定上限 | 力矩/限位余量');
const rows: string[] = [];
for (const d of body.dofs) {
  if (!/^(hip|knee|foot)/.test(d.name)) continue;
  const ref = baseAng(d.name, d.axis);
  const devs = devHist.get(`${d.name}/${d.axis}`) ?? [];
  const mean = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : NaN;
  const mx = devs.length ? Math.max(...devs.map(Math.abs)) : NaN;
  // 显式阻尼稳定上限（drive 的 Bmax 口径：B ≤ 0.8·I_low/dt）
  const bMax = 0.8 * Math.max(1e-9, d.inertiaLow) / dt;
  // 显式弹簧稳定上限（executor pairTorque 口径：kp ≤ 0.5·4·I/dt²）
  const kpMax = 0.5 * 4 * d.inertiaLow / (dt * dt);
  const bb = baseBuf?.[d.dofIndex] ?? 0;
  const limDeg = `[${(d.min * 57.3).toFixed(0)},${(d.max * 57.3).toFixed(0)}]`;
  rows.push(
    `${(d.name + '/' + d.axis).padEnd(10)} | ${d.inertia.toFixed(4).padStart(7)} ${d.inertiaLow.toFixed(4).padStart(7)} |` +
    ` ${d.tauMax.toFixed(0).padStart(4)} | ${limDeg.padStart(14)} | ${bb.toFixed(1).padStart(9)} |` +
    ` ${ref === undefined ? '   n/a' : (ref * 57.3).toFixed(1).padStart(7)} |` +
    ` ${(Number.isFinite(mean) ? mean.toFixed(2) : '-').padStart(7)}/${(Number.isFinite(mx) ? mx.toFixed(2) : '-').padStart(6)} |` +
    ` ${bMax.toFixed(1).padStart(9)} | kp≤${kpMax.toFixed(0)}`,
  );
}
console.log(rows.join('\n'));

console.log('\n════ 参照：站立状态同名关节（对比惯量/τmax）════');
for (const nm of ['hip_l', 'knee_l', 'foot_l']) {
  for (const ax of [0, 2]) {
    const i = body.dofByName(nm, ax);
    if (i < 0) continue;
    const d = body.dofs[i]!;
    console.log(`${(nm + '/' + ax).padEnd(10)} I=${d.inertia.toFixed(4)} I_low=${d.inertiaLow.toFixed(4)} τmax=${d.tauMax}`);
  }
}

console.log('\n════ 蹲姿静态需求参考（captureSquatBase 的 base）════');
const groups: string[] = [];
for (const d of body.dofs) {
  if (d.axis !== 2) continue;
  const v = baseBuf?.[d.dofIndex] ?? 0;
  if (Math.abs(v) > 0.5) groups.push(`${d.name}=${v.toFixed(0)}`);
}
console.log('  ' + groups.join('  '));
console.log(`\nfall=${court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}`);
