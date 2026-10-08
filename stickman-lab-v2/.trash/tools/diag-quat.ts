/**
 * diag-quat.ts —— restQuatOf 的输出是否合法 + setRotation 用到它会不会炸
 * 用法：node tools/run.mjs diag-quat
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

console.log('════ restQuatOf 输出 ════');
const sk = buildSkeleton(DEFAULT_CONFIG);
for (const k of ['head', 'spine4', 'torso', 'foot_l', 'mfoot_l', 'thigh_l']) {
  const b = sk.bodies.find((x) => x.key === k)!;
  const q = restQuatOf(b.restTiltRad, b.restYawRad);
  const arr = Array.from(q as ArrayLike<number>);
  const norm = Math.hypot(arr[0]!, arr[1]!, arr[2]!, arr[3]!);
  console.log(`${k.padEnd(10)} tilt=${b.restTiltRad.toFixed(6)} yaw=${b.restYawRad.toFixed(6)}  q=[${arr.map((v) => (Number.isFinite(v) ? v.toFixed(8) : String(v))).join(', ')}]  |q|=${norm.toFixed(8)}`);
}

console.log('\n════ 用真实 restQuat 建 2 刚体 ════');
function test(label: string, keys: string[], useExactQuat: boolean) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  const rbs: RAPIER.RigidBody[] = [];
  for (const k of keys) {
    const b = sk.bodies.find((x) => x.key === k)!;
    let d = RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz);
    if (useExactQuat) {
      const q = restQuatOf(b.restTiltRad, b.restYawRad);
      d = d.setRotation({ x: Math.fround(q[0]), y: Math.fround(q[1]), z: Math.fround(q[2]), w: Math.fround(q[3]) });
    }
    const rb = w.createRigidBody(d);
    b.colliders.forEach((c) => {
      const desc = c.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
        : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
        .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
          { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 });
      w.createCollider(desc, rb);
    });
    rbs.push(rb);
  }
  w.step();
  const bad = rbs.findIndex((r) => !Number.isFinite(r.translation().x));
  console.log(`${label.padEnd(38)} ${bad < 0 ? '✔ 稳定' : `✘ NaN @${keys[bad]}`}`);
}
test('2体 真实 restQuat  spine4+head', ['spine4', 'head'], true);
test('2体 真实 restQuat  foot_l+arch_l', ['foot_l', 'arch_l'], true);
test('2体 真实 restQuat  thigh_l+shin_l', ['thigh_l', 'shin_l'], true);
