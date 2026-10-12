import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { balanceScale } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const drive = (ctl as any).drive ?? (w as any).drive;
const tau = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  if (di < 0) return 0;
  const b = drive?.lastBreakdown?.[di] ?? {};
  return (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0) + (b.stiff ?? 0);
};
console.log('t 相 | CoM cm vZ cm/s | 真倒向 | 天平: tilt 内缘余量 CoP速度 TTB内 | 腿τ(髋外展) 脊柱τ(sp1) | 支撑脚z');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.3 || t > 4.3) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const b = balanceScale({ bal: (ctl as any).warner, body: w.body, sensors: ctl.sensors } as any, 'r');
  const comZ = ctl.sensors.com[2]!;
  const footZ = ctl.sensors.feet[1]!.z;
  const cm = (v: number): string => (Number.isFinite(v) ? (v * 100).toFixed(1) : ' -- ').padStart(6);
  const tt = (v: number): string => (Number.isFinite(v) ? (v === Infinity ? ' inf' : v.toFixed(2)) : ' -- ').padStart(5);
  // 真倒向：CoM 对支撑脚的偏移 + 速度的合成方向
  const dir = comZ - footZ + ctl.sensors.comVel[2]! / 3.2;
  const arrow = dir > 0.005 ? '→踢侧' : dir < -0.005 ? '→撑侧' : '  中 ';
  console.log(`${t.toFixed(2)} ${(ctl.actions.status.phase ?? '?').slice(0, 1)} | ${(comZ * 100).toFixed(1).padStart(6)} ${(ctl.sensors.comVel[2]! * 100).toFixed(1).padStart(6)} | ${arrow} | ${cm(b.tilt)} ${cm(b.marginMed)} ${cm(b.copVz)} ${tt(b.ttbMed)} | ${tau('hip_r', 0).toFixed(0).padStart(4)} ${tau('spine1', 0).toFixed(0).padStart(4)} | ${(footZ * 100).toFixed(1).padStart(6)}`);
}
