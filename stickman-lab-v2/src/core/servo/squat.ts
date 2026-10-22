/** squat.ts —— 蹲下模块（2026-10-21 架构清理版）
 *
 * 蹲姿 = **一个写手**（squat.pairBase）+ **一个捕获点**（释放瞬间）+ **一套参数**（状态表）。
 *
 *   L0 基础力：释放瞬间按标准姿势算一次静态支撑力矩（子树+GRF），固定不变
 *   L1 回正力：pair 的 PD（kp·(ref−θ) − kd·ω），ref = 释放姿势目标角
 *   L2 阻尼：drive.step 的 td（唯一阻尼）
 *
 * 任何新增写手必须先在本文件登记，否则禁止。
 */

import { baseState, baseParams, baseAng } from './baseTable';
import { propose, PRI } from '../proposalBus';
import { mapMomentToAxes, sagittalBaseMoment, type AdapterAxis } from './ankleAxisAdapter';
import { ankleCoPTarget } from './ankleCoP';
import { legSupportTorque } from './virtualLegSupport';
import { squatJointLoad } from '../jointLoad';
import { allocateLateralLoad } from './lateralLoadAllocator';

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep, courtInject } from '../court';

/** 基础力缓存（释放瞬间捕获一次；离开蹲姿清空） */
/**
 * 蹲姿每帧写手链：pairBase → ankleVec → hipStab → supportClean.arm。
 * 基础力 = 法庭 setup 时 captureSquatBase() 解一次（ctl.warner.sqBaseBuf），每帧原样读；
 * 虚拟踝→髋支撑是基础力分量：τ_a 并进 ankleVec 的 Mdes，τ_k 并进 pairBase 的 knee/2，
 * 不是独立写手。回正力 = pair 的 kp·(ref−θ) − kd·ω（ref = 释放姿势）。
 */
/** 虚拟踝→髋支撑参数（基础力分量；默认开，SQC_LEG_SUPPORT=0 关）。 */
function legSupportParams(): { on: boolean; up: number; signA: number; signK: number; kneeMin: number } {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  return {
    on: String(env.SQC_LEG_SUPPORT ?? '1') === '1',
    up: Number(env.SQC_LEG_UP ?? 18.2),
    signA: Number(env.SQC_LEG_SIGN_A ?? env.SQC_LEG_SIGN ?? 1) < 0 ? -1 : 1,
    signK: Number(env.SQC_LEG_SIGN_K ?? env.SQC_LEG_SIGN ?? 1) < 0 ? -1 : 1,
    kneeMin: Number(env.SQC_LEG_KNEE ?? -0.6),
  };
}

/** 支撑门控：蹲姿/释放后/未判死/足够深屈/脚承重。 */
function legSupportActive(w: World, st: CS | undefined, side: 'l' | 'r', p: ReturnType<typeof legSupportParams>): boolean {
  if (!p.on || !st || baseState() !== 'squat' || !st.released || st.fall >= 0) return false;
  const ki = w.body.dofByName(`knee_${side}`, 2);
  if (ki < 0 || w.body.dofs[ki]!.angle > p.kneeMin) return false;
  const bw = w.sk.massTotal * 9.81;
  return w.body.footNormalForce(side, w.dt) >= 0.1 * bw;
}

/** PUSH 时给 knee/2 的 pair 目标加差动偏置（腿长差），走 pair 通道，不外加 ext 力矩。 */
function lateralKneeBias(w: World, ctl: ControlModule, st: CS): { l: number; r: number } {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const zero = { l: 0, r: 0 };
  if (String(env.SQC_LAT_LOAD_PAIR ?? '0') !== '1') return zero;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return zero;
  const L = ctl.lateral.state;
  let ls = _latPairState.get(st);
  if (!ls) { ls = { hold: 0, prev: false, cur: 0 }; _latPairState.set(st, ls); }
  const active = L.onset && L.source === 'push' && L.confidence > 0.4 && !ctl.actions.status.active;
  let target = 0;
  if (active) {
    if (!ls.prev) ls.hold = Math.abs(Number(env.SQC_LAT_LOAD_PAIR_HOLD ?? 0.2));
    ls.prev = true;
    if (ls.hold > 0) {
      const sev = Math.max(0, Math.min(1, (L.changeScore - 1) / 3));
      const maxBias = Math.abs(Number(env.SQC_LAT_LOAD_PAIR_MAX ?? 0.05));
      const sign = Number(env.SQC_LAT_LOAD_PAIR_SIGN ?? 1) < 0 ? -1 : 1;
      target = sign * L.direction * sev * maxBias;
    }
    ls.hold = Math.max(0, ls.hold - w.dt);
  } else {
    ls.prev = false;
    ls.hold = 0;
  }
  const tauRamp = Math.max(1e-3, Number(env.SQC_LAT_LOAD_PAIR_RAMP ?? 0.06));
  ls.cur += (target - ls.cur) * (1 - Math.exp(-w.dt / tauRamp));
  if (Math.abs(ls.cur) < 1e-6) ls.cur = 0;
  return { l: ls.cur, r: -ls.cur };
}

export function squatPairBase(w: World, ctl: ControlModule, st?: CS): void {
  if (baseState() !== 'squat') return;
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!baseBuf) return;   // 未捕获 → 蹲姿不写 pair
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const latPairBias = st ? lateralKneeBias(w, ctl, st) : { l: 0, r: 0 };
  const bp = baseParams() as unknown as { pairC?: number };
  const cPair = Number(env.SQC_PAIR_C ?? bp.pairC ?? 0.7);
  const vecMode = String(env.SQC_ANKLE_VEC ?? '1') !== '0';   // 3D 矢量转接口模式
  const lsp = legSupportParams();
  const coOn = String(env.SQC_COACT ?? '1') === '1';
  const coK = Number(env.SQC_COACT_K ?? 200);
  const coB = Number(env.SQC_COACT_B ?? 20);
  const coCap = Math.abs(Number(env.SQC_COACT_CAP ?? 30));
  const coHipK = Number(env.SQC_COACT_HIP_K ?? 0);
  const coHipB = Number(env.SQC_COACT_HIP_B ?? 0);
  const coHipCap = Math.abs(Number(env.SQC_COACT_HIP_CAP ?? 30));
  const legTau = new Map<'l' | 'r', { tauA: number; tauK: number }>();
  if (lsp.on) {
    for (const side of ['l', 'r'] as const) {
      if (!legSupportActive(w, st, side, lsp)) continue;
      const t = legSupportTorque(w, side, lsp.up);
      legTau.set(side, { tauA: t.tauA, tauK: t.tauK });
    }
  }
  for (const d of body.dofs) {
    if (d.engineMotor) continue;
    // ★ 预环（ring0）已被物理锁死 [rest,rest]，写手 skip（防脏账/浪费算力）
    if (d.preRing) continue;
    // ★ 基础力全走矢状面：foot/ankle 只放行 pitch（轴 2）；侧向/扭转（0/1）不给权限
    //   vecMode：foot/ankle 全部交给 ankleVec 的 3D 分配器，pair 不再写脚踝
    // ★ vec 模式：基础力只允许矢状轴 2；hip/knee/spine/neck 的轴 0 也排除
    if (vecMode && d.axis !== 2) continue;
    const isTrunkLeg = /^(hip|knee|spine|neck)/.test(d.name) && (d.axis === 0 || d.axis === 2);
    const isFootPitch = !vecMode && /^(foot|ankle)/.test(d.name) && d.axis === 2;
    if (!(isTrunkLeg || isFootPitch)) continue;
    let base = baseBuf[d.dofIndex] ?? 0;
    if (/^knee_/.test(d.name) && d.axis === 2) {
      const side = d.name.endsWith('_l') ? 'l' : 'r';
      base += (legTau.get(side)?.tauK ?? 0) * lsp.signK;
    }
    let ref = baseAng(d.name, d.axis) ?? d.angle;
    if (/^knee_/.test(d.name) && d.axis === 2) {
      ref += d.name.endsWith('_l') ? latPairBias.l : latPairBias.r;
    }
    if (coOn && /^knee_/.test(d.name) && d.axis === 2) {
      const e = ref - d.angle;
      const tco = Math.max(-coCap, Math.min(coCap, coK * e - coB * d.vel));
      base += tco;
    }
    if (coOn && /^hip_/.test(d.name) && d.axis === 2) {
      const e = ref - d.angle;
      const tco = Math.max(-coHipCap, Math.min(coHipCap, coHipK * e - coHipB * d.vel));
      base += tco;
    }
    propose({ dof: d.dofIndex, kind: 'pair', pri: PRI.action, c: cPair, rad: ref, tau: base, src: 'squat.pairBase' });
  }
}

