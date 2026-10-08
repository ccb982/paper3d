/**
 * _probe-subset.ts —— 全链耦合定位：
 *  A. 每个 dof 出生时的"离轴残差"（qrel 旋转向量相对轴的正交分量）
 *  B. 只保留某组关节，看谁单独能注入
 */
import './_boot';
import { World } from '../src/core/world';
import { qOf, qRel } from '../src/core/quat';

const FRAMES = 240;

function spawnAlign(w: World): void {
  let worst = 0, worstName = '';
  for (const d of w.body.dofs) {
    const b1 = w.body.allBodies[d.b1]!;
    const b2 = w.body.allBodies[d.b2]!;
    const qr = qRel(qOf(b1.rotation()), qOf(b2.rotation()));
    // 旋转向量
    const len = Math.hypot(qr.x, qr.y, qr.z);
    const ang = 2 * Math.atan2(len, qr.w);
    const rvx = len > 1e-12 ? qr.x / len * ang : 0;
    const rvy = len > 1e-12 ? qr.y / len * ang : 0;
    const rvz = len > 1e-12 ? qr.z / len * ang : 0;
    const a = d.axisLocal;
    const al = Math.hypot(a.x, a.y, a.z);
    const dot = (rvx * a.x + rvy * a.y + rvz * a.z) / al;
    const perp = Math.hypot(rvx - dot * a.x / al, rvy - dot * a.y / al, rvz - dot * a.z / al);
    if (perp > worst) { worst = perp; worstName = `${d.name}/${d.axis}`; }
  }
  console.log(`   出生离轴残差 max = ${(worst * 180 / Math.PI).toExponential(2)}° (${worstName})`);
}

function measure(label: string, keep: (name: string) => boolean): void {
  const w = new World();
  w.driveEnabled = false;
  w.setGravityZero();
  w.reset();
  // 移除非保留关节
  for (const d of w.body.dofs) {
    if (d.engineJoint && !keep(d.name)) w.world.removeImpulseJoint(d.engineJoint, true);
  }
  for (const b of w.body.allBodies) {
    const t = b.translation();
    b.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true);
  }
  w.advance(2);
  let spike = 0;
  for (const d of w.body.dofs) if (keep(d.name)) spike += Math.abs(d.vel);
  w.advance(FRAMES - 2);
  let sum = 0, sumW = 0, worst = '', worstD = 0;
  for (const d of w.body.dofs) {
    if (!keep(d.name)) continue;
    const dd = Math.abs(d.angle) * 180 / Math.PI;
    sum += dd; sumW += Math.abs(d.vel);
    if (dd > worstD) { worstD = dd; worst = `${d.name}/${d.axis}`; }
  }
  console.log(`${label.padEnd(28)} Σ|Δθ|=${sum.toFixed(1).padStart(6)}°  Σ|ω|=${sumW.toFixed(3).padStart(8)}  第2拍|ω|=${spike.toFixed(3).padStart(7)}  最差 ${worst} ${worstD.toFixed(1)}°`);
}

console.log('════ 出生离轴残差（全骨架，reset 后）════');
{
  const w = new World();
  w.reset();
  spawnAlign(w);
}

console.log('\n════ 关节子集（零重力/抬离/240拍）════');
measure('① 全部', () => true);
measure('② 只上肢球窝', (n) => /^(neck|shoulder|elbow|spine)/.test(n));
measure('③ 只左腿链', (n) => /^(hip_l|knee_l|foot_l|arch_l|mfoot_l)/.test(n));
measure('④ 只右腿链', (n) => /^(hip_r|knee_r|foot_r|arch_r|mfoot_r)/.test(n));
measure('⑤ 只双臂', (n) => /^(shoulder|elbow)_/.test(n));
measure('⑥ 只脊柱+颈', (n) => /^(spine|neck)/.test(n));
measure('⑦ 腿链无柔性足', (n) => /^(hip_l|knee_l|foot_l)$/.test(n) || /^(hip_r|knee_r|foot_r)$/.test(n));
measure('⑧ 腿链无踝(髋+膝)', (n) => /^(hip_l|knee_l)$/.test(n) || /^(hip_r|knee_r)$/.test(n));
measure('⑨ 只踝+柔性足', (n) => /^(foot_l|arch_l|mfoot_l|foot_r|arch_r|mfoot_r)$/.test(n));
measure('⑩ 只髋', (n) => /^hip_/.test(n));
