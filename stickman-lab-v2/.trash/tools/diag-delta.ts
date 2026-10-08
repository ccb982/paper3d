/**
 * diag-delta.ts —— 把 World/Body 比 diag-full 多的东西，逐个加上去
 * 用法：node tools/run.mjs diag-delta
 *
 * 基线 = diag-full（已证 20 步稳定）：19体 + 18关节 + 地面，无 group、无 setLimits
 * 逐个加：
 *   D1 numAdditionalFrictionIterations = 4
 *   D2 collisionGroups（地面 0x0001/0x0002，刚体 0x0002/0x0001）
 *   D3 revolute 关节 setLimits(...)
 *   D4 damping（linear 0.02 / angular 0.05）
 *   D5 地面 collider 最先创建（先 ground 后 bodies）
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const MEM_SELF = 0x0002, MEM_GROUND = 0x0001;
const G_SELF = ((MEM_SELF << 16) | MEM_GROUND) >>> 0;
const G_GROUND = ((MEM_GROUND << 16) | MEM_SELF) >>> 0;

const sk = buildSkeleton(DEFAULT_CONFIG);

interface Opt {
  fricIter?: boolean;
  groups?: boolean;
  limits?: boolean;
  damping?: boolean;
  groundFirst?: boolean;
  ground?: boolean;
}
function test(label: string, o: Opt) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 8;
  if (o.fricIter) w.numAdditionalFrictionIterations = Math.max(1, 8 >> 1);

  const rbs: RAPIER.RigidBody[] = [];
  const idx = new Map<string, number>();

  const mkGround = () => {
    const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    const d = RAPIER.ColliderDesc.cuboid(60, 0.5, 12).setTranslation(0, -0.5, 0).setFriction(1.0);
    if (o.groups) d.setCollisionGroups(G_GROUND);
    w.createCollider(d, g);
  };
  if (o.groundFirst && o.ground !== false) mkGround();

  sk.bodies.forEach((b, i) => {
    idx.set(b.key, i);
    let d = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(b.cx, b.cy, b.cz)
      .setRotation(restQuatOf(b.restTiltRad, b.restYawRad))
      .setCanSleep(false);
    if (o.damping) d = d.setLinearDamping(0.02).setAngularDamping(0.05);
    const rb = w.createRigidBody(d);
    const isFoot = /foot|arch|mfoot|toe/.test(b.key);
    b.colliders.forEach((c) => {
      const desc = c.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
        : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
        .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
          { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(o.groups ? (isFoot ? 0.9 : 0.5) : 0.5)
        .setRestitution(0);
      if (o.groups) desc.setCollisionGroups(G_SELF);
      w.createCollider(desc, rb);
    });
    rbs.push(rb);
  });
  if (!o.groundFirst && o.ground !== false) mkGround();

  sk.joints.forEach((j) => {
    const pi = idx.get(j.parentKey), ci = idx.get(j.childKey);
    if (pi === undefined || ci === undefined) return;
    const a1 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
    const a2 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };
    if (j.revoluteAxis) {
      const joint = w.createImpulseJoint(
        RAPIER.JointData.revolute(a1, a2, { x: j.revoluteAxis[0], y: j.revoluteAxis[1], z: j.revoluteAxis[2] }),
        rbs[pi]!, rbs[ci]!, true,
      );
      if (o.limits) {
        const free = j.revoluteAxis[0] ? 0 : j.revoluteAxis[1] ? 1 : 2;
        (joint as unknown as { setLimits(a: number, b: number): void }).setLimits(j.minRad[free]!, j.maxRad[free]!);
      }
    } else {
      w.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), rbs[pi]!, rbs[ci]!, true);
    }
  });

  let badAt = -1, badKey = '';
  for (let s = 0; s < 20; s++) {
    w.step();
    for (let i = 0; i < rbs.length; i++) {
      if (!Number.isFinite(rbs[i]!.translation().x)) { badAt = s + 1; badKey = sk.bodies[i]!.key; break; }
    }
    if (badAt > 0) break;
  }
  console.log(`${label.padEnd(46)} ${badAt > 0 ? `✘ step${badAt} NaN @${badKey}` : '✔ 20 步稳定'}`);
  w.free();
}

console.log('════ 增量排查（基线 = diag-full） ════');
test('基线（无任何增量）', {});
test('+D1 fricIter', { fricIter: true });
test('+D2 groups', { groups: true });
test('+D3 setLimits', { limits: true });
test('+D4 damping', { damping: true });
test('+D5 groundFirst', { groundFirst: true });
test('+D1+D2+D3+D4+D5 全加', { fricIter: true, groups: true, limits: true, damping: true, groundFirst: true });
