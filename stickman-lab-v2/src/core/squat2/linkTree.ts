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
}

export function buildSagittalLinkTree(w: World): SagittalLink[] {
  const out: SagittalLink[] = [];
  for (const side of ['l', 'r'] as const) {
    for (const jointName of [`hip_${side}`, `knee_${side}`, `foot_${side}`]) {
      const joint = w.sk.joints.findIndex((j) => j.name === jointName);
      if (joint < 0) continue;
      const dof = w.body.dofs.find((d) => d.name === jointName && d.axis === 2);
      if (!dof) continue;
      const childBody = w.body.jointBodies[joint * 2 + 1]!;
      const parentBody = w.body.jointBodies[joint * 2]!;
      const rb = w.body.bodies[childBody]!;
      const c = rb.worldCom();
      out.push({
        name: jointName,
        joint,
        parentBody,
        childBody,
        axis: dof.axisWorld,
        anchor: dof.anchorWorld,
        mass: rb.mass(),
        com: { x: c.x, y: c.y, z: c.z },
      });
    }
  }
  return out;
}
