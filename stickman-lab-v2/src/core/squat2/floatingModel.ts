/**
 * floatingModel.ts —— 浮动基降阶模型（base 6 + 18 个下盘关节）
 *
 * 约定
 *   · base 坐标 = torso 刚体原点/世界角速度；ν = [v_base(3), ω_base(3), qd18]
 *   · 上身（脊柱/颈/头/臂）按“刚接在 base 上”的负载处理（架构：上身自主，WBC 只当负载）
 *   · M / h 由每个刚体的空间雅可比 + 世界惯量组装：
 *       M = Σ Jvᵀ m Jv + Jwᵀ I_w Jw
 *       h = Σ Jvᵀ m(a − g) + Jwᵀ(I_w α + ω × I_w ω)
 *     a/α 由 Jdot·ν 得到，Jdot 用真实采样间隔差分（用户允许 Jdot 差分）
 *   · 接触点 6D 雅可比：Jc = [Jv(contact); Jw(foot)]，含 base 列
 *
 * 这对应论文 WBC 的浮动基模型；不是原先 18×18 固定基 QP。
 */
import type { World } from '../world';

type V3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

const qMul = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const qConj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qRot = (q: Quat, v: V3): V3 => {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
};
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** 3×3 世界惯量：I_w = Σ I_i e_i e_iᵀ */
function worldInertia(rb: { principalInertia(): V3; principalInertiaLocalFrame(): Quat; rotation(): Quat }): number[][] {
  const qw = qMul(rb.rotation(), rb.principalInertiaLocalFrame());
  const I = rb.principalInertia();
  const axes = [qRot(qw, { x: 1, y: 0, z: 0 }), qRot(qw, { x: 0, y: 1, z: 0 }), qRot(qw, { x: 0, y: 0, z: 1 })];
  const vals = [I.x, I.y, I.z];
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < 3; k++) {
    const e = axes[k]!, v = vals[k]!;
    const c = [e.x, e.y, e.z];
    for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) out[r]![cc] += v * c[r]! * c[cc]!;
  }
  return out;
}

const skew = (r: V3): number[][] => [
  [0, -r.z, r.y],
  [r.z, 0, -r.x],
  [-r.y, r.x, 0],
];

export interface LowerAxes {
  axes: number[];
  hip2: Record<'l' | 'r', number>;
  knee2: Record<'l' | 'r', number>;
  foot2: Record<'l' | 'r', number>;
}

export function lowerAxes(w: World): LowerAxes {
  const axes: number[] = [];
  for (const side of ['l', 'r'] as const) {
    for (const [joint, ax] of [['hip', 0], ['hip', 1], ['hip', 2], ['knee', 0], ['knee', 1], ['knee', 2], ['foot', 0], ['foot', 1], ['foot', 2]] as const) {
      const i = w.body.dofByName(`${joint}_${side}`, ax);
      if (i >= 0) axes.push(i);
    }
  }
  return {
    axes,
    hip2: { l: w.body.dofByName('hip_l', 2), r: w.body.dofByName('hip_r', 2) },
    knee2: { l: w.body.dofByName('knee_l', 2), r: w.body.dofByName('knee_r', 2) },
    foot2: { l: w.body.dofByName('foot_l', 2), r: w.body.dofByName('foot_r', 2) },
  };
}

