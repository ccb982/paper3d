import type { World } from '../world';

export interface SagittalLink {
  name: string;
  joint: number;
  parentBody: number;
  childBody: number;
  axis: Float64Array;
  anchor: Float64Array;
  mass: number;
  com: { x: number; y: number; z: number };
  inertia: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  parentLink: number;
}

export function buildSagittalLinkTree(w: World): SagittalLink[] {
  const out: SagittalLink[] = [];
  for (const side of ['l', 'r'] as const) {
    const start = out.length;
    for (const jointName of [`hip_${side}`, `knee_${side}`, `foot_${side}`]) {
      const joint = w.sk.joints.findIndex((j) => j.name === jointName);
      if (joint < 0) continue;
      const dof = w.body.dofs.find((d) => d.name === jointName && d.axis === 2);
      if (!dof) continue;
      const childBody = w.body.jointBodies[joint * 2 + 1]!;
      const parentBody = w.body.jointBodies[joint * 2]!;
      const sub = w.body.subtree[joint] ?? [childBody];
      let mass = 0, cx = 0, cy = 0, cz = 0;
      for (const bi of sub) {
        const rb = w.body.bodies[bi]!;
        const c = rb.worldCom();
        const m = rb.mass();
        mass += m; cx += m * c.x; cy += m * c.y; cz += m * c.z;
      }
      const c = { x: cx / Math.max(1e-9, mass), y: cy / Math.max(1e-9, mass), z: cz / Math.max(1e-9, mass) };
      const I = { x: 0, y: 0, z: 0 };
      for (const bi of sub) {
        const rb = w.body.bodies[bi]!;
        const p = rb.worldCom();
        const m = rb.mass();
        const pi = rb.principalInertia();
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
        I.x += pi.x + m * (dy * dy + dz * dz);
        I.y += pi.y + m * (dx * dx + dz * dz);
        I.z += pi.z + m * (dx * dx + dy * dy);
      }
      const q = w.body.bodies[childBody]!.rotation();
      out.push({
        name: jointName,
        joint,
        parentBody,
        childBody,
        axis: dof.axisWorld,
        anchor: dof.anchorWorld,
        mass,
        com: c,
        inertia: I,
        rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
        parentLink: out.length > start ? out.length - 1 : -1,
      });
    }
  }
  return out;
}
