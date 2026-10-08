/**
 * _probe-limit-sign.ts —— Rapier revolute 角度零点/符号约定实测
 * 单关节 + 骨架同款串联，零重力/零力矩，带限位启动，看是否第 1 拍被"限位"推飞。
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';
import { qAxisAngle, qEulerXYZ, qMul, qOf, qRel } from '../src/core/quat';

const sk = buildSkeleton(DEFAULT_CONFIG);
const DEG = Math.PI / 180;

function mkBody(w: RAPIER.World, key: string): RAPIER.RigidBody {
  const b = sk.bodies.find((x) => x.key === key)!;
  const q = restQuatOf(b.restTiltRad, b.restYawRad);
  return w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }).setCanSleep(false),
  );
}

function relW(w: RAPIER.World, a: RAPIER.RigidBody, b: RAPIER.RigidBody): number {
  void w;
  const va = a.angvel(), vb = b.angvel();
  return Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
}

// ── A：单 revolute（踝 foot_l：轴 Z，限位 [-12°, +18°]）──
console.log('════ A. 单 revolute（foot_l，轴 Z，限位[-12°,+18°]，出生角 0）════');
{
  const J = sk.joints.find((j) => j.name === 'foot_l')!;
  for (const label of ['无限位', '限位[−12,18]', '限位[−12−π,18−π]', '限位[−π+12,−π−18]']) {
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    w.timestep = 1 / 240;
    w.numSolverIterations = 16;
    const P = mkBody(w, J.parentKey);
    const C = mkBody(w, J.childKey);
    const j = w.createImpulseJoint(
      RAPIER.JointData.revolute(
        { x: J.parentLocal[0], y: J.parentLocal[1], z: J.parentLocal[2] },
        { x: J.childLocal[0], y: J.childLocal[1], z: J.childLocal[2] },
        { x: 0, y: 0, z: 1 },
      ), P, C, true) as RAPIER.RevoluteImpulseJoint;
    if (label === '限位[−12,18]') j.setLimits(-12 * DEG, 18 * DEG);
    if (label === '限位[−12−π,18−π]') j.setLimits(-12 * DEG - Math.PI, 18 * DEG - Math.PI);
    if (label === '限位[−π+12,−π−18]') j.setLimits(-Math.PI + 12 * DEG, -Math.PI - 18 * DEG);
    const trace: number[] = [];
    for (let s = 0; s < 120; s++) {
      w.step();
      if (s < 5 || s === 59) trace.push(relW(w, P, C));
    }
    console.log(`${label.padEnd(22)} 前5拍ω: ${trace.slice(0, 5).map((v) => v.toFixed(3)).join(', ')}  t=0.25s: ${trace[5]!.toFixed(3)}`);
  }
}

// ── B：neck 串联（3×revolute，限位从骨架）──
console.log('\n════ B. neck 串联（X/Y/Z 三环，rest=0）════');
{
  const J = sk.joints.find((j) => j.name === 'neck')!;
  const P = mkBody, C = mkBody;
  for (const label of ['无限位', '骨架限位(rest+min/max)', '限位偏移−π']) {
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    w.timestep = 1 / 240;
    w.numSolverIterations = 16;
    const pp = P(w, J.parentKey);
    const cc = C(w, J.childKey);
    const qP = qOf(pp.rotation());
    const qC = qOf(cc.rotation());
    const [p1, p2, p3] = qEulerXYZ(qRel(qP, qC));
    const R1 = qMul(qP, qAxisAngle(1, 0, 0, p1));
    const R2 = qMul(R1, qAxisAngle(0, 1, 0, p2));
    const aw = new Float64Array(3);
    // 父锚点世界
    const tx = 2 * (qP.y * J.parentLocal[2] - qP.z * J.parentLocal[1]);
    const ty = 2 * (qP.z * J.parentLocal[0] - qP.x * J.parentLocal[2]);
    const tz = 2 * (qP.x * J.parentLocal[1] - qP.y * J.parentLocal[0]);
    aw[0] = J.parentLocal[0] + qP.w * tx + (qP.y * tz - qP.z * ty);
    aw[1] = J.parentLocal[1] + qP.w * ty + (qP.z * tx - qP.x * tz);
    aw[2] = J.parentLocal[2] + qP.w * tz + (qP.x * ty - qP.y * tx);
    const t = pp.translation();
    const pos = { x: t.x + aw[0]!, y: t.y + aw[1]!, z: t.z + aw[2]! };
    const mid = (q: typeof R1): RAPIER.RigidBody => {
      const m = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCanSleep(false));
      m.setAdditionalMassProperties(1e-3, { x: 0, y: 0, z: 0 }, { x: 1e-6, y: 1e-6, z: 1e-6 }, { x: 0, y: 0, z: 0, w: 1 }, true);
      return m;
    };
    const m1 = mid(R1), m2 = mid(R2);
    const a1 = { x: J.parentLocal[0], y: J.parentLocal[1], z: J.parentLocal[2] };
    const a2 = { x: J.childLocal[0], y: J.childLocal[1], z: J.childLocal[2] };
    const axes = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
    const js = [
      w.createImpulseJoint(RAPIER.JointData.revolute(a1, { x: 0, y: 0, z: 0 }, axes[0]!), pp, m1, true) as RAPIER.RevoluteImpulseJoint,
      w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, axes[1]!), m1, m2, true) as RAPIER.RevoluteImpulseJoint,
      w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, a2, axes[2]!), m2, cc, true) as RAPIER.RevoluteImpulseJoint,
    ];
    if (label === '骨架限位(rest+min/max)') {
      const rest = [p1, p2, p3];
      for (let k = 0; k < 3; k++) js[k]!.setLimits(rest[k]! + J.minRad[k]!, rest[k]! + J.maxRad[k]!);
    } else if (label === '限位偏移−π') {
      const rest = [p1, p2, p3];
      for (let k = 0; k < 3; k++) js[k]!.setLimits(rest[k]! + J.minRad[k]! - Math.PI, rest[k]! + J.maxRad[k]! - Math.PI);
    }
    const trace: number[] = [];
    for (let s = 0; s < 120; s++) {
      w.step();
      if (s < 5 || s === 59) trace.push(relW(w, pp, cc));
    }
    console.log(`${label.padEnd(22)} 前5拍ω: ${trace.slice(0, 5).map((v) => v.toFixed(3)).join(', ')}  t=0.25s: ${trace[5]!.toFixed(3)}`);
  }
}
