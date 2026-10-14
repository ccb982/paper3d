/** _tmp-tq-budget.ts —— 静态力矩账 v2（用户："你能保证这些数据准确吗"）
 *  修正：①真质心 worldCom()（v1 误用 translation()）；②需求矩改用引擎自带 gravityComp()（Featherstone 静态项，逐自由度精确）；
 *  ③实测矩按窗口平均（+0.8~1.2s）；④CoM 与系统传感器交叉对账。
 *  快照点=抬腿后 1.0s。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
resetFootLateral();
ctl.actions.play('singleLegR');
const g = 9.81;

let tLift = -1;
const avg = new Map<string, { s: number; s2: number; n: number }>();
const acc = (key: string, v: number): void => {
  const a = avg.get(key) ?? { s: 0, s2: 0, n: 0 };
  a.s += v; a.s2 += v * v; a.n++;
  avg.set(key, a);
};
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0 && isLiftDone()) tLift = t;
  if (tLift < 0) continue;
  const dtL = t - tLift;
  if (dtL >= 0.8 && dtL <= 1.2) {
    const dr = (ctl.warner as unknown as { drive: { lastBreakdown: Array<{ act: number }> } }).drive;
    for (const [n, ax] of [['hip_l', 0], ['hip_l', 2], ['knee_l', 2], ['foot_l', 2], ['hip_r', 0], ['hip_r', 2], ['knee_r', 2], ['foot_r', 2]] as Array<[string, number]>) {
      const di = w.body.dofByName(n, ax);
      acc(`${n}/${ax}`, di >= 0 ? (dr.lastBreakdown[di]?.act ?? 0) : 0);
    }
  }
  if (dtL >= 1.0) break;
}

type P = { x: number; y: number; z: number };
const bodies: Array<{ k: string; m: number; p: P }> = [];
for (const [k, i] of [...w.body.indexByKey.entries()].sort((a, b) => a[1] - b[1])) {
  const b = w.body.bodies[i]!;
  const c = b.worldCom();
  bodies.push({ k, m: b.mass(), p: { x: c.x, y: c.y, z: c.z } });
}
const M = bodies.reduce((s, b) => s + b.m, 0);
console.log(`【质量账】总=${M.toFixed(1)}kg 重力=${(M * g).toFixed(0)}N`);
for (const b of bodies) console.log(`  ${b.k.padEnd(9)} ${b.m.toFixed(2)}kg  com=(${b.p.x.toFixed(3)}, ${b.p.y.toFixed(3)}, ${b.p.z.toFixed(3)})`);

let mx = 0, my = 0, mz = 0;
for (const b of bodies) { mx += b.m * b.p.x; my += b.m * b.p.y; mz += b.m * b.p.z; }
const scom = ctl.sensors.com;
console.log(`【CoM 对账】加权=(${(mx / M).toFixed(4)}, ${(my / M).toFixed(4)}, ${(mz / M).toFixed(4)}) 传感器=(${scom[0]!.toFixed(4)}, ${scom[1]!.toFixed(4)}, ${scom[2]!.toFixed(4)})`);

const grp = (re: RegExp): { m: number; x: number; z: number } => {
  let m = 0, gx = 0, gz = 0;
  for (const b of bodies) if (re.test(b.k)) { m += b.m; gx += b.m * b.p.x; gz += b.m * b.p.z; }
  return { m, x: m > 0 ? gx / m : 0, z: m > 0 ? gz / m : 0 };
};
const upper = grp(/^(torso|spine|head|neck|arm|hand)/);
const swAll = grp(/^(thigh_l|shin_l|foot_l|arch_l|mfoot_l)/);
const sup = grp(/^(thigh_r|shin_r|foot_r|arch_r|mfoot_r)/);
console.log(`【分组】上身 ${upper.m.toFixed(1)}kg | 摆腿 ${swAll.m.toFixed(1)}kg | 支撑腿 ${sup.m.toFixed(1)}kg`);

// ── 精确需求：引擎自带静态重力补偿（Featherstone 静态项）
const gc = new Float64Array(w.body.dofs.length);
w.body.gravityComp(gc, w.world.gravity.y);
const req = (n: string, ax: number): number => {
  const di = w.body.dofByName(n, ax);
  return di >= 0 ? gc[di]! : 0;
};
console.log(`【需求矩·gravityComp（准静态精确）】`);
console.log(`  摆腿: 髋0=${req('hip_l', 0).toFixed(1)} 髋2=${req('hip_l', 2).toFixed(1)} 膝2=${req('knee_l', 2).toFixed(1)} 踝2=${req('foot_l', 2).toFixed(1)}(引擎电机跳过)`);
console.log(`  支撑: 髋0=${req('hip_r', 0).toFixed(1)} 髋2=${req('hip_r', 2).toFixed(1)} 膝2=${req('knee_r', 2).toFixed(1)} 踝2=${req('foot_r', 2).toFixed(1)}(引擎电机跳过)`);
for (const s2 of ['spine1', 'spine2', 'spine3', 'spine4']) {
  console.log(`  ${s2}: 轴0=${req(s2, 0).toFixed(1)} 轴2=${req(s2, 2).toFixed(1)}`);
}

console.log(`【实测矩·窗口平均 +0.8~1.2s】`);
for (const [n, ax] of [['hip_l', 0], ['hip_l', 2], ['knee_l', 2], ['foot_l', 2], ['hip_r', 0], ['hip_r', 2], ['knee_r', 2], ['foot_r', 2]] as Array<[string, number]>) {
  const a = avg.get(`${n}/${ax}`);
  if (!a || !a.n) { console.log(`  ${n}/${ax}: 无数据`); continue; }
  const m = a.s / a.n;
  const sd = Math.sqrt(Math.max(0, a.s2 / a.n - m * m));
  console.log(`  ${n}/${ax}: 均=${m.toFixed(1)} 标准差=${sd.toFixed(1)}`);
}