// ── 蹲姿编排入口：法庭 + 注入（唯一入口）──
export {
  squatCourtSetup,
  courtStep,
  courtInject,
  type CourtState,
} from '../court';

/** 申请制侧向触发器：dHatHP（net force 高通）→ 额外踝侧向力矩。
 *  只加在 foot 力矩上，不动矢状 base+pair；默认关（SQC_LAT_TRIG=1 开）。 */
function lateralTriggerMx(w: World, ctl: ControlModule, st: CS): number {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LAT_TRIG ?? '0') !== '1') return 0;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return 0;
  const p = ctl.perception;
  if (!p || p.confidence < Number(env.SQC_LAT_TRIG_CONF ?? 0.4)) return 0;
  const e = p.dHatHP[2]!;
  const dead = Math.abs(Number(env.SQC_LAT_TRIG_DEAD ?? 8));
  if (Math.abs(e) < dead) return 0;
  const sign = Number(env.SQC_LAT_TRIG_SIGN ?? 1) < 0 ? -1 : 1;
  const k = Number(env.SQC_LAT_TRIG_K ?? 1);
  const h = Math.max(0.3, p.com[1]!);
  const cap = Math.abs(Number(env.SQC_LAT_TRIG_CAP ?? 30));
  return Math.max(-cap, Math.min(cap, sign * k * e * h));
}

/** 蹲姿踝 3D 矢量转接口（SQC_ANKLE_VEC=1）：
 *  - 基础力矩只走矢状：M_base=(0,0,Mz)，x 分量恒 0；
 *  - 侧向回正允许 roll：M_fb_x；
 *  - 用当前真实踝轴 A=[u0,u1,u2] 解最小二乘；
 *  - 只在蹲姿释放后运行；站立完全不调用。 */
