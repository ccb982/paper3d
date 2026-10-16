/** _tmp-stand-ledger.ts —— 站立（双支撑）静态需求账本：给站立基础力组标定用 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const STEPCTX = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const plog = String(process.env.PLOG ?? '0') === '1' ? ((globalThis as { __PROPLOG?: Array<[number, string, number, string]> }).__PROPLOG = []) : null;
for (let s = 0; s < 480; s++) {
  const plogN0 = plog ? plog.length : 0;
  supportClean(STEPCTX, 'r');
  supportClean(STEPCTX, 'l');
  w.advance(1);
  if (s <= 30 || s === 422) {
    const AV = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); if (di < 0) return '--'; const d0 = w.body.dofs[di]!; return `${(d0.angle * 57.3).toFixed(1)}/${d0.vel.toFixed(1)}`; };
    const parts: string[] = [];
    if (plog) {
      const latD = [w.body.dofByName('hip_r', 0), w.body.dofByName('hip_r', 2), w.body.dofByName('knee_r', 0), w.body.dofByName('knee_r', 2), w.body.dofByName('foot_r', 0), w.body.dofByName('foot_r', 2), w.body.dofByName('spine1', 2)];
      const dset = new Set(latD);
      for (const x of plog.slice(plogN0)) if (dset.has(x[0])) parts.push(`${x[3]}=${x[2].toFixed(0)}@${w.body.dofs[x[0]]!.name}/${w.body.dofs[x[0]]!.axis}`);
    }
    console.log(`s${s} pitch=${(ctl.sensors.torsoTilt[0]! * 57.3).toFixed(1)}° 脊[1=${AV('spine1', 2)} 2=${AV('spine2', 2)} 3=${AV('spine3', 2)}] fz=${ctl.sensors.feet[0]!.fz.toFixed(0)}/${ctl.sensors.feet[1]!.fz.toFixed(0)}${parts.length ? ' | ' + parts.join(' ') : ''}`);
  }
  if (s % 60 === 0) {
    const appOf = (n: string, ax: number): number => { const di = w.body.dofByName(n, ax); return di < 0 ? NaN : w.executor.appliedOf(di); };
    const angOf = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); return di < 0 ? '--' : (w.body.dofs[di]!.angle * 57.3).toFixed(1); };
    console.log(`t=${(s * w.dt).toFixed(2)}s com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)}) pitch=${(ctl.sensors.torsoTilt[0]! * 57.3).toFixed(1)}° roll=${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)}° 脊(s1=${angOf('spine1', 2)},s2=${angOf('spine2', 2)},s3=${angOf('spine3', 2)}) 髋2R=${angOf('hip_r', 2)} 膝2R=${angOf('knee_r', 2)} 脊力(s1=${appOf('spine1', 2).toFixed(0)},s3=${appOf('spine3', 2).toFixed(0)}) fzL=${ctl.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl.sensors.feet[1]!.fz.toFixed(0)}`);
  }
}

const body = w.body;
const legParts = (side: string): Set<string> => new Set(['thigh', 'shin', 'foot', 'arch', 'mfoot'].map((q) => `${q}_${side}`));
if (plog) {
  const cov = new Map<number, Set<string>>();
  for (const x of plog) {
    if (!cov.has(x[0])) cov.set(x[0], new Set());
    cov.get(x[0])!.add(`${x[3]}:${x[1]}`);
  }
  console.log('══ 提案覆盖普查（每个轴收到的写手）══');
  for (const d0 of w.body.dofs) {
    const set = [...(cov.get(d0.dofIndex) ?? [])].sort().join(' ');
    console.log(`COV ${(d0.name + '/' + d0.axis).padEnd(12)} ${d0.engineMotor ? '[马达]' : '     '} ${set}`);
  }
}
console.log('══ 站立对账（需求原始式=执行器取反；差额=执行器需求−实际）══');
for (const side of ['r', 'l'] as const) {
  const excl = legParts(side);
  for (const [jn, ax] of [['hip', 0], ['hip', 2], ['knee', 0], ['knee', 2], ['foot', 0], ['foot', 2]] as Array<[string, number]>) {
    const di = body.dofByName(`${jn}_${side}`, ax);
    if (di < 0) continue;
    const d0 = body.dofs[di]!;
    const u = d0.axisWorld, a0 = d0.anchorWorld;
    let tau = 0;
    for (const [kk, bi] of body.indexByKey.entries()) {
      if (excl.has(kk)) continue;
      const rb = body.bodies[bi]!;
      const c = rb.worldCom();
      const Fy = rb.mass() * w.world.gravity.y;
      tau += u[0]! * (-(c.z - a0[2]!) * Fy) + u[2]! * ((c.x - a0[0]!) * Fy);
    }
    const need = -tau;
    const app = w.executor.appliedOf(di);
    console.log(`  ${`${jn}_${side}/${ax}`.padEnd(10)} 需求=${need.toFixed(1).padStart(7)}  实际=${app.toFixed(1).padStart(7)}  差额=${(need - app).toFixed(1).padStart(7)}`);
  }
}
console.log(`com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)})cm  fzL=${ctl.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl.sensors.feet[1]!.fz.toFixed(0)}`);
