/**
 * squatStatic.ts —— 蹲姿静态伺服（一次性计划 + 单写手）
 *
 * 固定脚、准静态：
 *   q_ref = 释放姿势（court 已 captureAngFrom）
 *   τ_ff  = captureSquatBase() 的闭合链静力解
 *   τ     = τ_ff + Kp(q_ref−q) − Kd·q̇（PD 可关，用于零反馈验收）
 *
 * 只写矢状轴 2；不写 CoP/CP；不参与回正。
 * SQC_STATIC=1 启用；默认关，旧链路不动。
 */

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { baseAng, baseState } from './baseTable';
import { sagittalBaseMoment } from './ankleAxisAdapter';
import { staticBalance } from './staticBalance';
import { staticQp } from './staticQp';
import { propose, PRI } from '../proposalBus';

const _captured = new WeakSet<CS>();
const _measured = new WeakMap<CS, Float64Array>();
const _qpPlan = new WeakMap<CS, Float64Array>();

function envOf(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
}

/** 释放后第一帧：用真实释放姿势 + 原始重力重捕静力解。 */
function ensureStaticPlan(w: World, ctl: ControlModule, st: CS): void {
  if (!st.released || _captured.has(st)) return;
  _captured.add(st);
  const gKeep = w.world.gravity.y;
  const gUse = st.g0 ?? -9.81;
  w.setGravity(gUse);
  try {
    ctl.warner.captureSquatBase();
  } finally {
    w.setGravity(gKeep);
  }
}

export function squatStatic(w: World, ctl: ControlModule, st: CS, ffIn?: Float64Array): void {
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  if (!ffIn) ensureStaticPlan(w, ctl, st);
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!baseBuf && !ffIn) return;
  const gBuf = new Float64Array(w.body.dofs.length);
  const src = ffIn ? 'in' : String(envOf().SQC_STATIC_SRC ?? 'base');
  if (src === 'gcomp') w.body.gravityComp(gBuf, st.g0 ?? -9.81, 'l', 0.5, 0.5);
  if (src === 'qp') {
    let qb = _qpPlan.get(st);
    if (!qb) {
      const out = staticQp(w.body, st.g0 ?? -9.81);
      if (!out) return;
      qb = out;
      _qpPlan.set(st, qb);
    }
    gBuf.set(qb);
  }
  if (src === 'measured') {
    let mb = _measured.get(st);
    if (!mb) {
      mb = new Float64Array(w.body.dofs.length);
      const cp = new Float64Array(3);
      const W = w.sk.massTotal * 9.81;
      const feet = { l: { N: W * 0.5, copX: st.c0.x, copZ: st.c0.z }, r: { N: W * 0.5, copX: st.c0.x, copZ: st.c0.z } };
      for (const side of ['l', 'r'] as const) {
        const fz = w.body.footNormalForce(side, w.dt);
        if (fz < 1 || !w.body.footCoP(side, w.dt, cp)) continue;
        feet[side] = { N: fz, copX: cp[0]!, copZ: cp[1]! };
      }
      staticBalance(w.body, mb, feet);
      _measured.set(st, mb);
    }
    gBuf.set(mb);
  }
  const ffOf = (i: number): number => (ffIn ? ffIn[i]! : src === 'none' ? 0 : src === 'gcomp' || src === 'measured' || src === 'qp' ? gBuf[i]! : baseBuf![i]!);

  const env = envOf();
  const pd = String(env.SQC_STATIC_PD ?? '0') === '1';
  const kp = Number(env.SQC_STATIC_KP ?? 50);
  const kd = Number(env.SQC_STATIC_KD ?? 5);
  const tmax = Math.abs(Number(env.SQC_STATIC_TMAX ?? 400));
  const dbg = String(env.SQC_STATIC_DBG ?? '0') === '1';
  const body = w.body;

  for (const d of body.dofs) {
    if (d.engineMotor || d.preRing || d.axis !== 2) continue;
    if (!/^(hip|knee|foot|spine|neck)/.test(d.name)) continue;
    let tau = ffOf(d.dofIndex);
    // 踝 pitch 的静力基矩：captureSquatBase 的逐关节表在踝上只有 ~0.5 N·m，
    // 缺少 CoP 从踝移到释放 CoM 的 Mz；用释放 CoM 显式补上。
    if (!ffIn && src === 'base' && /^foot_/.test(d.name) && d.axis === 2) {
      const FyHalf = w.sk.massTotal * 9.81 * 0.5;
      tau = sagittalBaseMoment(FyHalf, st.c0.x, d.anchorWorld[0]!)[2];
    }
    if (pd) {
      const ref = baseAng(d.name, d.axis) ?? d.angle;
      tau += kp * (ref - d.angle) - kd * d.vel;
    }
    tau = Math.max(-tmax, Math.min(tmax, tau));
    if (Math.abs(tau) < 1e-9) continue;
    propose({ dof: d.dofIndex, kind: 'ext', pri: PRI.action, tau, src: 'squat.static' });
    if (dbg) console.log(`STATIC t=${st.t.toFixed(3)} ${d.name}/${d.axis} ang=${(d.angle * 57.3).toFixed(1)}° tau=${tau.toFixed(1)} ff=${ffOf(d.dofIndex).toFixed(1)}`);
  }
}
