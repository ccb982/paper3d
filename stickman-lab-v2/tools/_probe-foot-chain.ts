/**
 * _probe-foot-chain.ts —— 柔性足链（foot→arch→mfoot，两环同轴 X）隔离测试
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);

function mkBody(w: RAPIER.World, key: string): RAPIER.RigidBody {
  const b = sk.bodies.find((x) => x.key === key)!;
  const q = restQuatOf(b.restTiltRad, b.restYawRad);
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }).setCanSleep(false),
  );
  for (const c of b.colliders) {
    const d = c.shape === 'capsule'
      ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
      : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
    d.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
      .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
        { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 })
      .setCollisionGroups(0);
    w.createCollider(d, rb);
  }
  return rb;
}

function run(label: string, limits: boolean, motor: boolean, both: boolean): void {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 16;
  const F = mkBody(w, 'foot_l');
  const A = mkBody(w, 'arch_l');
  const M = mkBody(w, 'mfoot_l');
  const JA = sk.joints.find((j) => j.name === 'arch_l')!;
  const JM = sk.joints.find((j) => j.name === 'mfoot_l')!;
  const mk = (J: typeof JA, P: RAPIER.RigidBody, C: RAPIER.RigidBody): void => {
    const j = w.createImpulseJoint(
      RAPIER.JointData.revolute(
        { x: J.parentLocal[0], y: J.parentLocal[1], z: J.parentLocal[2] },
        { x: J.childLocal[0], y: J.childLocal[1], z: J.childLocal[2] },
        { x: 1, y: 0, z: 0 },
      ), P, C, true) as RAPIER.RevoluteImpulseJoint;
    if (limits) j.setLimits(J.minRad[0]!, J.maxRad[0]!);
    if (motor) {
      j.configureMotorModel(RAPIER.MotorModel.ForceBased);
      j.configureMotorPosition(0, 400, 12);
    }
  };
  mk(JA, F, A);
  if (both) mk(JM, A, M);
  const rel = (a: RAPIER.RigidBody, b: RAPIER.RigidBody): number => {
    const ap = a.rotation(), bp = b.rotation();
    const d = Math.abs(ap.x * bp.x + ap.y * bp.y + ap.z * bp.z + ap.w * bp.w);
    return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI;
  };
  const trace: number[] = [];
  for (let s = 0; s < 120; s++) {
    w.step();
    if (s < 6 || s === 59) trace.push(Math.hypot(A.angvel().x, A.angvel().y, A.angvel().z) * 180 / Math.PI);
  }
  console.log(`${label.padEnd(26)} 弓角速(°/s): ${trace.slice(0, 6).map((v) => v.toFixed(1)).join(', ')}  t=0.25s:${trace[6]!.toFixed(1)}  末Δθ(足-弓)=${rel(F, A).toFixed(2)}°`);
}

console.log('════ 柔性足链隔离（零重力/无接触/120拍）════');
run('两环 裸', false, false, true);
run('两环 +限位', true, false, true);
run('两环 +电机', false, true, true);
run('两环 +限位+电机', true, true, true);
run('单环(足-弓) +限位', true, false, false);
run('单环(足-弓) +限位+电机', true, true, false);
