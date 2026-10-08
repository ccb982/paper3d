/**
 * diag-anchor.ts —— 球铰锚点是否导致"零输入注入角速度"
 * 用法：node tools/run.mjs diag-anchor
 *
 * 场景：spine4 + head，零重力零初速零力矩，球铰。
 * 变量：锚点取值
 *   A 骨架锚点          （已知：step1 后 ω=−14.5）
 *   B 全原点 (0,0,0)
 *   C 只用 childLocal 给两边（等价于锚点=同一点但表达不同）
 *   D 锚点 = 两体心连线中点（本地系）
 * 若 B 也发散 ⇒ 与锚点无关，是球铰+惯量比本身的问题。
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const J = sk.joints.find((j) => j.name === 'neck')!;

function test(label: string, a1: { x: number; y: number; z: number }, a2: { x: number; y: number; z: number }, steps = 5) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = Number(process.env.ITERS ?? 8);
  if (process.env.FRIC) w.numAdditionalFrictionIterations = Number(process.env.FRIC);
  if (process.env.SMALL) w.smallStepsEnabled = true;
  const RB: RAPIER.RigidBody[] = [];
  for (const k of [J.parentKey, J.childKey]) {
    const b = sk.bodies.find((x) => x.key === k)!;
    const q = restQuatOf(b.restTiltRad, b.restYawRad);
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
        .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }).setCanSleep(false),
    );
    b.colliders.forEach((c) => {
      const d = c.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
        : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      d.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
        .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
          { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 });
      w.createCollider(d, rb);
    });
    RB.push(rb);
  }
  w.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), RB[0]!, RB[1]!, true);
  const out: string[] = [];
  for (let s = 0; s < steps; s++) {
    w.step();
    const wc = RB[1]!.angvel(), wp = RB[0]!.angvel();
    const d = Math.hypot(wc.x - wp.x, wc.y - wp.y, wc.z - wp.z);
    out.push(`s${s + 1}:|Δω|=${d.toFixed(3)}`);
  }
  console.log(`${label.padEnd(28)} ${out.join('  ')}`);
  w.free();
}

const P = { x: J.parentLocal[0], y: J.parentLocal[1], z: J.parentLocal[2] };
const C = { x: J.childLocal[0], y: J.childLocal[1], z: J.childLocal[2] };
const O = { x: 0, y: 0, z: 0 };

console.log(`关节 ${J.name}  parentLocal=(${P.x.toFixed(4)}, ${P.y.toFixed(4)}, ${P.z.toFixed(4)})`);
console.log(`         childLocal=(${C.x.toFixed(4)}, ${C.y.toFixed(4)}, ${C.z.toFixed(4)})`);
console.log('');
console.log('════ 零重力零初速零力矩：球铰是否自己注入角速度 ════');
test('A 骨架锚点 P/C', P, C);
test('B 全原点', O, O);
test('C P/P', P, P);
test('D C/C', C, C);