export function squatAnkleVector(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_ANKLE_VEC ?? '1') === '0') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const body = w.body;
  const cop = new Float64Array(3);
  const FyHalf = w.sk.massTotal * 9.81 * 0.5;
  const kpRoll = Number(env.SQC_VEC_KP_ROLL ?? env.SQC_VEC_KP ?? 0);
  const kd = Number(env.SQC_VEC_KD ?? 0.2);
  const lambda = Number(env.SQC_VEC_LAMBDA ?? 1e-4);
  const debug = String(env.SQC_VEC_DBG ?? '0') === '1';
  const copXBase = st.c0.x;
  const useCP = String(env.SQC_SAG_CP ?? '1') === '1';
  const lambdaCp = Number(env.SQC_SAG_LAMBDA ?? 1.0);
  const useTorsion = String(env.SQC_TORSION ?? '1') === '1';
  const kpTorsion = Number(env.SQC_TORSION_KP ?? 20);
  const kdTorsion = Number(env.SQC_TORSION_KD ?? 2);
  const capTorsion = Math.abs(Number(env.SQC_TORSION_CAP ?? 10));
  const useAnkleCop = String(env.SQC_ANKLE_COP ?? '1') === '1';
  const zLimAlloc = Math.abs(Number(env.SQC_COP_Z_LIMIT ?? 0.09));
  const sideZ = (s: 'l' | 'r'): number => {
    const i = body.dofByName(`foot_${s}`, 2);
    return i >= 0 ? body.dofs[i]!.anchorWorld[2]! : 0;
  };
  const fzL = body.footNormalForce('l', w.dt);
  const fzR = body.footNormalForce('r', w.dt);
  const zL0 = sideZ('l'), zR0 = sideZ('r');
  const wsum = Math.max(1e-6, fzL + fzR);
  const wL = fzL / wsum, wR = fzR / wsum;
  const omega = Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!));
  const rawZ = (useAnkleCop || useCP)
    ? (1 + lambdaCp / omega) * (ctl.sensors.com[2]! + ctl.sensors.comVel[2]! / omega - st.c0.z)
    : 0;
  const totalZ = wL * zL0 + wR * zR0 + rawZ;
  let pL = Math.max(zL0 - zLimAlloc, Math.min(zL0 + zLimAlloc, zL0 + rawZ));
  let pR = Math.max(zR0 - zLimAlloc, Math.min(zR0 + zLimAlloc, zR0 + rawZ));
  for (let it = 0; it < 3; it++) {
    const err = totalZ - (wL * pL + wR * pR);
    if (Math.abs(err) < 1e-9) break;
    const roomL = err > 0 ? zL0 + zLimAlloc - pL : pL - (zL0 - zLimAlloc);
    const roomR = err > 0 ? zR0 + zLimAlloc - pR : pR - (zR0 - zLimAlloc);
    const sum = Math.max(1e-9, wL * Math.max(0, roomL) + wR * Math.max(0, roomR));
    const use = Math.max(-1, Math.min(1, err / sum));
    if (roomL > 0) pL += use * Math.min(Math.abs(err), Math.abs(roomL)) * Math.sign(err);
    if (roomR > 0) pR += use * Math.min(Math.abs(err), Math.abs(roomR)) * Math.sign(err);
    pL = Math.max(zL0 - zLimAlloc, Math.min(zL0 + zLimAlloc, pL));
    pR = Math.max(zR0 - zLimAlloc, Math.min(zR0 + zLimAlloc, pR));
  }
  const zAlloc: Record<'l' | 'r', number> = { l: pL, r: pR };
  const useLegCop = String(env.SQC_LEG_COP ?? '0') === '1';
  if (useLegCop) {
    const kLeg = Number(env.SQC_LEG_COP_K ?? 2.0);
    const kdLeg = Number(env.SQC_LEG_COP_KD ?? 0.2);
    const maxLeg = Math.abs(Number(env.SQC_LEG_COP_MAX ?? 0.06));
    const signLeg = Number(env.SQC_LEG_COP_SIGN ?? 1) < 0 ? -1 : 1;
    const biasLeg = Number(env.SQC_LEG_COP_BIAS ?? 0);
    const src = String(env.SQC_LEG_COP_SRC ?? 'hip');
    const kneeZ = (s: 'l' | 'r'): number => {
      const i = body.dofByName(`knee_${s}`, 2);
      return i >= 0 ? body.dofs[i]!.anchorWorld[2]! : 0;
    };
    const hipZ = (s: 'l' | 'r'): number => {
      const i = body.dofByName(`hip_${s}`, 0);
      return i >= 0 ? body.dofs[i]!.anchorWorld[2]! : 0;
    };
    let refs = _legCopRefs.get(st);
    if (!refs) {
      refs = { l: kneeZ('l'), r: kneeZ('r') };
      _legCopRefs.set(st, refs);
    }
    for (const side of ['l', 'r'] as const) {
      const h0 = hipZ(side);
      const href = side === 'l' ? (st.hipRefL ?? h0) : (st.hipRefR ?? h0);
      const dist = src === 'knee' ? kneeZ(side) - refs[side] : h0 - href;
      const bi = body.indexByKey.get(src === 'knee' ? `shin_${side}` : `thigh_${side}`);
      const vz = bi !== undefined ? body.bodies[bi]!.linvel().z : 0;
      const raw = biasLeg + signLeg * kLeg * dist - kdLeg * vz;
      const corr = Math.max(-maxLeg, Math.min(maxLeg, raw));
      const z0 = side === 'l' ? zL0 : zR0;
      zAlloc[side] = Math.max(z0 - zLimAlloc, Math.min(z0 + zLimAlloc, zAlloc[side] + corr));
    }
  }
  const latCopOn = String(env.SQC_LAT_COP ?? '0') === '1';
  const servoOn = String(env.SQC_LAT_SERVO ?? '1') === '1' && ctl.lateralServo.active;
  const servoCop = servoOn ? ctl.lateralServo.copReq : 0;
  let latCopDp = 0;
  if (latCopOn) {
    const L = ctl.lateral.state;
    let ls = _latCopState.get(st);
    if (!ls) { ls = { hold: 0, prev: false }; _latCopState.set(st, ls); }
    const active = L.onset && L.source === 'push' && L.confidence > 0.4 && !ctl.actions.status.active;
    if (active) {
      if (!ls.prev) ls.hold = Math.abs(Number(env.SQC_LAT_COP_HOLD ?? 0.15));
      ls.prev = true;
      if (ls.hold > 0) {
        const sev = Math.max(0, Math.min(1, (L.changeScore - 1) / 3));
        const maxDp = Math.abs(Number(env.SQC_LAT_COP_DP ?? 0.04));
        const sign = Number(env.SQC_LAT_COP_SIGN ?? 1) < 0 ? -1 : 1;
        latCopDp = sign * L.direction * sev * maxDp;
      }
      ls.hold = Math.max(0, ls.hold - w.dt);
    } else {
      ls.prev = false;
      ls.hold = 0;
    }
  }
  for (const side of ['l', 'r'] as const) {
    const fz = body.footNormalForce(side, w.dt);
    if (fz < 1 || !body.footCoP(side, w.dt, cop)) continue;
    const pi = body.dofByName(`foot_${side}`, 2);
    const ri = body.dofByName(`foot_${side}`, 0);
    if (pi < 0) continue;
    const dPitch = body.dofs[pi]!;
    const ankX = dPitch.anchorWorld[0]!, ankZ = dPitch.anchorWorld[2]!;
    const rx = cop[0]! - ankX, rz = cop[1]! - ankZ;
    const copZLim = Math.abs(Number(env.SQC_COP_Z_LIMIT ?? 0.09));
    const footLocal = String(env.SQC_FOOT_LOCAL ?? '0') === '1';
    const footAdm = Number(env.SQC_FOOT_ADM ?? 0.5);
    const footKs = Number(env.SQC_FOOT_KSPRING ?? 30);
    const footBs = Number(env.SQC_FOOT_BSPRING ?? 3);
    const footKcop = Number(env.SQC_FOOT_KCOP ?? 0.6);
    const footMxCap = Math.abs(Number(env.SQC_FOOT_MX_CAP ?? 40));
    let targetX = copXBase;
    let targetZ = cop[1]!;
    if (useAnkleCop || useCP) {
      const cp = ankleCoPTarget(
        ctl.sensors.com[0]!, ctl.sensors.com[2]!, ctl.sensors.comVel[0]!, ctl.sensors.comVel[2]!, ctl.sensors.com[1]!,
        copXBase, st.c0.z,
        { minX: ankX - 0.12, maxX: ankX + 0.12, minZ: ankZ - copZLim, maxZ: ankZ + copZLim },
        lambdaCp,
        ankZ,
      );
      targetX = cp.pX;
      // 伺服 CoP 是 rawZ 之外的附加回正偏移；载荷分担部分由 squatLateralServo 翻脚，
      // 两路合起来≈servo 的任务 CoP。保留 rawZ（基线 CP 跟踪），不替换。
      targetZ = zAlloc[side];
      if (latCopOn && !servoOn) targetZ = Math.max(ankZ - copZLim, Math.min(ankZ + copZLim, targetZ + latCopDp));
      if (servoOn) targetZ = Math.max(ankZ - copZLim, Math.min(ankZ + copZLim, targetZ + servoCop));
    }
    const Mbase = sagittalBaseMoment(FyHalf, targetX, ankX);   // 目标 CoP 随当前 CP 移动
    const rollSign = Number(env.SQC_COP_ROLL_SIGN ?? 1) < 0 ? -1 : 1;
    const rollK = Number(env.SQC_COP_ROLL_K ?? 0.9);
    let Mx: number;
    if (useAnkleCop && footLocal && ri >= 0) {
      const fd = body.dofs[ri]!;
      const phi0 = baseAng(`foot_${side}`, 0) ?? fd.angle;
      const pErr = targetZ - cop[1]!;
      const phiRef = phi0 + footAdm * pErr;
      const spring = footKs * (phiRef - fd.angle) - footBs * fd.vel;
      const copTerm = footKcop * fz * pErr;
      Mx = Math.max(-footMxCap, Math.min(footMxCap, rollSign * (spring + copTerm)));
    } else {
      Mx = useAnkleCop ? rollSign * rollK * fz * (targetZ - cop[1]!) : (kpRoll * fz * rz - kd * (ri >= 0 ? body.dofs[ri]!.vel : 0));
    }
    const Mz = Mbase[2] - kd * dPitch.vel;
    const Mpre = musclePreMoment(w, side);   // 申请制前馈：虚拟肌肉线 → 踝力矩
    const latTrig = lateralTriggerMx(w, ctl, st);
    const fzShare = fz / Math.max(1e-6, fzL + fzR);
    const lsp = legSupportParams();
    const ls = legSupportActive(w, st, side, lsp)
      ? legSupportTorque(w, side, lsp.up)
      : { tauA: 0, tauK: 0 };
    // 虚拟支撑的扭转通道：髋/骨盆 twist → 踝/foot yaw 反扭矩
    let My = 0;
    if (useTorsion) {
      const hi1 = body.dofByName(`hip_${side}`, 1);
      if (hi1 >= 0) {
        const hd = body.dofs[hi1]!;
        const eY = (baseAng(`hip_${side}`, 1) ?? hd.angle) - hd.angle;
        My = Math.max(-capTorsion, Math.min(capTorsion, kpTorsion * eY - kdTorsion * hd.vel));
      }
    }
    const Mdes: [number, number, number] = [Mx + Mpre[0] + latTrig * fzShare, My, Mz + Mpre[2] + ls.tauA * lsp.signA];
    const axes: AdapterAxis[] = [];
    const idx: number[] = [];
    for (const k of [0, 1, 2]) {
      const i = body.dofByName(`foot_${side}`, k);
      if (i < 0) { axes.push({ u: [0, 0, 0], tauMax: 0, available: false }); idx.push(-1); continue; }
      const d = body.dofs[i]!;
      axes.push({ u: [d.axisWorld[0]!, d.axisWorld[1]!, d.axisWorld[2]!], tauMax: d.tauMax > 0 ? d.tauMax : 320, available: !d.preRing });
      idx.push(i);
    }
    const out = mapMomentToAxes(Mdes, axes, lambda);
    // 侧向 fine task 的脚力矩（已由 squatFineLateral 算好，保留 ankleVec 阻尼/前馈）
    if (String(env.SQC_FINE_LAT ?? '1') === '1') out.tau[0] = (out.tau[0] ?? 0) + (side === 'l' ? _fineFootL : _fineFootR);
    for (let k = 0; k < 3; k++) {
      const i = idx[k]!;
      if (i < 0 || !axes[k]!.available) continue;
      propose({ dof: i, kind: 'ext', pri: PRI.reflex, tau: out.tau[k]!, src: 'squat.ankleVec' });
    }
    if (debug) {
      const Mext: [number, number, number] = [0, 0, 0];
      const Mapp: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const i = idx[k]!;
        if (i < 0 || !axes[k]!.available) continue;
        const u = axes[k]!.u;
        const te = out.tau[k]!;
        Mext[0] += te * u[0]; Mext[1] += te * u[1]; Mext[2] += te * u[2];
        const ta = w.executor.ledger[i]!.applied;
        Mapp[0] += ta * u[0]; Mapp[1] += ta * u[1]; Mapp[2] += ta * u[2];
      }
      console.log(`VEC t=${st.t.toFixed(3)} ${side} fz=${fz.toFixed(0)} rx=${(rx * 1000).toFixed(0)} rz=${(rz * 1000).toFixed(0)} Mdes=(${Mdes.map((v) => v.toFixed(1)).join(',')}) Mpre=(${Mpre[0].toFixed(1)},0,${Mpre[2].toFixed(1)}) Fm=${Mpre[3].toFixed(0)} Mext=(${Mext.map((v) => v.toFixed(1)).join(',')}) Mapp=(${Mapp.map((v) => v.toFixed(1)).join(',')}) tau=(${out.tau.map((v) => v.toFixed(1)).join(',')}) res=${out.residualNorm.toFixed(2)}`);
    }
  }
}

