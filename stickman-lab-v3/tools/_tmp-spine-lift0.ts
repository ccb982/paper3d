/** _tmp-spine-lift0.ts —— 抬腿后前 0.1s：脊柱发了什么命令（逐帧）
 *  触发：摆动脚 fz 首次 < 5%W（脚离地）= 抬腿时刻。
 *  输出① 抬腿时刻的力链直率表（unified SEGS 同款：d / τ=W×d）
 *  输出② 0–0.1s 逐帧：每脊柱节（spine1/2/3）× 轴（0侧/2矢）的 θ、λ(pairRef)、C、applied、sat、
 *         跨节肌的 (c, ref, 合角差, 计算矩)（覆盖该 dof 的每条）
 *  用法：node tools/run.mjs _tmp-spine-lift0
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const dr = (ctl.warner as unknown as { drive: any }).drive;
const idx = body.indexByKey;
const W = body.sk.massTotal * 9.81;
const D = (r: number): number => (r * 180) / Math.PI;

const SWING = 0;   // 左 = 摆动（singleLegR）
// 先等摆动脚承重（A 相），再检测离地（抬腿）
let wasLoaded = false;
let lifted = -1;
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const fz = ctl.sensors.feet[SWING]!.fz;
  if (fz > 0.3 * W) wasLoaded = true;
  if (wasLoaded && fz < 0.05 * W) { lifted = s; break; }
}
if (lifted < 0) { console.log('抬腿未发生'); process.exit(0); }
const t0 = lifted * w.dt;
console.log(`抬腿时刻 t=${t0.toFixed(3)}s（左脚 fz<5%W；liftDone=${isLiftDone()}；phase=${ctl.actions.status.phase}）`);

// 力链直率表（unified 同款）
{
  const SEGS: ReadonlyArray<[string, string]> = [
    ['foot_r', '足'], ['shin_r', '胫'], ['thigh_r', '腿'], ['torso', '盆'],
    ['spine2', '腰'], ['spine3', '腰+'], ['spine4', '胸'], ['head', '头'],
  ];
  console.log('── 力链直率（CoM 重力线到各节）──');
  for (const [k, nm] of SEGS) {
    const ix = idx.get(k); if (ix === undefined) continue;
    const p = body.bodies[ix]!.translation();
    const dX = Math.abs(p.x - ctl.sensors.com[0]!);
    const dZ = Math.abs(p.z - ctl.sensors.com[2]!);
    const d = Math.hypot(dX, dZ);
    console.log(`  ${nm.padEnd(3)} d=${(d * 100).toFixed(1).padStart(5)}cm  τ=W×d=${(W * d).toFixed(0).padStart(4)}N·m  (dX=${(dX * 100).toFixed(1)} dZ=${(dZ * 100).toFixed(1)})`);
  }
}

const dofsOf = (sn: string, ax: number): number => body.dofByName(sn, ax);
const spanTau = (i: number): { c: number; ref: number; diff: number; tq: number }[] => {
  const out: { c: number; ref: number; diff: number; tq: number }[] = [];
  for (const m of dr.spanMuscles as Array<{ dofs: number[]; c: number; ref: number }>) {
    if (!m.dofs.includes(i) || m.c < 1e-3) continue;
    let sum = 0; for (const dj of m.dofs) sum += body.dofs[dj]!.angle;
    out.push({ c: m.c, ref: m.ref, diff: sum - m.ref, tq: (-dr.opt.musclePairK * m.c * (sum - m.ref)) / m.dofs.length });
  }
  return out;
};

console.log('\n── 抬腿后 0–0.1s：脊柱命令逐帧（θ/λ/C/applied/sat；span=每条跨节肌的合角差→计算矩）──');
const N = Math.round(0.1 / w.dt);
for (let s = 1; s <= N; s++) {
  w.advance(1);
  const t = (lifted + s) * w.dt;
  if (s % 2 !== 1 && s !== N) continue;   // 每 2 步（120Hz）打印，够密
  console.log(`\n t=+${(t - t0).toFixed(3)}s  盆pitch=${((ctl.sensors.torsoTilt[0] ?? 0) * 57.3).toFixed(2)}° roll=${((ctl.sensors.torsoTilt[1] ?? 0) * 57.3).toFixed(2)}°  comZ=${ctl.sensors.com[2]!.toFixed(3)} vz=${ctl.sensors.comVel[2]!.toFixed(3)}  liftDone=${isLiftDone()}`);
  for (const ax of [0, 2] as const) {
    const parts: string[] = [];
    for (const sn of ['spine1', 'spine2', 'spine3'] as const) {
      const i = dofsOf(sn, ax); if (i < 0) continue;
      const d = body.dofs[i]!;
      const C = dr.pairC[i] ?? 0;
      const lam = dr.pairRef[i] ?? 0;
      const l = w.executor.ledger[i]!;
      const bd = dr.lastBreakdown[i] ?? {};
      const sp = spanTau(i).map((x) => `${D(x.diff).toFixed(1)}°→${x.tq.toFixed(0)}`).join(' | ');
      parts.push(`${sn}: θ=${D(d.angle).toFixed(1)} λ=${D(lam).toFixed(1)} C=${C.toFixed(2)} τ=${l.applied.toFixed(0)}${l.saturated ? '*' : ''} act=${(bd.act ?? 0).toFixed(0)} span[${sp}]`);
    }
    console.log(`  轴${ax === 0 ? '0侧' : '2矢'}: ${parts.join('  ')}`);
  }
}
