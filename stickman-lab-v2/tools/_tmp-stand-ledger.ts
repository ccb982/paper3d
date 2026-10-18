/** _tmp-stand-ledger.ts —— 站立（双支撑）静态需求账本：给站立基础力组标定用 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { setBaseState } from '../src/core/servo/baseTable';
import { squatCourtSetup, courtInject, courtStep, type CourtState } from '../src/core/court';
import { qAxisAngle, qMul, qOf, qRotateVec } from '../src/core/quat';
import { supportClean } from '../src/core/servo/supportClean';
import { propose, PRI } from '../src/core/proposalBus';

const w = new World();
const ctl = new ControlModule(w, { postureTone: Number(process.env.TONE ?? 8) });
// ★ 蹲下状态（探针）：先姿势（手动瞬移）→ 0.5s 后释放→三层（squat 表）
let sqRel = -1;
let sqCourt: CourtState | null = null;
let msqTeleport: { hq: number; kq: number; fq: number } | null = null;
let msqDone = false;
// ★ 纯直控蹲姿（MSQ=1，用户：'去掉外部受力用直控层写蹲姿势'）：gcomp 关 + 基础力零 + 手动摆姿
if (String(process.env.MSQ ?? '0') === '1') {
  ctl.warner.opt.gravityComp = false;
  process.env.SC_B0_HIP2 = '0'; process.env.SC_B0_KNEE2 = '0'; process.env.SC_B0_FOOT2 = '0';
  process.env.SC_B0_HIP0 = '0'; process.env.SC_B0_KNEE0 = '0'; process.env.SC_B0_FOOT0 = '0';
  process.env.SC_KZ = '0'; process.env.SC_KX = '0'; process.env.SC_KY = '0';
  const hq = Number(process.env.MSQ_H ?? 0.65), kq = Number(process.env.MSQ_K ?? -2.4), fq = Number(process.env.MSQ_F ?? 0);
  w.setGravityZero();   // ★ 用户：'连重力也不要，浮在天上，只要姿势'
  if (String(process.env.MSQ_CORR ?? '0') === '1') { setBaseState('squat'); console.log('MSQ 回正力模式（无手动弹簧——supportClean 持姿）'); }
  ctl.controller = null;   // 关控制模块（无任何受力/写手）
  // 零重力下弹簧直接摆到目标（无重力抵抗——不需要瞬移）
  const h0 = Number(process.env.MSQ_H0 ?? -0.15), k0 = Number(process.env.MSQ_K0 ?? 0), f0 = Number(process.env.MSQ_F0 ?? 0);
  const lean = Number(process.env.MSQ_LEAN ?? 0.75);   // ★ 躯干前倾（用户：躯干-大腿≈45°）
  const useCorr = String(process.env.MSQ_CORR ?? '0') === '1';
  if (lean !== 0 && !useCorr) for (const sg2 of ['spine1', 'spine2', 'spine3'] as const) ctl.manual.setAngle(sg2, 2, -lean / 3, 1500, 60);   // ★ CORR 模式不设脊柱手动（sv=83 的源头！）
  if (!useCorr) for (const sd of ['l', 'r'] as const) {
    const sg = sd === 'l' ? -1 : 1;   // 侧向轴镜像
    ctl.manual.setAngle(`hip_${sd}`, 2, hq, 2000, 80);
    ctl.manual.setAngle(`knee_${sd}`, 2, kq, 2000, 80);
    ctl.manual.setAngle(`foot_${sd}`, 2, fq, 2000, 80);
    if (h0 !== 0) ctl.manual.setAngle(`hip_${sd}`, 0, h0 * sg, 2000, 80);
    if (k0 !== 0) ctl.manual.setAngle(`knee_${sd}`, 0, k0 * sg, 2000, 80);
    if (f0 !== 0) ctl.manual.setAngle(`foot_${sd}`, 0, f0 * sg, 2000, 80);
  }
  // ★ 完整刚体瞬移（用项目 quat 工具；首步后执行——锚点初始化前是零）
  msqTeleport = { hq, kq, fq };
}
if (String(process.env.SQSTATE ?? '0') === '1') {
  for (const sd of ['l', 'r'] as const) {
    ctl.manual.setAngle(`hip_${sd}`, 2, 1.0, 400, 50);
    ctl.manual.setAngle(`knee_${sd}`, 2, -1.0, 400, 50);
    ctl.manual.setAngle(`foot_${sd}`, 2, -0.3, 400, 50);
  }
  sqRel = 400;
}
ctl.actions.idleEnabled = String(process.env.IDLE ?? '0') === '1';   // ★ 默认关（确定性）；IDLE=1 测试空闲
w.controller = ctl;
w.reset();
if (String(process.env.GRAV0 ?? '0') === '1') w.setGravityZero();   // ★ 悬空对比（振动源定位）
const STEPCTX = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const plog = String(process.env.PLOG ?? '0') === '1' ? ((globalThis as { __PROPLOG?: Array<[number, string, number, string]> }).__PROPLOG = []) : null;
let dead = -1, whyD = '';
const fzHist: number[] = [];   // ★ 振动频率分析（fzR−fzL 过零计数）
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
  // ★ 2026-10-16 振动专项：脚速度/踝角高频采样（s 150-400 = 0.6-1.7s 稳态段）
  if (s >= 150 && s <= 400 && s % 10 === 0) {
    const frb = w.body.bodies[w.body.indexByKey.get('foot_r')!]!;
    const flb = w.body.bodies[w.body.indexByKey.get('foot_l')!]!;
    const vr = frb.linvel(), vl = flb.linvel();
    const ar = w.body.dofs[w.body.dofByName('foot_r', 2)]!;
    const al = w.body.dofs[w.body.dofByName('foot_l', 2)]!;
    const tq = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); return di < 0 ? '--' : w.executor.appliedOf(di).toFixed(0); };
    console.log(`V s${s} 脊3=${tq('spine3', 2)} 髋R=${tq('hip_r', 2)} 膝R=${tq('knee_r', 2)} 踝R=${tq('foot_r', 2)} 髋L=${tq('hip_l', 2)} 膝L=${tq('knee_l', 2)} 踝L=${tq('foot_l', 2)} | vR=${Math.hypot(vr.x, vr.y, vr.z).toFixed(1)}mm/s vL=${Math.hypot(vl.x, vl.y, vl.z).toFixed(1)} fzR=${ctl.sensors.feet[1]!.fz.toFixed(0)} fzL=${ctl.sensors.feet[0]!.fz.toFixed(0)}`);
  }
  // ★ 基础力矩测量（s=0：纯静态重力矩——标准姿态下的每轴需求）
  if (s === 0) {
    const gbuf = new Float64Array(w.body.dofs.length);
    w.body.gravityComp(gbuf, -9.81);
    console.log('══ 基础力矩表（标准姿态静态重力矩；gcomp 输出）══');
    for (const jn of ['hip_r', 'hip_l', 'knee_r', 'knee_l', 'foot_r', 'foot_l', 'spine1', 'spine2', 'spine3', 'neck', 'shoulder_l', 'shoulder_r', 'elbow_l', 'elbow_r']) {
      const parts: string[] = [];
      for (const ax of [0, 1, 2]) {
        const di = w.body.dofByName(jn, ax);
        if (di < 0) continue;
        const t = gbuf[di]!;
        if (Math.abs(t) > 0.5) parts.push(`${ax}:${t.toFixed(1)}`);
      }
      if (parts.length) console.log(`BASE ${jn} [${parts.join(' ')}]`);
    }
    console.log(`BASE com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[1]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)})cm`);
  }
  // ★ 脚初始状态（s=0：位置+四元数）
  if (s === 0) {
    for (const fn of ['foot_r', 'foot_l', 'mfoot_r', 'mfoot_l', 'arch_r', 'arch_l', 'arm_l', 'arm_r', 'hand_l', 'hand_r']) {
      const bi = w.body.indexByKey.get(fn);
      if (bi === undefined) continue;
      const rb = w.body.bodies[bi]!;
      const t = rb.translation(); const q = rb.rotation();
      console.log(`F0 ${fn} pos=(${(t.x * 1000).toFixed(1)},${(t.y * 1000).toFixed(1)},${(t.z * 1000).toFixed(1)})mm q=(${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)},${q.w.toFixed(3)})`);
    }
  }
  // ★ 完整关节回读（s=1,5,20：全轴角度+力矩）
  // ★ 精细膝盖轨迹（每5帧）
  if (s <= 60 && s % 5 === 0) {
    const kr = w.body.dofs[w.body.dofByName('knee_r', 2)]!;
    const kl = w.body.dofs[w.body.dofByName('knee_l', 2)]!;
    const hr = w.body.dofs[w.body.dofByName('hip_r', 2)]!;
    const ar = w.body.dofs[w.body.dofByName('foot_r', 2)]!;
    console.log(`K${s} kneeR=${(kr.angle * 57.3).toFixed(1)}°/${kr.vel.toFixed(1)} kneeL=${(kl.angle * 57.3).toFixed(1)}°/${kl.vel.toFixed(1)} hipR=${(hr.angle * 57.3).toFixed(1)}° 踝R=${(ar.angle * 57.3).toFixed(1)}°`);
  }
  if (s === 1 || s === 5 || s === 20) {
    const rows: string[] = [];
    for (const jn of ['hip_r', 'hip_l', 'knee_r', 'knee_l', 'foot_r', 'foot_l', 'spine1', 'spine2', 'spine3', 'neck']) {
      const parts: string[] = [];
      for (const ax of [0, 1, 2]) {
        const di = w.body.dofByName(jn, ax);
        if (di < 0) continue;
        const d0 = w.body.dofs[di]!;
        const tq = w.executor.appliedOf(di);
        if (Math.abs(d0.angle) > 0.01 || Math.abs(tq) > 0.5) parts.push(`${ax}:${(d0.angle * 57.3).toFixed(1)}°/${tq.toFixed(0)}`);
      }
      if (parts.length) rows.push(`${jn}[${parts.join(' ')}]`);
    }
    console.log(`J${s} ${rows.join(' ')}`);
  }
  if (s <= 30) {
    const AV = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); if (di < 0) return '--'; const d0 = w.body.dofs[di]!; return `${(d0.angle * 57.3).toFixed(1)}/${d0.vel.toFixed(1)}`; };
    const parts: string[] = [];
    if (plog) {
      const latD = [w.body.dofByName('hip_r', 0), w.body.dofByName('hip_r', 2), w.body.dofByName('knee_r', 0), w.body.dofByName('knee_r', 2), w.body.dofByName('foot_r', 0), w.body.dofByName('foot_r', 2), w.body.dofByName('spine1', 2), w.body.dofByName('hip_l', 0), w.body.dofByName('knee_l', 0), w.body.dofByName('foot_l', 0), w.body.dofByName('knee_r', 2), w.body.dofByName('knee_l', 2), w.body.dofByName('hip_r', 2), w.body.dofByName('hip_l', 2)];
      const dset = new Set(latD);
      for (const x of plog.slice(plogN0)) if (dset.has(x[0])) parts.push(`${x[3]}=${x[2].toFixed(0)}@${w.body.dofs[x[0]]!.name}/${w.body.dofs[x[0]]!.axis}`);
    }
    {
      const tqB = (jn: string, ax: number): string => {
        const dr = w.body.dofByName(`${jn}_r`, ax), dl = w.body.dofByName(`${jn}_l`, ax);
        const vr = dr < 0 ? '--' : w.executor.appliedOf(dr).toFixed(0);
        const vl = dl < 0 ? '--' : w.executor.appliedOf(dl).toFixed(0);
        return `${jn}${ax}:${vr}/${vl}`;
      };
      console.log(`T${s} ${tqB('hip', 0)} ${tqB('hip', 2)} ${tqB('knee', 0)} ${tqB('knee', 2)} ${tqB('foot', 0)} ${tqB('foot', 2)}`);
    }
    console.log(`s${s} pitch=${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)}° 脊[1=${AV('spine1', 2)} 2=${AV('spine2', 2)} 3=${AV('spine3', 2)}] fz=${ctl.sensors.feet[0]!.fz.toFixed(0)}/${ctl.sensors.feet[1]!.fz.toFixed(0)}${parts.length ? ' | ' + parts.join(' ') : ''} headZ=${(w.body.bodies[w.body.indexByKey.get('head')!]!.translation().z * 1000).toFixed(1)}mm chestZ=${(w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().z * 1000).toFixed(1)}mm ax3=${(() => { const di = w.body.dofByName('spine3', 2); const a = w.body.dofs[di]!.axisWorld; return `(${a[0]!.toFixed(2)},${a[1]!.toFixed(2)},${a[2]!.toFixed(2)})`; })()} ax3_0=${(() => { const di = w.body.dofByName('spine3', 0); const a = w.body.dofs[di]!.axisWorld; return `(${a[0]!.toFixed(2)},${a[1]!.toFixed(2)},${a[2]!.toFixed(2)})`; })()}`);
  }
  if (sqRel > 0 && --sqRel === 0) {
    for (const sd of ['l', 'r'] as const) { ctl.manual.clearAngle(`hip_${sd}`, 2); ctl.manual.clearAngle(`knee_${sd}`, 2); ctl.manual.clearAngle(`foot_${sd}`, 2); }
    setBaseState('squat');
  }
  if (false && msqTeleport !== null && !msqDone && s === 5) {
    msqDone = true;
    const { hq: thq, kq: tkq, fq: tfq } = msqTeleport;
    const tmpV = new Float64Array(3);
    const rotAbout = (b: import('@dimforge/rapier3d-compat').RigidBody, anchor: ArrayLike<number>, axis: ArrayLike<number>, ang: number): void => {
      const q = qAxisAngle(axis[0]!, axis[1]!, axis[2]!, ang);
      const p = b.translation();
      qRotateVec(q, p.x - anchor[0]!, p.y - anchor[1]!, p.z - anchor[2]!, tmpV);
      b.setTranslation({ x: anchor[0]! + tmpV[0]!, y: anchor[1]! + tmpV[1]!, z: anchor[2]! + tmpV[2]! }, true);
      b.setRotation(qMul(q, qOf(b.rotation())), true);
    };
    const axRot = (q: import('../src/core/quat').Quat, a: ArrayLike<number>): number[] => { qRotateVec(q, a[0]!, a[1]!, a[2]!, tmpV); return [tmpV[0]!, tmpV[1]!, tmpV[2]!]; };
    // ① 骨盆（+整腿）先下移——蹲姿腿长几何（髋高≈踝8+小腿43·cos(hip+knee)+大腿43·cos(hip)）
    const legLen = 0.43, shinLen = 0.43, ankleH = 0.08;
    const hipH = ankleH + shinLen * Math.cos(thq + tkq) + legLen * Math.cos(thq);
    const standHip = Number(process.env.MSQ_HIP0 ?? 0.85);
    const drop = Math.max(0, standHip - hipH);
    const rb = w.body.root();
    const t0 = rb.translation();
    rb.setTranslation({ x: t0.x, y: t0.y - drop, z: t0.z }, true);
    for (const sd of ['l', 'r'] as const) {
      const bOf = (k: string): import('@dimforge/rapier3d-compat').RigidBody | null => { const i = w.body.indexByKey.get(k); return i === undefined ? null : w.body.bodies[i]!; };
      for (const k of [`thigh_${sd}`, `shin_${sd}`, `foot_${sd}`]) {
        const b = bOf(k); if (!b) continue;
        const p = b.translation();
        b.setTranslation({ x: p.x, y: p.y - drop, z: p.z }, true);
      }
    }
    // ② 绕移动后的锚点旋转（锚点 y 也 −drop）
    const shiftA = (a: ArrayLike<number>): number[] => [a[0]!, a[1]! - drop, a[2]!];
    for (const sd of ['l', 'r'] as const) {
      const bOf = (k: string): import('@dimforge/rapier3d-compat').RigidBody | null => { const i = w.body.indexByKey.get(k); return i === undefined ? null : w.body.bodies[i]!; };
      const thigh = bOf(`thigh_${sd}`), shin = bOf(`shin_${sd}`), foot = bOf(`foot_${sd}`);
      if (!thigh || !shin || !foot) continue;
      const hipD = w.body.dofByName(`hip_${sd}`, 2), knD = w.body.dofByName(`knee_${sd}`, 2), ftD = w.body.dofByName(`foot_${sd}`, 2);
      const hipA = shiftA(w.body.dofs[hipD]!.anchorWorld), hipAx = w.body.dofs[hipD]!.axisWorld;
      const qH = qAxisAngle(hipAx[0]!, hipAx[1]!, hipAx[2]!, thq);
      for (const b of [thigh, shin, foot]) rotAbout(b, hipA, hipAx, thq);
      const knA = shiftA(w.body.dofs[knD]!.anchorWorld), knAxW = axRot(qH, w.body.dofs[knD]!.axisWorld);
      const qK = qAxisAngle(knAxW[0]!, knAxW[1]!, knAxW[2]!, tkq);
      for (const b of [shin, foot]) rotAbout(b, knA, knAxW, tkq);
      const ftA = shiftA(w.body.dofs[ftD]!.anchorWorld), ftAxW = axRot(qMul(qH, qK), w.body.dofs[ftD]!.axisWorld);
      rotAbout(foot, ftA, ftAxW, tfq);
    }
    console.log(`MSQ teleport done drop=${drop.toFixed(2)}`);
  }
  if (String(process.env.MSQ ?? '0') === '1') {   // ★ 钉住骨盆（零重力下不飘）
    const rb = w.body.root();
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  if (String(process.env.DOFCHK ?? '0') === '1' && s === 5) {
    for (const [n, a] of [['knee_r', 0], ['knee_r', 1], ['knee_r', 2], ['elbow_r', 0], ['elbow_r', 2], ['hip_r', 0]] as Array<[string, number]>) {
      const di = w.body.dofByName(n, a);
      console.log(`DOFCHK ${n}/${a} -> ${di}${di >= 0 ? ` name=${w.body.dofs[di]!.name}/${w.body.dofs[di]!.axis} angle=${(w.body.dofs[di]!.angle * 57.3).toFixed(1)}` : ''}`);
    }
  }
  // ★ 蹲下法庭探针（SQCOURT=1）
  if (String(process.env.SQCOURT ?? '0') === '1') {
    if (s === 120 && sqCourt === null) {
      w.reset();
      const feetBefore = new Map<string, { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }>();
      for (const key of ['foot_l', 'foot_r']) {
        const bi = w.body.indexByKey.get(key);
        if (bi === undefined) continue;
        const rb = w.body.bodies[bi]!;
        const p0 = rb.translation();
        const q0 = rb.rotation();
        feetBefore.set(key, { p: { x: p0.x, y: p0.y, z: p0.z }, q: { x: q0.x, y: q0.y, z: q0.z, w: q0.w } });
      }
      sqCourt = squatCourtSetup(w, ctl, 2.0);
      console.log('SQCOURT setup done');
      for (const key of ['foot_l', 'foot_r']) {
        const bi = w.body.indexByKey.get(key);
        if (bi === undefined) continue;
        const rb = w.body.bodies[bi]!;
        const p1 = rb.translation();
        const q1 = rb.rotation();
        const b = feetBefore.get(key)!;
        const dP = Math.hypot(p1.x - b.p.x, p1.y - b.p.y, p1.z - b.p.z) * 100;
        const dot = Math.abs(q1.x * b.q.x + q1.y * b.q.y + q1.z * b.q.z + q1.w * b.q.w);
        const dAng = 2 * Math.acos(Math.min(1, dot)) * 57.3;
        console.log(`SQC 脚对比 ${key}: 位置差=${dP.toFixed(2)}cm 朝向差=${dAng.toFixed(2)}°`);
        console.log(`    前: (${(b.p.x * 100).toFixed(1)},${(b.p.y * 100).toFixed(1)},${(b.p.z * 100).toFixed(1)}) 后: (${(p1.x * 100).toFixed(1)},${(p1.y * 100).toFixed(1)},${(p1.z * 100).toFixed(1)})`);
      }
      {
        const kn = w.body.dofs[w.body.dofByName('knee_r', 2)]!.anchorWorld;
        const an = w.body.dofs[w.body.dofByName('foot_r', 2)]!.anchorWorld;
        const hp = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld;
        const ftB2 = w.body.bodies[w.body.indexByKey.get('foot_r')!]!;
        const q3 = ftB2.rotation();
        const soleY = -(1 - 2 * (q3.x * q3.x + q3.y * q3.y));
        console.log(`SQC 几何: 髋=(${(hp[0]! * 100).toFixed(0)},${(hp[1]! * 100).toFixed(0)}) 膝=(${(kn[0]! * 100).toFixed(0)},${(kn[1]! * 100).toFixed(0)}) 踝=(${(an[0]! * 100).toFixed(0)},${(an[1]! * 100).toFixed(0)}) soleY=${soleY.toFixed(2)}`);
        // 腰角：大腿方向(髋→膝) vs 躯干方向(脊柱3向上)
        const sp3 = w.body.bodies[w.body.indexByKey.get('spine3')!]!;
        const q4 = sp3.rotation();
        const up3 = [2 * (q4.x * q4.y - q4.w * q4.z), 1 - 2 * (q4.x * q4.x + q4.z * q4.z)];
        const thD = [kn[0]! - hp[0]!, kn[1]! - hp[1]!];
        const tl = Math.hypot(thD[0]!, thD[1]!) || 1;
        const dot = (thD[0]! / tl) * up3[0]! + (thD[1]! / tl) * up3[1]!;
        const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 57.3;
        console.log(`SQC 腰: 躯干-大腿外角=${ang.toFixed(0)}° 内角=${(180 - ang).toFixed(0)}° 躯干倾=${(Math.atan2(up3[0]!, up3[1]!) * 57.3).toFixed(0)}°`);
        {
          let mx = 0, m = 0;
          for (const rb of w.body.bodies) {
            const mm = rb.mass();
            if (mm <= 0) continue;
            mx += rb.translation().x * mm; m += mm;
          }
          const comX = m > 0 ? mx / m : 0;
          const thSlope = Math.atan2(kn[1]! - hp[1]!, kn[0]! - hp[0]!) * 57.3;
          console.log(`SQC CoM: x=${(comX * 100).toFixed(1)}cm（脚踝x=0） 大腿斜率=${thSlope.toFixed(0)}°（0=水平 负=膝低）`);
        }
        const axes9: Array<[string, number]> = [['hip', 0], ['hip', 1], ['hip', 2], ['knee', 0], ['knee', 1], ['knee', 2], ['foot', 0], ['foot', 1], ['foot', 2]];
        const rd = (tag: string): void => {
          const parts: string[] = [];
          for (const [n, ax] of axes9) {
            const di = w.body.dofByName(`${n}_r`, ax);
            if (di < 0) { parts.push(`${n}${ax}=--`); continue; }
            const d0 = w.body.dofs[di]!;
            parts.push(`${n}${ax}=${(d0.angle * 57.3).toFixed(0)}°/${w.executor.appliedOf(di).toFixed(0)}`);
          }
          console.log(`SQC ${tag}: ${parts.join(' ')}`);
        };
        rd('9轴@setup');
        {
          const aJ = w.body.sk.joints.findIndex((x) => x.name === 'foot_r');
          if (aJ >= 0) {
            const pi = w.body.jointBodies[aJ * 2]!;
            const ci = w.body.jointBodies[aJ * 2 + 1]!;
            const j0 = w.body.sk.joints[aJ]!;
            const qp0 = w.body.bodies[pi]!.rotation();
            const qc0 = w.body.bodies[ci]!.rotation();
            console.log(`SQC 踝关节: 父=${j0.parentKey}(b${pi}) 子=${j0.childKey}(b${ci}) rest=(${j0.restRad.map((v) => (v * 57.3).toFixed(1)).join(',')})°`);
            console.log(`SQC 踝q: 父=(${qp0.x.toFixed(3)},${qp0.y.toFixed(3)},${qp0.z.toFixed(3)},${qp0.w.toFixed(3)}) 子=(${qc0.x.toFixed(3)},${qc0.y.toFixed(3)},${qc0.z.toFixed(3)},${qc0.w.toFixed(3)})`);
            const di2 = w.body.dofByName('foot_r', 2);
            if (di2 >= 0) {
              const d2 = w.body.dofs[di2]!;
              console.log(`SQC 踝read: 角=${(d2.angle * 57.3).toFixed(1)}° axisLocal=(${d2.axisLocal.x.toFixed(2)},${d2.axisLocal.y.toFixed(2)},${d2.axisLocal.z.toFixed(2)}) axisWorld=(${d2.axisWorld[0]!.toFixed(2)},${d2.axisWorld[1]!.toFixed(2)},${d2.axisWorld[2]!.toFixed(2)})`);
            }
          }
        }
        {
          const hI = w.body.indexByKey.get('hand_r');
          const sI = w.body.indexByKey.get('arm_r');
          const ht = hI === undefined ? null : w.body.bodies[hI]!.translation();
          const st2 = sI === undefined ? null : w.body.bodies[sI]!.translation();
          if (ht && st2) console.log(`SQC 手: 肩=(${(st2.x * 100).toFixed(0)},${(st2.y * 100).toFixed(0)},${(st2.z * 100).toFixed(0)}) 手=(${(ht.x * 100).toFixed(0)},${(ht.y * 100).toFixed(0)},${(ht.z * 100).toFixed(0)})`);
        }
        {
          const hipJ = w.body.sk.joints.findIndex((x) => x.name === 'hip_l');
          const pi = w.body.jointBodies[hipJ * 2]!;
          const ci = w.body.jointBodies[hipJ * 2 + 1]!;
          const qp0 = w.body.bodies[pi]!.rotation();
          const qc0 = w.body.bodies[ci]!.rotation();
          const j0 = w.body.sk.joints[hipJ]!;
          const qp = { x: qp0.x, y: qp0.y, z: qp0.z, w: qp0.w };
          const qc = { x: qc0.x, y: qc0.y, z: qc0.z, w: qc0.w };
          const qrest = { x: 0, y: 0, z: 0, w: 1 };
          void qrest;
          const qrel = (a: typeof qp, b: typeof qc): typeof qp => {
            const ix = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
            const iy = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
            const iz = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
            const iw = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
            return { x: -ix, y: -iy, z: -iz, w: iw };
          };
          const rel = qrel(qp, qc);
          const ang = 2 * Math.acos(Math.min(1, Math.abs(rel.w)));
          const s2 = Math.sqrt(Math.max(1e-12, 1 - rel.w * rel.w));
          const rv = [rel.x / s2, rel.y / s2, rel.z / s2].map((v) => v * ang);
          console.log(`SQC 髋rel: 角=${(ang * 57.3).toFixed(1)}° rotvec=(${rv.map((v) => (v * 57.3).toFixed(1)).join(',')})° 父=${j0.parentKey} 子=${j0.childKey}`);
          const qr = j0.restRad;
          console.log(`SQC 髋rest: (${qr.map((v) => (v * 57.3).toFixed(1)).join(',')})°`);
        }
        (globalThis as { __sqcRd?: (t: string) => void }).__sqcRd = rd;
      }
    } else if (sqCourt !== null) {
      courtInject(w, ctl);
      w.advance(1);
      courtStep(w, ctl, sqCourt);
      if (sqCourt.t >= 2.017 && sqCourt.t < 2.035) {
        // ★★★ 虚功法测重力矩（用户：'找到正确方法'）：τ = ΔU/Δθ（纯几何，无动力学噪声）
        //   对每个关节：扰动 ±ε 绕锚点转子树 → 势能差 / 2ε = 重力矩
        const bodies = w.body.bodies;
        const g = 9.81;
        const U = (): number => {
          let u = 0;
          for (const rb of bodies) u += rb.mass() * g * rb.translation().y;
          return u;
        };
        const snapshot = (): Array<{ p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }> =>
          bodies.map((rb) => ({ p: { ...rb.translation() }, q: { ...rb.rotation() } }));
        const restore = (snap: Array<{ p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }>): void => {
          for (let i = 0; i < bodies.length; i++) { bodies[i]!.setTranslation(snap[i]!.p, true); bodies[i]!.setRotation(snap[i]!.q, true); }
        };
        const perturb = (di: number, ang: number): void => {
          const d2 = w.body.dofs[di]!;
          const ax2 = d2.axisWorld;
          const av = { x: ax2[0]!, y: ax2[1]!, z: ax2[2]! };
          const a0 = { x: d2.anchorWorld[0]!, y: d2.anchorWorld[1]!, z: d2.anchorWorld[2]! };
          const th = ang / 2;
          const s = Math.sin(th), c = Math.cos(th);
          const qr = { x: av.x * s, y: av.y * s, z: av.z * s, w: c };
          const qmul = (a: typeof qr, b: typeof qr): typeof qr => ({
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
          });
          const rotV = (q: typeof qr, v: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
            const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
            return { x: v.x + q.w * tx + (q.y * tz - q.z * ty), y: v.y + q.w * ty + (q.z * tx - q.x * tz), z: v.z + q.w * tz + (q.x * ty - q.y * tx) };
          };
          // 子树 = 该 dof 的 child 及以下（用 b2 起）
          const sub = new Set<number>();
          const visit = (bi: number): void => {
            if (sub.has(bi)) return;
            sub.add(bi);
            for (const d3 of w.body.dofs) if (d3.b1 === bi) visit(d3.b2);
          };
          visit(w.body.dofs[di]!.b2);
          for (const bi of sub) {
            const rb = bodies[bi];
            if (!rb) continue;
            const p = rb.translation();
            const dp = { x: p.x - a0.x, y: p.y - a0.y, z: p.z - a0.z };
            const dr = rotV(qr, dp);
            rb.setTranslation({ x: a0.x + dr.x, y: a0.y + dr.y, z: a0.z + dr.z }, true);
            rb.setRotation(qmul(qr, rb.rotation() as typeof qr), true);
          }
        };
        const eps = 0.02;
        const lines: string[] = [];
        for (const [nm, ax] of [['hip_r', 0], ['hip_r', 1], ['hip_r', 2], ['knee_r', 0], ['knee_r', 1], ['knee_r', 2], ['foot_r', 0], ['foot_r', 1], ['foot_r', 2]] as Array<[string, number]>) {
          const di = w.body.dofByName(nm, ax);
          if (di < 0) continue;
          const snap0 = snapshot();
          perturb(di, eps);
          const uP = U();
          restore(snap0);
          perturb(di, -eps);
          const uM = U();
          restore(snap0);
          const tauG = (uP - uM) / (2 * eps);
          lines.push(`${nm.replace('_r', '')}${ax}=${tauG.toFixed(0)}`);
        }
        console.log(`SQC 虚功重力矩: ${lines.join(' ')}`);
      }
      if (sqCourt.t >= 2.08 && sqCourt.t < 2.11) {
        const lb = (w as unknown as { drive?: { lastBreakdown?: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }> } }).drive?.lastBreakdown;
        if (lb) {
          const big: string[] = [];
          for (let i = 0; i < w.body.dofs.length; i++) {
            const d2 = w.body.dofs[i]!;
            const bd = lb[i];
            if (!bd) continue;
            const tot = Math.abs(bd.stiff) + Math.abs(bd.act) + Math.abs(bd.servo) + Math.abs(bd.ff) + Math.abs(bd.damp) + Math.abs(bd.itb) + Math.abs(bd.lum);
            if (tot > 30) big.push(`${d2.name}/${d2.axis}[st=${bd.stiff.toFixed(0)}act=${bd.act.toFixed(0)}sv=${bd.servo.toFixed(0)}ff=${bd.ff.toFixed(0)}dp=${bd.damp.toFixed(0)}]`);
          }
          console.log(`SQC 放开后写手(>30): ${big.slice(0, 14).join(' ')}`);
        }
      }
      if (sqCourt.t >= 1.0 && sqCourt.t < 1.01) {
        for (const [nm, ax] of [['hip_r', 2], ['knee_r', 2], ['foot_r', 2], ['hip_r', 0], ['hip_r', 1]] as Array<[string, number]>) {
          const di = w.body.dofByName(nm, ax);
          if (di < 0) continue;
          const d2 = w.body.dofs[di]!;
          console.log(`LIM ${nm}/${ax}: min=${(d2.min * 57.3).toFixed(0)}° max=${(d2.max * 57.3).toFixed(0)}° 角=${(d2.angle * 57.3).toFixed(0)}° 引擎限位=${d2.engineLimited}`);
        }
      }
      if (sqCourt.t >= 1.0 && sqCourt.t < 1.01) {
        let mSum = 0;
        for (const rb of w.body.bodies) mSum += rb.mass();
        console.log(`质量 总=${mSum.toFixed(1)}kg 体重=${(mSum * 9.81).toFixed(0)}N | fzL=${w.body.footNormalForce('l', w.dt).toFixed(0)} fzR=${w.body.footNormalForce('r', w.dt).toFixed(0)}`);
      }
      // ★★★ 全身旋转回读（用户：'现在是全身转了'）：偏航角 + 总角动量(垂直)
      if (sqCourt.t >= 1.95 && sqCourt.t <= 5.0) {
        const stp = Math.round(sqCourt.t * 240);
        if (stp % 60 === 0) {
          const ti = w.body.indexByKey.get('torso')!;
          const tq = w.body.bodies[ti]!.rotation();
          const yaw = Math.atan2(2 * (tq.w * tq.y + tq.x * tq.z), 1 - 2 * (tq.y * tq.y + tq.x * tq.x)) * 57.3;
          let m = 0, cx = 0, cy = 0, cz = 0;
          for (const rb of w.body.bodies) { const c = rb.worldCom(); m += rb.mass(); cx += rb.mass() * c.x; cy += rb.mass() * c.y; cz += rb.mass() * c.z; }
          cx /= m; cy /= m; cz /= m;
          let Ly = 0;
          for (const rb of w.body.bodies) {
            const c = rb.worldCom(); const v = rb.linvel(); const wv = rb.angvel();
            const rx = c.x - cx, rz = c.z - cz;
            Ly += rb.mass() * (rz * v.x - rx * v.z);
            const I = rb.mass() * 0.02;
            Ly += I * wv.y;
          }
          console.log(`SP t=${sqCourt.t.toFixed(2)} 骨盆偏航=${yaw.toFixed(0)}° 总角动量Ly=${Ly.toFixed(2)}kgm2/s`);
        }
      }
      // ★★★ 手臂写手明细（用户：'有什么东西在写，手臂不需要乱写的'）
      if (sqCourt.t >= 2.0 && sqCourt.t <= 2.3) {
        const stp = Math.round(sqCourt.t * 240);
        if (stp % 12 === 0) {
          const g8 = globalThis as { __wdbg?: number };
          if (g8.__wdbg === undefined) g8.__wdbg = 0;
          if (g8.__wdbg < 8) {
            g8.__wdbg++;
            const lb8 = (w as unknown as { drive?: { lastBreakdown?: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }> } }).drive?.lastBreakdown;
            const led8 = (w.executor as unknown as { ledger?: Array<{ cmd: number; applied: number; limit: number; saturated: boolean }> }).ledger;
            const parts: string[] = [];
            for (const [nm, ax] of [['shoulder_r', 1], ['shoulder_r', 2], ['elbow_r', 2]] as Array<[string, number]>) {
              const di = w.body.dofByName(nm, ax);
              if (di < 0) continue;
              const b = lb8?.[di]; const l = led8?.[di];
              parts.push(`${nm.replace('_r', '')}${ax}: ff=${b ? b.ff.toFixed(1) : '-'} dp=${b ? b.damp.toFixed(1) : '-'} st=${b ? b.stiff.toFixed(0) : '-'} sv=${b ? b.servo.toFixed(0) : '-'} act=${b ? b.act.toFixed(0) : '-'} | cmd=${l ? l.cmd.toFixed(1) : '-'} lim=${l ? l.limit.toFixed(1) : '-'} 加=${l ? l.applied.toFixed(1) : '-'}`);
            }
            console.log(`W t=${sqCourt.t.toFixed(2)} ${parts.join(' ‖ ')}`);
          }
        }
      }
      // ★★★ 手臂回读（用户：'手臂也在转'）
      if (sqCourt.t >= 1.95 && sqCourt.t <= 2.6) {
        const stp = Math.round(sqCourt.t * 240);
        if (stp % 12 === 0) {
          const g7 = globalThis as { __adbg?: number };
          if (g7.__adbg === undefined) g7.__adbg = 0;
          if (g7.__adbg < 14) {
            g7.__adbg++;
            const parts: string[] = [];
            for (const [nm, ax] of [['shoulder_r', 0], ['shoulder_r', 1], ['shoulder_r', 2], ['elbow_r', 0], ['elbow_r', 1], ['elbow_r', 2]] as Array<[string, number]>) {
              const di = w.body.dofByName(nm, ax);
              if (di < 0) continue;
              const d2 = w.body.dofs[di]!;
              parts.push(`${nm.replace('_r', '')}${ax}:${(d2.angle * 57.3).toFixed(0)}°v${d2.vel.toFixed(1)}加${w.executor.appliedOf(di).toFixed(0)}`);
            }
            const ai = w.body.indexByKey.get('arm_r')!;
            const av = w.body.bodies[ai]!.angvel();
            console.log(`ARM t=${sqCourt.t.toFixed(2)} ${parts.join(' ')} | 臂角速=${Math.hypot(av.x, av.y, av.z).toFixed(1)}`);
          }
        }
      }
      // ★★★ 头/颈回读（用户：'头部如同螺旋桨一般转'）
      if (sqCourt.t >= 1.95 && sqCourt.t <= 2.6) {
        const stp = Math.round(sqCourt.t * 240);
        if (stp % 12 === 0) {
          const g6 = globalThis as { __hdbg?: number };
          if (g6.__hdbg === undefined) g6.__hdbg = 0;
          if (g6.__hdbg < 16) {
            g6.__hdbg++;
            const parts: string[] = [];
            for (const [nm, ax] of [['neck', 0], ['neck', 1], ['neck', 2]] as Array<[string, number]>) {
              const di = w.body.dofByName(nm, ax);
              if (di < 0) continue;
              const d2 = w.body.dofs[di]!;
              parts.push(`${nm}/${ax}: ${(d2.angle * 57.3).toFixed(0)}° v=${d2.vel.toFixed(1)} 加=${w.executor.appliedOf(di).toFixed(0)}`);
            }
            const hi = w.body.indexByKey.get('head')!;
            const hv = w.body.bodies[hi]!.angvel();
            const hs = Math.hypot(hv.x, hv.y, hv.z);
            console.log(`HD t=${sqCourt.t.toFixed(2)} ${parts.join(' | ')} | 头角速=${hs.toFixed(1)}rad/s`);
          }
        }
      }
      // ★★★ 脚→膝→腰传递链回读（用户：'脚是不是没站住/脚的发力怎么传到膝盖'）
      if (sqCourt.t >= 1.95 && sqCourt.t <= 2.6) {
        const stp = Math.round(sqCourt.t * 240);
        if (stp % 12 === 0) {
          const lb6 = (w as unknown as { drive?: { lastBreakdown?: Array<{ ff: number; damp: number }> } }).drive?.lastBreakdown;
          const app = (n: string, a: number): string => {
            const di = w.body.dofByName(n, a);
            if (di < 0) return '--';
            return w.executor.appliedOf(di).toFixed(0);
          };
          const fxi = w.body.indexByKey.get('foot_r')!;
          const fx = w.body.bodies[fxi]!.translation();
          const fz = w.body.footNormalForce('r', w.dt);
          const gb = new Float64Array(3);
          const okC = w.body.footCoP('r', w.dt, gb);
          const diF = w.body.dofByName('foot_r', 2);
          const vel = diF >= 0 ? w.body.dofs[diF]!.vel.toFixed(1) : '--';
          console.log(`FC t=${sqCourt.t.toFixed(2)} 脚R: x=${(fx.x * 100).toFixed(1)} y=${(fx.y * 100).toFixed(1)}cm fz=${fz.toFixed(0)}N CoP=${okC ? (gb[0]! * 100).toFixed(1) : 'X'} | 踝力=${app('foot_r', 2)}(v${vel}) 膝力=${app('knee_r', 2)} 髋力=${app('hip_r', 2)} 腰力=${app('spine1', 2)}`);
        }
      }
      // ★★★ 上身回读（用户：'回读上身的情况'）：躯干CoM高度/骨盆/胸/头 + 速度，逐 0.05s
      if (sqCourt.t >= 1.95 && sqCourt.t <= 3.0) {
        const stp = Math.round(sqCourt.t * 240);
        if (stp % 12 === 0) {
          const keys = ['torso', 'spine2', 'spine3', 'spine4', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
          let m = 0, y = 0, vy = 0;
          for (const k of keys) {
            const bi = w.body.indexByKey.get(k);
            if (bi === undefined) continue;
            const rb = w.body.bodies[bi]!;
            const c = rb.worldCom();
            const v = rb.linvel();
            m += rb.mass(); y += rb.mass() * c.y; vy += rb.mass() * v.y;
          }
          const yCom = y / m; const vCom = vy / m;
          const posY = (k: string): number => {
            const bi = w.body.indexByKey.get(k);
            return bi === undefined ? NaN : w.body.bodies[bi]!.translation().y;
          };
          console.log(`UB t=${sqCourt.t.toFixed(2)} 上身CoM=${(yCom * 100).toFixed(1)}cm v=${(vCom * 100).toFixed(1)}cm/s | 骨盆=${(posY('torso') * 100).toFixed(0)} 胸=${(posY('spine4') * 100).toFixed(0)} 头=${(posY('head') * 100).toFixed(0)}cm`);
        }
      }
      // ★★★ 全关节受力回读（用户：'回读各个关节的受力'）：2.00/2.08/2.16/2.24 四个瞬间
      if (sqCourt.t >= 1.99 && sqCourt.t <= 2.26) {
        const stp = Math.round(sqCourt.t * 240);
        if ([480, 499, 518, 537].includes(stp)) {
          const lb5 = (w as unknown as { drive?: { lastBreakdown?: Array<{ servo: number; ff: number; damp: number }> } }).drive?.lastBreakdown;
          const rows: string[] = [];
          for (const [nm, ax] of [['hip_l', 2], ['hip_r', 2], ['knee_l', 2], ['knee_r', 2], ['foot_l', 2], ['foot_r', 2], ['spine1', 2], ['spine2', 2], ['spine3', 2]] as Array<[string, number]>) {
            const di = w.body.dofByName(nm, ax);
            if (di < 0) continue;
            const d2 = w.body.dofs[di]!;
            const b = lb5?.[di];
            rows.push(`${nm.replace('_l', 'L').replace('_r', 'R')}=${(d2.angle * 57.3).toFixed(0)}° v${d2.vel.toFixed(1)} ff${b ? b.ff.toFixed(0) : '-'} dp${b ? b.damp.toFixed(0) : '-'} 加${w.executor.appliedOf(di).toFixed(0)}`);
          }
          console.log(`RB t=${sqCourt.t.toFixed(2)} ${rows.join(' ')}`);
        }
      }
      // ★★★ 静态标定（用户：'加基础力'）：放开后用强弹簧撑住姿势→读平衡力矩=基础力真值
      if (String(process.env.SQC_STATIC ?? '0') === '1') {
        const g3 = globalThis as { __staticSet?: boolean };
        if (!g3.__staticSet && sqCourt.t >= 2.0) {
          g3.__staticSet = true;
          for (const nm of ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r', 'spine1', 'spine2', 'spine3']) {
            const di = w.body.dofByName(nm, 2);
            if (di < 0) continue;
            ctl.warner.manual.setAngle(nm, 2, w.body.dofs[di]!.angle, 1200, 120);
          }
          console.log('ST 弹簧已挂（1200/120）');
        }
        if (sqCourt.t >= 3.5 && sqCourt.t < 3.52) {
          const lb4 = (w as unknown as { drive?: { lastBreakdown?: Array<{ servo: number; ff: number; damp: number }> } }).drive?.lastBreakdown;
          const parts: string[] = [];
          for (const nm of ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r', 'spine1', 'spine2', 'spine3']) {
            const di = w.body.dofByName(nm, 2);
            if (di < 0) continue;
            const d2 = w.body.dofs[di]!;
            const b = lb4?.[di];
            parts.push(`${nm}/2: sv=${b ? b.servo.toFixed(0) : '-'} ff=${b ? b.ff.toFixed(0) : '-'} 加=${w.executor.appliedOf(di).toFixed(0)}(角${(d2.angle * 57.3).toFixed(0)}°)`);
          }
          console.log(`ST 平衡: ${parts.join(' ')}`);
        }
      }
      // ★★★ 读数交叉验证（用户：'你是不是全回读错了'）：d.angle vs 独立几何（位置/朝向直算）
      if ((sqCourt.t >= 0.5 && sqCourt.t < 0.55) || (sqCourt.t >= 2.1 && sqCourt.t < 2.15) || (sqCourt.t >= 2.3 && sqCourt.t < 2.35)) {
        const stp = Math.round(sqCourt.t * 240);
        if (stp % 6 === 0) {
          const P = (k: string): { x: number; y: number; z: number } => {
            const bi = w.body.indexByKey.get(k)!;
            const t = w.body.bodies[bi]!.translation();
            return { x: t.x, y: t.y, z: t.z };
          };
          const angOf2 = (v1: { x: number; y: number; z: number }, v2: { x: number; y: number; z: number }): number => {
            const l1 = Math.hypot(v1.x, v1.y, v1.z) || 1, l2 = Math.hypot(v2.x, v2.y, v2.z) || 1;
            const c = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (l1 * l2);
            return Math.acos(Math.max(-1, Math.min(1, c))) * 57.3;
          };
          const hpp = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld;
          const kna = w.body.dofs[w.body.dofByName('knee_r', 2)]!.anchorWorld;
          const ana = w.body.dofs[w.body.dofByName('foot_r', 2)]!.anchorWorld;
          const th = P('thigh_r'), sh = P('shin_r'), ft = P('foot_r'); void th; void sh; void ft;
          const thRod = { x: kna[0]! - hpp[0]!, y: kna[1]! - hpp[1]!, z: kna[2]! - hpp[2]! };
          const shRod = { x: ana[0]! - kna[0]!, y: ana[1]! - kna[1]!, z: ana[2]! - kna[2]! };
          const kneeGeo = angOf2({ x: -thRod.x, y: -thRod.y, z: -thRod.z }, shRod);
          const diK = w.body.dofByName('knee_r', 2), diH = w.body.dofByName('hip_r', 2);
          const kAngle = diK >= 0 ? (w.body.dofs[diK]!.angle * 57.3) : NaN;
          const hAngle = diH >= 0 ? (w.body.dofs[diH]!.angle * 57.3) : NaN;
          console.log(`XC t=${sqCourt.t.toFixed(2)} 膝: d.angle=${kAngle.toFixed(1)}° 几何夹角=${kneeGeo.toFixed(1)}° | 髋: d.angle=${hAngle.toFixed(1)}° | 锚髋=(${(hpp[0]! * 100).toFixed(0)},${(hpp[1]! * 100).toFixed(0)}) 锚膝=(${(kna[0]! * 100).toFixed(0)},${(kna[1]! * 100).toFixed(0)}) 锚踝=(${(ana[0]! * 100).toFixed(0)},${(ana[1]! * 100).toFixed(0)})`);
        }
      }
      // ★★★ 关节运动轨迹（用户：'你就不能回读关节的运动轨迹吗'）：放开后每 0.1s 一行
      if (sqCourt.t >= 1.9 && sqCourt.t <= 5.0) {
        const stp = Math.round(sqCourt.t * 240);
        if (stp % 24 === 0) {
          const ang = (n: string, a: number): string => {
            const di = w.body.dofByName(n, a);
            return di < 0 ? '--' : (w.body.dofs[di]!.angle * 57.3).toFixed(0);
          };
          console.log(`轨 t=${sqCourt.t.toFixed(1)} 髋L=${ang('hip_l', 2)} 膝L=${ang('knee_l', 2)} 踝L=${ang('foot_l', 2)} | 髋R=${ang('hip_r', 2)} 膝R=${ang('knee_r', 2)} 踝R=${ang('foot_r', 2)} | 腰1=${ang('spine1', 2)} 腰2=${ang('spine2', 2)} 腰3=${ang('spine3', 2)} 颈=${ang('neck', 2)}`);
        }
      }
      // ★★★ 解除冻结瞬间全轴基础力快照（用户：'解除冻结的时候基础力到底多大'）
      if ((sqCourt.t >= 2.0 && sqCourt.t < 2.06) || (sqCourt.t >= 2.18 && sqCourt.t < 2.20)) {
        const lb3 = (w as unknown as { drive?: { lastBreakdown?: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }>; outputScale?: number } }).drive;
        const led3 = (w.executor as unknown as { ledger?: Array<{ cmd: number; applied: number; limit: number; saturated: boolean }> }).ledger;
        const parts: string[] = [];
        for (let i = 0; i < w.body.dofs.length; i++) {
          const d2 = w.body.dofs[i]!;
          const b = lb3?.lastBreakdown?.[i];
          if (!b || Math.abs(b.ff) < 0.5) continue;
          parts.push(`${d2.name}/${d2.axis}=${b.ff.toFixed(0)}`);
        }
        const dH2 = w.body.dofByName('hip_r', 2);
        const lH2 = led3?.[dH2];
        console.log(`FF t=${sqCourt.t.toFixed(3)} outScale=${(lb3?.outputScale ?? -1).toFixed(2)} | ${parts.join(' ')} | 髋实加=${lH2 ? lH2.applied.toFixed(0) : '-'}`);
      }
      // ★★ 髋回读（用户：'髋部是最核心的'）：放开窗口逐 0.05s——角/速/通道分解/账本
      if (sqCourt.t >= 1.98 && sqCourt.t <= 4.2) {
        const stp = Math.round(sqCourt.t * 240);
        if (stp % 12 === 0) {
          const lb2 = (w as unknown as { drive?: { lastBreakdown?: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }> } }).drive?.lastBreakdown;
          const led2 = (w.executor as unknown as { ledger?: Array<{ cmd: number; applied: number; limit: number; saturated: boolean }> }).ledger;
          const parts: string[] = [];
          for (const [nm, ax] of [['hip_r', 2], ['knee_r', 2], ['foot_r', 2]] as Array<[string, number]>) {
            const di = w.body.dofByName(nm, ax);
            if (di < 0) continue;
            const d2 = w.body.dofs[di]!;
            const b = lb2?.[di]; const l = led2?.[di];
            parts.push(`${nm.replace('_r', '')}: 角=${(d2.angle * 57.3).toFixed(0)}° 速=${d2.vel.toFixed(2)} ff=${b ? b.ff.toFixed(0) : '-'} dp=${b ? b.damp.toFixed(0) : '-'} st=${b ? b.stiff.toFixed(0) : '-'} | 加=${l ? l.applied.toFixed(0) : '-'} lim=${l ? l.limit.toFixed(0) : '-'} sat=${l ? l.saturated : '-'}`);
          }
          console.log(`H t=${sqCourt.t.toFixed(2)} ${parts.join(' ‖ ')}`);
        }
      }
      if (sqCourt.t >= 0.5 && sqCourt.t < 0.52) {
        const diH = w.body.dofByName('hip_r', 2);
        if (diH >= 0) {
          const dH = w.body.dofs[diH]!;
          const led = (w.executor as unknown as { ledger?: Array<{ cmd: number; applied: number; passive: number; limit: number; saturated: boolean }> }).ledger?.[diH];
          console.log(`SQC hip链: 角=${(dH.angle * 57.3).toFixed(0)}° tauMax=${(dH.tauMax ?? 0).toFixed(0)} | ${led ? `cmd=${led.cmd.toFixed(0)} applied=${led.applied.toFixed(0)} passive=${led.passive.toFixed(0)} limit=${led.limit.toFixed(0)} sat=${led.saturated}` : 'ledger无'}`);
        }
        const kn = w.body.dofs[w.body.dofByName('knee_r', 2)]!.anchorWorld;
        const an = w.body.dofs[w.body.dofByName('foot_r', 2)]!.anchorWorld;
        const hp = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld;
        {
          const hd = w.body.bodies[w.body.indexByKey.get('head')!]!.translation();
          const s4i = w.body.indexByKey.get('spine4')!;
          const s4 = w.body.bodies[s4i]!;
          const s4p = s4.translation();
          const q4 = s4.rotation();
          const upx = 2 * (q4.x * q4.y - q4.w * q4.z), upy = 1 - 2 * (q4.x * q4.x + q4.z * q4.z);
          console.log(`SQC 几何t0.5: 髋=(${(hp[0]! * 100).toFixed(0)},${(hp[1]! * 100).toFixed(0)}) 膝=(${(kn[0]! * 100).toFixed(0)},${(kn[1]! * 100).toFixed(0)}) 踝=(${(an[0]! * 100).toFixed(0)},${(an[1]! * 100).toFixed(0)}) 头=(${(hd.x * 100).toFixed(0)},${(hd.y * 100).toFixed(0)}) 脊4=(${(s4p.x * 100).toFixed(0)},${(s4p.y * 100).toFixed(0)}) 脊4up=(${upx.toFixed(2)},${upy.toFixed(2)})`);
        }
      }
      if (sqCourt.t >= 0.5 && sqCourt.t < 0.56) (globalThis as { __sqcRd?: (t: string) => void }).__sqcRd?.('9轴@t0.5s');
      if (sqCourt.t >= 0.5 && sqCourt.t < 0.52) {
        const exec = w.executor as unknown as { lastBreakdown?: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }> };
        const lb = (w as unknown as { drive?: { lastBreakdown?: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }> } }).drive?.lastBreakdown;
        if (lb) {
          for (const [nm, ax] of [['hip_r', 2], ['knee_r', 2], ['foot_r', 2]] as Array<[string, number]>) {
            const di = w.body.dofByName(nm, ax);
            if (di < 0) { console.log(`SQC 写手 ${nm}/${ax}: dof缺`); continue; }
            const bd = lb[di];
            if (bd) console.log(`SQC 写手 ${nm}/${ax}(dof${di}): stiff=${bd.stiff.toFixed(0)} itb=${bd.itb.toFixed(0)} lum=${bd.lum.toFixed(0)} act=${bd.act.toFixed(0)} servo=${bd.servo.toFixed(0)} ff=${bd.ff.toFixed(0)} damp=${bd.damp.toFixed(0)}`);
            else console.log(`SQC 写手 ${nm}/${ax}(dof${di}): 无bd`);
          }
        }
      }
      {
        const g = globalThis as { __sqcPrev?: Float64Array; __sqcJit?: Map<string, number> };
        if (g.__sqcPrev === undefined) g.__sqcPrev = new Float64Array(w.body.dofs.length);
        if (g.__sqcJit === undefined) g.__sqcJit = new Map();
        if (sqCourt.t <= 2.0) {
          for (let i = 0; i < w.body.dofs.length; i++) {
            const d2 = w.body.dofs[i]!;
            const dlt = Math.abs(d2.angle - g.__sqcPrev[i]!);
            if (dlt > 0.02) {
              const key = `${d2.name}/${d2.axis}`;
              g.__sqcJit.set(key, (g.__sqcJit.get(key) ?? 0) + dlt);
            }
            g.__sqcPrev[i] = d2.angle;
          }
        } else if (sqCourt.t >= 2.0 && sqCourt.t < 2.05) {
          const top = [...g.__sqcJit.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
          console.log(`SQC 抖动Top10（静置期累计|Δ角|）: ${top.map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' ')}`);
          g.__sqcJit = new Map();
        } else if (sqCourt.t > 2.05 && sqCourt.t <= 2.5) {
          for (let i = 0; i < w.body.dofs.length; i++) {
            const d2 = w.body.dofs[i]!;
            const dlt = Math.abs(d2.angle - g.__sqcPrev[i]!);
            if (dlt > 0.02) {
              const key = `${d2.name}/${d2.axis}`;
              g.__sqcJit.set(key, (g.__sqcJit.get(key) ?? 0) + dlt);
            }
            g.__sqcPrev[i] = d2.angle;
          }
        } else if (sqCourt.t > 2.5 && sqCourt.t < 2.55) {
          const top = [...g.__sqcJit.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
          console.log(`SQC 抖动Top10（放开后0.5s累计|Δ角|）: ${top.map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' ')}`);
        }
      }
      if (sqCourt.t < 2.1 && sqCourt.t > 2.0) {
        for (const d2 of w.body.dofs) {
          const tq = w.executor.appliedOf(w.body.dofs.indexOf(d2));
          if (Math.abs(tq) > 40) console.log(`SQC 猛推: ${d2.name}/${d2.axis} 实加=${tq.toFixed(0)} 角=${(d2.angle * 57.3).toFixed(1)}° t=${sqCourt.t.toFixed(2)}`);
        }
      }
      if (sqCourt.t < 2.15 && sqCourt.t > 2.02) {
        for (const rb of w.body.bodies) {
          const lv = rb.linvel();
          const av = rb.angvel();
          const sp = Math.hypot(lv.x, lv.y, lv.z);
          const asp = Math.hypot(av.x, av.y, av.z);
          if (sp > 0.5 || asp > 2) {
            const bkey = w.body.keyByIndex?.get(w.body.bodies.indexOf(rb)) ?? String(w.body.bodies.indexOf(rb));
            console.log(`SQC 飞: ${bkey} 线速=${sp.toFixed(1)}m/s 角速=${asp.toFixed(1)}rad/s t=${sqCourt.t.toFixed(2)}`);
          }
        }
      }
      {
        const last = (globalThis as { __sqcFt?: number }).__sqcFt ?? -1;
        if (sqCourt.t - last >= 0.2) {
          (globalThis as { __sqcFt?: number }).__sqcFt = sqCourt.t;
          const ftLine: string[] = [];
          for (const key of ['foot_l', 'foot_r']) {
            const bi = w.body.indexByKey.get(key);
            if (bi === undefined) continue;
            const rb = w.body.bodies[bi]!;
            const p1 = rb.translation();
            const q1 = rb.rotation();
            const upY = 1 - 2 * (q1.x * q1.x + q1.z * q1.z);
            ftLine.push(`${key}: y=${(p1.y * 100).toFixed(1)}cm up_y=${upY.toFixed(2)}`);
          }
          console.log(`SQC 过程 t=${sqCourt.t.toFixed(1)}s ${ftLine.join(' | ')}`);
        }
      }
      if (sqCourt.fall >= 0) {
        console.log(`SQCOURT 判死：倒下 @${sqCourt.fall.toFixed(2)}s (${sqCourt.reason})`);
        process.exit(0);
      }
      if (sqCourt.t > 12) {
        console.log(`SQCOURT 判死：站住 ✓ 12s 存活 (peakRoll=${(sqCourt.peakRoll * 57.3).toFixed(1)}° peakPitch=${(sqCourt.peakPitch * 57.3).toFixed(1)}°)`);
        process.exit(0);
      }
    }
  }
  fzHist.push(ctl.sensors.feet[1]!.fz - ctl.sensors.feet[0]!.fz);
  // ★ 手势精细 trace（G2：肘角+速度+手高度）
  if (String(process.env.GESTURE ?? '0') === '1' && s >= 2400 && s <= 3100 && s % 10 === 0) {
    const ei = w.body.dofByName('elbow_r', 2);
    const e0 = ei < 0 ? null : w.body.dofs[ei]!;
    const hI = w.body.indexByKey.get('hand_r');
    const hy = hI === undefined ? 0 : w.body.bodies[hI]!.translation().y * 100;
    console.log(`G2 s${s} 肘R=${e0 ? (e0.angle * 57.3).toFixed(0) : '--'}° vel=${e0 ? e0.vel.toFixed(1) : '--'} 手R_y=${hy.toFixed(0)}cm`);
  }
  if (String(process.env.IDLE ?? '0') === '1' && s % 240 === 0) {
    const st = ctl.actions.status;
    console.log(`IDLE s${s} enabled=${ctl.actions.idleEnabled} active=${st.active} id=${st.id ?? '-'} wait=${((ctl.actions as unknown as { idleWait: number }).idleWait).toFixed(1)} next=${((ctl.actions as unknown as { nextIdle: number }).nextIdle).toFixed(1)}`);
  }
  // ★ 手臂惯量回读（ARM_INERTIA=1）
  if (String(process.env.ARM_INERTIA ?? '0') === '1' && s === 60) {
    {
      const eR2 = w.body.dofByName('elbow_r', 2), eL2 = w.body.dofByName('elbow_l', 2);
      const axR = eR2 < 0 ? null : w.body.dofs[eR2]!.axisWorld;
      const axL = eL2 < 0 ? null : w.body.dofs[eL2]!.axisWorld;
      const shR = w.body.dofByName('shoulder_r', 0), shL = w.body.dofByName('shoulder_l', 0);
      const aR = shR < 0 ? null : w.body.dofs[shR]!.anchorWorld;
      const aL = shL < 0 ? null : w.body.dofs[shL]!.anchorWorld;
      console.log(`II2 肘轴R=(${axR ? axR.map((v) => v.toFixed(2)).join(',') : '--'}) 肘轴L=(${axL ? axL.map((v) => v.toFixed(2)).join(',') : '--'})`);
      console.log(`II2 肩锚R=(${aR ? aR.map((v) => (v * 100).toFixed(1)).join(',') : '--'}) 肩锚L=(${aL ? aL.map((v) => (v * 100).toFixed(1)).join(',') : '--'})`);
      const eAR = eR2 < 0 ? null : w.body.dofs[eR2]!.anchorWorld;
      const eAL = eL2 < 0 ? null : w.body.dofs[eL2]!.anchorWorld;
      const hR2 = w.body.indexByKey.get('hand_r'), hL2 = w.body.indexByKey.get('hand_l');
      const hRp = hR2 === undefined ? null : w.body.bodies[hR2]!.translation();
      const hLp = hL2 === undefined ? null : w.body.bodies[hL2]!.translation();
      console.log(`II2 肘锚R=(${eAR ? eAR.map((v) => (v * 100).toFixed(1)).join(',') : '--'}) 肘锚L=(${eAL ? eAL.map((v) => (v * 100).toFixed(1)).join(',') : '--'})`);
      console.log(`II2 手R心=(${hRp ? (hRp.x * 100).toFixed(1) + ',' + (hRp.y * 100).toFixed(1) + ',' + (hRp.z * 100).toFixed(1) : '--'}) 手L心=(${hLp ? (hLp.x * 100).toFixed(1) + ',' + (hLp.y * 100).toFixed(1) + ',' + (hLp.z * 100).toFixed(1) : '--'})`);
    }
    for (const [n, ax] of [['shoulder_r', 0], ['shoulder_r', 1], ['shoulder_r', 2], ['elbow_r', 2]] as Array<[string, number]>) {
      const di = w.body.dofByName(n, ax);
      if (di < 0) { console.log(`II ${n}/${ax} --`); continue; }
      const d = w.body.dofs[di]!;
      const Bmax = 0.8 * Math.max(1e-9, d.inertiaLow) / (1 / 480);
      console.log(`II ${n}/${ax} I=${d.inertia.toExponential(2)} Ilow=${d.inertiaLow.toExponential(2)} tauMax=${d.tauMax} 限=[${d.min.toFixed(2)},${d.max.toFixed(2)}] Bmax=${Bmax.toFixed(2)}`);
    }
  }
  // ★ 手动空闲动作追踪（PART=摸头：s=120 触发，逐帧手位置+关节角+速度）
  if (String(process.env.PART ?? '') !== '' && s === 120) {
    ctl.actions.playPart(String(process.env.PART));
  if (String(process.env.SQTRISE ?? '0') === '1' && s === 120) ctl.actions.play('squatRise');
    console.log(`PART play=${process.env.PART}`);
  }
  if (String(process.env.PART ?? '') !== '' && s >= 120 && s <= 3300 && s % 30 === 0) {
    const ag = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); return di < 0 ? '--' : `${(w.body.dofs[di]!.angle * 57.3).toFixed(0)}°/${w.body.dofs[di]!.vel.toFixed(1)}`; };
    const hI = w.body.indexByKey.get('hand_r');
    const t = hI === undefined ? null : w.body.bodies[hI]!.translation();
    const hdI = w.body.indexByKey.get('head');
    const hd = hdI === undefined ? null : w.body.bodies[hdI]!.translation();
    const eB = w.body.indexByKey.get('arm_r');
    const eb = eB === undefined ? null : w.body.bodies[eB]!.translation();
    const eL = w.body.indexByKey.get('arm_l');
    const elb = eL === undefined ? null : w.body.bodies[eL]!.translation();
    const hL = w.body.indexByKey.get('hand_l');
    const hlb = hL === undefined ? null : w.body.bodies[hL]!.translation();
    const st = ctl.actions.status;
    const eI = w.body.dofByName('elbow_r', 2);
    const ap = eI < 0 ? '--' : w.executor.appliedOf(eI).toFixed(0);
    const sh1 = (() => { const di = w.body.dofByName('shoulder_r', 1); if (di < 0) return '--'; const dr = ctl.warner.drive as unknown as { target: Float64Array; kp: Float64Array }; const mn = ctl.manual as unknown as { angle: Float64Array; kp: Float64Array }; return `${(w.body.dofs[di]!.angle * 57.3).toFixed(0)}° has=${ctl.manual.hasAngle(di)} mAng=${Number.isNaN(mn.angle[di]!) ? 'NaN' : mn.angle[di]!.toFixed(2)} mKp=${mn.kp[di]!.toFixed(0)} tgt=${dr.target[di]!.toFixed(2)} kp=${dr.kp[di]!.toFixed(0)}`; })();
    const axE = (() => { const di = w.body.dofByName('elbow_r', 2); if (di < 0) return '--'; const a = w.body.dofs[di]!.axisWorld; return `(${a[0]!.toFixed(2)},${a[1]!.toFixed(2)},${a[2]!.toFixed(2)})`; })();
    const axS0 = (() => { const di = w.body.dofByName('shoulder_r', 0); if (di < 0) return '--'; const a = w.body.dofs[di]!.axisWorld; const dr = ctl.warner.drive as unknown as { target: Float64Array; kp: Float64Array }; return `ax=(${a[0]!.toFixed(2)},${a[1]!.toFixed(2)},${a[2]!.toFixed(2)}) tq=${w.executor.appliedOf(di).toFixed(0)} tgt=${dr.target[di]!.toFixed(2)} kp=${dr.kp[di]!.toFixed(0)}`; })();
    const eL2 = (() => { const di = w.body.dofByName('elbow_l', 2); if (di < 0) return '--'; const d = w.body.dofs[di]!; return `${(d.angle * 57.3).toFixed(0)}° 限[${(d.min * 57.3).toFixed(0)},${(d.max * 57.3).toFixed(0)}]`; })();
    const shL = (() => { const a0 = w.body.dofByName('shoulder_l', 0), a1 = w.body.dofByName('shoulder_l', 1), a2 = w.body.dofByName('shoulder_l', 2); const g = (di: number): string => di < 0 ? '--' : (w.body.dofs[di]!.angle * 57.3).toFixed(0); return `${g(a0)}/${g(a1)}/${g(a2)}`; })();
    const eAR2 = (() => { const di = w.body.dofByName('elbow_r', 2); if (di < 0) return '--'; const a = w.body.dofs[di]!.anchorWorld; return `(${(a[0]! * 100).toFixed(0)},${(a[1]! * 100).toFixed(0)},${(a[2]! * 100).toFixed(0)})`; })();
    const eAL2 = (() => { const di = w.body.dofByName('elbow_l', 2); if (di < 0) return '--'; const a = w.body.dofs[di]!.anchorWorld; return `(${(a[0]! * 100).toFixed(0)},${(a[1]! * 100).toFixed(0)},${(a[2]! * 100).toFixed(0)})`; })();
    const legs = (() => { const g = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); return di < 0 ? '--' : (w.body.dofs[di]!.angle * 57.3).toFixed(0); };
      const hax = w.body.dofs[w.body.dofByName('hip_r', 2)]!.axisWorld;
      const kax = w.body.dofs[w.body.dofByName('knee_r', 2)]!.axisWorld;
      const spineAx = ['spine1', 'spine2', 'spine3', 'neck'].flatMap((jn4) => [0, 2].map((ax4) => {
        const di4 = w.body.dofByName(jn4, ax4);
        if (di4 < 0) return `${jn4}${ax4}=--`;
        const bd4 = ctl.warner.drive.lastBreakdown[di4];
        return `${jn4}/${ax4}=${(w.body.dofs[di4]!.angle * 57.3).toFixed(0)}°[st${bd4 ? bd4.stiff.toFixed(0) : '--'} ac${bd4 ? bd4.act.toFixed(0) : '--'} sv${bd4 ? bd4.servo.toFixed(0) : '--'} ff${bd4 ? bd4.ff.toFixed(0) : '--'} dp${bd4 ? bd4.damp.toFixed(0) : '--'} lum${bd4 ? bd4.lum.toFixed(0) : '--'} itb${bd4 ? bd4.itb.toFixed(0) : '--'}]`;
      })).join(' ');
      const allAx = ['hip', 'knee', 'foot'].flatMap((jn3) => [0, 1, 2].map((ax3) => {
        const di3 = w.body.dofByName(`${jn3}_r`, ax3);
        if (di3 < 0) return `${jn3}${ax3}=--`;
        const bd3 = ctl.warner.drive.lastBreakdown[di3];
        const dev3 = (w.body.dofs[di3]!.angle * 57.3).toFixed(0);
        const tq3 = w.executor.appliedOf(di3).toFixed(0);
        const ff3 = bd3 ? bd3.ff.toFixed(0) : '--';
        return `${jn3}${ax3}=${dev3}°/ff${ff3}`;
        void tq3;
      })).join(' ');
      const kn = w.body.dofs[w.body.dofByName('knee_r', 2)]!.anchorWorld;
      const ftB = (() => { const i = w.body.indexByKey.get('foot_r'); return i === undefined ? null : w.body.bodies[i]!; })();
      let soleTxt = '--';
      if (ftB) { const q = ftB.rotation(); const sy = 2 * (q.y * q.z + q.w * q.x); soleTxt = `soleY=${(-(1 - 2 * (q.x * q.x + q.y * q.y))).toFixed(2)}`; void sy; }
      const ft = w.body.dofs[w.body.dofByName('foot_r', 2)]!.anchorWorld;
      const torsoB = w.body.bodies[w.body.indexByKey.get('spine3') ?? w.body.indexByKey.get('torso') ?? 0]!;   // ★ 上身（脊柱3）不是骨盆
      const tq2 = torsoB.rotation();
      const upv = [2 * (tq2.x * tq2.y - tq2.w * tq2.z), 1 - 2 * (tq2.x * tq2.x + tq2.z * tq2.z), 2 * (tq2.y * tq2.z + tq2.w * tq2.x)];
      const torsoPitch = Math.atan2(upv[0]!, upv[1]!) * 57.3;
      const hipP2 = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld;
      const thighD = [kn[0]! - hipP2[0]!, kn[1]! - hipP2[1]!, kn[2]! - hipP2[2]!];
      const tl = Math.hypot(thighD[0]!, thighD[1]!, thighD[2]!) || 1;
      const cosA = (thighD[0]! / tl) * upv[0]! + (thighD[1]! / tl) * upv[1]! + (thighD[2]! / tl) * upv[2]!;
      const angTT = Math.acos(Math.max(-1, Math.min(1, cosA))) * 57.3;
      return `上身[${spineAx}] 腿全轴[${allAx}] 躯干倾=${torsoPitch.toFixed(0)}° 躯干-大腿夹角=${angTT.toFixed(0)}° 髋R=${g('hip_r', 2)}° 膝R=${g('knee_r', 2)}° 踝R=${g('foot_r', 2)}° 髋轴=(${hax[0]!.toFixed(2)},${hax[1]!.toFixed(2)},${hax[2]!.toFixed(2)}) 膝轴=(${kax[0]!.toFixed(2)},${kax[1]!.toFixed(2)},${kax[2]!.toFixed(2)}) 膝锚=(${(kn[0]! * 100).toFixed(0)},${(kn[1]! * 100).toFixed(0)},${(kn[2]! * 100).toFixed(0)}) 踝锚=(${(ft[0]! * 100).toFixed(0)},${(ft[1]! * 100).toFixed(0)},${(ft[2]! * 100).toFixed(0)}) ${soleTxt}`; })();

    console.log(`PT s${s} ${legs} 肘锚R=${eAR2} 肘锚L=${eAL2} 肩L=${shL} 肘L回读=${eL2} 肩1=${sh1} 肘轴=${axE} ax肩0=${axS0} act=${st.active ? st.id : '-'} 肩0=${ag('shoulder_r', 0)} 肩2=${ag('shoulder_r', 2)} 肘=${ag('elbow_r', 2)} tq=${ap} 肘部=(${eb ? (eb.x * 100).toFixed(0) : '--'},${eb ? (eb.y * 100).toFixed(0) : '--'},${eb ? (eb.z * 100).toFixed(0) : '--'}) 手=(${t ? (t.x * 100).toFixed(0) : '--'},${t ? (t.y * 100).toFixed(0) : '--'},${t ? (t.z * 100).toFixed(0) : '--'}) 肘L=(${elb ? (elb.x * 100).toFixed(0) : '--'},${elb ? (elb.y * 100).toFixed(0) : '--'},${elb ? (elb.z * 100).toFixed(0) : '--'}) 手L=(${hlb ? (hlb.x * 100).toFixed(0) : '--'},${hlb ? (hlb.y * 100).toFixed(0) : '--'},${hlb ? (hlb.z * 100).toFixed(0) : '--'}) 头=(${hd ? (hd.x * 100).toFixed(0) : '--'},${hd ? (hd.y * 100).toFixed(0) : '--'},${hd ? (hd.z * 100).toFixed(0) : '--'})`);
  }
  // ★ 手势轨迹回读（GESTURE=1）
  if (String(process.env.GESTURE ?? '0') === '1' && s >= 120 && s % 30 === 0) {
    const ag = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); return di < 0 ? '--' : (w.body.dofs[di]!.angle * 57.3).toFixed(0); };
    const hI = w.body.indexByKey.get('hand_l');
    const hy = hI === undefined ? '--' : (w.body.bodies[hI]!.translation().y * 100).toFixed(0);
    const hyR = (() => { const i = w.body.indexByKey.get('hand_r'); return i === undefined ? '--' : (w.body.bodies[i]!.translation().y * 100).toFixed(0); })();
    console.log(`G s${s} 肩L0=${ag('shoulder_l', 0)}° 肩L2=${ag('shoulder_l', 2)}° 肘L=${ag('elbow_l', 2)}° 手L_y=${hy}cm | 肩R0=${ag('shoulder_r', 0)}° 肘R=${ag('elbow_r', 2)}° 手R_y=${hyR}cm`);
  }
  // ★ 手势标定（GESTCAL=1：扫肩0/肩2/肘组合，看手位置）
  if (String(process.env.GESTCAL ?? '0') === '1' && s === 60) {
    const hI = w.body.indexByKey.get('hand_r');
    const hp = (): string => {
      if (hI === undefined) return '--';
      const t = w.body.bodies[hI]!.translation();
      return `(${(t.x * 100).toFixed(0)},${(t.y * 100).toFixed(0)},${(t.z * 100).toFixed(0)})`;
    };
    const clearAll = (): void => { for (const jn2 of ['shoulder_r', 'elbow_r']) for (const a of [0, 1, 2]) ctl.manual.clearAngle(jn2, a); };
    const setAll = (s0: number, s2: number, el: number): void => {
      clearAll();
      ctl.manual.setAngle('shoulder_r', 0, s0, 300, 15);
      ctl.manual.setAngle('shoulder_r', 2, s2, 300, 15);
      ctl.manual.setAngle('elbow_r', 2, el, 300, 15);
    };
    console.log(`GC base 手=${hp()}cm`);
    // ★ 蹲底测量（SQUAT=1）：手动摆蹲姿→回读维持力矩
  if (String(process.env.SQUAT ?? '0') === '1' && s === 60) {
    const setLeg = (hip: number, knee: number, foot: number): void => {
      for (const sd of ['l', 'r'] as const) {
        ctl.manual.setAngle(`hip_${sd}`, 2, hip, 300, 20);
        ctl.manual.setAngle(`knee_${sd}`, 2, knee, 300, 20);
        ctl.manual.setAngle(`foot_${sd}`, 2, foot, 300, 20);
      }
    };
    console.log('SQ start');
    for (const [hip, knee, foot] of [[1.8, -2.3, -0.5], [2.0, -2.4, -0.5], [1.7, -2.2, -0.45]] as Array<[number, number, number]>) {
      setLeg(hip, knee, foot);
      for (let k2 = 0; k2 < 200; k2++) { setLeg(hip, knee, foot); w.advance(1); }
      const hd2 = w.body.indexByKey.get('head');
      const hy2 = hd2 === undefined ? 0 : w.body.bodies[hd2]!.translation().y * 100;
      const tq2 = (n: string, ax: number): string => {
        const di = w.body.dofByName(`${n}_r`, ax); return di < 0 ? '--' : w.executor.appliedOf(di).toFixed(0);
      };
      console.log(`SQ hip=${hip} knee=${knee} foot=${foot} head=${hy2.toFixed(0)}cm tq[hip=${tq2('hip', 2)} knee=${tq2('knee', 2)} foot=${tq2('foot', 2)}]`);
    }
    for (const sd of ['l', 'r'] as const) for (const [n2, ax2] of [['hip', 2], ['knee', 2], ['foot', 2]] as Array<[string, number]>) ctl.manual.clearAngle(`${n2}_${sd}`, ax2);
  }
  // ★ 可达性网格（用户：'查自由度'）：肩三轴×肘——找"手到后脑勺"（x<5, y145-170, |z|<15）
    const hits: string[] = [];
    const best: string[] = [];
    for (const s0 of [-1.0, -1.4, -1.8, -2.2, -2.6]) for (const s1 of [-2.4, -1.8, -1.2, -0.6, 0, 0.6]) for (const s2 of [-1.6, -0.8, 0, 0.8, 1.6]) for (const el of [2.0, 2.4]) {
      clearAll();
      ctl.manual.setAngle('shoulder_l', 0, s0, 300, 15);
      ctl.manual.setAngle('shoulder_l', 1, s1, 300, 15);
      ctl.manual.setAngle('shoulder_l', 2, s2, 300, 15);
      ctl.manual.setAngle('elbow_l', 2, el, 300, 15);
      for (let k = 0; k < 120; k++) { w.advance(1); }
      const hI2 = w.body.indexByKey.get('hand_l');
      const t2 = hI2 === undefined ? null : w.body.bodies[hI2]!.translation();
      if (t2) {
        const hx = t2.x * 100, hy = t2.y * 100, hz = t2.z * 100;
        if (hx > 0 && hx < 20 && hy > 148 && hy < 166 && hz > 2 && hz < 22) hits.push(`HIT s0=${s0} s1=${s1} s2=${s2} el=${el} 手=(${hx.toFixed(0)},${hy.toFixed(0)},${hz.toFixed(0)})`);
        const dd = Math.hypot(hx - 8, hy - 155, hz - 15);
        best.push(`d=${dd.toFixed(0)} s0=${s0} s1=${s1} s2=${s2} el=${el} 手=(${hx.toFixed(0)},${hy.toFixed(0)},${hz.toFixed(0)})`);
        best.sort((a, b) => Number(a.slice(2, a.indexOf(' '))) - Number(b.slice(2, b.indexOf(' '))));
        if (best.length > 6) best.length = 6;
      }
    }
    console.log(`REACH 后脑勺命中 ${hits.length} 个组合`);
    for (const h of hits.slice(0, 8)) console.log('REACH ' + h);
    for (const h of best.slice(0, 5)) console.log('REACH-NEAR ' + h);
    clearAll();
    for (const [s0, s2, el] of [] as Array<[number, number, number]>) {
      setAll(s0, s2, el);
      for (let k = 0; k < 150; k++) { setAll(s0, s2, el); w.advance(1); }
      const aj = (n: string, ax: number): string => { const di = w.body.dofByName(n, ax); return di < 0 ? '--' : (w.body.dofs[di]!.angle * 57.3).toFixed(0); };
      const di0 = w.body.dofByName('shoulder_r', 0);
      const b0 = di0 < 0 ? null : ctl.warner.drive.lastBreakdown[di0];
      console.log(`GC [sh0=${s0},sh2=${s2},el=${el}] 手=${hp()}cm 实际[肩0=${aj('shoulder_r', 0)} 肩2=${aj('shoulder_r', 2)} 肘=${aj('elbow_r', 2)}] 肩0通道[tq=${di0 < 0 ? '--' : w.executor.appliedOf(di0).toFixed(0)} sv=${b0 ? b0.servo.toFixed(0) : '--'} ac=${b0 ? b0.act.toFixed(0) : '--'} ff=${b0 ? b0.ff.toFixed(0) : '--'} dp=${b0 ? b0.damp.toFixed(0) : '--'}]`);
    }
    clearAll();
  }
  // ★ 手臂轴系统检查（AXCHK=1：每轴±0.5，看手位置）
  if (String(process.env.AXCHK ?? '0') === '1' && s === 60) {
    const hI = w.body.indexByKey.get('hand_l');
    const hp = (): string => {
      if (hI === undefined) return '--';
      const t = w.body.bodies[hI]!.translation();
      return `(${(t.x * 100).toFixed(0)},${(t.y * 100).toFixed(0)},${(t.z * 100).toFixed(0)})`;
    };
    const clear = (): void => {
      for (const jn2 of ['shoulder_l', 'elbow_l']) for (const a of [0, 1, 2]) ctl.manual.clearAngle(jn2, a);
      for (let k = 0; k < 60; k++) w.advance(1);
    };
    console.log(`AXCHK base 手=${hp()}cm`);
    for (const [jn2, ax] of [['shoulder_l', 0], ['shoulder_l', 1], ['shoulder_l', 2], ['elbow_l', 2]] as Array<[string, number]>) {
      for (const v of [0.5, -0.5]) {
        clear();
        for (let k = 0; k < 180; k++) { propose({ dof: w.body.dofByName(jn2, ax), kind: 'angle', pri: PRI.action, rad: v, kp: 300, kd: 15, src: 'axchk' }); w.advance(1); }
        console.log(`AXCHK ${jn2}/${ax}=${v} 手=${hp()}cm`);
      }
    }
    clear();
  }
  // ★ 肘测试（ELBOW=1：设肘-1.5，追踪手位置+写手）
  if (String(process.env.ELBOW ?? '0') === '1') {
    if (s === 120) ctl.manual.setAngle('elbow_l', 2, Number(process.env.ELBOWV ?? -1.5), 120, 12);
    if (s >= 120 && s % 20 === 0) {
      const hI = w.body.indexByKey.get('hand_l');
      const hp = hI === undefined ? '--' : (() => { const t = w.body.bodies[hI]!.translation(); return `(${(t.x * 100).toFixed(0)},${(t.y * 100).toFixed(0)},${(t.z * 100).toFixed(0)})`; })();
      const ei = w.body.dofByName('elbow_l', 2);
      const ea = ei < 0 ? 0 : w.body.dofs[ei]!.angle * 57.3;
      const et = ei < 0 ? 0 : w.executor.appliedOf(ei);
      const plog0 = (globalThis as { __PROPLOG?: Array<[number, string, number, string]> }).__PROPLOG;
      const wr = plog0 ? plog0.slice(-60).filter((x) => x[0] === ei).map((x) => `${x[3]}=${x[2].toFixed(0)}`).join(' ') : '';
      console.log(`E s${s} 手=${hp}cm 肘角=${ea.toFixed(0)}° min=${(w.body.dofs[ei]!.min * 57.3).toFixed(0)}° max=${(w.body.dofs[ei]!.max * 57.3).toFixed(0)}° 肘力=${et.toFixed(0)} 写手: ${wr}`);
    }
  }
  // ★ 侧向扰动测试（PUSH_S 帧给 +X 冲量）
  const pushS = Number(process.env.PUSH_S ?? 0);
  const pushF = Number(process.env.PUSH_F ?? 0);
  if (pushS > 0 && s === pushS && pushF !== 0) {
    w.torso().applyImpulse({ x: pushF, y: 0, z: 0 }, true);
    console.log(`PUSH @s${s}: F=${pushF}N·s`);
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
{
  // ★ 2026-10-16 振动专项：过零率（稳态段 s600-2400 = 2.5-10s）
  let cross = 0;
  for (let i = 601; i < Math.min(2400, fzHist.length); i++) {
    const a = fzHist[i - 1]!, b = fzHist[i]!;
    if (a * b < 0) cross++;
  }
  const dur = (Math.min(2400, fzHist.length) - 600) / 240;
  console.log(`══ 振动频率：fzR−fzL 过零 ${cross} 次 / ${dur.toFixed(1)}s ⇒ 主频 ≈ ${(cross / 2 / dur).toFixed(1)} Hz ══`);
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
    const torsoB = w.body.bodies[w.body.indexByKey.get('torso') ?? 0]!;
    const tq2 = torsoB.rotation();
    // 躯干前倾角（本地Y轴的俯仰）+ 大腿方向 vs 躯干方向的夹角
    const upv = [2 * (tq2.x * tq2.y - tq2.w * tq2.z), 1 - 2 * (tq2.x * tq2.x + tq2.z * tq2.z), 2 * (tq2.y * tq2.z + tq2.w * tq2.x)];
    const torsoPitch = Math.atan2(upv[0]!, upv[1]!) * 57.3;
    const hipP2 = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld;
    const kneeP2 = w.body.dofs[w.body.dofByName('knee_r', 2)]!.anchorWorld;
    const thighD = [kneeP2[0]! - hipP2[0]!, kneeP2[1]! - hipP2[1]!, kneeP2[2]! - hipP2[2]!];
    const tl = Math.hypot(thighD[0]!, thighD[1]!, thighD[2]!) || 1;
    const cosA = (thighD[0]! / tl) * upv[0]! + (thighD[1]! / tl) * upv[1]! + (thighD[2]! / tl) * upv[2]!;
    const angTT = Math.acos(Math.max(-1, Math.min(1, cosA))) * 57.3;
console.log(`com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)})cm  fzL=${ctl.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl.sensors.feet[1]!.fz.toFixed(0)}`);
