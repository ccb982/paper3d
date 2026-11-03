/**
 * 实时力链（静态/准静态）：按关节子树累加自重 + 脚底逐接触点力，
 * 对关节轴取矩。子树的父侧载荷不进来，因此与 applied 同口径。
 */
import type { World } from '../world';

export interface JointLoad {
  name: string;
  child: string;
  torque: number;
  force: { x: number; y: number; z: number };
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

const velPrev = new WeakMap<World, Map<number, [number,number,number,number,number,number]>>();
const loadCache = new WeakMap<World, { t: number; out: JointLoad[] }>();

export function measureJointLoads(w: World): JointLoad[] {
  const cached = loadCache.get(w);
  if (cached && cached.t === w.clock) return cached.out;
  const out: JointLoad[] = [];
  let hist = velPrev.get(w); if (!hist) { hist = new Map(); velPrev.set(w, hist); }
  const dt = Math.max(w.dt, 1e-6);
  const contacts = w.body.allContactSamples(w.dt);
  w.sk.joints.forEach((j, ji) => {
    let anchor: Float64Array | null = null;
    let axis: Float64Array | null = null;
    for (const d of w.body.dofs) {
      if (d.joint !== ji) continue;
      if (!anchor) anchor = d.anchorWorld;
      if (d.axis === 2) axis = d.axisWorld;
    }
    if (!anchor || !axis) return;
    let tx = 0, ty = 0, tz = 0, fx = 0, fy = 0, fz = 0;
    for (const bi of w.body.subtree[ji] ?? []) {
      const rb = w.body.bodies[bi]!;
      const p = rb.worldCom(); const m = rb.mass();
      const v = rb.linvel(), av = rb.angvel();
      const H = worldAngularMomentum(rb, av);
      const pv = hist.get(bi);
      const ax = pv ? (v.x - pv[0]) / dt : 0, ay = pv ? (v.y - pv[1]) / dt : 0, az = pv ? (v.z - pv[2]) / dt : 0;
      const hx = pv ? (H.x - pv[3]) / dt : 0, hy = pv ? (H.y - pv[4]) / dt : 0, hz = pv ? (H.z - pv[5]) / dt : 0;
      hist.set(bi, [v.x, v.y, v.z, H.x, H.y, H.z]);
      const bfx = m * (-ax), bfy = m * (-9.81 - ay), bfz = m * (-az);
      const rx = p.x - anchor[0]!, ry = p.y - anchor[1]!, rz = p.z - anchor[2]!;
      fx += bfx; fy += bfy; fz += bfz;
      tx += ry * bfz - rz * bfy + hx;
      ty += rz * bfx - rx * bfz + hy;
      tz += rx * bfy - ry * bfx + hz;
    }
    const sub = new Set(w.body.subtree[ji] ?? []);
    for (const c of contacts) {
      if (!sub.has(c.body)) continue;
      const rx = c.x - anchor[0]!, ry = c.y - anchor[1]!, rz = c.z - anchor[2]!;
      fx += c.fx; fy += c.fy; fz += c.fz;
      tx += ry * c.fz - rz * c.fy;
      ty += rz * c.fx - rx * c.fz;
      tz += rx * c.fy - ry * c.fx;
    }
    out.push({
      name: j.name, child: j.childKey,
      // 实测正方向：髋/膝为负载反作用，踝为同向。
      torque: (/^(hip|knee)_/.test(j.name) ? -1 : 1) * (tx * axis[0]! + ty * axis[1]! + tz * axis[2]!),
      force: { x: fx, y: fy, z: fz },
      anchor: { x: anchor[0]!, y: anchor[1]!, z: anchor[2]! },
    });
  });
  loadCache.set(w, { t: w.clock, out });
  return out;
}
