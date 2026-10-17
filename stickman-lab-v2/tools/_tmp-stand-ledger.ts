/** _tmp-stand-ledger.ts —— 站立（双支撑）静态需求账本：给站立基础力组标定用 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { propose, PRI } from '../src/core/proposalBus';

const w = new World();
const ctl = new ControlModule(w, { postureTone: Number(process.env.TONE ?? 8) });   // ★ TONE env 接入
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
    console.log(`PT s${s} 肘锚R=${eAR2} 肘锚L=${eAL2} 肩L=${shL} 肘L回读=${eL2} 肩1=${sh1} 肘轴=${axE} ax肩0=${axS0} act=${st.active ? st.id : '-'} 肩0=${ag('shoulder_r', 0)} 肩2=${ag('shoulder_r', 2)} 肘=${ag('elbow_r', 2)} tq=${ap} 肘部=(${eb ? (eb.x * 100).toFixed(0) : '--'},${eb ? (eb.y * 100).toFixed(0) : '--'},${eb ? (eb.z * 100).toFixed(0) : '--'}) 手=(${t ? (t.x * 100).toFixed(0) : '--'},${t ? (t.y * 100).toFixed(0) : '--'},${t ? (t.z * 100).toFixed(0) : '--'}) 肘L=(${elb ? (elb.x * 100).toFixed(0) : '--'},${elb ? (elb.y * 100).toFixed(0) : '--'},${elb ? (elb.z * 100).toFixed(0) : '--'}) 手L=(${hlb ? (hlb.x * 100).toFixed(0) : '--'},${hlb ? (hlb.y * 100).toFixed(0) : '--'},${hlb ? (hlb.z * 100).toFixed(0) : '--'}) 头=(${hd ? (hd.x * 100).toFixed(0) : '--'},${hd ? (hd.y * 100).toFixed(0) : '--'},${hd ? (hd.z * 100).toFixed(0) : '--'})`);
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
    for (const [hip, knee, foot] of [[1.0, -1.0, -0.3], [1.2, -1.2, -0.4], [1.4, -1.4, -0.5], [1.4, -1.6, -0.6]] as Array<[number, number, number]>) {
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
console.log(`com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)})cm  fzL=${ctl.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl.sensors.feet[1]!.fz.toFixed(0)}`);
