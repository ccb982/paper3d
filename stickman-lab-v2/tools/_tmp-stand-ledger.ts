/** _tmp-stand-ledger.ts —— 站立（双支撑）静态需求账本：给站立基础力组标定用 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;   // ★ 确定性：关空闲随机微动（否则 2.5-6.5s 随机触发 → 仿真不可复现）
w.controller = ctl;
w.reset();
const STEPCTX = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const plog = String(process.env.PLOG ?? '0') === '1' ? ((globalThis as { __PROPLOG?: Array<[number, string, number, string]> }).__PROPLOG = []) : null;
let dead = -1, whyD = '';
const c0x0 = ctl.sensors.com[0]!, c0z0 = ctl.sensors.com[2]!;
for (let s = 0; s < 3840; s++) {
  const plogN0 = plog ? plog.length : 0;
  supportClean(STEPCTX, 'r');
  supportClean(STEPCTX, 'l');
  w.advance(1);
  if (dead < 0) {
    // ★ 2026-10-16 修正轴：torsoTilt[0]=绕Z倾斜=侧向(roll)；torsoTilt[1]=绕X倾斜=矢状(pitch)
    const ro = Math.abs(ctl.sensors.torsoTilt[0]!), pi = Math.abs(ctl.sensors.torsoTilt[1]!);
    const ox = Math.abs(ctl.sensors.com[0]! - c0x0), oz = Math.abs(ctl.sensors.com[2]! - c0z0);
    const cy = ctl.sensors.com[1]!;
    if (pi > 0.3491) { dead = s * w.dt; whyD = `pitch=${(pi * 57.3).toFixed(1)}°`; }
    else if (ro > 0.1745) { dead = s * w.dt; whyD = `roll=${(ro * 57.3).toFixed(1)}°`; }
    else if (ox > 0.05) { dead = s * w.dt; whyD = `offX=${(ox * 100).toFixed(1)}cm`; }
    else if (oz > 0.05) { dead = s * w.dt; whyD = `offZ=${(oz * 100).toFixed(1)}cm`; }
    else if (cy < 0.75) { dead = s * w.dt; whyD = `comY=${(cy * 100).toFixed(1)}cm`; }
  }
  if (s === 422 && plog) {
    // ★ 基础力闭合检查：逐关节 纯重力需求 vs gcomp(antiG) 出力
    const body0 = w.body;
    console.log('══ 基础力闭合检查（需求=纯重力矩原始式；antiG=gcomp 出力）══');
    for (const side of ['r', 'l'] as const) {
      const excl = new Set(['thigh', 'shin', 'foot', 'arch', 'mfoot'].map((q) => `${q}_${side}`));
      for (const [jn, ax] of [['hip', 0], ['hip', 2], ['knee', 0], ['knee', 2], ['foot', 0], ['foot', 2]] as Array<[string, number]>) {
        const di = body0.dofByName(`${jn}_${side}`, ax);
        if (di < 0) continue;
        const d0 = body0.dofs[di]!;
        const u = d0.axisWorld, a0 = d0.anchorWorld;
        let tau = 0;
        for (const [kk, bi] of body0.indexByKey.entries()) {
          if (excl.has(kk)) continue;
          const rb = body0.bodies[bi]!;
          const c = rb.worldCom();
          const Fy = rb.mass() * w.world.gravity.y;
          tau += u[0]! * (-(c.z - a0[2]!) * Fy) + u[2]! * ((c.x - a0[0]!) * Fy);
        }
        // 物理重力矩 τ_raw（抗重力应 = −τ_raw）
        const antiG = [...plog!].reverse().find((x) => x[0] === di && x[1] === 'antiG')?.[2] ?? NaN;
        const sc = [...plog!].reverse().find((x) => x[0] === di && x[3]?.startsWith('supportClean') && x[1] === 'torque')?.[2] ?? 0;
        const ten = [...plog!].reverse().find((x) => x[0] === di && x[3] === 'tension')?.[2] ?? 0;
        const want = -tau;   // 抗重力目标
        const dev = d0.angle;   // 相对 ref 的偏差（ref≈0 首帧）
        const dirOK = Math.abs(sc) < 1 || Math.abs(dev) < 0.01 || (sc * dev < 0);
        console.log(`  ${(jn + '_' + side + '/' + ax).padEnd(10)} 角=${(d0.angle * 57.3).toFixed(1).padStart(6)}° 需求=${want.toFixed(1).padStart(7)} 基础=${antiG.toFixed(1).padStart(7)} 差=${(want - antiG).toFixed(1).padStart(7)} 回正=${sc.toFixed(1).padStart(7)} 阻尼=${ten.toFixed(1).padStart(6)}`);
      }
    }
  }
  if (s === 422 && plog) {
    // ★ 2026-10-16 用户："根据脊柱状态进行回读"——脊柱逐轴受力
    console.log('══ 脊柱受力回读（轴0=矢状/轴2=侧向；被动=drive.stiff）══');
    for (const [jn, ax] of [['spine1', 0], ['spine1', 2], ['spine2', 0], ['spine3', 0], ['spine3', 2], ['neck', 0]] as Array<[string, number]>) {
      const di = w.body.dofByName(jn, ax);
      if (di < 0) continue;
      const d0 = w.body.dofs[di]!;
      const antiG = [...plog!].reverse().find((x) => x[0] === di && x[1] === 'antiG')?.[2] ?? NaN;
      const writes = plog!.filter((x) => x[0] === di).map((x) => `${x[3]}=${x[2].toFixed(0)}`).join(' ');
      const bd = w.drive.lastBreakdown[di]!;
      const applied = w.executor.appliedOf(di);
      console.log(`  ${(jn + '/' + ax).padEnd(9)} 角=${(d0.angle * 57.3).toFixed(1).padStart(6)}° 基础=${(Number.isNaN(antiG) ? 0 : antiG).toFixed(1).padStart(6)} 被动=${bd.stiff.toFixed(1).padStart(6)} 实加=${applied.toFixed(1).padStart(6)} | ${writes}`);
    }
  }
  if (s <= 30) {
    const AV = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); if (di < 0) return '--'; const d0 = w.body.dofs[di]!; return `${(d0.angle * 57.3).toFixed(1)}/${d0.vel.toFixed(1)}`; };
    const parts: string[] = [];
    if (plog) {
      const latD = [w.body.dofByName('hip_r', 0), w.body.dofByName('hip_r', 2), w.body.dofByName('knee_r', 0), w.body.dofByName('knee_r', 2), w.body.dofByName('foot_r', 0), w.body.dofByName('foot_r', 2), w.body.dofByName('spine1', 2)];
      const dset = new Set(latD);
      for (const x of plog.slice(plogN0)) if (dset.has(x[0])) parts.push(`${x[3]}=${x[2].toFixed(0)}@${w.body.dofs[x[0]]!.name}/${w.body.dofs[x[0]]!.axis}`);
    }
    console.log(`s${s} pitch=${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)}° 脊[1=${AV('spine1', 2)} 2=${AV('spine2', 2)} 3=${AV('spine3', 2)}] fz=${ctl.sensors.feet[0]!.fz.toFixed(0)}/${ctl.sensors.feet[1]!.fz.toFixed(0)}${parts.length ? ' | ' + parts.join(' ') : ''} headZ=${(w.body.bodies[w.body.indexByKey.get('head')!]!.translation().z * 1000).toFixed(1)}mm chestZ=${(w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().z * 1000).toFixed(1)}mm ax3=${(() => { const di = w.body.dofByName('spine3', 2); const a = w.body.dofs[di]!.axisWorld; return `(${a[0]!.toFixed(2)},${a[1]!.toFixed(2)},${a[2]!.toFixed(2)})`; })()} ax3_0=${(() => { const di = w.body.dofByName('spine3', 0); const a = w.body.dofs[di]!.axisWorld; return `(${a[0]!.toFixed(2)},${a[1]!.toFixed(2)},${a[2]!.toFixed(2)})`; })()}`);
  }
  if (s % 120 === 0) {
    const appOf = (n: string, ax: number): number => { const di = w.body.dofByName(n, ax); return di < 0 ? NaN : w.executor.appliedOf(di); };
    const angOf = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); return di < 0 ? '--' : (w.body.dofs[di]!.angle * 57.3).toFixed(1); };
    const fr = w.body.bodies[w.body.indexByKey.get('foot_r')!]!.translation();
    const fl2 = w.body.bodies[w.body.indexByKey.get('foot_l')!]!.translation();
    console.log(`t=${(s * w.dt).toFixed(2)}s com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)}) roll=${(ctl.sensors.torsoTilt[0]! * 57.3).toFixed(1)}° 足R=(${(fr.x * 1000).toFixed(1)},${(fr.z * 1000).toFixed(1)})mm 足L=(${(fl2.x * 1000).toFixed(1)},${(fl2.z * 1000).toFixed(1)})mm 踝R=${angOf('foot_r', 2)} 踝L=${angOf('foot_l', 2)} fzL=${ctl.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl.sensors.feet[1]!.fz.toFixed(0)}`);
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
console.log(`══ 严格判死：${dead < 0 ? '站住 ✓' : `倒下 @${dead.toFixed(2)}s ✗ ${whyD}`} ══`);
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
