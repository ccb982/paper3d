/**
 * _probe-isolate.ts —— T1 注入源隔离：分别移除球窝链 / revolute / 引擎电机 / 地面接触
 */
import './_boot';
import { World } from '../src/core/world';

const FRAMES = 720;

function measure(label: string, mut?: (w: World) => void): void {
  const w = new World();
  w.driveEnabled = false;
  w.setGravityZero();
  w.reset();
  if (mut) mut(w);
  // 出生角检查
  let spawnMax = 0, spawnName = '';
  for (const d of w.body.dofs) {
    const a = Math.abs(d.angle);
    if (a > spawnMax) { spawnMax = a; spawnName = `${d.name}/${d.axis}`; }
  }
  w.advance(FRAMES);
  let sum = 0, sumW = 0, worst = '', worstD = 0;
  for (const d of w.body.dofs) {
    const dd = Math.abs(d.angle) * 180 / Math.PI;
    sum += dd; sumW += Math.abs(d.vel);
    if (dd > worstD) { worstD = dd; worst = `${d.name}/${d.axis}`; }
  }
  console.log(`${label.padEnd(30)} Σ|Δθ|=${sum.toFixed(1).padStart(7)}°  Σ|ω|=${sumW.toFixed(3).padStart(8)}  最差 ${worst.padEnd(12)} ${worstD.toFixed(1)}°  出生角max=${(spawnMax * 180 / Math.PI).toFixed(3)}°(${spawnName})`);
}

console.log('════ T1 注入源隔离（零重力/零驱动/720 拍）════');
measure('① 基线');
measure('② 移除全部球窝链', (w) => {
  for (const d of w.body.dofs) {
    if (!d.engineMotor && d.engineJoint && w.sk.joints[d.joint]!.revoluteAxis === undefined) {
      w.world.removeImpulseJoint(d.engineJoint, true);
      d.engineJoint = undefined;
    }
  }
});
measure('③ 关闭引擎电机(arch/mfoot限位保留)', (w) => {
  for (const d of w.body.dofs) {
    if (d.engineMotor && d.engineJoint) d.engineJoint.configureMotorVelocity(0, 0);
  }
});
measure('④ 地面移开(取消接触)', (w) => {
  // 地面 cuboid 在 y=-0.5，把整个角色抬到 y=100 即可离开接触
  for (const b of w.body.allBodies) {
    const t = b.translation();
    b.setTranslation({ x: t.x, y: t.y + 100, z: t.z }, true);
  }
});
measure('⑤ 移除全部引擎铰链(无关节)', (w) => {
  for (const j of [...w.body.dofs]) {
    if (j.engineJoint) w.world.removeImpulseJoint(j.engineJoint, true);
  }
});