/** 蹲姿专属虚拟肌肉线前馈（申请制）：
 *  内侧足 → 内侧膝的斜向内下力线，力 Fm 预计算；取它对踝的力矩作为侧向前馈。
 *  不是 hip/膝常值力矩；踝把 M_pre 变成 CoP 偏移，横向力由 GRF/摩擦出。
 *  预算：Fm ≤ SQC_MUSCLE_F_MAX，|M_pre| ≤ SQC_MUSCLE_M_MAX。 */
function musclePreMoment(w: World, side: 'l' | 'r'): [number, number, number, number] {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const fMax = Math.abs(Number(env.SQC_MUSCLE_F_MAX ?? 2000));
  const fRaw = Number(env.SQC_MUSCLE_F ?? -230);
  if (!Number.isFinite(fRaw) || fRaw === 0) return [0, 0, 0, 0];
  const Fm = Math.max(-fMax, Math.min(fMax, fRaw));
  const body = w.body;
  const ai = body.dofByName(`foot_${side}`, 2);
  const ki = body.dofByName(`knee_${side}`, 2);
  if (ai < 0 || ki < 0) return [0, 0, 0, 0];
  const a = body.dofs[ai]!.anchorWorld;
  const k = body.dofs[ki]!.anchorWorld;
  const med = side === 'l' ? -1 : 1;
  // 内侧附着点（相对踝/膝）：斜向内下（从膝指向足）
  const pFoot = { x: a[0]! + 0.02, y: a[1]! - 0.03, z: a[2]! + med * 0.03 };
  const pKnee = { x: k[0]!, y: k[1]!, z: k[2]! + med * 0.06 };
  const L = { x: pKnee.x - pFoot.x, y: pKnee.y - pFoot.y, z: pKnee.z - pFoot.z };
  const len = Math.hypot(L.x, L.y, L.z) || 1;
  const d = { x: L.x / len, y: L.y / len, z: L.z / len };
  // 肌肉对膝的拉力：从膝指向足（斜向内下）
  const F = { x: -Fm * d.x, y: -Fm * d.y, z: -Fm * d.z };
  const r = { x: pKnee.x - a[0]!, y: pKnee.y - a[1]!, z: pKnee.z - a[2]! };
  const M = {
    x: r.y * F.z - r.z * F.y,
    y: r.z * F.x - r.x * F.z,
    z: r.x * F.y - r.y * F.x,
  };
  const mMax = Math.abs(Number(env.SQC_MUSCLE_M_MAX ?? 50));
  const lim = (v: number): number => Math.max(-mMax, Math.min(mMax, v));
  const useMz = String(env.SQC_MUSCLE_MZ ?? '0') === '1';
  return [lim(M.x), 0, useMz ? lim(M.z) : 0, Fm];
}

/** 蹲姿髋矢状稳定（申请制 PD，不是常值前馈）：
 *  只修 hip/2 残余角/速度；经 propose ext，单一写手、有预算、可审计。 */
