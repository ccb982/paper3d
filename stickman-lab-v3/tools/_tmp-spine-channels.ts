/** _tmp-spine-channels.ts —— 抬腿后 0.1s：脊柱逐通道分解（找抖动的来源）
 *  对 spine1/2 的轴0/轴2 每帧打印：θ、vel、C、λ、stiff、act、servo、ff、damp、lum、passive、writes、applied、sat
 *  用法：node tools/run.mjs _tmp-spine-channels
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const dr = (ctl.warner as unknown as { drive: any }).drive;
const W = body.sk.massTotal * 9.81;
const D = (r: number): number => (r * 180) / Math.PI;

let wasLoaded = false; let lifted = -1;
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const fz = ctl.sensors.feet[0]!.fz;
  if (fz > 0.3 * W) wasLoaded = true;
  if (wasLoaded && fz < 0.05 * W) { lifted = s; break; }
}
if (lifted < 0) { console.log('抬腿未发生'); process.exit(0); }
const t0 = lifted * w.dt;
console.log(`抬腿 t=${t0.toFixed(3)}s`);
for (const [sn, ax] of [['spine1', 0], ['spine2', 0], ['spine3', 0], ['spine1', 2], ['spine2', 2], ['spine3', 2]] as Array<[string, number]>) {
  const i = body.dofByName(sn, ax);
  const d = i >= 0 ? body.dofs[i]! : null;
  console.log(`  ${sn}/${ax}: inertia=${d?.inertia.toFixed(5)} inertiaLow=${d?.inertiaLow.toFixed(5)} tauMax=${d?.tauMax} → 显式阻尼上限 0.8·I_low/dt=${(0.8 * (d?.inertiaLow ?? 0) * 240).toFixed(2)} N·m·s/rad`);
}

const N = Math.round(0.1 / w.dt);
for (const [sn, ax] of [['spine1', 0], ['spine2', 0], ['spine1', 2], ['spine2', 2]] as Array<[string, number]>) {
  console.log(`\n===== ${sn}/${ax} (${ax === 0 ? '侧' : '矢'}) =====`);
  console.log('dt     θ°    vel    C    λ°  | stiff   act  servo   ff  damp   lum | pas  w  app    sat');
  for (let s = 1; s <= N; s++) {
    w.advance(1);
    const i = body.dofByName(sn, ax); if (i < 0) continue;
    const d = body.dofs[i]!;
    const bd = dr.lastBreakdown[i] ?? {};
    const l = w.executor.ledger[i]!;
    console.log(
      `${(s * w.dt).toFixed(3)} ${D(d.angle).toFixed(2).padStart(6)} ${d.vel.toFixed(2).padStart(6)} ${(dr.pairC[i] ?? 0).toFixed(2)} ${D(dr.pairRef[i] ?? 0).toFixed(2).padStart(5)} |` +
      `${(bd.stiff ?? 0).toFixed(0).padStart(6)} ${(bd.act ?? 0).toFixed(0).padStart(5)} ${(bd.servo ?? 0).toFixed(0).padStart(6)} ${(bd.ff ?? 0).toFixed(0).padStart(4)} ${(bd.damp ?? 0).toFixed(0).padStart(5)} ${(bd.lum ?? 0).toFixed(0).padStart(5)} |` +
      `${(l.passive).toFixed(0).padStart(4)} ${String(l.writes).padStart(2)} ${l.applied.toFixed(0).padStart(5)} ${l.saturated ? '*' : ' '}`,
    );
  }
}
