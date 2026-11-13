import type { World } from '../world';
import { buildSagittalLinkTree, type SagittalLink } from './linkTree';

interface V3 { x: number; y: number; z: number }

const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

function inertiaMul(link: SagittalLink, v: V3): V3 {
  const q = link.rotation;
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const rot = (vx: number, vy: number, vz: number): V3 => {
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return { x: vx + w * tx + (y * tz - z * ty), y: vy + w * ty + (z * tx - x * tz), z: vz + w * tz + (x * ty - y * tx) };
  };
  const ex = rot(1, 0, 0), ey = rot(0, 1, 0), ez = rot(0, 0, 1);
  return add(add(scale(ex, link.inertia.x * dot(ex, v)), scale(ey, link.inertia.y * dot(ey, v))), scale(ez, link.inertia.z * dot(ez, v)));
}

export function computeRneaBias(w: World, out: Float64Array, qdZero = false): void {
  out.fill(0);
  const links = buildSagittalLinkTree(w);
  const n = links.length;
  const omega: V3[] = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  const alpha: V3[] = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  const acc: V3[] = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  const force: V3[] = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  const moment: V3[] = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  const g = { x: 0, y: -9.81, z: 0 };
  for (let i = 0; i < n; i++) {
    const link = links[i]!;
    const p = link.parentLink;
    const wp = p >= 0 ? omega[p]! : { x: 0, y: 0, z: 0 };
    const ap = p >= 0 ? alpha[p]! : { x: 0, y: 0, z: 0 };
    const u = { x: link.axis[0]!, y: link.axis[1]!, z: link.axis[2]! };
    const dof = w.body.dofs.find((d) => d.name === link.name && d.axis === 2);
    const qd = qdZero ? 0 : (dof?.vel ?? 0);
    const wrel = scale(u, qd);
    omega[i] = add(wp, wrel);
    alpha[i] = add(ap, scale(cross(wp, u), qd));
    const r = sub(link.com, { x: link.anchor[0]!, y: link.anchor[1]!, z: link.anchor[2]! });
    const centripetal = cross(omega[i]!, cross(omega[i]!, r));
    acc[i] = add(cross(alpha[i]!, r), centripetal);
    const f = scale(sub(acc[i]!, g), link.mass);
    const Iw = inertiaMul(link, omega[i]!);
    const N = add(inertiaMul(link, alpha[i]!), cross(omega[i]!, Iw));
    force[i] = f;
    moment[i] = N;
  }
  for (let i = 0; i < n; i++) {
    const link = links[i]!;
    if (/^hip_/.test(link.name)) {
      const sub = new Set(w.body.subtree[link.joint] ?? []);
      const u = { x: link.axis[0]!, y: link.axis[1]!, z: link.axis[2]! };
      const a = { x: link.anchor[0]!, y: link.anchor[1]!, z: link.anchor[2]! };
      let upper = 0;
      for (let bi = 0; bi < w.body.bodies.length; bi++) {
        if (sub.has(bi)) continue;
        const rb = w.body.bodies[bi]!;
        const c = rb.worldCom();
        const r = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const F = { x: 0, y: -rb.mass() * 9.81, z: 0 };
        upper += dot(u, cross(r, F));
      }
      const di = w.body.dofByName(link.name, 2);
      if (di >= 0) out[di] = out[di]! + upper;
    }
    const f = force[i]!;
    const m = moment[i]!;

    let j = i;
    while (j >= 0) {
      const anc = links[j]!;
      const u = { x: anc.axis[0]!, y: anc.axis[1]!, z: anc.axis[2]! };
      const r = sub(link.com, { x: anc.anchor[0]!, y: anc.anchor[1]!, z: anc.anchor[2]! });
      const t = add(m, cross(r, f));
      const di = w.body.dofByName(anc.name, 2);
      if (di >= 0) out[di] = out[di]! + dot(u, t);
      j = anc.parentLink;
    }
  }
}