export function squatHipStab(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const kp = Number(env.SQC_HIP_STAB_KP ?? 50);
  if (kp === 0) return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const kd = Number(env.SQC_HIP_STAB_KD ?? 5);
  const tmax = Math.abs(Number(env.SQC_HIP_STAB_TMAX ?? 200));
  const dbg = String(env.SQC_HIP_STAB_DBG ?? '0') === '1';
  const body = w.body;
  for (const side of ['l', 'r'] as const) {
    const hi = body.dofByName(`hip_${side}`, 2);
    if (hi < 0) continue;
    const d = body.dofs[hi]!;
    const ref = baseAng(`hip_${side}`, 2) ?? d.angle;
    const tau = Math.max(-tmax, Math.min(tmax, kp * (ref - d.angle) - kd * d.vel));
    propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.hipStab' });
    if (dbg) console.log(`HIPSTAB t=${st.t.toFixed(3)} ${side} ang=${(d.angle * 57.3).toFixed(1)}° v=${d.vel.toFixed(2)} ref=${(ref * 57.3).toFixed(1)}° tau=${tau.toFixed(0)}`);
  }
}

/** 侧向 fine：CoM→CoP + 躯干 roll（hip/0 + spine1） + knee/1 关节 P。 */
const _fineState = new WeakMap<CS, { integ: number; rollRef: number | null; hipRefL: number | null; hipRefR: number | null }>();
const _legCopRefs = new WeakMap<CS, { l: number; r: number }>();
const _latCopState = new WeakMap<CS, { hold: number; prev: boolean }>();
const _latLoadState = new WeakMap<CS, { hold: number; prev: boolean }>();
const _latPairState = new WeakMap<CS, { hold: number; prev: boolean; cur: number }>();
function torsoRollRobust(w: World): number {
  const i = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  if (i === undefined) return 0;
  const q = w.body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return Math.atan2(uz, Math.hypot(ux, uy));
}
const _hipTaskState = new WeakMap<CS, { refL: number; refR: number; prevL: number; prevR: number }>();
const _hipServoState = new WeakMap<CS, { t0: number }>();
const _hipDampState = new WeakMap<CS, { l: number; r: number }>();
const _hipCopRef = new WeakMap<CS, number>();
const _latLockOrig = new WeakMap<CS, Map<number, { min: number; max: number }>>();
let _fineFootL = 0, _fineFootR = 0;
function squatFineLateral(w: World, ctl: ControlModule, st: CS): void {
  _fineFootL = 0; _fineFootR = 0;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_FINE_LAT ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;

  let fs = _fineState.get(st);
  if (!fs) { fs = { integ: 0, rollRef: null, hipRefL: null, hipRefR: null }; _fineState.set(st, fs); }
  const kcop = Number(env.SQC_FINE_KCOP ?? 8.0);
  const ki = Number(env.SQC_FINE_KI ?? 0);
  const dead = Math.abs(Number(env.SQC_FINE_DEAD ?? 0.5)) / 1000;
  const cap = Math.abs(Number(env.SQC_FINE_CAP ?? 8));
  const sign = Number(env.SQC_FINE_SIGN ?? 1) < 0 ? -1 : 1;
  const useRoll = String(env.SQC_FINE_ROLL ?? '1') === '1';
  const kpRoll = Number(env.SQC_FINE_KP_ROLL ?? 5);
  const kdRoll = Number(env.SQC_FINE_KD_ROLL ?? 0.5);
  const capRoll = Math.abs(Number(env.SQC_FINE_CAP_ROLL ?? 3));
  const rollSign = Number(env.SQC_FINE_ROLL_SIGN ?? 1) < 0 ? -1 : 1;
  const useKnee = String(env.SQC_FINE_KNEE ?? '1') === '1';
  const kpKnee = Number(env.SQC_FINE_KP_KNEE ?? 300);
  const kpPelvis = Number(env.SQC_FINE_KP_PELVIS ?? 0);
  const pelvisSign = Number(env.SQC_FINE_PELVIS_SIGN ?? 1) < 0 ? -1 : 1;
  const capKnee = Math.abs(Number(env.SQC_FINE_CAP_KNEE ?? 20));

  const e = ctl.sensors.com[2]! - st.c0.z;
  if (Math.abs(e) >= dead) fs.integ += e * w.dt;
  fs.integ = Math.max(-0.02, Math.min(0.02, fs.integ));
  const dp = sign * (kcop * e + ki * fs.integ);

  if (fs.rollRef === null) fs.rollRef = torsoRollRobust(w);
  let tRoll = 0;
  if (useRoll) {
    const roll = torsoRollRobust(w);
    const rollRate = ctl.sensors.torsoAngVel[0]!;
    const eRoll = fs.rollRef - roll;
    if (Math.abs(eRoll) > 0.1 / 57.3) tRoll = Math.max(-capRoll, Math.min(capRoll, rollSign * (kpRoll * eRoll - kdRoll * rollRate)));
  }
  const tRollSpine = tRoll * Number(env.SQC_FINE_ROLL_SPINE ?? 0.3);
  if (Math.abs(tRollSpine) > 1e-9) {
    const si = w.body.dofByName('spine1', 0);
    if (si >= 0) propose({ dof: si, kind: 'ext', pri: PRI.direct, tau: tRollSpine, src: 'squat.fineTask.roll' });
  }

  for (const side of ['l', 'r'] as const) {
    // pelvis 误差用于 AnkleCoP 关闭时的脚 CoP 偏置；hip/0 由 squatHipTask 单独写。
    let ePelvis = 0;
    const hbi = w.body.indexByKey.get(`thigh_${side}`);
    if (hbi !== undefined) {
      const hz = w.body.bodies[hbi]!.translation().z;
      let hr = side === 'l' ? fs.hipRefL : fs.hipRefR;
      if (hr === null) { hr = hz; if (side === 'l') fs.hipRefL = hr; else fs.hipRefR = hr; }
      ePelvis = hz - hr;
    }
    const fzSide = w.body.footNormalForce(side, w.dt);
    // 正常承重膝由 passiveLock 管；fine knee 只给悬空/卸载腿
    if (useKnee && fzSide < 0.1 * w.sk.massTotal * 9.81) {
      const ki2 = w.body.dofByName(`knee_${side}`, 1);
      if (ki2 >= 0) {
        const kd = w.body.dofs[ki2]!;
        const eK = (baseAng(`knee_${side}`, 1) ?? kd.angle) - kd.angle;
        if (Math.abs(eK) > 0.1 / 57.3) {
          const tK = Math.max(-capKnee, Math.min(capKnee, kpKnee * eK));
          if (Math.abs(tK) > 1e-9) propose({ dof: ki2, kind: 'ext', pri: PRI.reflex, tau: tK, src: 'squat.fineTask.knee' });
        }
      }
    }
    // pelvis 误差同时用于脚 CoP（AnkleCoP 关闭时）；hip 位置任务已在上方。
    const fz = fzSide;
    const dpSide = dp + pelvisSign * kpPelvis * ePelvis;
    const tf = String(env.SQC_ANKLE_COP ?? '1') === '1' ? 0 : Math.max(-cap, Math.min(cap, fz * dpSide));
    if (side === 'l') _fineFootL = tf; else _fineFootR = tf;
    if (String(env.SQC_FINE_DBG ?? '0') === '1' && st.t >= 2.0 && st.t <= 2.4 && Math.round(st.t * 240) % 12 === 0) {
      console.log(`FINECOP t=${st.t.toFixed(3)} ${side} e=${(e * 1000).toFixed(2)}mm dp=${(dp * 1000).toFixed(2)}mm fz=${fz.toFixed(0)} tf=${tf.toFixed(2)} ep=${(ePelvis*1000).toFixed(1)}mm`);
    }
  }
}

