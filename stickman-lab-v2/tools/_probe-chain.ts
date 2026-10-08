/**
 * _probe-chain.ts —— 最小化：N 个 revolute 串联是否注入能量（与骨架无关）
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';

function run(label: string, nMid: number): void {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 16;
  const mkBig = (x: number): RAPIER.RigidBody => {
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, 0).setCanSleep(false));
    b.setAdditionalMassProperties(10, { x: 0, y: 0, z: 0 }, { x: 0.1, y: 0.1, z: 0.1 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    return b;
  };
  const mkMid = (x: number): RAPIER.RigidBody => {
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, 0).setCanSleep(false));
    b.setAdditionalMassProperties(1e-3, { x: 0, y: 0, z: 0 }, { x: 1e-5, y: 1e-5, z: 1e-5 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    return b;
  };
  const A = mkBig(0);
  const B = mkBig(0);
  const axes: { x: number; y: number; z: number }[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
  let prev: RAPIER.RigidBody = A;
  const mids: RAPIER.RigidBody[] = [];
  for (let i = 0; i < nMid; i++) {
    const m = mkMid(0);
    mids.push(m);
    w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, axes[i]!), prev, m, true);
    prev = m;
  }
  w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, axes[nMid] ?? axes[0]!), prev, B, true);

  const relW = (): number => {
    const va = A.angvel(), vb = B.angvel();
    return Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
  };
  let peak = 0;
  for (let s = 0; s < 480; s++) { w.step(); const v = relW(); if (v > peak) peak = v; }
  const p = A.linvel(); const q = B.linvel();
  console.log(`${label.padEnd(22)} 峰值|ωrel|=${peak.toFixed(4).padStart(9)}  末=${relW().toFixed(4).padStart(9)}  线速A=${Math.hypot(p.x, p.y, p.z).toFixed(3)} B=${Math.hypot(q.x, q.y, q.z).toFixed(3)}`);
}

console.log('════ 最小链条 / 零重力 / 480 拍 ════');
run('1 mid（2 关节）', 1);
run('2 mid（3 关节 XYZ）', 2);
run('0 mid（1 关节）', 0);
