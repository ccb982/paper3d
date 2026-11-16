import type { World } from '../world';

export interface UpperLoad {
  name: string;
  torque: [number, number, number];
  forceY: number;
}

export function measureUpperLoads(w: World): UpperLoad[] {
  const out: UpperLoad[] = [];
  w.sk.joints.forEach((j, ji) => {
    if (!/^(spine|neck)/.test(j.name)) return;
    let anchor: Float64Array | null = null;
    const axes: Array<Float64Array | null> = [null, null, null];
    for (const d of w.body.dofs) {
      if (d.joint !== ji) continue;
      if (!anchor) anchor = d.anchorWorld;
      if (d.axis >= 0 && d.axis <= 2) axes[d.axis] = d.axisWorld;
    }
    if (!anchor || axes[0] === null || axes[1] === null || axes[2] === null) return;
    let tx = 0, ty = 0, tz = 0, fy = 0;
    for (const bi of w.body.subtree[ji] ?? []) {
      const rb = w.body.bodies[bi]!;
      const p = rb.worldCom();
      const mg = rb.mass() * 9.81;
      const rx = p.x - anchor[0]!;
      const ry = p.y - anchor[1]!;
      const rz = p.z - anchor[2]!;
      fy -= mg;
      tx += ry * 0 - rz * (-mg);
      tz += rx * (-mg) - ry * 0;
    }
    const tau: [number, number, number] = [
      tx * axes[0]![0]! + ty * axes[0]![1]! + tz * axes[0]![2]!,
      tx * axes[1]![0]! + ty * axes[1]![1]! + tz * axes[1]![2]!,
      tx * axes[2]![0]! + ty * axes[2]![1]! + tz * axes[2]![2]!,
    ];
    out.push({ name: j.name, torque: tau, forceY: fy });
  });
  return out;
}