/** 髋伺服：静态，唯一 hip/0 写手；内部 EARLY→RECOVER→FINE。
 *  q 误差 + q 速度，早期大增益/大 cap，无积分；不是 z 位置环。 */
function squatHipServo(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_HIP_SERVO ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  let ss = _hipServoState.get(st);
  if (!ss) { ss = { t0: w.clock }; _hipServoState.set(st, ss); }
  const age = Math.max(0, w.clock - ss.t0);
  const earlyMs = Math.max(0, Number(env.SQC_HIP_EARLY_MS ?? 150)) / 1000;
  const recoverMs = Math.max(0, Number(env.SQC_HIP_RECOVER_MS ?? 150)) / 1000;
  const kpE = Number(env.SQC_HIP_EARLY_KP ?? 50);
  const kdE = Number(env.SQC_HIP_EARLY_KD ?? 30);
  const capE = Math.abs(Number(env.SQC_HIP_EARLY_CAP ?? 15));
  const kpF = Number(env.SQC_HIP_FINE_KP ?? 50);
  const kdF = Number(env.SQC_HIP_FINE_KD ?? 10);
  const capF = Math.abs(Number(env.SQC_HIP_FINE_CAP ?? 10));
  const signServo = Number(env.SQC_HIP_SERVO_SIGN ?? 1) < 0 ? -1 : 1;
  let wgt = 0;
  if (age <= earlyMs) wgt = 1;
  else if (age <= earlyMs + recoverMs) wgt = 1 - (age - earlyMs) / Math.max(1e-6, recoverMs);
  const kp = kpF + (kpE - kpF) * wgt;
  const kd = kdF + (kdE - kdF) * wgt;
  const cap = capF + (capE - capF) * wgt;
  for (const side of ['l', 'r'] as const) {
    const hi = w.body.dofByName(`hip_${side}`, 0);
    if (hi < 0) continue;
    const d = w.body.dofs[hi]!;
    const qref = baseAng(`hip_${side}`, 0) ?? d.angle;
    const e = qref - d.angle;
    const tau = Math.max(-cap, Math.min(cap, signServo * (kp * e - kd * d.vel)));
    if (Math.abs(tau) > 1e-9) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.hipServo' });
    if (String(env.SQC_HIP_SERVO_DBG ?? '0') === '1' && side === 'l' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
      console.log(`HIPSERVO t=${w.clock.toFixed(2)} q=${(d.angle*57.3).toFixed(2)} ref=${(qref*57.3).toFixed(2)} v=${d.vel.toFixed(2)} w=${wgt.toFixed(2)} tau=${tau.toFixed(1)}`);
    }
  }
}

/** 髋任务：控髋中心 + 髋宽度，一个写手写 hip/0 两侧。
 *  不是 q 锁，不是脚 CoP 偏置；hip/1/knee 的联合分配后续再加。 */
function squatHipTask(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_HIP_TASK ?? '0') !== '1') return;
  if (baseState() !== 'squat' || st.fall >= 0) return;
  const hl = w.body.dofByName('hip_l', 0);
  const hr = w.body.dofByName('hip_r', 0);
  if (hl < 0 || hr < 0) return;
  const zl = w.body.dofs[hl]!.anchorWorld[2]!;
  const zr = w.body.dofs[hr]!.anchorWorld[2]!;
  let hs = _hipTaskState.get(st);
  if (!hs) { hs = { refL: st.hipRefL ?? zl, refR: st.hipRefR ?? zr, prevL: zl, prevR: zr }; _hipTaskState.set(st, hs); }
  // ★ 预释放帧也要更新 prev/捕获 ref，否则释放后第一帧才捕获，已经晚了。
  if (!st.released) { hs.prevL = zl; hs.prevR = zr; return; }
  const dt = Math.max(1e-6, w.dt);
  const vC = ((zl + zr) - (hs.prevL + hs.prevR)) / (2 * dt);
  const vW = ((zl - zr) - (hs.prevL - hs.prevR)) / dt;
  hs.prevL = zl; hs.prevR = zr;
  const eC = (zl + zr) / 2 - (hs.refL + hs.refR) / 2;
  const eW = (zl - zr) - (hs.refL - hs.refR);
  const kc = Number(env.SQC_HIP_TASK_KC ?? 0);
  const kw = Number(env.SQC_HIP_TASK_KW ?? 300);
  const kdC = Number(env.SQC_HIP_TASK_KD ?? 2);
  const kdW = Number(env.SQC_HIP_TASK_KDW ?? 2);
  // ★ 外向侧滑阻尼：直接按 hip 锚点 z 的线速度阻尼，不是 q 速度。
  const dampC = Number(env.SQC_HIP_DAMP_C ?? 300);
  const dampW = Number(env.SQC_HIP_DAMP_W ?? 300);
  const cap = Math.abs(Number(env.SQC_HIP_TASK_CAP ?? 30));
  const signC = Number(env.SQC_HIP_TASK_SIGN_C ?? 1) < 0 ? -1 : 1;
  const signW = Number(env.SQC_HIP_TASK_SIGN_W ?? 1) < 0 ? -1 : 1;
  const fC = signC * (kc * eC - kdC * vC - dampC * vC);
  const fW = signW * (kw * eW - kdW * vW - dampW * vW);
  const tL = Math.max(-cap, Math.min(cap, fC + fW));
  const tR = Math.max(-cap, Math.min(cap, fC - fW));
  if (Math.abs(tL) > 1e-9) propose({ dof: hl, kind: 'ext', pri: PRI.reflex, tau: tL, src: 'squat.hipTask' });
  if (Math.abs(tR) > 1e-9) propose({ dof: hr, kind: 'ext', pri: PRI.reflex, tau: tR, src: 'squat.hipTask' });
  if (String(env.SQC_HIP_TASK_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
    console.log(`HIPTASK t=${w.clock.toFixed(2)} zL=${(zl*1000).toFixed(1)} zR=${(zr*1000).toFixed(1)} eC=${(eC*1000).toFixed(1)} eW=${(eW*1000).toFixed(1)} ref=${((hs.refL-hs.refR)*1000).toFixed(1)} tL=${tL.toFixed(1)} tR=${tR.toFixed(1)}`);
  }
}

