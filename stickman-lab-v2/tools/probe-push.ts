/**
 * probe-push.ts —— 判据②：腰能不能挺起来（纯脊柱力矩隔离）
 *
 * 场景：
 *   ① 0–1.0s   用角目标把腰弯下去（spine1/2/3 各 −0.15，颈 −0.10）
 *   ② 1.0–1.6s 叠加**纯脊柱伸力矩**（+20/+15/+10 N·m）→ 腰应挺回去
 *   ③ 1.6–2.2s 撤力矩（保留弯角目标）→ 腰应弯回
 *
 * 判据：②期间 头/胸 y 上升 ≥3cm；③回落。全程双脚不离地、不摔倒。
 */
import './_boot';
import { World } from '../src/core/world';
import { StabilityWarner } from '../src/core/stability';

const w = new World();
const bal = new StabilityWarner(w, {
  gravityComp: true, comKp: 12, comKd: 5, maxForceFrac: 0.35,
  postureTone: 0.8, lateralControl: false,
});
w.controller = bal;
w.reset();

const weight = w.sk.massTotal * 9.81;
const bend: Record<string, number> = {
  'spine1/2': -0.15, 'spine2/2': -0.15, 'spine3/2': -0.12, 'neck/2': -0.10,
};
const extend: Record<string, number> = { 'spine1/2': +20, 'spine2/2': +15, 'spine3/2': +10 };

const chest = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3') ?? 0;
const head = w.body.indexByKey.get('head') ?? 0;

for (const [k, v] of Object.entries(bend)) {
  const [n, a] = k.split('/');
  bal.manual.setAngle(n!, Number(a), v);
}

const tExt = 1.0, tRel = 1.6, tEnd = 2.2;
let ext = false, rel = false;
const rows: string[] = [];
let yMin = Infinity, yMax = -Infinity;

const N = Math.round(tEnd / w.dt);
for (let s = 0; s < N; s++) {
  const t = s * w.dt;
  if (t >= tExt && !ext) {
    for (const [k, v] of Object.entries(extend)) { const [n, a] = k.split('/'); bal.manual.setTorque(n!, Number(a), v); }
    ext = true;
  }
  if (t >= tRel && !rel) {
    for (const k of Object.keys(extend)) { const [n, a] = k.split('/'); bal.manual.setTorque(n!, Number(a), 0); }
    rel = true;
  }
  w.advance(1);
  bal.setComTarget(0, bal.telemetry.comZ);
  const hy = w.body.bodies[head]!.translation().y;
  const cy = w.body.bodies[chest]!.translation().y;
  const fz = (w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt)) / weight * 100;
  if (t >= tExt && t < tRel) { if (hy < yMin) yMin = hy; }
  if (t >= tRel && t < tEnd) { if (hy > yMax) yMax = hy; }
  if (Math.abs(t - (tExt - 0.04)) < w.dt / 2) rows.push(`挺前 t=${t.toFixed(2)}  胸y=${cy.toFixed(3)}  头y=${hy.toFixed(3)}  ΣFz=${fz.toFixed(0)}%`);
  if (Math.abs(t - (tRel - 0.04)) < w.dt / 2) rows.push(`挺中 t=${t.toFixed(2)}  胸y=${cy.toFixed(3)}  头y=${hy.toFixed(3)}  ΣFz=${fz.toFixed(0)}%`);
  if (Math.abs(t - (tEnd - 0.04)) < w.dt / 2) rows.push(`挺后 t=${t.toFixed(2)}  胸y=${cy.toFixed(3)}  头y=${hy.toFixed(3)}  ΣFz=${fz.toFixed(0)}%`);
}

console.log('════ 挺腰（纯脊柱伸力矩 +20/+15/+10 N·m）════');
for (const r of rows) console.log('  ' + r);
if (yMax > -Infinity) console.log(`  挺腰升幅（头 y）= ${((yMax - yMin) * 100).toFixed(1)} cm`);
const outs: string[] = [];
for (const k of Object.keys(extend)) {
  const [n, a] = k.split('/');
  const di = w.body.dofByName(n!, Number(a));
  if (di >= 0) outs.push(`${k}: applied=${w.executor.ledger[di]!.applied.toFixed(0)}N·m(末)`);
}
console.log('  回读：' + outs.join('  '));
console.log(`  执行器不变量：${w.executor.checkInvariants().length === 0 ? '通过' : '失败'}`);
