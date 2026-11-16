import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const tau = (n: string, ax: number): number => {
  const di = w.body.dofByName(n, ax);
  if (di < 0) return 0;
  const b = drive?.lastBreakdown?.[di] ?? {};
  return (b.stiff ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.act ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0);
};
const tmax = (n: string, ax: number): number => {
  const di = w.body.dofByName(n, ax);
  return di >= 0 ? w.body.dofs[di]!.tauMax : 1;
};
const joints: Array<[string, number, string]> = [
  ['foot_r', 2, '踝·跖屈'], ['foot_r', 0, '踝·内外翻'], ['arch_r', 0, '足弓'],
  ['hip_r', 2, '髋·屈伸'], ['hip_r', 0, '髋·外展'], ['hip_r', 1, '髋·旋转'],
  ['spine1', 0, '腹·侧屈'], ['spine1', 2, '腹·屈伸'], ['spine1', 1, '腹·旋转'],
  ['knee_r', 2, '膝'],
];
const peak = new Map<string, number>();
let nSL = 0, copMinFwd = 99, copMinBack = 99, copMaxZ = 0, copSumX = 0, copSumZ = 0;
let comSumX = 0, comSumZ = 0, comPeakX = 0, comPeakZ = 0;
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.3 || t > 4.3) continue;
  const fr = ctl.sensors.feet[1]!;
  if (!fr.loaded) continue;
  nSL++;
  // ★ CoM−CoP 同系距离（稳健：zroute同口径）
  if (fr.copValid && t < 3.4) {
    comSumX += ctl.sensors.com[0]! - fr.copX;
    comSumZ += ctl.sensors.com[2]! - fr.copZ;
    comPeakX = Math.max(comPeakX, Math.abs(ctl.sensors.com[0]! - fr.copX));
    comPeakZ = Math.max(comPeakZ, Math.abs(ctl.sensors.com[2]! - fr.copZ));
  }
  for (const [n, ax, label] of joints) {
    const u = Math.abs(tau(n, ax)) / Math.max(1, tmax(n, ax));
    const key = `${label} (${n}/${ax})`;
    if ((peak.get(key) ?? 0) < u) peak.set(key, u);
  }
  // CoP 边距：CoP 相对踝投影前后可达
  if (fr.copValid) {
    const dx = fr.copX - fr.x;   // 前为正
    copMinFwd = Math.min(copMinFwd, 0.14 - dx);
    copMinBack = Math.min(copMinBack, dx - (-0.05));
    copMaxZ = Math.max(copMaxZ, Math.abs(fr.copZ - fr.z));
    copSumX += dx; copSumZ += Math.abs(fr.copZ - fr.z);
  }
}
console.log(`单腿采样帧=${nSL}  平均CoP: 前移 ${((copSumX / Math.max(1, nSL)) * 100).toFixed(1)}cm 侧移 ${((copSumZ / Math.max(1, nSL)) * 100).toFixed(1)}cm`);
console.log(`CoM−CoP(同系): 平均 前${((comSumX / Math.max(1, nSL)) * 100).toFixed(1)}cm/侧${((comSumZ / Math.max(1, nSL)) * 100).toFixed(1)}cm | 峰值 前${(comPeakX * 100).toFixed(1)}/侧${(comPeakZ * 100).toFixed(1)}cm`);
console.log(`CoP 边距最小值: 距趾尖 ${(copMinFwd * 100).toFixed(1)}cm | 距跟 ${(copMinBack * 100).toFixed(1)}cm | 侧向峰值 ${(copMaxZ * 100).toFixed(1)}cm (侧可达±2cm)`);
console.log('── 三道防线力矩利用率（峰值 |τ|/τmax）──');
const rows = [...peak.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of rows) console.log(`  ${k.padEnd(22)} ${(v * 100).toFixed(0).padStart(4)}%  ${v > 0.8 ? '★满' : v > 0.5 ? '△半' : '✓余量'}`);