/** 承重相关被动锁：只锁 knee/1（frontal），不锁矢状；deadband + 载荷刚度。 */
function squatPassiveLock(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LOCK ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const W = w.sk.massTotal * 9.81;
  const k0 = Number(env.SQC_LOCK_K0 ?? 20);
  const kLoad = Number(env.SQC_LOCK_KL ?? 800);
  const kd = Number(env.SQC_LOCK_KD ?? 2);
  const cap = Math.abs(Number(env.SQC_LOCK_CAP ?? 30));
  const dead = Math.abs(Number(env.SQC_LOCK_DEAD ?? 1.5)) / 57.3;
  const useHipLock = String(env.SQC_LOCK_HIP ?? '1') === '1';
  const hipTaskOn = String(env.SQC_HIP_TASK ?? '0') === '1';
  const hipDamp = Number(env.SQC_HIP_DAMP ?? 1000);
  const hipLockCap = Math.abs(Number(env.SQC_HIP_LOCK_CAP ?? 50));
  const hipLockKLoad = Number(env.SQC_HIP_LOCK_KLOAD ?? 150);
  const hipCommonCap = Math.abs(Number(env.SQC_HIP_COMMON_CAP ?? 1e9));
  const hipDiffCap = Math.abs(Number(env.SQC_HIP_DIFF_CAP ?? hipLockCap));
  const hipRaw = new Map<'l' | 'r', number>();
  let ds = _hipDampState.get(st);
  if (!ds) { ds = { l: 0, r: 0 }; _hipDampState.set(st, ds); }
  const deadH = Math.abs(Number(env.SQC_LOCK_HIP_DEAD ?? 2.0)) / 57.3;
  const useSpineLock = String(env.SQC_LOCK_SPINE ?? '1') === '1';
  const kpSpine = Number(env.SQC_LOCK_SPINE_KP ?? 100);
  const kdSpine = Number(env.SQC_LOCK_SPINE_KD ?? 5);
  const capSpine = Math.abs(Number(env.SQC_LOCK_SPINE_CAP ?? 30));
  for (const side of ['l', 'r'] as const) {
    const ki = w.body.dofByName(`knee_${side}`, 1);
    if (ki < 0) continue;
    const fz = w.body.footNormalForce(side, w.dt);
    if (fz < 0.1 * W) continue;
    const d = w.body.dofs[ki]!;
    const e = (baseAng(`knee_${side}`, 1) ?? d.angle) - d.angle;
    if (Math.abs(e) < dead) continue;
    const Kl = k0 + kLoad * (fz / W);
    const tau = Math.max(-cap, Math.min(cap, Kl * e - kd * d.vel));
    if (Math.abs(tau) > 1e-9) propose({ dof: ki, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.passiveLock' });
    if (useHipLock && !hipTaskOn) {
      for (const [ax, kh, kload, cH0] of [[0, 10, 150, 15]] as const) {
        const cH = hipLockCap;
        const hi = w.body.dofByName(`hip_${side}`, ax);
        if (hi < 0) continue;
        const hd = w.body.dofs[hi]!;
        const eh = (baseAng(`hip_${side}`, ax) ?? hd.angle) - hd.angle;
        const hz = hd.anchorWorld[2]!;
        const prev = side === 'l' ? ds.l : ds.r;
        const vz = (hz - prev) / Math.max(1e-6, w.dt);
        if (side === 'l') ds.l = hz; else ds.r = hz;
        if (Math.abs(eh) < deadH && Math.abs(hipDamp * vz) < 1e-9) continue;
        const Kh = kh + hipLockKLoad * (fz / W);
        const th = Math.max(-cH, Math.min(cH, Kh * eh - kd * hd.vel - hipDamp * vz));
        hipRaw.set(side, th);
      }
    }
  }
  if (useHipLock && hipRaw.size > 0) {
    const tl = hipRaw.get('l') ?? 0;
    const tr = hipRaw.get('r') ?? 0;
    const common = Math.max(-hipCommonCap, Math.min(hipCommonCap, (tl + tr) / 2));
    const diff = Math.max(-hipDiffCap, Math.min(hipDiffCap, (tl - tr) / 2));
    const hipTest = Number(env.SQC_HIP_TEST ?? 0);
    const outL = common + diff + hipTest;
    const outR = common - diff + hipTest;
    if (Math.abs(outL) > 1e-9) {
      const hi = w.body.dofByName('hip_l', 0);
      if (hi >= 0) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: outL, src: 'squat.passiveLock.hip' });
    }
    if (Math.abs(outR) > 1e-9) {
      const hi = w.body.dofByName('hip_r', 0);
      if (hi >= 0) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: outR, src: 'squat.passiveLock.hip' });
    }
    if (String(env.SQC_HIP_COMMON_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
      console.log(`HIPCM t=${w.clock.toFixed(2)} raw=${tl.toFixed(1)},${tr.toFixed(1)} common=${common.toFixed(1)} diff=${diff.toFixed(1)} out=${outL.toFixed(1)},${outR.toFixed(1)}`);
    }
  }
  if (String(env.SQC_HIP_TWIST_LOCK ?? '1') === '1') {
    const kt = Number(env.SQC_HIP_TWIST_K ?? 120);
    const bt = Number(env.SQC_HIP_TWIST_B ?? 8);
    const ct = Math.abs(Number(env.SQC_HIP_TWIST_CAP ?? 20));
    const dt = Math.abs(Number(env.SQC_HIP_TWIST_DEAD ?? 0.5)) / 57.3;
    for (const side of ['l', 'r'] as const) {
      if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
      const hi = w.body.dofByName(`hip_${side}`, 1);
      if (hi < 0) continue;
      const d = w.body.dofs[hi]!;
      const e = (baseAng(`hip_${side}`, 1) ?? d.angle) - d.angle;
      if (Math.abs(e) < dt) continue;
      const tau = Math.max(-ct, Math.min(ct, kt * e - bt * d.vel));
      if (Math.abs(tau) > 1e-9) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.hipTwistLock' });
    }
  }
  if (String(env.SQC_KNEE_TWIST_LOCK ?? '1') === '1') {
    const kt = Number(env.SQC_KNEE_TWIST_K ?? 80);
    const bt = Number(env.SQC_KNEE_TWIST_B ?? 5);
    const ct = Math.abs(Number(env.SQC_KNEE_TWIST_CAP ?? 15));
    const dt = Math.abs(Number(env.SQC_KNEE_TWIST_DEAD ?? 0.5)) / 57.3;
    for (const side of ['l', 'r'] as const) {
      if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
      const ki = w.body.dofByName(`knee_${side}`, 0);
      if (ki < 0) continue;
      const d = w.body.dofs[ki]!;
      const e = (baseAng(`knee_${side}`, 0) ?? d.angle) - d.angle;
      if (Math.abs(e) < dt) continue;
      const tau = Math.max(-ct, Math.min(ct, kt * e - bt * d.vel));
      if (Math.abs(tau) > 1e-9) propose({ dof: ki, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.kneeTwistLock' });
    }
  }
  if (useSpineLock) {
    for (const nm of ['spine1', 'spine2', 'spine3'] as const) {
      for (const ax of [0, 1] as const) {
        const di = w.body.dofByName(nm, ax);
        if (di < 0) continue;
        const d = w.body.dofs[di]!;
        const e = (baseAng(nm, ax) ?? d.angle) - d.angle;
        if (Math.abs(e) < 0.1 / 57.3) continue;
        const tau = Math.max(-capSpine, Math.min(capSpine, kpSpine * e - kdSpine * d.vel));
        if (Math.abs(tau) > 1e-9) propose({ dof: di, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.passiveLock.spine' });
      }
    }
  }
}

/** 载荷门控的侧向硬限位：承重腿锁住 hip/0、knee/1、foot/0 的侧向自由度；
 *  卸载腿恢复原限位，允许摆腿。 */
function squatLateralLock(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const lockOn = String(env.SQC_LAT_LOCK ?? '1') === '1';
  const sphereLock = String(env.SQC_LAT_LOCK_SPHERE ?? '0') === '1';
  const W = w.sk.massTotal * 9.81;
  const hipW = Math.abs(Number(env.SQC_LAT_LOCK_HIP_DEG ?? 1.5)) / 57.3;
  const kneeW = Math.abs(Number(env.SQC_LAT_LOCK_KNEE_DEG ?? 1.0)) / 57.3;
  const footW = Math.abs(Number(env.SQC_LAT_LOCK_FOOT_DEG ?? 2.0)) / 57.3;
  const hipTwistW = Math.abs(Number(env.SQC_LAT_LOCK_HIP_TWIST_DEG ?? 0)) / 57.3;
  const kneeTwistW = Math.abs(Number(env.SQC_LAT_LOCK_KNEE_TWIST_DEG ?? 0)) / 57.3;
  let orig = _latLockOrig.get(st);
  if (!orig) {
    orig = new Map();
    _latLockOrig.set(st, orig);
  }
  const setLim = (name: string, ax: number, width: number, loaded: boolean): void => {
    const di = w.body.dofByName(name, ax);
    if (di < 0) return;
    const d = w.body.dofs[di]!;
    let o = orig.get(di);
    if (!o) {
      o = { min: d.min, max: d.max };
      orig.set(di, o);
    }
    if (width <= 0) {
      d.min = o.min;
      d.max = o.max;
      if (d.engineLimited && d.engineJoint) d.engineJoint.setLimits(d.rest + o.min, d.rest + o.max);
      return;
    }
    const on = lockOn && loaded && (d.engineLimited || sphereLock);
    const c = baseAng(name, ax) ?? d.angle;
    const lo = on ? c - width : o.min;
    const hi = on ? c + width : o.max;
    if (d.engineLimited && d.engineJoint) {
      d.engineJoint.setLimits(d.rest + lo, d.rest + hi);
    } else {
      d.min = lo;
      d.max = hi;
    }
  };
  for (const side of ['l', 'r'] as const) {
    const loaded = w.body.footNormalForce(side, w.dt) >= 0.1 * W;
    setLim(`hip_${side}`, 0, hipW, loaded);
    setLim(`hip_${side}`, 1, hipTwistW, loaded);
    setLim(`knee_${side}`, 1, kneeW, loaded);
    setLim(`knee_${side}`, 0, kneeTwistW, loaded);
    setLim(`foot_${side}`, 0, footW, loaded);
  }
}

/** 申请制侧向载荷：PUSH 时用 knee/2 差动（腿长差）加载推侧脚。
 *  与矢状 pair 的 knee/2 力矩相加（ext 通道），不覆盖 pair。 */
function squatLateralLoad(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LAT_LOAD ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const L = ctl.lateral.state;
  let ls = _latLoadState.get(st);
  if (!ls) { ls = { hold: 0, prev: false }; _latLoadState.set(st, ls); }
  const active = L.onset && L.source === 'push' && L.confidence > 0.4 && !ctl.actions.status.active;
  if (active) {
    if (!ls.prev) ls.hold = Math.abs(Number(env.SQC_LAT_LOAD_HOLD ?? 0.2));
    ls.prev = true;
    if (ls.hold > 0) {
      const sev = Math.max(0, Math.min(1, (L.changeScore - 1) / 3));
      const cap = Math.abs(Number(env.SQC_LAT_LOAD_CAP ?? 30));
      const sign = Number(env.SQC_LAT_LOAD_SIGN ?? 1) < 0 ? -1 : 1;
      const tau = sign * L.direction * sev * cap;
      const kl = w.body.dofByName('knee_l', 2);
      const kr = w.body.dofByName('knee_r', 2);
      if (kl >= 0) propose({ dof: kl, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.lateralLoad' });
      if (kr >= 0) propose({ dof: kr, kind: 'ext', pri: PRI.reflex, tau: -tau, src: 'squat.lateralLoad' });
    }
    ls.hold = Math.max(0, ls.hold - w.dt);
  } else {
    ls.prev = false;
    ls.hold = 0;
  }
}

/** 侧向伺服 L3：把 LateralServo 的 ΔFz 请求分配到 knee/2 与 hip/2。 */
function squatLateralServo(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LAT_SERVO ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const srv = ctl.lateralServo;
  if (!srv.active || Math.abs(srv.fzReq) < 0.5) return;
  const alloc = allocateLateralLoad(srv.fzReq, {
    hipCap: Math.abs(Number(env.SQC_LAT_SERVO_HIP_CAP ?? 10)),
    kneeCap: Math.abs(Number(env.SQC_LAT_SERVO_KNEE_CAP ?? 30)),
    hipShare: Number(env.SQC_LAT_SERVO_HIP_SHARE ?? 0.5),
  });
  const kl = w.body.dofByName('knee_l', 2);
  const kr = w.body.dofByName('knee_r', 2);
  const hl = w.body.dofByName('hip_l', 2);
  const hr = w.body.dofByName('hip_r', 2);
  if (kl >= 0) propose({ dof: kl, kind: 'ext', pri: PRI.reflex, tau: alloc.knee2, src: 'squat.lateralServo' });
  if (kr >= 0) propose({ dof: kr, kind: 'ext', pri: PRI.reflex, tau: -alloc.knee2, src: 'squat.lateralServo' });
  if (hl >= 0) propose({ dof: hl, kind: 'ext', pri: PRI.reflex, tau: alloc.hip2, src: 'squat.lateralServo' });
  if (hr >= 0) propose({ dof: hr, kind: 'ext', pri: PRI.reflex, tau: -alloc.hip2, src: 'squat.lateralServo' });
}

/** 蹲姿每物理步：法庭（目标/判死）+ 当前写手链 */
export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  squatPairBase(w, ctl, st);
  squatLateralServo(w, ctl, st);
  squatLateralLoad(w, ctl, st);
  squatFineLateral(w, ctl, st);
  squatAnkleVector(w, ctl, st);
  squatHipStab(w, ctl, st);
  squatHipTask(w, ctl, st);
  squatHipServo(w, ctl, st);
  squatPassiveLock(w, ctl, st);
  courtInject(w, ctl);
  squatJointLoad(w, st);
  squatLateralLock(w, st);
}
