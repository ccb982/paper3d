import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const body = w.body as any;
// J^T 映射：\u5728 p \u70b9\u65bd\u52a0\u671f\u671b\u529b F\uff08\u4e16\u754c\uff09\u2192 \u5404 DOF \u7684\u7b49\u6548\u5173\u8282\u77e9\uff1a\u03c4_i = a_i \u00b7 ((r_i \u2212 p) \u00d7 F)
const jtTorque = (di: number, p: number[], F: number[]): number => {
  const d = body.dofs[di];
  const a = [d.axisWorld[0], d.axisWorld[1], d.axisWorld[2]];
  const r = [d.anchorWorld[0], d.anchorWorld[1], d.anchorWorld[2]];
  const rx = r[0]! - p[0]!, ry = r[1]! - p[1]!, rz = r[2]! - p[2]!;
  // (r\u2212p)\u00d7F
  const cx = ry * F[2]! - rz * F[1]!;
  const cy = rz * F[0]! - rx * F[2]!;
  const cz = rx * F[1]! - ry * F[0]!;
  return a[0]! * cx + a[1]! * cy + a[2]! * cz;
};
const legQ = (): number => {
  let m = 0;
  for (const nm of ['hip_r', 'knee_r', 'foot_r', 'ankle_r']) {
    for (const ax of [0, 1, 2]) {
      const di = body.dofByName(nm, ax);
      if (di >= 0) m = Math.max(m, Math.abs((body.dofs[di]?.vel ?? 0) * 57.3));
    }
  }
  return m;
};
const trunkUpZ = (): number => {
  const q = body.bodies[body.indexByKey.get('spine4')]!.rotation();
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  return Math.atan2(uz, uy) * 57.3;
};
// \u7ad9\u7a33\uff08\u53cc\u811a\uff09
for (let s = 0; s < Math.round(1.2 / w.dt); s++) w.advance(1);
const com = [ctl.sensors.com[0]!, ctl.sensors.com[1]!, ctl.sensors.com[2]!];
const F = [0, 0, -120];   // \u5411\u2013z \u7684 120N \u865a\u62df\u529b\uff08\u63a8\u4e0a\u8eab\u5411\u2013z\uff09
console.log('\u2460 J^T \u5206\u5e03\uff08F=[0,0,\u2212120]\uff0c\u4f5c\u7528\u70b9=CoM\uff09\uff1a');
const parts: string[] = [];
let sum = 0;
for (const d of body.dofs) {
  const t = jtTorque(d.dofIndex, com, F);
  if (Math.abs(t) > 0.5) parts.push(`${d.name}/${d.axis}=\u03c4${t.toFixed(1)}`);
  sum += Math.abs(t);
}
console.log('  ' + parts.slice(0, 24).join(' '));
console.log(`  \u2211|\u03c4|=${sum.toFixed(0)} N\u00b7m`);
// \u52a8\u6001\u5bf9\u7167\uff1a\u2461 \u51c0\u5173\u8282\u65bd\u52a0\uff08\u5355\u9ac7 -80\uff09 vs \u2462 J^T \u6a21\u5f0f
const run = (label: string, apply: (s: number) => void): void => {
  w.reset();
  for (let s = 0; s < Math.round(1.2 / w.dt); s++) w.advance(1);
  let legPeak = 0, upPeak = 0;
  for (let s = 0; s < Math.round(0.35 / w.dt); s++) {
    w.advance(0); // \u6b64\u5904\u7a7a\u8f6c\uff08\u4e0b\u4e00\u884c\u771f\u63a8\u8fdb\uff09
  }
  console.log(`${label}: \u5f85\u5b9e\u73b0`);
  void legPeak; void upPeak; void apply;
};
void run;
// \u2461/\u2462 \u5b9e\u73b0\uff1a\u5206\u522b\u8dd1
const go = (label: string, writer: 'naive' | 'jt'): void => {
  w.reset();
  for (let s = 0; s < Math.round(1.2 / w.dt); s++) w.advance(1);
  let legPeak = 0, upDelta = 0;
  const u0 = trunkUpZ();
  for (let s = 0; s < Math.round(0.30 / w.dt); s++) {
    const comNow = [ctl.sensors.com[0]!, ctl.sensors.com[1]!, ctl.sensors.com[2]!];
    if (writer === 'naive') {
      const di = body.dofByName('hip_r', 0);
      if (di >= 0) ctl.warner.drive.setTorque(di, -80);
    } else {
      const F2 = [0, 0, -120];
      for (const d of body.dofs) {
        const t = jtTorque(d.dofIndex, comNow, F2);
        if (Math.abs(t) > 0.5) ctl.warner.drive.setTorque(d.dofIndex, t);
      }
    }
    w.advance(1);
    legPeak = Math.max(legPeak, legQ());
    upDelta = Math.max(upDelta, Math.abs(trunkUpZ() - u0));
  }
  console.log(`${label}: \u817f\u5173\u8282\u901f\u5cf0=\u00b1${legPeak.toFixed(0)}\u00b0/s \u8eaf\u5e72\u503e\u89d2\u53d8\u5316=${upDelta.toFixed(2)}\u00b0`);
};
go('\u2461 \u51c0\u5173\u8282\u65bd\u52a0\uff08hip_r/0 = \u221280\uff09', 'naive');
go('\u2462 J^T \u6a21\u5f0f\uff08F=[0,0,\u2212120] @CoM\uff09', 'jt');
