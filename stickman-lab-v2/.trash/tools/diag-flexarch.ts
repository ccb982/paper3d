/**
 * diag-flexarch.ts —— 消融对照：flexibleArch = true / false
 * 用法：node tools/run.mjs diag-flexarch
 *
 * 假设：v2 的 NaN 来自「小惯量刚体（arch/mfoot，I≈2e-4）用刚性 revolute 硬连」。
 *       v1 对这类关节**从不**用引擎刚性约束，而是自研被动弹簧阻尼软化。
 * 若 flexibleArch=false 时不再 NaN ⇒ 假设成立。
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

function test(label: string, cfg: Parameters<typeof buildSkeleton>[0], withJoints: boolean) {
  const sk = buildSkeleton(cfg);
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
        .setRotation(restQuatOf(b.restTiltRad, b.restYawRad))
        .setCanSleep(false),
    );
    b.colliders.forEach((c) => {
      const desc = c.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
        : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
        .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
          { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.5).setRestitution(0);
      w.createCollider(desc, rb);
    });
    bodies.push(rb);
  });

  let nJoint = 0;
  if (withJoints) {
    sk.joints.forEach((j) => {
      const pi = idx.get(j.parentKey), ci = idx.get(j.childKey);
      if (pi === undefined || ci === undefined) return;
      const a1 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
      const a2 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };
      const jd = j.revoluteAxis
        ? RAPIER.JointData.revolute(a1, a2, { x: j.revoluteAxis[0], y: j.revoluteAxis[1], z: j.revoluteAxis[2] })
        : RAPIER.JointData.spherical(a1, a2);
      w.createImpulseJoint(jd, bodies[pi]!, bodies[ci]!, true);
      nJoint++;
    });
  }

  // 记录最小惯量的刚体，便于归因
  let minI = Infinity, minKey = '';
  sk.bodies.forEach((b) => {
    const tot = b.colliders.reduce((s, c) => s + c.inertiaXY + c.inertiaZ, 0);
    if (tot < minI) { minI = tot; minKey = b.key; }
  });

  let badAt = -1, badKey = '';
  for (let s = 0; s < 10; s++) {
    w.step();
    for (let i = 0; i < bodies.length; i++) {
      if (!Number.isFinite(bodies[i]!.translation().x)) { badAt = s + 1; badKey = sk.bodies[i]!.key; break; }
    }
    if (badAt > 0) break;
  }
  console.log(
    `${label.padEnd(30)} 刚体=${String(sk.bodies.length).padStart(2)} 关节=${String(nJoint).padStart(2)} ` +
    `最小惯量体=${minKey}(${minI.toExponential(2)})  ` +
    `${badAt > 0 ? `✘ step${badAt} NaN @${badKey}` : '✔ 10 步稳定'}`,
  );
}

console.log('════ 柔性足消融对照 ════');
test('flexibleArch=true  有关节', { ...DEFAULT_CONFIG }, true);
test('flexibleArch=false 有关节', { ...DEFAULT_CONFIG, flexibleArch: false }, true);
test('flexibleArch=false 无关节', { ...DEFAULT_CONFIG, flexibleArch: false }, false);
