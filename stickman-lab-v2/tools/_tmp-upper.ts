/** 临时探针：蹲姿释放后**上身逐轴受力全分解**（脊柱/颈/髋 + 躯干姿态）
 *  用法: node tools/run.mjs _tmp-upper
 *  env: 同 _tmp-stand-ledger（SQCOURT/PRED_OFF/TR 等） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, courtInject, courtStep, type CourtState } from '../src/core/court';

const w = new World();
const ctl = new ControlModule(w, { postureTone: Number(process.env.TONE ?? 8) });
w.controller = ctl;
w.reset();
let st: CourtState | null = null;

for (let s = 0; s < 120; s++) w.advance(1);
w.reset();
st = squatCourtSetup(w, ctl, Number(process.env.SQC_SETTLE ?? 2.0));
console.log('setup done');

for (let s = 0; s < 2400; s++) {
  courtInject(w, ctl);
  w.advance(1);
  courtStep(w, ctl, st);
  if (st.released && st.t >= 2.0 && st.t <= 2.6) {
    const stp = Math.round(st.t * 240);
    if (stp % 12 === 0) {
      const lb = w.drive.lastBreakdown;
      const led = (w.executor as unknown as { ledger?: Array<{ cmd: number; applied: number; passive: number; limit: number; saturated: boolean }> }).ledger;
      const rows: string[] = [];
      for (const nm of ['spine1', 'spine2', 'spine3', 'neck'] as const) {
        for (const ax of [0, 1, 2] as const) {
          const di = w.body.dofByName(nm, ax);
          if (di < 0) continue;
          const d = w.body.dofs[di]!;
          const b = lb[di];
          const l = led?.[di];
          if (!b) continue;
          const sum = Math.abs(b.stiff) + Math.abs(b.itb) + Math.abs(b.lum) + Math.abs(b.act) + Math.abs(b.servo) + Math.abs(b.ff) + Math.abs(b.damp);
          if (sum < 5 && Math.abs(d.vel) < 0.5) continue;
          rows.push(`${nm}/${ax} a=${(d.angle * 57.3).toFixed(0)}° v=${d.vel.toFixed(1)} 加=${(l?.applied ?? 0).toFixed(0)} | st=${b.stiff.toFixed(0)} itb=${b.itb.toFixed(0)} lum=${b.lum.toFixed(0)} act=${b.act.toFixed(0)} sv=${b.servo.toFixed(0)} ff=${b.ff.toFixed(0)} dp=${b.damp.toFixed(0)} pas=${(l?.passive ?? 0).toFixed(0)} lim=${(l?.limit ?? 0).toFixed(0)} cmd=${(l?.cmd ?? 0).toFixed(0)}${l?.saturated ? ' SAT' : ''}`);
        }
      }
      const ti = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3')!;
      const q = w.body.bodies[ti]!.rotation();
      const ux = 2 * (q.x * q.y - q.w * q.z);
      const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
      const uz = 2 * (q.w * q.x + q.y * q.z);
      const hipR = w.body.dofByName('hip_r', 2);
      const hipA = hipR >= 0 ? (w.body.dofs[hipR]!.angle * 57.3).toFixed(0) : '--';
      console.log(`U t=${st.t.toFixed(2)} 躯干up=(${ux.toFixed(2)},${uy.toFixed(2)},${uz.toFixed(2)}) 髋R=${hipA}° | ${rows.join(' ')}`);
    }
  }
  if (st.t > 3.0) break;
}
