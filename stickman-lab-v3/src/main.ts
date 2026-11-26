// ============================================================
// main —— v2 入口：wasm → World（执行层）→ ControlModule（控制模块）→ Viewer
// ============================================================
// 控制模块只做四件事：收命令 / 整合两提案 / 反射 / 写关节（唯一写手）。
// 按钮 → 动作层（独立系统，出提案）；执行时伺服层默默工作（控制模块每拍照跑）。

import * as THREE from 'three';   // ★ 姿势预览绘制
import { initRapierWasm } from './core/rapierWasm';
import { World, DEFAULT_WORLD_OPTIONS } from './core/world';
import { ControlModule } from './core/control';
import { setBaseState, baseState, baseParams, resetBaseTable } from './core/servo/baseTable';
import { WEB_DEFAULTS } from './core/webDefaults';
import { upperOff, setUpperOff, setRigidUpper, rigidUpperOn, freezeUpperStep, lastRescueDbg } from './core/servo/rescue';   // ★ §2.669-671 上身力开关 + 刚体上身 + 方向力矩 UI
import { captureSquatCourt, courtSetup, type CourtState } from './core/court';
import { squatFrame } from './core/servo/squat';
import { estimateHipLevel } from './core/servo/squatHipLevel';
import { supportClean } from './core/servo/supportClean';   // ★ 回正力写手：每帧双腿（正常站立也走它）   // ★ 法庭网页实装（与探针 _tmp-hold10 同流程）
import { measureJointLoads } from './core/servo/fullInverseDynamics';
import { Viewer } from './render/viewer';

const q = new URLSearchParams(location.search);
const GRAV_OFF = q.get('grav') === 'off';
const DRIVE_OFF = q.get('drive') === 'off';

// ★ 2026-10-16 浏览器 env shim（用户："无变化啊"——网页是浏览器，process.env 不存在，
//   之前所有 TR_*/SC_*/TENSION_* 环境变量在网页全部无效、一直用代码默认值！）
//   用法：URL 参数 ?TR_B0_LAT=300 或控制台 globalThis.__ENV.TR_B0_LAT=300（实时生效）
const __ENV: Record<string, string> = Object.fromEntries(q.entries());
// ★ 默认：被动刚度 + 托髋支柱（URL 参数可覆盖）
const __DEFAULTS: Record<string, string> = WEB_DEFAULTS;;
for (const k of Object.keys(__DEFAULTS)) if (__ENV[k] === undefined) __ENV[k] = __DEFAULTS[k]!;
// v3：网页默认开辅助回正；URL ?V3_AR_MODE=monitor 可退回只监控
if (__ENV.V3_AR_MODE === undefined) __ENV.V3_AR_MODE = 'assist';
(globalThis as Record<string, unknown>).__ENV = __ENV;
console.log(`[V3_AR] mode=${__ENV.V3_AR_MODE} root=${__ENV.V3_AR_ROOT ?? 'on'}`);
(globalThis as Record<string, unknown>).process ??= { env: __ENV };
(globalThis as { __IK_DBG?: boolean }).__IK_DBG = String(__ENV.SQC_IK_DBG ?? '1') !== '0';

