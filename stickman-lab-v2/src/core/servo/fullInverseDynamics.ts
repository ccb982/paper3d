/**
 * 实时力链（静态/准静态 + 滤波后的动态项）：按关节子树累加自重 + 脚底逐接触点力，
 * 对关节轴取矩。子树的父侧载荷不进来，因此与 applied 同口径。
 *
 * 精度策略：
 *   重力项精确、不过滤；
 *   接触力 + 惯性项统一低通，避免有限差分噪声污染力链。
 */
import type { World } from '../world';

export interface JointLoad {
  name: string;
  child: string;
  torque: number;
  moment: { x: number; y: number; z: number };
  force: { x: number; y: number; z: number };
  rawTorque: number;
  rawForce: { x: number; y: number; z: number };
  anchor: { x: number; y: number; z: number };
}

function worldAngularMomentum(rb: { principalInertia(): {x:number;y:number;z:number}; principalInertiaLocalFrame(): {x:number;y:number;z:number;w:number} }, w: {x:number;y:number;z:number}) {
  const q = rb.principalInertiaLocalFrame();
  const ix = -q.x, iy = -q.y, iz = -q.z, iw = q.w;
  const lx = iw*w.x + iy*w.z - iz*w.y;
  const ly = iw*w.y + iz*w.x - ix*w.z;
  const lz = iw*w.z + ix*w.y - iy*w.x;
  const ii = rb.principalInertia();
  const hx = lx*ii.x, hy = ly*ii.y, hz = lz*ii.z;
  return {
    x: q.w*hx + q.y*hz - q.z*hy,
    y: q.w*hy + q.z*hx - q.x*hz,
    z: q.w*hz + q.x*hy - q.y*hx,
  };
}

interface Accel { ax: number; ay: number; az: number; hx: number; hy: number; hz: number }
const velPrev = new WeakMap<World, Map<number, [number,number,number,number,number,number]>>();
const loadCache = new WeakMap<World, { t: number; out: JointLoad[] }>();
const loadFilter = new WeakMap<World, Map<string, { m: [number,number,number]; f: [number,number,number] }>>();

export function measureJointLoads(w: World): JointLoad[] {
  const cached = loadCache.get(w);
  if (cached && cached.t === w.clock) return cached.out;
  const out: JointLoad[] = [];
  let hist = velPrev.get(w); if (!hist) { hist = new Map(); velPrev.set(w, hist); }
  const dt = Math.max(w.dt, 1e-6);
  const contacts = w.body.allContactSamples(w.dt);

  // 先对全身做一次速度/角动量差分，避免同一体在多个关节子树里被重复更新而把加速度刷成 0。
  const accel = new Map<number, Accel>();
  for (let bi = 0; bi < w.body.bodies.length; bi++) {
    const rb = w.body.bodies[bi]!;
    const v = rb.linvel(), av = rb.angvel();
    const H = worldAngularMomentum(rb, av);
    const pv = hist.get(bi);
    accel.set(bi, {
      ax: pv ? (v.x - pv[0]) / dt : 0,
      ay: pv ? (v.y - pv[1]) / dt : 0,
      az: pv ? (v.z - pv[2]) / dt : 0,
      hx: pv ? (H.x - pv[3]) / dt : 0,
      hy: pv ? (H.y - pv[4]) / dt : 0,
      hz: pv ? (H.z - pv[5]) / dt : 0,
    });
    hist.set(bi, [v.x, v.y, v.z, H.x, H.y, H.z]);
  }

  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const hz = Math.max(0, Number(env.SQC_FORCE_LP_HZ ?? 15));
  const alpha = hz > 0 ? 1 - Math.exp(-dt / (1 / (2 * Math.PI * hz))) : 1;
  let filt = loadFilter.get(w); if (!filt) { filt = new Map(); loadFilter.set(w, filt); }

  w.sk.joints.forEach((j, ji) => {
    let anchor: Float64Array | null = null;
    let axis: Float64Array | null = null;
    for (const d of w.body.dofs) {
      if (d.joint !== ji) continue;
      if (!anchor) anchor = d.anchorWorld;
      if (d.axis === 2) axis = d.axisWorld;
    }
    if (!anchor || !axis) return;

    // 重力项：精确，不过滤。
    let gtx = 0, gty = 0, gtz = 0, gfx = 0, gfy = 0, gfz = 0;
    // 接触 + 惯性项：统一低通。
    let ntx = 0, nty = 0, ntz = 0, nfx = 0, nfy = 0, nfz = 0;

    for (const bi of w.body.subtree[ji] ?? []) {
      const rb = w.body.bodies[bi]!;
      const p = rb.worldCom(); const m = rb.mass();
      const a = accel.get(bi)!;
      const rx = p.x - anchor[0]!, ry = p.y - anchor[1]!, rz = p.z - anchor[2]!;
      const wgt = -m * 9.81;
      gfx += 0; gfy += wgt; gfz += 0;
      gtx += ry * 0 - rz * wgt;
      gty += rz * 0 - rx * 0;
      gtz += rx * wgt - ry * 0;
      const bfx = m * (-a.ax), bfy = m * (-a.ay), bfz = m * (-a.az);
      nfx += bfx; nfy += bfy; nfz += bfz;
      ntx += ry * bfz - rz * bfy + a.hx;
      nty += rz * bfx - rx * bfz + a.hy;
      ntz += rx * bfy - ry * bfx + a.hz;
    }
    const sub = new Set(w.body.subtree[ji] ?? []);
    for (const c of contacts) {
      if (!sub.has(c.body)) continue;
      const rx = c.x - anchor[0]!, ry = c.y - anchor[1]!, rz = c.z - anchor[2]!;
      nfx += c.fx; nfy += c.fy; nfz += c.fz;
      ntx += ry * c.fz - rz * c.fy;
      nty += rz * c.fx - rx * c.fz;
      ntz += rx * c.fy - ry * c.fx;
    }

    let st = filt.get(j.name);
    if (!st) { st = { m: [ntx, nty, ntz], f: [nfx, nfy, nfz] }; filt.set(j.name, st); }
    else {
      st.m[0] += (ntx - st.m[0]) * alpha;
      st.m[1] += (nty - st.m[1]) * alpha;
      st.m[2] += (ntz - st.m[2]) * alpha;
      st.f[0] += (nfx - st.f[0]) * alpha;
      st.f[1] += (nfy - st.f[1]) * alpha;
      st.f[2] += (nfz - st.f[2]) * alpha;
    }

    const mx = gtx + st.m[0], my = gty + st.m[1], mz = gtz + st.m[2];
    const fx = gfx + st.f[0], fy = gfy + st.f[1], fz = gfz + st.f[2];
    const rawMx = gtx + ntx, rawMy = gty + nty, rawMz = gtz + ntz;
    const rawFx = gfx + nfx, rawFy = gfy + nfy, rawFz = gfz + nfz;
    const sgn = /^(hip|knee)_/.test(j.name) ? -1 : 1;
    out.push({
      name: j.name,
      child: j.childKey,
      torque: sgn * (mx * axis[0]! + my * axis[1]! + mz * axis[2]!),
      moment: { x: mx, y: my, z: mz },
      force: { x: fx, y: fy, z: fz },
      rawTorque: sgn * (rawMx * axis[0]! + rawMy * axis[1]! + rawMz * axis[2]!),
      rawForce: { x: rawFx, y: rawFy, z: rawFz },
      anchor: { x: anchor[0]!, y: anchor[1]!, z: anchor[2]! },
    });
  });
  loadCache.set(w, { t: w.clock, out });
  return out;
}
