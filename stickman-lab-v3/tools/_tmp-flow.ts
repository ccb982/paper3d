import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const tot = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  if (di < 0) return NaN;
  const b = ctl.warner.drive.lastBreakdown[di] as any;
  if (!b) return NaN;
  return (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
};
const F = (v: number): string => Number.isFinite(v) ? v.toFixed(0).padStart(5) : '  n/a';
console.log('t | 足底CoP矩(实) | 踝R2 | 膝R2 | 髇R2 | 髇R0 | 脚底竹法验证=fz×(CoP-踝)');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 24 === 0) {
    const f = ctl.sensors.feet[1]!;
    const W = body.sk.massTotal * 9.81;
    // 踝矩的物理真值≈ fz × (CoP - 踝关节z)（箭矢面近似）
    const copArm = (f.copZ - f.z) * 100;
    console.log(`${t.toFixed(2)} | ${(f.fz/W*100).toFixed(0).padStart(3)}% cop${f.copZ !== undefined ? (f.copZ*100).toFixed(1) : '?'} | ${F(tot('foot_r',2))} | ${F(tot('knee_r',2))} | ${F(tot('hip_r',2))} | ${F(tot('hip_r',0))} | ${(f.fz*copArm*0.01).toFixed(0)}`);
  }
}
