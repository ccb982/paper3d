/**
 * jointEkf —— 分布式肢体等效 IMU + 编码器 EKF。
 *
 * 每个关节状态 [q, qd, qdd]。
 * 预测：常加速度。
 * 测量：编码器 q/qd + 相邻肢体角加速度差投影到关节轴。
 */
import type { World } from '../world';
import { sampleMotionAcceleration } from './motionAcceleration';

interface St { q: number; qd: number; qdd: number; P: number[][]; init: boolean }
const _st = new WeakMap<World, Map<number, St>>();
const _qddLp = new WeakMap<World, Map<number, number>>();

const clamp = (v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));

export interface JointEkfOut { qdd: Float64Array; confidence: number }
export function sampleJointEkf(w: World): JointEkfOut {
  const on = Number((globalThis as { process?: { env?: Record<string,string> } }).process?.env?.SQC_IMU_EKF_ON ?? 1) !== 0;
  const raw = sampleMotionAcceleration(w);
  let map = _st.get(w); if (!map) { map = new Map(); _st.set(w, map); }
  const out = new Float64Array(w.body.dofs.length);
  const qProc = Math.max(0, Number((globalThis as { process?: { env?: Record<string,string> } }).process?.env?.SQC_IMU_EKF_Q ?? 200));
  const rQ = Math.max(1e-9, Number((globalThis as { process?: { env?: Record<string,string> } }).process?.env?.SQC_IMU_EKF_RQ ?? 1e-6));
  const rQd = Math.max(1e-9, Number((globalThis as { process?: { env?: Record<string,string> } }).process?.env?.SQC_IMU_EKF_RQD ?? 1e-4));
  const rQdd = Math.max(1e-3, Number((globalThis as { process?: { env?: Record<string,string> } }).process?.env?.SQC_IMU_EKF_RQDD ?? 100));
  const rGain = Math.max(0, Number((globalThis as { process?: { env?: Record<string,string> } }).process?.env?.SQC_IMU_EKF_RQDD_GAIN ?? 2));
  const qLp = Math.max(0.003, Number((globalThis as { process?: { env?: Record<string,string> } }).process?.env?.SQC_IMU_EKF_QDD_LP ?? 0.015));
  let lpMap = _qddLp.get(w); if (!lpMap) { lpMap = new Map(); _qddLp.set(w, lpMap); }
  let used = 0;
  for (let i=0;i<w.body.dofs.length;i++) {
    const d = w.body.dofs[i]!;
    if (!/^(hip|knee|foot)_/.test(d.name) || d.axis !== 2) continue;
    let s = map.get(i);
    if (!s) { s = { q: d.angle, qd: d.vel, qdd: 0, P: [[1,0,0],[0,1,0],[0,0,1]], init: true }; map.set(i, s); }
    if (!on) { out[i] = d.vel; continue; }
    const dt = Math.max(1e-5, w.dt);
    // predict
    s.q += s.qd*dt + 0.5*s.qdd*dt*dt;
    s.qd += s.qdd*dt;
    const F = [[1,dt,0.5*dt*dt],[0,1,dt],[0,0,1]];
    const P = s.P;
    const FP = Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>F[r]![0]!*P[0]![c]!+F[r]![1]!*P[1]![c]!+F[r]![2]!*P[2]![c]!));
    const FPFT = Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>FP[r]![0]!*F[c]![0]!+FP[r]![1]!*F[c]![1]!+FP[r]![2]!*F[c]![2]!));
    for (let k=0;k<3;k++) FPFT[k]![k]! += qProc*dt;
    s.P = FPFT;
    // IMU-derived qdd: child angAcc - parent angAcc projected on axis
    const pj = w.body.jointBodies[d.joint*2] ?? -1;
    const cj = w.body.jointBodies[d.joint*2+1] ?? -1;
    const ax = d.axisWorld;
    let qddImu = 0;
    if (pj>=0 && cj>=0) {
      const pa = raw.bodyAngAcc, ca = raw.bodyAngAcc;
      qddImu = (ca[cj*3]! - pa[pj*3]!)*ax[0]! + (ca[cj*3+1]! - pa[pj*3+1]!)*ax[1]! + (ca[cj*3+2]! - pa[pj*3+2]!)*ax[2]!;
      if (!Number.isFinite(qddImu)) qddImu = 0;
      qddImu = clamp(qddImu, -2000, 2000);
      const prevLp = lpMap.get(i) ?? qddImu;
      const aLp = 1 - Math.exp(-dt / qLp);
      qddImu = prevLp + (qddImu - prevLp) * aLp;
      lpMap.set(i, qddImu);
    }
    // measurement z = [q_enc, qd_enc, qdd_imu]
    const e = [d.angle - s.q, d.vel - s.qd, qddImu - s.qdd];
    const R = [rQ, rQd, rQdd + rGain * qddImu * qddImu];
    const S = s.P.map((row,r)=>row.map((v,c)=>v+(r===c?R[r]!:0)));
    // solve K = P S^-1 for 3x3 (Gauss-Jordan on augmented)
    const A = S.map((row,r)=>[...row,...(r===0?[1,0,0]:r===1?[0,1,0]:[0,0,1])]);
    for(let c=0;c<3;c++){let piv=c;for(let r=c+1;r<3;r++)if(Math.abs(A[r]![c]!)>Math.abs(A[piv]![c]!))piv=r;[A[c],A[piv]]=[A[piv]!,A[c]!];const dv=A[c]![c]!||1;for(let j=0;j<6;j++)A[c]![j]!/=dv;for(let r=0;r<3;r++){if(r===c)continue;const f=A[r]![c]!;if(!f)continue;for(let j=0;j<6;j++)A[r]![j]!-=f*A[c]![j]!;}}
    const Sinv = A.map(row=>row.slice(3));
    const K = s.P.map((row)=>Sinv.map((_,c)=>row[0]!*Sinv[0]![c]!+row[1]!*Sinv[1]![c]!+row[2]!*Sinv[2]![c]!));
    for(let r=0;r<3;r++){const dx=K[r]![0]!*e[0]!+K[r]![1]!*e[1]!+K[r]![2]!*e[2]!;if(r===0)s.q+=dx;else if(r===1)s.qd+=dx;else s.qdd+=dx;}
    const IKH = Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>(r===c?1:0)-K[r]![c]!));
    s.P = Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>IKH[r]![0]!*s.P[0]![c]!+IKH[r]![1]!*s.P[1]![c]!+IKH[r]![2]!*s.P[2]![c]!));
    out[i] = s.qdd;
    used++;
  }
  (globalThis as { __JOINT_EKF?: Record<string, number> }).__JOINT_EKF = {
    qddHip: out[w.body.dofByName('hip_l',2)] ?? 0,
    qddKnee: out[w.body.dofByName('knee_l',2)] ?? 0,
    qddAnkle: out[w.body.dofByName('foot_l',2)] ?? 0,
    used,
  };
  return { qdd: out, confidence: used>0?0.8:0 };
}