async function boot(): Promise<void> {
  const status = document.getElementById('boot');
  const setStatus = (s: string) => { if (status) status.textContent = s; };

  setStatus('加载 rapier wasm…');
  await initRapierWasm();

  // ★ 2026-10-15 用户："这个回读是不是没种子"——?seed=N 固定随机（预历史可复现；与实验室 mulberry32(N*100+1) 同款）
  const seedQ = q.get('seed');
  if (seedQ !== null) {
    let sa = (Number(seedQ) * 100 + 1) >>> 0;
    Math.random = () => {
      sa = (sa + 0x6d2b79f5) >>> 0;
      let t = Math.imul(sa ^ (sa >>> 15), 1 | sa);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  setStatus('装配骨架 / 串联铰链 / 执行器…');
  const makeSim = (): { sim: World; control: ControlModule } => {
    const nextSim = new World({ ...DEFAULT_WORLD_OPTIONS, gravityY: GRAV_OFF ? 0 : -9.81 });
    const nextControl = new ControlModule(nextSim, { postureTone: 8 });
    nextControl.actions.idleEnabled = true;
    nextSim.controller = nextControl;
    nextSim.reset();
    return { sim: nextSim, control: nextControl };
  };
  let { sim, control } = makeSim();
  const DT = sim.dt;

  setStatus('控制模块…');
  let upperGravityZero = false;
  const setUpperGravityZero = (on: boolean): void => {
    upperGravityZero = on;
    const keys = ['torso', 'spine1', 'spine2', 'spine3', 'spine4', 'neck', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
    for (const k of keys) {
      const i = sim.body.indexByKey.get(k);
      if (i !== undefined) sim.body.bodies[i]!.setGravityScale(on ? 0 : 1, true);
    }
    let low = 0, total = 0;
    for (const b of sim.sk.bodies) {
      total += b.mass;
      if (/^(thigh|shin|foot|arch|mfoot)_/.test(b.key)) low += b.mass;
    }
    __ENV.SQC_PAIR_SCALE = on ? (low / Math.max(1e-6, total)).toFixed(3) : '0.95';
    __ENV.SQC_LOCK_HIP = on ? '0' : '1';
    __ENV.SQC_LAT_LOCK_HIP_DEG = on ? '0' : '1.5';
    __ENV.SQC_NB_LOAD_BALANCE = on ? '1' : '0';
    console.log(`[NO_UPPER] upper gravityScale=${on ? 0 : 1} pairScale=${__ENV.SQC_PAIR_SCALE}`);
  };
  control.actions.idleEnabled = true;   // ★ 2026-10-17 恢复（用户：动作层覆盖伺服——上身小力矩不影响平衡；站立已稳定）
  (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;   // ★ 2026-10-16 用户："让反射默认关吧"（预测层默认暂停；按钮可开）
  // ★ 2026-10-15 用户："架构不需要这个了"——腰椎训练策略已删（lumbarPolicy/lumbarTrain/train 页）
  sim.controller = control;
  sim.reset();
  let court: CourtState | null = null;
  const probeOn = __ENV.SQC_BROWSER_PROBE === '1';
  const probeFrames: Array<Record<string, number>> = [];
  if (probeOn) {
    (globalThis as { __SQC_PROBE?: { frames: Array<Record<string, number>>; clear: () => void } }).__SQC_PROBE = {
      frames: probeFrames,
      clear: () => { probeFrames.length = 0; },
    };
  }
  const probeStep = (): void => {
    if (!probeOn || !court || !court.released) return;
    const b = sim.body as unknown as {
      dofByName(n: string, a: number): number;
      dofs: Array<{ angle: number; vel: number; anchorWorld: Float64Array }>;
      footNormalForce(s: 'l' | 'r', dt: number): number;
    };
    const led = sim.executor.ledger;
    const idx = (n: string, a: number): number => b.dofByName(n, a);
    const ap = (n: string, a: number): number => { const i = idx(n, a); return i >= 0 ? (led[i]?.applied ?? 0) : 0; };
    const wr = (n: string, a: number): number => { const i = idx(n, a); return i >= 0 ? (led[i]?.writes ?? 0) : 0; };
    const an = (n: string, a: number): number => { const i = idx(n, a); return i >= 0 ? (b.dofs[i]?.angle ?? 0) : 0; };
    const hx = (n: string): number => { const i = idx(n, 2); return i >= 0 ? (b.dofs[i]?.anchorWorld[0] ?? 0) : 0; };
    const hy = (n: string): number => { const i = idx(n, 2); return i >= 0 ? (b.dofs[i]?.anchorWorld[1] ?? 0) : 0; };
    const hz = (n: string): number => { const i = idx(n, 2); return i >= 0 ? (b.dofs[i]?.anchorWorld[2] ?? 0) : 0; };
    const dbg = (globalThis as { __SQC_KNEE_FOOT_DBG?: Record<string, Record<string, number>> }).__SQC_KNEE_FOOT_DBG?.l ?? {};
    const dbgR = (globalThis as { __SQC_KNEE_FOOT_DBG?: Record<string, Record<string, number>> }).__SQC_KNEE_FOOT_DBG?.r ?? {};
    const fzb = (globalThis as { __FZ_BUDGET?: { fzLTarget?: number; fzRTarget?: number; valid?: boolean } }).__FZ_BUDGET ?? {};
    const macc = (globalThis as { __MOTION_ACC?: Record<string, number>; __ACC_OBS?: Record<string, number> }).__MOTION_ACC ?? {};
    const accObs = (globalThis as { __ACC_OBS?: Record<string, number> }).__ACC_OBS ?? {};
    const limbAcc = (globalThis as { __LIMB_ACC?: Record<string, number> }).__LIMB_ACC ?? {};
    const jekf = (globalThis as { __JOINT_EKF?: Record<string, number> }).__JOINT_EKF ?? {};
    const legId = (globalThis as { __LEG_ID?: Record<string, Record<string, number>> }).__LEG_ID?.l ?? {};
    const sqp = (globalThis as { __SQC_SUPPORT_QP?: Record<string, number> }).__SQC_SUPPORT_QP ?? {};
    const loads = measureJointLoads(sim as unknown as Parameters<typeof measureJointLoads>[0]);
    const loadHip = loads.find((x) => x.name === 'hip_l');
    const loadKnee = loads.find((x) => x.name === 'knee_l');
    const loadAnkle = loads.find((x) => x.name === 'foot_l');
    const body = sim.body as unknown as {
      indexByKey: Map<string, number>;
      bodies: Array<{ translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } }>;
    };
    const fbi = body.indexByKey.get('foot_l');
    const sbi = body.indexByKey.get('shin_l');
    const footBody = fbi !== undefined ? body.bodies[fbi]! : null;
    const shinBody = sbi !== undefined ? body.bodies[sbi]! : null;
    const fp = footBody?.translation();
    const fq = footBody?.rotation();
    const sq = shinBody?.rotation();
    const footTgt = control.footAnkle.world.pose.get('l');
    const tilt = (q: { x: number; y: number; z: number; w: number } | undefined): [number, number] => {
      if (!q) return [0, 0];
      const ux = 2 * (q.x * q.y - q.w * q.z);
      const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
      const uz = 2 * (q.w * q.x + q.y * q.z);
      return [Math.atan2(ux, uy) * 57.29578, Math.atan2(uz, Math.hypot(ux, uy)) * 57.29578];
    };
    const [footPitch, footRoll] = tilt(fq);
    const [shankPitch, shankRoll] = tilt(sq);
    const [footTargetPitch, footTargetRoll] = tilt(footTgt?.q);
    probeFrames.push({
      footWorldX: fp?.x ?? 0, footWorldY: fp?.y ?? 0, footWorldZ: fp?.z ?? 0,
      footPitch, footRoll, shankPitch, shankRoll,
      footTargetX: footTgt?.p.x ?? 0, footTargetY: footTgt?.p.y ?? 0, footTargetZ: footTgt?.p.z ?? 0,
      footTargetPitch, footTargetRoll,
      t: court.t, fall: court.fall, stale: court.t < 0.01 ? 1 : 0,
      knee2T: dbg.knee2T ?? 0, knee2Cmd: dbg.knee2Cmd ?? 0, kneeFf: dbg.kneeFf ?? 0, kneeBudget: dbg.kneeBudget ?? 0,
      contactLatch: dbg.contactLatch ?? 0, contactLatchSince: dbg.contactLatchSince ?? 0, contactLatchLost: dbg.contactLatchLost ?? 0, contactFzLp: dbg.contactFzLp ?? 0,
      hip2T: dbg.hip2T ?? 0, hip2Cmd: dbg.hip2Cmd ?? 0, hipFf: dbg.hipFf ?? 0,
      baseHipFf: dbg.baseHipFf ?? 0, supHip: dbg.supHip ?? 0, comHip: dbg.comHip ?? 0, thigh2: dbg.thigh2 ?? 0,
      idHip: dbg.idHip ?? 0, idKnee: dbg.idKnee ?? 0, idAnkle: dbg.idAnkle ?? 0, fzUse: dbg.fzUse ?? 0, fzRawUse: dbg.fzRawUse ?? 0, fzFloor: dbg.fzFloor ?? 0, fzCom: dbg.fzCom ?? 0, comY: dbg.comY ?? 0, comYTarget: dbg.comYTarget ?? 0, comYAcc: dbg.comYAcc ?? 0, copXUse: dbg.copXUse ?? 0, supportCopX: dbg.supportCopX ?? 0, supportCopZ: dbg.supportCopZ ?? 0, supportWrenchFeasible: dbg.supportWrenchFeasible ?? 0, fzAbsMax: dbg.fzAbsMax ?? 0, fzAbsFloor: dbg.fzAbsFloor ?? 0, hipErrFz: dbg.hipErrFz ?? 0, hipAccDes: dbg.hipAccDes ?? 0, fzTotalDesired: dbg.fzTotalDesired ?? 0, fzShare: dbg.fzShare ?? 0, fzDesired: dbg.fzDesired ?? 0, fzCmd: dbg.fzCmd ?? 0, hipTargetForFz: dbg.hipTargetForFz ?? 0, hipYForFz: dbg.hipYForFz ?? 0,
      idHipGrav: legId.hip_lGrav ?? 0, idHipContact: legId.hip_lContact ?? 0, idHipBoundary: legId.hip_lBoundary ?? 0,
      idKneeGrav: legId.knee_lGrav ?? 0, idKneeContact: legId.knee_lContact ?? 0, idKneeBoundary: legId.knee_lBoundary ?? 0,
      idAnkleGrav: legId.foot_lGrav ?? 0, idAnkleContact: legId.foot_lContact ?? 0, idAnkleBoundary: legId.foot_lBoundary ?? 0,
      idHipX: legId.hipX ?? 0, supportContactCount: legId.contactCount ?? 0,
      loadHip: loadHip?.torque ?? 0, loadKnee: loadKnee?.torque ?? 0, loadAnkle: loadAnkle?.torque ?? 0,
      loadHipRaw: loadHip?.rawTorque ?? 0, loadKneeRaw: loadKnee?.rawTorque ?? 0, loadAnkleRaw: loadAnkle?.rawTorque ?? 0,
      chainHip: dbg.chainHip ?? 0, chainKnee: dbg.chainKnee ?? 0, chainAnkle: dbg.chainAnkle ?? 0,
      chainFx: dbg.chainFx ?? 0, chainFy: dbg.chainFy ?? 0, chainFz: dbg.chainFz ?? 0,
      chainCopX: dbg.chainCopX ?? 0, chainCopZ: dbg.chainCopZ ?? 0,
      chainContact: dbg.chainContact ?? 0, chainCopInside: dbg.chainCopInside ?? 0,
      chainResHip: dbg.chainResHip ?? 0, chainResKnee: dbg.chainResKnee ?? 0, chainResAnkle: dbg.chainResAnkle ?? 0,
      fullHip: dbg.fullHip ?? 0, fullKnee: dbg.fullKnee ?? 0, fullAnkle: dbg.fullAnkle ?? 0, fullOn: dbg.fullOn ?? 0,
      fullHipRaw: dbg.fullHipRaw ?? 0, fullKneeRaw: dbg.fullKneeRaw ?? 0, fullAnkleRaw: dbg.fullAnkleRaw ?? 0,
      fullHipDesired: dbg.fullHipDesired ?? 0, fullKneeDesired: dbg.fullKneeDesired ?? 0, fullAnkleDesired: dbg.fullAnkleDesired ?? 0,
      hipYNow: dbg.hipYNow ?? 0, hipY0: dbg.hipY0 ?? 0, hipLift: dbg.hipLift ?? 0, hipHeightScale: dbg.hipHeightScale ?? 0,
      supportPulse: dbg.supportPulse ?? 0, pulseOn: dbg.pulseOn ?? 0,
      fullHipPulsed: dbg.fullHipPulsed ?? 0, fullKneePulsed: dbg.fullKneePulsed ?? 0, fullAnklePulsed: dbg.fullAnklePulsed ?? 0,
      kneePasK: dbg.kneePasK ?? 0, kneePasB: dbg.kneePasB ?? 0,
      foot2Local: dbg.foot2Local ?? 0, supportContact: dbg.supportContact ?? 0,
      handoffU: dbg.handoffU ?? 0, handHip: dbg.handHip ?? 0, handKnee: dbg.handKnee ?? 0, handAnkle: dbg.handAnkle ?? 0,
      prevHip: dbg.prevHip ?? 0, prevKnee: dbg.prevKnee ?? 0, prevAnkle: dbg.prevAnkle ?? 0,
      dynAccHip: dbg.accHip ?? 0, dynAccKnee: dbg.accKnee ?? 0, dynAccAnkle: dbg.accAnkle ?? 0,
      copCorr: dbg.copCorr ?? 0, ikHipDbg: dbg.ikHip ?? 0, ikKneeDbg: dbg.ikKnee ?? 0, ikAnkleDbg: dbg.ikAnkle ?? 0, staticGate: dbg.staticGate ?? 0, ikGate: dbg.ikGate ?? 0, ikDev: dbg.ikDev ?? 0,
      supportContactR: dbgR.supportContact ?? 0, contactR: dbgR.contact ?? 0, fzUseR: dbgR.fzUse ?? 0, foot2R: ap('foot_r', 2), idAnkleR: dbgR.idAnkle ?? 0,
      qpFeasible: sqp.feasible ?? 0, qpUse: sqp.useQp ?? 0, qpFzL: sqp.fzL ?? 0, qpFzR: sqp.fzR ?? 0, qpTotalFz: sqp.totalFz ?? 0, qpFzTotal: sqp.qpFzTotal ?? 0, qpAY: sqp.aY ?? 0, qpCopXL: sqp.copXL ?? 0, qpCopXR: sqp.copXR ?? 0, qpFzRefL: sqp.fzRefL ?? 0, qpFzRefR: sqp.fzRefR ?? 0,
      fzLTarget: fzb.fzLTarget ?? 0, fzRTarget: fzb.fzRTarget ?? 0, fzBudgetValid: fzb.valid ? 1 : 0,
      comAccX: macc.comAccX ?? 0, comAccY: macc.comAccY ?? 0, comAccZ: macc.comAccZ ?? 0,
      baseAccX: accObs.baseAccX ?? 0, baseAccY: accObs.baseAccY ?? 0, baseAccZ: accObs.baseAccZ ?? 0,
      obsComAccX: accObs.comAccX ?? 0, obsComAccY: accObs.comAccY ?? 0, obsComAccZ: accObs.comAccZ ?? 0,
      obsComErr: Math.hypot((accObs.comAccX ?? 0)-(macc.comAccX ?? 0),(accObs.comAccY ?? 0)-(macc.comAccY ?? 0),(accObs.comAccZ ?? 0)-(macc.comAccZ ?? 0)),
      qddHipObs: accObs.qddHip ?? 0, qddKneeObs: accObs.qddKnee ?? 0, qddAnkleObs: accObs.qddAnkle ?? 0, accConfidence: accObs.confidence ?? 0,
      shinAz: limbAcc.shin_lAz ?? 0, shinWz: limbAcc.shin_lWz ?? 0, thighAz: limbAcc.thigh_lAz ?? 0, footAz: limbAcc.foot_lAz ?? 0, torsoAz: limbAcc.torsoAz ?? 0,
      ekfQddHip: jekf.qddHip ?? 0, ekfQddKnee: jekf.qddKnee ?? 0, ekfQddAnkle: jekf.qddAnkle ?? 0, ekfUsed: jekf.used ?? 0,
      contactAccX: macc.contactAccX ?? 0, contactAccY: macc.contactAccY ?? 0, contactAccZ: macc.contactAccZ ?? 0,
      hip2Acc: macc.hip2Acc ?? 0, knee2Acc: macc.knee2Acc ?? 0, ankle2Acc: macc.ankle2Acc ?? 0,
      contact: dbg.contact ?? 0, copValid: dbg.copValid ?? 0, 
      comX: control.sensors.com[0]!, comZ: control.sensors.com[2]!,
      hipX: hx('hip_l'), kneeX: hx('knee_l'), footX: hx('foot_l'),
      hipY: hy('hip_l'), kneeY: hy('knee_l'), footY: hy('foot_l'),
      hipZ: hz('hip_l'), kneeZ: hz('knee_l'), footZ: hz('foot_l'),
      hip2: ap('hip_l', 2), knee2: ap('knee_l', 2), foot2: ap('foot_l', 2),
      hip2w: wr('hip_l', 2), knee2w: wr('knee_l', 2), foot2w: wr('foot_l', 2),
      hip2a: an('hip_l', 2), knee2a: an('knee_l', 2), foot2a: an('foot_l', 2),
      hip0Applied: ap('hip_l', 0), hip1Applied: ap('hip_l', 1), hip2Applied: ap('hip_l', 2),
      knee1Applied: ap('knee_l', 1), knee2Applied: ap('knee_l', 2), foot1Applied: ap('foot_l', 1), foot2Applied: ap('foot_l', 2),
      hip1A: an('hip_l', 1), knee1A: an('knee_l', 1), foot1A: an('foot_l', 1),
      hip1V: b.dofs[idx('hip_l', 1)]?.vel ?? 0, knee1V: b.dofs[idx('knee_l', 1)]?.vel ?? 0, foot1V: b.dofs[idx('foot_l', 1)]?.vel ?? 0,
      spine1Applied: ap('spine1', 2), spine2Applied: ap('spine2', 2), spine3Applied: ap('spine3', 2), neckApplied: ap('neck', 0),
      spine1A: an('spine1', 2), spine2A: an('spine2', 2), spine3A: an('spine3', 2), neckA: an('neck', 0),
      spine1V: b.dofs[idx('spine1', 2)]?.vel ?? 0, spine2V: b.dofs[idx('spine2', 2)]?.vel ?? 0, spine3V: b.dofs[idx('spine3', 2)]?.vel ?? 0, neckV: b.dofs[idx('neck', 0)]?.vel ?? 0,
      dynRawHip: dbg.dynRawHip ?? 0, dynRawKnee: dbg.dynRawKnee ?? 0, dynRawAnkle: dbg.dynRawAnkle ?? 0,
      dynMHip: dbg.dynMHip ?? 0, dynMKnee: dbg.dynMKnee ?? 0, dynMAnkle: dbg.dynMAnkle ?? 0,
      dynCHip: dbg.dynCHip ?? 0, dynCKnee: dbg.dynCKnee ?? 0, dynCAnkle: dbg.dynCAnkle ?? 0,
      resHip: dbg.resHip ?? 0, resKnee: dbg.resKnee ?? 0, resAnkle: dbg.resAnkle ?? 0,
      pdHip: dbg.pdHip ?? 0, pdKnee: dbg.pdKnee ?? 0, pdAnkle: dbg.pdAnkle ?? 0,
      tauCorrAccHip: dbg.tauCorrAccHip ?? 0, tauCorrAccKnee: dbg.tauCorrAccKnee ?? 0, tauCorrAccAnkle: dbg.tauCorrAccAnkle ?? 0,
      hip2CmdT: dbg.hipCmdT ?? 0, knee2CmdT: dbg.kneeCmdT ?? 0,
      hip2Passive: dbg.hipPassive ?? 0, knee2Passive: dbg.kneePassive ?? 0,
      foot0a: an('foot_l', 0), foot1a: an('foot_l', 1),
      foot0v: b.dofs[idx('foot_l', 0)]?.vel ?? 0, foot1v: b.dofs[idx('foot_l', 1)]?.vel ?? 0, foot2v: b.dofs[idx('foot_l', 2)]?.vel ?? 0,
      hip0v: b.dofs[idx('hip_l', 0)]?.vel ?? 0, hip2v: b.dofs[idx('hip_l', 2)]?.vel ?? 0,
      fzL: b.footNormalForce('l', sim.dt), fzR: b.footNormalForce('r', sim.dt),
    });
    if (probeFrames.length > 6000) probeFrames.shift();
  };
  let pendingSquatDown = false;
  let squatDownArmed = false;
  const stepCtx = { sensors: control.sensors, bal: control.warner, body: sim.body, world: sim };   // ★ 法庭模式状态（非空 = 法庭运行中）
  /** 每次法庭重建整个 World/Control：身体、执行器、Drive、Pad、传感器一起新造。 */
  function rebuildSim(): void {
    resetBaseTable();
    const next = makeSim();
    sim = next.sim;
    control = next.control;
    stepCtx.sensors = control.sensors;
    stepCtx.bal = control.warner;
    stepCtx.body = sim.body;
    stepCtx.world = sim;
  }

  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('缺少 #view canvas');

  setStatus('建渲染层…');
  const viewer = new Viewer(canvas, sim.sk, 1, { assetBase: '' });
  viewer.followShowcase = true;

  // ── 动作按钮 → 动作层（独立系统）──
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#actions button'));
  const pairBtn = buttons.find((b) => b.dataset.act === 'pairpause');
  if (pairBtn) pairBtn.textContent = `驱动层：${__ENV.SQC_PASSIVE_MODE === '1' ? '被动刚度' : 'pairPD'}`;
  const setActive = (btn?: HTMLButtonElement | null): void => {
    for (const b of buttons) b.classList.toggle('active', b === btn);
  };

  function act(name: string, btn: HTMLButtonElement): void {
    if (name !== 'court' && name !== 'writerdbg') court = null;
    if (name !== 'squatdown') { pendingSquatDown = false; squatDownArmed = false; }
    switch (name) {
      case 'stand':
        control.actions.play('stand');
        control.manual.clear();
        control.warner.setComTarget(0, 0);
        setActive(btn);
        break;
      case 'bow':
        control.actions.playPart('鞠躬');   // ★ 新动作层（用户：旧关键帧遗留→重写）
        setActive(btn);
        break;
      case 'oneleg':
        // ★ 用户：保留网页随机预状态（idle 随机历史=真实鲁棒性测试）——
        //   探针已同步为随机模式（tools/_tmp-lat-robust.ts），两边一致。
        control.actions.play('singleLegR');
        setActive(btn);
        break;
      case 'push':
        control.actions.play('pushRise');   // ★ 旧路径（新层腿力矩实测侧向失稳——腿发力需蹲的专项）
        setActive(btn);
        break;
      case 'squat':
        control.actions.play('squatRise');
        setActive(btn);
        break;
      case 'g:对折': case 'g:举手': case 'g:叉腰': case 'g:抱胸': case 'g:摸头': case 'g:摸脸':
      case 'g:甩头': case 'g:晃臂': case 'g:转体': case 'g:重心移':
        control.actions.playPart(name.slice(2));
        setActive(btn);
        break;
      case 'posepreview': {
        // ★ 用户：'连重力也不要，浮在天上，只要姿势'——零重力姿势预览
        posePreview = !posePreview;
        if (posePreview) {
          sim.setGravityZero();
          // ★ 只关受力层（控制器留着——手动弹簧在控制器里，关了就没人摆姿势）
          control.warner.opt.gravityComp = false;   // 关重力补偿
          control.actions.abort();                  // ★ 用户：'除了蹲下的姿态以外别再写任何动作'
          control.actions.idleEnabled = false;
          drawPoseOverlay();   // ★ 画设想骨架
          // ★★ 正确序列（用户：'腰弯不下去'真身=被动刚度把腿拉回站立）：
          //   ① 先手动摆到红骨架姿势（硬弹簧）
          for (const sd of ['l', 'r'] as const) {
            control.manual.setAngle(`hip_${sd}`, 2, 0.65, 2000, 80);
            control.manual.setAngle(`knee_${sd}`, 2, -2.4, 2000, 80);
            control.manual.setAngle(`foot_${sd}`, 2, 0.0, 2000, 80);   // ★ 脚底朝下承重（用户）
            control.manual.setAngle(`hip_${sd}`, 0, sd === 'l' ? 0.15 : -0.15, 2000, 80);   // ★ 收回外撇
          }
          //   ② 1.5s 后（姿势到位）：重捕获被动基准（站立S→蹲姿）→ 交给回正力
          window.setTimeout(() => {
            if (!posePreview) return;
            sim.switchPoseState('squat');         // ★★ 原子切换（用户架构：所有层一次切完）
            control.warner.setComTarget(baseParams().comX, 0);   // ★ CoM 状态参数
            for (const sd of ['l', 'r'] as const) {
              control.manual.clearAngle(`hip_${sd}`, 2);
              control.manual.clearAngle(`knee_${sd}`, 2);
              control.manual.clearAngle(`foot_${sd}`, 2);
              control.manual.clearAngle(`hip_${sd}`, 0);
            }
          }, 1500);
        } else {
          sim.setGravity(-9.81);
          control.warner.opt.gravityComp = true;
          control.actions.idleEnabled = true;
          setBaseState('stand');
          if (overlay) { viewer.scene.remove(overlay); overlay.geometry.dispose(); overlay = null; }
          for (const sd of ['l', 'r'] as const) {
            control.manual.clearAngle(`hip_${sd}`, 2);
            control.manual.clearAngle(`knee_${sd}`, 2);
            control.manual.clearAngle(`foot_${sd}`, 2);
            control.manual.clearAngle(`hip_${sd}`, 0);
          }

        }
        btn.textContent = `姿势预览：${posePreview ? '开' : '关'}`;
        setActive(posePreview ? btn : null);
        break;
      }
      case 'pairpause': {
        const on = __ENV.SQC_PASSIVE_MODE !== '1';
        __ENV.SQC_PASSIVE_MODE = on ? '1' : '0';
        __ENV.SQC_PASSIVE_ONLY = on ? '1' : '0';
        __ENV.SQC_JOINT_LOAD = on ? '1' : '0';
        __ENV.SQC_PB_C_LOAD = '5';
        __ENV.SQC_PASSIVE_B = '2';
        __ENV.SQC_PA_K = '100';
        __ENV.SQC_PA_B = '4';
        __ENV.SQC_PA_CAP = '5';
        __ENV.SQC_LEG_UP = '50';
        __ENV.SQC_LEG_SIGN = '-1';
        __ENV.SQC_LEG_SHARE_A = '2';
        __ENV.SQC_LEG_SHARE_K = '0.5';
        __ENV.SQC_PAIR_OFF = '0';
        __ENV.SQC_SAG_PASSIVE = '0';
        btn.textContent = `驱动层：${on ? '被动刚度' : 'pairPD'}`;
        setActive(on ? btn : null);
        break;
      }
      case 'squatstate': {
        // ★ 用户：蹲下状态——'先进入姿势之后再接受受力'（瞬移姿势→释放给三层）
        const on = baseState() === 'squat';
        if (!on) {
          // ① 先姿势：手动直接摆到蹲姿态（强弹簧瞬移；同时标记让位=三层暂不施力）
          for (const sd of ['l', 'r'] as const) {
            control.manual.setAngle(`hip_${sd}`, 2, 1.0, 400, 50);
            control.manual.setAngle(`knee_${sd}`, 2, -1.0, 400, 50);
            control.manual.setAngle(`foot_${sd}`, 2, -0.3, 400, 50);
          }
          // ② 后受力：0.5s 后释放手动→三层架构（squat 表）接管
          window.setTimeout(() => {
            for (const sd of ['l', 'r'] as const) {
              control.manual.clearAngle(`hip_${sd}`, 2);
              control.manual.clearAngle(`knee_${sd}`, 2);
              control.manual.clearAngle(`foot_${sd}`, 2);
            }
            setBaseState('squat');
          }, 700);
        } else {
          setBaseState('stand');
        }
        btn.textContent = `蹲下状态：${on ? '关' : '开'}`;
        setActive(on ? null : btn);
        break;
      }
      case 'idle':
        control.actions.idleEnabled = !control.actions.idleEnabled;
        btn.textContent = `空闲行为：${control.actions.idleEnabled ? '开' : '关'}`;
        setActive(control.actions.idleEnabled ? btn : null);
        break;
      case 'reflex': {
        // ★ 2026-10-16 用户："加按钮，手动开关反射"——__PRED_OFF_RT 运行时开关（预测层整段暂停）
        const g = globalThis as { __PRED_OFF_RT?: boolean };
        g.__PRED_OFF_RT = !(g.__PRED_OFF_RT === true);
        const off = g.__PRED_OFF_RT === true;
        btn.textContent = `反射：${off ? '关' : '开'}`;
        setActive(off ? null : btn);
        break;
      }
      case 'limp':
        control.actions.abort();
        control.manual.clear();
        sim.controller = null;              // 松手：控制模块全撤
        setActive(btn);
        break;
      case 'noupper': {
        const on = !upperGravityZero;
        setUpperGravityZero(on);
        btn.textContent = `上身重力：${on ? '0' : '正常'}`;
        setActive(on ? btn : null);
        break;
      }
      case 'reset':
        control.actions.abort();
        control.manual.clear();
        sim.controller = control;
        sim.driveEnabled = true;
        sim.reset();
        setUpperGravityZero(false);
        control.warner.setComTarget(0, 0);
        setActive(btn);
        break;
      case 'squatdown':
        // ★ stand 伺服状态 --动作层下蹲--> squat 伺服状态（不在 squatFrame 里写下蹲）
        control.actions.abort();
        control.actions.idleEnabled = false;
        control.manual.clear();
        sim.controller = control;
        sim.driveEnabled = true;
        sim.reset();
        sim.switchPoseState('stand');
        control.resetCourt();
        control.actions.play('squatDown');
        pendingSquatDown = true;
        squatDownArmed = false;
        setActive(btn);
        break;
      case 'writerdbg': {
        const on = __ENV.WR_DBG !== '1';
        __ENV.WR_DBG = on ? '1' : '0';
        btn.textContent = on ? '写手审计：开' : '写手审计：关';
        console.log(`[WRITER] WR_DBG=${__ENV.WR_DBG}`);
        break;
      }
      case 'court':
        rebuildSim();
        // ★ 法庭：①reset 分腿站 → ②运动学摆左腿 → ③绕踝回正 → ④零速捕获 → ⑤静置2s→放开→判死
        control.actions.abort();
        control.manual.clear();
        sim.controller = control;
        sim.driveEnabled = true;
        sim.reset();
        court = courtSetup(sim, control, 2.0);
        setActive(btn);
        break;
    }
  }
  for (const b of buttons) {
    b.addEventListener('click', () => act(b.dataset.act ?? '', b));
  }

  function maybeSquatHandoff(): void {
    if (!pendingSquatDown) return;
    if (control.actions.status.id === 'squatDown' && control.actions.status.active) squatDownArmed = true;
    if (!squatDownArmed) return;
    // ★ 只有动作**真正到达法庭目标姿态**才允许交接（不看 comZ/时间）。
    //   目标 = 蹲下动作 p=1 路径终点（与法庭 seat 同一组角）。
    const body = sim.body;
    const ang = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? body.dofs[i]!.angle : Number.NaN; };
    const jt = 5 / 57.29578;
    const tgtHip = 103.1 / 57.29578, tgtKnee = -102.1 / 57.29578;
    // ★★★ 2026-10-26 修弹飞：门控原先 8 条里有两条**先天不可能成立**，导致交接被无限拖延
    //   （实测一直拖到动作层自己的「交接」相位 zeroAll）：
    //     · `|foot_l/2| < 10°`：实测恒 +22°，而这 22° **正是动作层自己在推的**
    //       （`ANK_K·comErr`，comErr≈6cm ⇒ 6×0.06≈21°）⇒ 要求与控制目标互相矛盾；
    //     · `|comX − 0.010| < 0.03`：实测**单调漂移** −2.5 → −9.6cm，从不回头。
    //   拖延的代价是实测的：t=6.05 交接 ⇒ 稳坐 30s；t=7.27 交接 ⇒ comX 已漂 −9.6cm，
    //   squat 伺服救不回 ⇒ 前栽 ⇒ 脚部限位爆 55 m/s。
    //   ⇒ 判据改成「**姿势到位 + 双脚着地**」（这才是"蹲完了"的定义），踝/CoM 交给伺服自己收。
    const fzL = body.footNormalForce('l', DT);
    const fzR = body.footNormalForce('r', DT);
    const minFz = Math.max(5, Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_HANDOFF_MIN_FZ ?? 20));
    const poseOk = Number.isFinite(ang('hip_l', 2)) && Number.isFinite(ang('knee_l', 2))
      && Math.abs(ang('hip_l', 2) - tgtHip) < jt
      && Math.abs(ang('knee_l', 2) - tgtKnee) < jt
      && fzL > 50 && fzR > 50;
    // ★★★ 2026-10-26 修弹飞（用户：'我只要你修弹飞'）：
    //   动作层第 3 个相位「交接」的 enter 就是 `zeroAll()`——把 hip/knee/foot/spine/neck/shoulder
    //   的 manual 角度**全清**、第 0 轴力矩**归零** ⇒ 深蹲**一个写手都不剩**；而 supportClean 的
    //   `_ref` 还是**站立**目标 ⇒ 一步内往站姿猛拉。实测 6.72 / 7.99 / 9.80 m/s（用户看到的弹飞）。
    //   ⇒ 兜底：只要动作已经走到「交接」相位、且膝盖确实还在蹲（< −60°），无条件接管。
    const forced = control.actions.status.phase === '交接' && ang('knee_l', 2) < -60 / 57.29578
      && fzL > minFz && fzR > minFz;
    if (!poseOk && !forced) return;
    pendingSquatDown = false;
    squatDownArmed = false;
    control.actions.abort();
    // ★ 同一帧：先捕获动作层最后力矩，再清 manual → 捕获 CourtState → squat 伺服接管。
    {
      const holdTorques: Record<string, number> = {};
      for (const n of ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r']) {
        const i = sim.body.dofByName(n, 2);
        holdTorques[n] = i >= 0 ? (sim.executor.ledger[i]?.applied ?? 0) : 0;
      }
      (globalThis as { __SQC_HANDOFF_TORQUE?: Record<string, number> }).__SQC_HANDOFF_TORQUE = holdTorques;
    }
    control.manual.clear();
    court = captureSquatCourt(sim, control);
    setActive(null);
  }

  // ── 渲染 + 物理循环 ──
  let last = performance.now();
  let acc = 0;
  const MAX_STEPS = 32;   // 低帧率也保持实时（8 步在 30fps 下=半速慢动作）
  // ★ §2.250 帧控（用户：慢速/暂停/单帧逐帧查）
  let timeScale = 1;    // 0=暂停
  let stepRemain = 0;   // 单帧剩余物理帧数
  let posePreview = false;   // ★ 姿势预览（零重力悬浮）
  // ★ 用户：'用绘制的方式，绘制你设想中的关节'——纯 FK 画骨架（不跑物理）
  let overlay: THREE.LineSegments | null = null;
  let ikOverlay: THREE.LineSegments | null = null;
  const drawPoseOverlay = (): void => {
    const h = 1.5, k = -2.4, f = -0.3, h0 = -0.15, lean = 0.75;   // ★ 大腿抬到水平上方（躯干-大腿真45°）
    const th = 0.43, sh = 0.35, ft = 0.20;
    const pts: number[] = [];
    const seg = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void => { pts.push(x1, y1, z1, x2, y2, z2); };
    for (const sgn of [-1, 1]) {
      const z0 = sgn * 0.08;
      const hx = 0, hy = 0.85, hz = z0 + sgn * h0 * 0.4;
      const a1 = h;
      const kx = hx + th * Math.sin(a1), ky = hy - th * Math.cos(a1), kz = hz;
      const a2 = a1 + k;
      const ax = kx + sh * Math.sin(a2), ay = ky - sh * Math.cos(a2), az = kz;
      const a3 = a2 + f + Math.PI;   // ★ 脚要Z字形：从折叠小腿再折回来指向前方（脚底朝下承重）
      const tx = ax + ft * Math.sin(a3), ty = ay - ft * Math.cos(a3), tz = az;
      seg(hx, hy, hz, kx, ky, kz);
      seg(kx, ky, kz, ax, ay, az);
      seg(ax, ay, az, tx, ty, tz);
    }
    // 躯干：骨盆→脊柱（前倾 lean）→ 头
    const sx = 0 + Math.sin(lean) * 0.5, sy = 0.85 + Math.cos(lean) * 0.5;
    seg(0, 0.85, 0, sx, sy, 0);
    seg(sx, sy, 0, sx + Math.sin(lean) * 0.25, sy + Math.cos(lean) * 0.25, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    if (overlay) { viewer.scene.remove(overlay); overlay.geometry.dispose(); }
    overlay = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: false }));
    overlay.renderOrder = 999;
    viewer.scene.add(overlay);
  };
  const drawIkOverlay = (): void => {
    type P3 = { x: number; y: number; z: number };
    type Side = { H: P3; targetKnee: P3; A: P3; eq?: { F?: { y: number }; cop?: { x: number; z: number } } };
    const hide = (): void => {
      if (ikOverlay) { viewer.scene.remove(ikOverlay); ikOverlay.geometry.dispose(); ikOverlay = null; }
    };
    if (!court || !court.released) { hide(); return; }
    const st = (globalThis as { __IK_STATE?: Record<string, Side> }).__IK_STATE;
    if (!st) { hide(); return; }
    const pos: number[] = [];
    const col: number[] = [];
    const line = (a: P3, b: P3, c: number): void => {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, bl = (c & 255) / 255;
      col.push(r, g, bl, r, g, bl);
    };
    const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
    const add = (a: P3, b: P3): P3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
    const mul = (a: P3, k: number): P3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
    const len = (a: P3): number => Math.hypot(a.x, a.y, a.z);
    const norm = (a: P3): P3 => { const n = len(a) || 1; return { x: a.x / n, y: a.y / n, z: a.z / n }; };
    const cross = (a: P3, b: P3): P3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    const arrow = (from: P3, dir: P3, length: number): void => {
      const tip = add(from, mul(dir, length));
      line(from, tip, 0xffaa00);
      let side = cross(dir, { x: 0, y: 1, z: 0 });
      if (len(side) < 1e-6) side = cross(dir, { x: 1, y: 0, z: 0 });
      side = norm(side);
      const back = add(tip, mul(dir, -0.035));
      line(tip, add(back, mul(side, 0.018)), 0xffaa00);
      line(tip, add(back, mul(side, -0.018)), 0xffaa00);
    };
    for (const sideName of ['l', 'r'] as const) {
      const d = st[sideName];
      if (!d) continue;
      const ok = [d.H, d.targetKnee, d.A].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
      if (!ok) continue;
      line(d.H, d.targetKnee, 0x00e5ff);
      line(d.targetKnee, d.A, 0x00e5ff);
      const ki = sim.body.dofByName(`knee_${sideName}`, 2);
      if (ki >= 0) {
        const ka = sim.body.dofs[ki]!.anchorWorld;
        line(d.targetKnee, { x: ka[0]!, y: ka[1]!, z: ka[2]! }, 0xffd24a);
      }
      const u = norm(sub(d.targetKnee, d.A));
      const f = Math.max(0, d.eq?.F?.y ?? 0);
      arrow(d.A, u, Math.min(0.4, f * 0.0004));
      const cop = d.eq?.cop;
      if (cop) {
        const y = 0.02;
        line({ x: cop.x - 0.03, y, z: cop.z }, { x: cop.x + 0.03, y, z: cop.z }, 0xff00ff);
        line({ x: cop.x, y, z: cop.z - 0.03 }, { x: cop.x, y, z: cop.z + 0.03 }, 0xff00ff);
      }
    }
    if (pos.length === 0) { hide(); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (ikOverlay) { viewer.scene.remove(ikOverlay); ikOverlay.geometry.dispose(); }
    ikOverlay = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    ikOverlay.renderOrder = 999;
    viewer.scene.add(ikOverlay);
  };
  const pbBtn = (id: string): HTMLButtonElement | null => document.getElementById(id) as HTMLButtonElement | null;
  const setSpeed = (v: number): void => {
    timeScale = v; stepRemain = 0;
    for (const [id, val] of [['pb-slow', 0.1], ['pb-half', 0.5], ['pb-norm', 1], ['pb-pause', 0]] as const) {
      pbBtn(id)?.classList.toggle('active', v === val);
    }
  };
  pbBtn('pb-slow')?.addEventListener('click', () => setSpeed(0.1));
  pbBtn('pb-half')?.addEventListener('click', () => setSpeed(0.5));
  pbBtn('pb-norm')?.addEventListener('click', () => setSpeed(1));
  pbBtn('pb-pause')?.addEventListener('click', () => setSpeed(0));
  pbBtn('pb-step1')?.addEventListener('click', () => { setSpeed(0); stepRemain += 1; });
  pbBtn('pb-step10')?.addEventListener('click', () => { setSpeed(0); stepRemain += 10; });

  // 关节回读：角度、速度、指令、实际、分层力矩
  const jointDump = (): string[] => {
    const body = sim.body as unknown as {
      dofs: Array<{ dofIndex: number; name: string; axis: number; angle: number; vel: number; tauMax: number }>;
    };
    const drv = (sim as unknown as { drive?: { lastBreakdown?: Array<Record<string, number>>; dampingParts?: Array<Record<string, number>> } }).drive;
    const ex = (sim as unknown as { executor?: { ledger: Array<{ cmd: number; applied: number; writes: number; saturated: boolean }> } }).executor;
    const L = ['name/axis	angle_deg	vel_rad_s	tau	cmd	applied	tauMax	sat	writes	act	servo	stiff	damp	ff	B_act	B_ref	B_tgt	B_joint'];
    for (const d of body.dofs) {
      const b = (drv?.lastBreakdown?.[d.dofIndex] ?? {}) as Record<string, number>;
      const dp = (drv?.dampingParts?.[d.dofIndex] ?? {}) as Record<string, number>;
      const l = ex?.ledger[d.dofIndex];
      const tau = (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0) + (b.stiff ?? 0);
      L.push(`${d.name}/${d.axis}	${(d.angle * 57.29578).toFixed(2)}	${d.vel.toFixed(4)}	${tau.toFixed(2)}	${(l?.cmd ?? 0).toFixed(2)}	${(l?.applied ?? 0).toFixed(2)}	${d.tauMax}	${l?.saturated ? 1 : 0}	${l?.writes ?? 0}	${(b.act ?? 0).toFixed(2)}	${(b.servo ?? 0).toFixed(2)}	${(b.stiff ?? 0).toFixed(2)}	${(b.damp ?? 0).toFixed(2)}	${(b.ff ?? 0).toFixed(2)}	${(dp.actuator ?? 0).toFixed(2)}	${(dp.reflex ?? 0).toFixed(2)}	${(dp.target ?? 0).toFixed(2)}	${(dp.joint ?? 0).toFixed(2)}`);
    }
    return L;
  };
  (globalThis as { __jointDump?: () => string[] }).__jointDump = jointDump;

  // ★ §2.253 导出本帧（用户：复制此刻关节数据和 CoP）
  let physFrames = 0;
  const exportFrame = (): void => {
    const body = sim.body as unknown as {
      dofs: Array<{ dofIndex: number; name: string; axis: number; angle: number; vel: number; tauMax: number }>;
    };
    const ctl = control as unknown as { sensors?: { com: number[]; comVel: number[]; feet: Array<Record<string, number | boolean | string>> }; warner?: unknown; drive?: unknown };
    const drv = (ctl.drive ?? (sim as unknown as { drive?: unknown }).drive) as { lastBreakdown?: Array<Record<string, number>> } | undefined;
    const s = ctl.sensors;
    const L: string[] = [];
    L.push(`# 帧导出  physFrame=${physFrames}  t=${(physFrames * DT).toFixed(4)}s`);
    if (s) {
      const mm = (v: number): string => (v * 1000).toFixed(1);
      L.push(`CoM_mm: x=${mm(s.com[0]!)} y=${mm(s.com[1]!)} z=${mm(s.com[2]!)}`);
      L.push(`CoMVel_mm_s: x=${mm(s.comVel[0]!)} y=${mm(s.comVel[1]!)} z=${mm(s.comVel[2]!)}`);
      for (const f of s.feet) {
        L.push(`foot_${f.side}: fz=${Number(f.fz).toFixed(1)}N loaded=${Boolean(f.loaded)} copValid=${Boolean(f.copValid)} copX=${mm(Number(f.copX))} copZ=${mm(Number(f.copZ))} posX=${mm(Number(f.x))} posZ=${mm(Number(f.z))}`);
      }
    }
    L.push(...jointDump());
    const text = L.join('\\n');
    console.log(text);
    const btn = pbBtn('pb-export');
    const done = (): void => { if (btn) { btn.textContent = '已复制✓'; setTimeout(() => { btn.textContent = '导出本帧(C)'; }, 900); } };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else done();
  };
  pbBtn('pb-export')?.addEventListener('click', exportFrame);
  pbBtn('hud-copy')?.addEventListener('click', () => {
    const btn = pbBtn('hud-copy');
    const text = `URL: ${location.href}
${hud?.textContent ?? ''}

${jointDump().join('\n')}`;
    const finish = (ok: boolean): void => {
      if (!btn) return;
      btn.textContent = ok ? '已复制✓' : '复制失败';
      setTimeout(() => { btn.textContent = '复制HUD'; }, 900);
    };
    const fallback = (): boolean => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => finish(true)).catch(() => finish(fallback()));
    } else {
      finish(fallback());
    }
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'c' || ev.key === 'C') exportFrame();
    if (ev.key === 'f' || ev.key === 'F') {
      const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
      if (env) {
        const on = env.SQC_FLOATING_ID !== '1';
        env.SQC_FLOATING_ID = on ? '1' : '0';
        if (on && env.SQC_FLOATING_MIX === undefined) env.SQC_FLOATING_MIX = '0.05';
        console.log(`[FLOATING_ID] ${on ? 'on' : 'off'} mix=${env.SQC_FLOATING_MIX ?? '1'}`);
      }
    }
    if (ev.key === 'l' || ev.key === 'L') {
      const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
      if (env) {
        const on = (env.SQC_SUPPORT_FZ_LOAD_K ?? '0') === '0';
        env.SQC_SUPPORT_FZ_LOAD_K = on ? '0.01' : '0';
        env.SQC_SUPPORT_FZ_LOAD_KI = on ? '0.3' : '0';
        console.log(`[FZ_LOAD] ${on ? 'on' : 'off'} K=${env.SQC_SUPPORT_FZ_LOAD_K} KI=${env.SQC_SUPPORT_FZ_LOAD_KI}`);
      }
    }
    if (ev.key === 'w' || ev.key === 'W') {
      const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
      if (env) {
        const on = env.SQC_FLOATING_BASE_SOLVE !== '1';
        env.SQC_FLOATING_BASE_SOLVE = on ? '1' : '0';
        if (on) {
          if (env.SQC_FLOATING_W_ANKLE_W === undefined) env.SQC_FLOATING_W_ANKLE_W = '0.2';
          if (env.SQC_FLOATING_W_PRESSURE_W === undefined) env.SQC_FLOATING_W_PRESSURE_W = '20';
        }
        console.log(`[W_QP] ${on ? 'on' : 'off'} ankle=${env.SQC_FLOATING_W_ANKLE_W ?? '0'} pressure=${env.SQC_FLOATING_W_PRESSURE_W ?? '0'}`);
      }
    }
    if (ev.key === 'r' || ev.key === 'R') {
      const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
      if (env) {
        const on = env.SQC_FOOT_RECOVER !== '1';
        env.SQC_FOOT_RECOVER = on ? '1' : '0';
        if (on) {
          if (env.SQC_FOOT_RECOVER_KP === undefined) env.SQC_FOOT_RECOVER_KP = '200';
          if (env.SQC_FOOT_RECOVER_KD === undefined) env.SQC_FOOT_RECOVER_KD = '20';
        }
        console.log(`[FOOT_RECOVER] ${on ? 'on' : 'off'} KP=${env.SQC_FOOT_RECOVER_KP ?? '0'} KD=${env.SQC_FOOT_RECOVER_KD ?? '0'}`);
      }
    }
  });

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // ★ §2.670 刚体上身（任何时刻切换都生效：世界冻结+脊柱超刚锁，独立于控制器）
    freezeUpperStep(
      sim.body as unknown as { indexByKey: Map<string, number>; bodies: Array<unknown>; dofByName(j: string, a: number): number },
      control.warner.manual as unknown as { setAngle(j: string, a: number, r: number, kp?: number, kd?: number): void; pin(j: string, a: number, v: boolean): void; clearAngle(j: string, a: number): void },
    );
    if (stepRemain > 0) {
      const k = Math.min(stepRemain, MAX_STEPS);
      for (let i = 0; i < k; i++) {
        if (posePreview) { const rb = sim.body.root(); rb.setLinvel({ x: 0, y: 0, z: 0 }, true); rb.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        if (DRIVE_OFF) sim.driveEnabled = false;
        supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');   // ★ 与 probe 一致：court 也每帧跑回正力，否则 live/headless 分叉
        sim.advance(1); physFrames++;
        maybeSquatHandoff();
        if (court) squatFrame(sim, control, court);
        probeStep();
      }
      stepRemain -= k;
      acc = 0;
    } else if (timeScale > 0) {
      acc += dt * timeScale;
      let n = 0;
      while (acc >= DT && n < MAX_STEPS) {
        acc -= DT; n++;
        if (DRIVE_OFF) sim.driveEnabled = false;
        supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');   // ★ 与 probe 一致：court 也每帧跑回正力，否则 live/headless 分叉
        if (posePreview) { const rb = sim.body.root(); rb.setLinvel({ x: 0, y: 0, z: 0 }, true); rb.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        sim.advance(1); physFrames++;      // 控制模块在 advance 内：感知→整合→反射→写关节
        maybeSquatHandoff();
        if (court) squatFrame(sim, control, court);
        probeStep();
      }
    }
    drawIkOverlay();
    viewer.syncShowcase(sim, dt);
    viewer.render();
    updateHud(now);
    requestAnimationFrame(frame);
  }

  const hud = document.getElementById('hud');
  let fpsN = 0, fpsShown = 0, fpsT = 0;
  function updateHud(now: number): void {
    fpsN++;
    if (now - fpsT > 500) {
      fpsShown = Math.round((fpsN * 1000) / (now - fpsT));
      fpsN = 0; fpsT = now;
    }
    if (!hud) return;
    const t = sim.torso().translation();
    const weight = sim.sk.massTotal * 9.81;
    const fz = (sim.body.footNormalForce('l', DT) + sim.body.footNormalForce('r', DT)) / weight * 100;
    const st = control.actions.status;
    const actName = st.id ? `${st.id}  t=${st.t.toFixed(1)}s${st.active ? '' : '（完）'}` : baseState() === 'squat' ? '蹲姿（空闲）' : '站定';
    const prop = control.lastProposal;
    const sup = prop?.support;
    const est = prop?.est;
    const tf = (v: number | undefined) => v === undefined || !isFinite(v) ? '∞' : v.toFixed(2);
    // ★ §2.671 方向力矩 UI 回读（受力解剖）：各方向链路净力矩（脊Σ/髋/膝/踝发动机电机）+ 救援量
    const drv = (control.warner as unknown as { drive: { lastBreakdown: Array<{ act: number; servo: number; stiff: number; damp: number; ff: number }>; dampingParts?: Array<Record<string, number>> } }).drive;
    const tq = (n: string, a: number): number => {
      const i = sim.body.dofByName(n, a);
      if (i < 0) return 0;
      const d0 = sim.body.dofs[i]!;
      if (d0.engineMotor) return (d0 as unknown as { motorTqEst?: number }).motorTqEst ?? 0;
      const b = drv.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0, ff: 0 };
      return b.act + b.servo + b.stiff + b.damp + (b.ff ?? 0);   // ★ 补 ff（基础力/staticBalance/回正力全在 ff 通道）
    };
    const dirRow = (axis: number): string => {
      const spine = tq('spine1', axis) + tq('spine2', axis) + tq('spine3', axis);
      const hipL = tq('hip_l', axis), hipR = tq('hip_r', axis);
      const knee = tq('knee_r', axis), ank = tq('foot_r', axis);
      const hip = hipL + hipR;
      return `脊${spine.toFixed(0).padStart(5)} 髋L${hipL.toFixed(0).padStart(4)} 髋R${hipR.toFixed(0).padStart(4)} 膝${knee.toFixed(0).padStart(4)} 踝${ank.toFixed(0).padStart(5)} Σ${(spine + hip + knee + ank).toFixed(0).padStart(5)}`;
    };
    const hls = court ? estimateHipLevel(sim, court) : null;
    const dampOne = (n: string, a: number, tag: string): string => {
      const i = sim.body.dofByName(n, a);
      const p = i >= 0 ? drv.dampingParts?.[i] : undefined;
      if (!p) return `${tag}:--`;
      const f = (v: unknown): string => Number(v ?? 0).toFixed(0);
      return `${tag}:${f(p.actuator)}/${f(p.reflex)}/${f(p.target)}/${f(p.joint)}`;
    };
    const shankHudLine = (): string => {
      const sh = (globalThis as unknown as { __SQC_SHANK_HUD?: Record<string, { align: number; eLat: number; soft: number; targetDeg: number; actualDeg: number; active: number; fade: number; chainOk: number }> }).__SQC_SHANK_HUD;
      if (!sh) return '';
      const one = (s: 'l' | 'r'): string => {
        const v = sh[s];
        if (!v) return '-';
        return `align=${v.align} eLat=${v.eLat.toFixed(0)} soft=${v.soft.toFixed(2)} -> ${v.targetDeg.toFixed(1)}° (${v.actualDeg.toFixed(1)}°)`;
      };
      return `侧向踝: L ${one('l')} | R ${one('r')}
`;
    };
    const hipHudLine = (): string => {
      const hh = (globalThis as unknown as { __HIP_HUD?: Record<string, { knee0: number; fLat: number; fParallel: number; fParallelSigned: number; fPerpSag: number; hip0Delta: number; hip1Delta: number; valgusHip0: number; valgusHip1: number; hip0T: number; hip1T: number }> }).__HIP_HUD;
      if (!hh) return '';
      const one = (s: 'l' | 'r'): string => {
        const v = hh[s];
        if (!v) return '-';
        const d = (x: number): string => (x * 57.2958).toFixed(1);
        return `knee0=${d(v.knee0)}° fLat=${v.fLat.toFixed(0)} fSag=${v.fPerpSag.toFixed(0)} fParS=${v.fParallelSigned.toFixed(0)} hip0Δ=${d(v.hip0Delta)}° hip1Δ=${d(v.hip1Delta)}° val=${d(v.valgusHip0)}/${d(v.valgusHip1)}°`;
      };
      return `髋: L ${one('l')} | R ${one('r')}
`;
    };
    const sag16HudLine = (): string => {
      const sg = (globalThis as unknown as { __SAG16?: Record<string, { hipFf: number; idHip: number; idKnee: number }> }).__SAG16;
      if (!sg) return '';
      const one = (s: 'l' | 'r'): string => {
        const v = sg[s];
        if (!v) return '-';
        return `${s} hipFf=${v.hipFf.toFixed(0)} idHip=${v.idHip.toFixed(0)} idKnee=${v.idKnee.toFixed(0)}`;
      };
      return `矢状ID: ${one('l')} | ${one('r')}
`;
    };
    const dampLine = [
      dampOne('hip_l', 0, 'hL0'), dampOne('hip_l', 2, 'hL2'), dampOne('knee_l', 2, 'kL2'),
      dampOne('foot_l', 0, 'fL0'), dampOne('foot_l', 2, 'fL2'),
      dampOne('hip_r', 0, 'hR0'), dampOne('knee_r', 2, 'kR2'), dampOne('foot_r', 0, 'fR0'),
    ].join(' ');
    hud.textContent =
      `FPS ${fpsShown}\n` +
      `动作: ${actName}   伺服: ${baseState()}${court ? ' · 法庭' : ''}\n` +
      (st.phase ? `阶段: ${st.phase}\n` : '') +
      (court ? (court.released
        ? `法庭: ★★★已放开★★★ 放开于 t=${court.settle.toFixed(1)}s｜当前 t=${court.t.toFixed(2)}s（自由）`
        : `法庭: 静置中(扶) t=${court.t.toFixed(1)}/${court.settle.toFixed(1)}s — ${(court.settle - court.t).toFixed(1)}s 后放开`)
        + ` com=(${(control.sensors.com[0]! * 100).toFixed(1)},${(control.sensors.com[2]! * 100).toFixed(1)})cm tilt=(p${(control.sensors.torsoTilt[0]! * 57.3).toFixed(1)},r${(control.sensors.torsoTilt[1]! * 57.3).toFixed(1)})°${court.fall >= 0 ? `  ✗倒下@${court.fall.toFixed(2)}s ${court.reason}` : '  ✓站住'}${court.safeExit !== undefined && court.safeExit >= 0 ? `  安全区@${court.safeExit.toFixed(2)}s ${court.safeReason ?? ''}` : ''}\n` : '') +
      `预警: level=${prop?.level ?? '-'}  ${prop?.reason ?? ''}\n` +
      (sup ? `支撑: ${sup.mode}/${sup.phase} 负载${sup.loadOk ? 'ok' : 'NO'} 建议${sup.suggest}\n` : '') +
      (() => {
        const sh = (globalThis as unknown as { __SUPPORT_HUD?: { side: string; phase: string; targetDiff: number; upperLean: number } }).__SUPPORT_HUD;
        return sh ? `支撑侧: ${sh.side}  相位: ${sh.phase}  ΔFz目标: ${sh.targetDiff.toFixed(0)}N  upperLean: ${(sh.upperLean * 57.3).toFixed(1)}°
` : '';
      })() +
      (est ? `预测: risk=${est.risk} TTB x=${tf(est.ttbX)}s z=${tf(est.ttbZ)}s\n` : '') +
      (est ? `XCoM x=${est.xcomX.toFixed(3)} z=${est.xcomZ.toFixed(3)}\n` : '') +
      `胸腔 y = ${t.y.toFixed(4)} m   x = ${t.x.toFixed(4)} m\n` +
      `地面力 = ${fz.toFixed(0)}% 体重\n` +
      `摩擦 L=${(control.perception.feet[0]!.frictionUse * 100).toFixed(0)}% R=${(control.perception.feet[1]!.frictionUse * 100).toFixed(0)}%
` +
      `方矩左右: ${dirRow(0)}\n` +
      `方矩前后: ${dirRow(2)}\n` +
      `救援[前=${lastRescueDbg.sagD.toFixed(2)} 左=${lastRescueDbg.latRollD.toFixed(2)}] 上身力=${upperOff() ? '关' : '开'} 刚体=${rigidUpperOn() ? '开' : '关'}\n` +
      `重力=${GRAV_OFF ? 'off' : 'on'}  驱动=${DRIVE_OFF ? 'off' : 'on'}
` + shankHudLine() + hipHudLine() + sag16HudLine();
  }

  setStatus('就绪');
  if (status) status.style.display = 'none';
  requestAnimationFrame((t) => { last = t; fpsT = t; frame(t); });
}

boot().catch((e) => {
  const status = document.getElementById('boot');
  if (status) {
    status.style.display = 'block';
    status.textContent = `启动失败：${e instanceof Error ? e.message : String(e)}`;
    status.style.color = '#b4331f';
  }
  console.error(e);
});
