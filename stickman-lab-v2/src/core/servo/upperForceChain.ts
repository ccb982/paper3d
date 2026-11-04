import type { World } from '../world';
export interface UpperLoad { name: string; torque: number; forceY: number }
export function measureUpperLoads(w: World): UpperLoad[] {
  const out: UpperLoad[] = [];
  w.sk.joints.forEach((j, ji) => {
    if (!/^(spine|neck)/.test(j.name)) return;
    let anchor: Float64Array | null = null, axis: Float64Array | null = null;
    for (const d of w.body.dofs) { if (d.joint !== ji) continue; if (!anchor) anchor = d.anchorWorld; if (d.axis === 2) axis = d.axisWorld; }
    if (!anchor || !axis) return;
    let tx = 0, ty = 0, tz = 0, fy = 0;
    for (const bi of w.body.subtree[ji] ?? []) {
      const rb = w.body.bodies[bi]!; const p = rb.worldCom(); const mg = rb.mass() * 9.81;
      const rx = p.x - anchor[0]!, ry = p.y - anchor[1]!, rz = p.z - anchor[2]!;
      fy -= mg; tx += ry * 0 - rz * (-mg); tz += rx * (-mg) - ry * 0;
    }
    out.push({ name: j.name, torque: tx * axis[0]! + ty * axis[1]! + tz * axis[2]!, forceY: fy });
  });
  return out;
}
