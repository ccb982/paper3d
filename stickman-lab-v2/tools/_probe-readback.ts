/** _probe-readback.ts —— 零重力下回读保真度：单环/复合角命令 vs 回读 */
import './_boot';
import { World } from '../src/core/world';

const w = new World();
w.world.gravity = { x: 0, y: 0, z: 0 };      // 零重力隔离
const idx: number[] = [];
for (const ax of [0, 1, 2]) idx.push(w.body.dofByName('foot_l', ax));
const name = (i: number) => `轴${w.body.dofs[i]!.axis}`;

function hold(sec: number): void {
  for (let s = 0; s < Math.round(sec / w.dt); s++) w.advance(1);
}
function readAll(tag: string): void {
  console.log(`${tag} → ${idx.map((i) => `${name(i)}=${w.body.dofs[i]!.angle.toFixed(3)}`).join('  ')}`);
}

hold(0.3);
readAll('初始');

// ① 单环命令：屈伸（轴2）0.25
w.drive.setJointAngle('foot_l', 2, 0.25);
hold(0.8);
readAll('轴2←0.25');

// ② 再叠加内外翻（轴0）0.15
w.drive.setJointAngle('foot_l', 0, 0.15);
hold(0.8);
readAll('轴2=0.25 轴0←0.15');

// ③ 全部归零
w.drive.setJointAngle('foot_l', 2, 0);
w.drive.setJointAngle('foot_l', 0, 0);
hold(0.8);
readAll('全部←0');

// ④ 只动内外翻 0.15
w.drive.setJointAngle('foot_l', 0, 0.15);
hold(0.8);
readAll('轴0←0.15');

// ⑤ 越限测试：命令 0.5（限位 0.31）/ 轴0 命令 0.4（限位 0.24）
w.drive.setJointAngle('foot_l', 0, 0);
w.drive.setJointAngle('foot_l', 2, 0.5);
hold(0.8);
readAll('轴2←0.5（限位0.31）');
w.drive.setJointAngle('foot_l', 2, 0);
w.drive.setJointAngle('foot_l', 0, 0.4);
hold(0.8);
readAll('轴0←0.4（限位0.24）');
