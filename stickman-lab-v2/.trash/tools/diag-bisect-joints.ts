/**
 * diag-bisect-joints.ts —— 逐个添加关节，找出哪一对导致 NaN
 * 用法：node tools/run.mjs diag-bisect-joints
 */
import './_boot';
import * as RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Executor } from '../src/core/executor';
import { restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const EXCLUDE = new Set<string>(process.env.EXCLUDE ? process.env.EXCLUDE.split(',') : []);

function makeWorld(nJoints: number, exclude: Set<string>) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 8;
  const bodies: RAPIER.RigidBody[] = [];
  const idx = new Map<string, number>();
  sk.bodies.forEach((b, i) => {
    idx.set(b.key, i);
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(b.cx, b.cy, b.cz)
        .setRotation(restQuatOf(b.restTiltRad, b.restYawRad)),
    );
    for (const c of b.colliders) {
      const desc = c.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
        : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
        .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
          { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 });
      w.createCollider(desc, rb);
    }
    bodies.push(rb);
  });

  const added: string[] = [];
  for (let i = 0; i < Math.min(nJoints, sk.joints.length); i++) {
    const j = sk.joints[i]!;
    if (exclude.has(j.name)) continue;
    const pi = idx.get(j.parentKey)!, ci = idx.get(j.childKey)!;
    const a1 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
    const a2 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };
    let jd: RAPIER.JointData;
    if (j.revoluteAxis) {
      jd = RAPIER.JointData.revolute(a1, a2, { x: j.revoluteAxis[0], y: j.revoluteAxis[1], z: j.revoluteAxis[2] });
    } else {
      jd = RAPIER.JointData.spherical(a1, a2);
    }
    w.createImpulseJoint(jd, bodies[pi]!, bodies[ci]!, true);
    added.push(j.name);
  }
  void Executor;
  return { w, bodies, added };
}

function testStable(nJoints: number, steps = 3): { ok: boolean; bad: string | null; added: string[] } {
  const { w, bodies, added } = makeWorld(nJoints, EXCLUDE);
  for (let s = 0; s < steps; s++) {
    w.step();
    for (let i = 0; i < bodies.length; i++) {
      if (!Number.isFinite(bodies[i]!.translation().x)) {
        return { ok: false, bad: sk.bodies[i]!.key, added };
      }
    }
  }
  return { ok: true, bad: null, added };
}

console.log('════ 逐关节添加，找 NaN 的临界关节 ════');
console.log(`排除: ${EXCLUDE.size ? [...EXCLUDE].join(',') : '(无)'}`);
console.log('');

let lastOk = 0;
for (let n = 1; n <= sk.joints.length; n++) {
  const r = testStable(n);
  const name = sk.joints[n - 1]!.name;
  if (!r.ok) {
    console.log(`✘ 加到 ${n} 个关节（+${name}）⇒ 不稳定，第一个 NaN 是 ${r.bad}`);
    console.log(`  上一个稳定状态 = ${lastOk} 个关节（到 ${sk.joints[lastOk - 1]?.name ?? '-'}）`);
    break;
  }
  lastOk = n;
  console.log(`✔ ${String(n).padStart(2)} 个关节（... +${name}）稳定`);
}

console.log('');
console.log('全部关节名（顺序）：');
console.log(sk.joints.map((j, i) => `${i}:${j.name}`).join('  '));