export interface ContactSpec {
  side: 'l' | 'r';
  point: V3;
  /** 每脚支撑多边形（世界 x/z 范围） */
  ref?: V3;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface FloatingModel {
  axes: number[];
  nu: Float64Array;
  qd18: Float64Array;
  M: Float64Array;
  h: Float64Array;
  Jcom: Float64Array;
  Jbase: Float64Array;
  JdotComNu: Float64Array;
  JdotBaseNu: Float64Array;
  com: V3;
  comVel: V3;
  baseQuat: Quat;
  baseOmega: V3;
  mass: number;
  contact: ContactSpec[];
  Jc: Float64Array[];
  JdotNu: Float64Array[];
}

interface BodyJ {
  jv: Float64Array;
  jw: Float64Array;
  m: number;
  Iw: number[][];
  c: V3;
  bi: number;
}

interface Cache {
  t: number;
  nu: Float64Array;
  bodyJ: Map<number, { jv: Float64Array; jw: Float64Array }>;
  Jcom: Float64Array;
  Jbase: Float64Array;
  Jc: Float64Array[];
  contacts: ContactSpec[];
}

const _cache = new WeakMap<World, Cache>();

export function resetFloatingCache(w: World): void {
  _cache.delete(w);
}

const NV = 24;

/**
 * 计算浮动基模型。
 * @param contacts 每脚接触点与支撑多边形；contact 顺序 l/r
 */
export function computeFloatingModel(w: World, contacts: ContactSpec[], dtWbc: number): FloatingModel {
  const body = w.body;
  const axes = lowerAxes(w).axes;
  const nJ = axes.length;
  if (nJ !== 18) throw new Error(`floatingModel: lower axes ${nJ} != 18`);

  const torsoKey = body.indexByKey.get('torso') ?? body.indexByKey.get('spine1');
  const baseBi = torsoKey ?? 0;
  const torso = body.bodies[baseBi]!;
  // base 点取 torso COM（Rapier linvel 是 COM 速度）；base 姿态仍取 torso 朝向
  const p0 = torso.worldCom();
  const baseQuat = torso.rotation();
  const v0 = torso.linvel();
  const w0 = torso.angvel();

  // ★ 命令层在 physics.step 之后运行，body.dofs[].vel 是**上一步**的（滞后一拍）。
  //   这里直接用当前 b1/b2 刚体的角速度和当前几何轴重算 qd，消除一拍滞后。
  const qd18 = new Float64Array(nJ);
  const legAxis: V3[] = [];
  const legAnchor: V3[] = [];
  for (let k = 0; k < nJ; k++) {
    const d = body.dofs[axes[k]!]!;
    const b1 = body.allBodies[d.b1]!;
    const b2 = body.allBodies[d.b2]!;
    const q1 = b1.rotation();
    const axis = qRot(q1, d.axisLocal);
    const anchor = add(qRot(q1, d.anchorB1Local), b1.translation());
    legAxis.push(axis);
    legAnchor.push(anchor);
    const w1 = b1.angvel();
    const w2 = b2.angvel();
    qd18[k] = (w2.x - w1.x) * axis.x + (w2.y - w1.y) * axis.y + (w2.z - w1.z) * axis.z;
  }
  const nu = new Float64Array(NV);
  nu[0] = v0.x; nu[1] = v0.y; nu[2] = v0.z;
  nu[3] = w0.x; nu[4] = w0.y; nu[5] = w0.z;
  nu.set(qd18, 6);

  const dofSub: number[][] = axes.map((a) => {
    const d = body.dofs[a]!;
    return body.subtree[d.joint] ?? [];
  });

  const bodyJs: BodyJ[] = [];
  for (let bi = 0; bi < body.bodies.length; bi++) {
    const rb = body.bodies[bi]!;
    const m = rb.mass();
    if (m <= 0) continue;
    const c = rb.worldCom();
    const Jv = new Float64Array(3 * NV);
    const Jw = new Float64Array(3 * NV);
    const d = sub(c, p0);
    const sk = skew(d);
    for (let r = 0; r < 3; r++) {
      Jv[r * NV + r] = 1;
      for (let k = 0; k < 3; k++) Jv[r * NV + 3 + k] = -sk[r]![k]!;
      Jw[r * NV + 3 + r] = 1;
    }
    for (let k = 0; k < nJ; k++) {
      if (!dofSub[k]!.includes(bi)) continue;
      const u = legAxis[k]!;
      const a = legAnchor[k]!;
      const rr = sub(c, a);
      const vj = cross(u, rr);
      for (let r = 0; r < 3; r++) {
        Jv[r * NV + 6 + k] = r === 0 ? vj.x : r === 1 ? vj.y : vj.z;
        Jw[r * NV + 6 + k] = r === 0 ? u.x : r === 1 ? u.y : u.z;
      }
    }
    bodyJs.push({ jv: Jv, jw: Jw, m, Iw: worldInertia(rb), c, bi });
  }

  // M / Jcom
  const M = new Float64Array(NV * NV);
  let mass = 0;
  const Jcom = new Float64Array(3 * NV);
  for (const b of bodyJs) {
    mass += b.m;
    for (let r = 0; r < NV; r++) {
      const jvr = [b.jv[r]!, b.jv[NV + r]!, b.jv[2 * NV + r]!];
      const jwr = [b.jw[r]!, b.jw[NV + r]!, b.jw[2 * NV + r]!];
      for (let cc = 0; cc < NV; cc++) {
        const jvc = [b.jv[cc]!, b.jv[NV + cc]!, b.jv[2 * NV + cc]!];
        const jwc = [b.jw[cc]!, b.jw[NV + cc]!, b.jw[2 * NV + cc]!];
        let v = b.m * (jvr[0]! * jvc[0]! + jvr[1]! * jvc[1]! + jvr[2]! * jvc[2]!);
        const iw = b.Iw;
        v += jwc[0]! * (iw[0]![0]! * jwr[0]! + iw[0]![1]! * jwr[1]! + iw[0]![2]! * jwr[2]!)
          + jwc[1]! * (iw[1]![0]! * jwr[0]! + iw[1]![1]! * jwr[1]! + iw[1]![2]! * jwr[2]!)
          + jwc[2]! * (iw[2]![0]! * jwr[0]! + iw[2]![1]! * jwr[1]! + iw[2]![2]! * jwr[2]!);
        M[r * NV + cc] += v;
      }
      for (let k = 0; k < 3; k++) Jcom[k * NV + r] += b.m * [b.jv[r]!, b.jv[NV + r]!, b.jv[2 * NV + r]!][k]!;
    }
  }
  for (let k = 0; k < 3 * NV; k++) Jcom[k] /= Math.max(1e-9, mass);
  const com = { x: 0, y: 0, z: 0 };
  for (const b of bodyJs) { com.x += b.m * b.c.x; com.y += b.m * b.c.y; com.z += b.m * b.c.z; }
  com.x /= mass; com.y /= mass; com.z /= mass;
  const comVel = { x: 0, y: 0, z: 0 };
  for (let k = 0; k < 3; k++) {
    let s = 0;
    for (let j = 0; j < NV; j++) s += Jcom[k * NV + j]! * nu[j]!;
    if (k === 0) comVel.x = s; else if (k === 1) comVel.y = s; else comVel.z = s;
  }

  // h = Σ Jvᵀ m(a−g) + Jwᵀ(Iw α + ω×Iwω)
  const h = new Float64Array(NV);
  const prev = _cache.get(w);
  const gap = prev ? w.clock - prev.t : 0;
  const dtJ = prev ? Math.max(1e-4, Math.min(0.15, gap)) : 0;
  const g = { x: 0, y: w.world.gravity.y, z: 0 };
  for (const b of bodyJs) {
    let acc = { x: 0, y: 0, z: 0 };
    let alpha = { x: 0, y: 0, z: 0 };
    if (prev && dtJ > 1e-9) {
      const old = prev.bodyJ.get(b.bi);
      if (old) {
        const dv = new Float64Array(3);
        const dw = new Float64Array(3);
        for (let k = 0; k < NV; k++) {
          for (let r = 0; r < 3; r++) {
            dv[r] += ((b.jv[r * NV + k]! - old.jv[r * NV + k]!) / dtJ) * nu[k]!;
            dw[r] += ((b.jw[r * NV + k]! - old.jw[r * NV + k]!) / dtJ) * nu[k]!;
          }
        }
        acc = { x: dv[0]!, y: dv[1]!, z: dv[2]! };
        alpha = { x: dw[0]!, y: dw[1]!, z: dw[2]! };
      }
    }
    const wb = { x: 0, y: 0, z: 0 };
    for (let r = 0; r < 3; r++) {
      let s = 0;
      for (let k = 0; k < NV; k++) s += b.jw[r * NV + k]! * nu[k]!;
      if (r === 0) wb.x = s; else if (r === 1) wb.y = s; else wb.z = s;
    }
    const F = scale(sub(acc, g), b.m);
    const Iw = b.Iw;
    const IwW = {
      x: Iw[0]![0]! * wb.x + Iw[0]![1]! * wb.y + Iw[0]![2]! * wb.z,
      y: Iw[1]![0]! * wb.x + Iw[1]![1]! * wb.y + Iw[1]![2]! * wb.z,
      z: Iw[2]![0]! * wb.x + Iw[2]![1]! * wb.y + Iw[2]![2]! * wb.z,
    };
    const gyro = cross(wb, IwW);
    const IwA = {
      x: Iw[0]![0]! * alpha.x + Iw[0]![1]! * alpha.y + Iw[0]![2]! * alpha.z,
      y: Iw[1]![0]! * alpha.x + Iw[1]![1]! * alpha.y + Iw[1]![2]! * alpha.z,
      z: Iw[2]![0]! * alpha.x + Iw[2]![1]! * alpha.y + Iw[2]![2]! * alpha.z,
    };
    const N = add(IwA, gyro);
    for (let k = 0; k < NV; k++) {
      h[k] += b.jv[k]! * F.x + b.jv[NV + k]! * F.y + b.jv[2 * NV + k]! * F.z;
      h[k] += b.jw[k]! * N.x + b.jw[NV + k]! * N.y + b.jw[2 * NV + k]! * N.z;
    }
  }

  // h 取 biasForce 口径（与 executor/旧命令层同号）：上面算的是重力广义力，整体取负。
  for (let k = 0; k < NV; k++) h[k] = -h[k]!;

  // Jbase = torso Jw（base 姿态任务）
  const torsoB = bodyJs.find((b) => b.bi === baseBi);
  const Jbase = new Float64Array(3 * NV);
  if (torsoB) Jbase.set(torsoB.jw);

  // CoM/base 任务的 Jdot·ν（论文任务：J qdd = a* - Jdot qd）
  const JdotComNu = new Float64Array(3);
  const JdotBaseNu = new Float64Array(3);
  if (prev && dtJ > 1e-9) {
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < NV; k++) {
        JdotComNu[r] += ((Jcom[r * NV + k]! - prev.Jcom[r * NV + k]!) / dtJ) * nu[k]!;
        JdotBaseNu[r] += ((Jbase[r * NV + k]! - prev.Jbase[r * NV + k]!) / dtJ) * nu[k]!;
      }
    }
  }

  // 接触 Jc（6×24）
  const Jc: Float64Array[] = [];
  const JdotNu: Float64Array[] = [];
  for (let ci = 0; ci < contacts.length; ci++) {
    const c = contacts[ci]!;
    const bi = body.indexByKey.get(`foot_${c.side}`);
    if (bi === undefined) { Jc.push(new Float64Array(6 * NV)); JdotNu.push(new Float64Array(6)); continue; }
    const rb = body.bodies[bi]!;
    const Jv = new Float64Array(3 * NV);
    const Jw = new Float64Array(3 * NV);
    const d = sub(c.point, p0);
    const sk = skew(d);
    for (let r = 0; r < 3; r++) {
      Jv[r * NV + r] = 1;
      for (let k = 0; k < 3; k++) Jv[r * NV + 3 + k] = -sk[r]![k]!;
      Jw[r * NV + 3 + r] = 1;
    }
    for (let k = 0; k < nJ; k++) {
      if (!dofSub[k]!.includes(bi)) continue;
      const u = legAxis[k]!;
      const a = legAnchor[k]!;
      const rr = sub(c.point, a);
      const vj = cross(u, rr);
      for (let r = 0; r < 3; r++) {
        Jv[r * NV + 6 + k] = r === 0 ? vj.x : r === 1 ? vj.y : vj.z;
        Jw[r * NV + 6 + k] = r === 0 ? u.x : r === 1 ? u.y : u.z;
      }
    }
    const J = new Float64Array(6 * NV);
    for (let r = 0; r < 3; r++) for (let k = 0; k < NV; k++) J[r * NV + k] = Jv[r * NV + k]!;
    for (let r = 0; r < 3; r++) for (let k = 0; k < NV; k++) J[(3 + r) * NV + k] = Jw[r * NV + k]!;
    Jc.push(J);
    const cur = new Float64Array(6);
    const old = prev?.Jc[ci];
    if (old && dtJ > 1e-9) {
      for (let r = 0; r < 6; r++) {
        let s = 0;
        for (let k = 0; k < NV; k++) s += ((J[r * NV + k]! - old[r * NV + k]!) / dtJ) * nu[k]!;
        cur[r] = s;
      }
    }
    JdotNu.push(cur);
  }

  if (prev && dtJ > 1e-9) {
    const g = globalThis as { __FM_DBG?: number };
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    if (String(env.SQC_FM_DBG ?? '0') === '1' && (g.__FM_DBG ?? 0) < 2) {
      g.__FM_DBG = (g.__FM_DBG ?? 0) + 1;
      for (let fi = 0; fi < contacts.length; fi++) {
        const J = Jc[fi]!;
        const v = [0, 0, 0];
        for (let r = 0; r < 3; r++) for (let k = 0; k < NV; k++) v[r] += J[r * NV + k]! * nu[k]!;
        const curP = contacts[fi]!.point;
        const oldP = prev.contacts[fi]!.point;
        const side = contacts[fi]!.side;
        const fbi = body.indexByKey.get(`foot_${side}`);
        let bp = 'no';
        if (fbi !== undefined) {
          const fb = body.bodies[fbi]!;
          const fv = fb.linvel();
          const fw = fb.angvel();
          const fc = fb.worldCom();
          const rx = curP.x - fc.x, ry = curP.y - fc.y, rz = curP.z - fc.z;
          const vpx = fv.x + fw.y * rz - fw.z * ry;
          const vpy = fv.y + fw.z * rx - fw.x * rz;
          const vpz = fv.z + fw.x * ry - fw.y * rx;
          bp = `${vpx.toFixed(3)},${vpy.toFixed(3)},${vpz.toFixed(3)}`;
        }
        console.log(`[FM] foot=${fi} JcV=${v.map((x) => x.toFixed(3)).join(',')} fd=${((curP.x - oldP.x) / dtJ).toFixed(3)},${((curP.y - oldP.y) / dtJ).toFixed(3)},${((curP.z - oldP.z) / dtJ).toFixed(3)} bodyVP=${bp} p=${curP.x.toFixed(3)},${curP.y.toFixed(3)},${curP.z.toFixed(3)}`);
      }
    }
  }

  _cache.set(w, {
    t: w.clock,
    nu,
    bodyJ: new Map(bodyJs.map((b) => [b.bi, { jv: b.jv, jw: b.jw }])),
    Jcom,
    Jbase,
    Jc,
    contacts,
  });

  return {
    axes,
    nu,
    qd18,
    M,
    h,
    Jcom,
    Jbase,
    JdotComNu,
    JdotBaseNu,
    com,
    comVel,
    baseQuat: { x: baseQuat.x, y: baseQuat.y, z: baseQuat.z, w: baseQuat.w },
    baseOmega: { x: w0.x, y: w0.y, z: w0.z },
    mass,
    contact: contacts,
    Jc,
    JdotNu,
  };
}

/** 四元数误差 → 世界旋转向量（target ⊗ current⁻¹） */
export function quatError(qTarget: Quat, qCurrent: Quat): V3 {
  let e = qMul(qTarget, qConj(qCurrent));
  if (e.w < 0) e = { x: -e.x, y: -e.y, z: -e.z, w: -e.w };
  const s = Math.sqrt(Math.max(0, 1 - e.w * e.w));
  if (s < 1e-9) return { x: 0, y: 0, z: 0 };
  const ang = 2 * Math.atan2(s, e.w);
  return { x: (e.x / s) * ang, y: (e.y / s) * ang, z: (e.z / s) * ang };
}
