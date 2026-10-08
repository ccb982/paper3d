/**
 * diag-handle.ts —— 验证「getRigidBody(0) 是 handle 不是下标」的假说
 * 用法：node tools/run.mjs diag-handle
 *
 * 这解释了为什么一堆探针误报 NaN：
 *   · 早期探针用 w.getRigidBody(0) 读第一个刚体
 *   · 若之前已经创建过别的 world / 刚体，handle 分配器是全局递增的
 *   · getRigidBody(0) 拿不到东西（或拿到已释放的句柄）⇒ translation() 读到 NaN
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';

console.log('════ handle 分配行为 ════');

// 先建一个 world，用掉一些 handle
const w0 = new RAPIER.World({ x: 0, y: 0, z: 0 });
const a0 = w0.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0));
w0.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1), a0);
console.log(`w0 第一个刚体 handle = ${a0.handle}`);

// 再建第二个 world
const w1 = new RAPIER.World({ x: 0, y: 0, z: 0 });
const a1 = w1.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0));
w1.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1), a1);
console.log(`w1 第一个刚体 handle = ${a1.handle}`);

w1.step();
console.log(`w1.step() 后  a1.translation().y = ${a1.translation().y}`);

const byHandle = w1.getRigidBody(a1.handle);
console.log(`w1.getRigidBody(${a1.handle}) = ${byHandle ? '✔ 拿到' : '✘ null'}  y=${byHandle?.translation().y}`);

const byZero = w1.getRigidBody(0);
console.log(`w1.getRigidBody(0)  = ${byZero ? `拿到 y=${byZero.translation().y}` : '✘ null'}`);

console.log('');
console.log('════ 结论 ════');
console.log('正确读法：**保存 createRigidBody 的返回值**，不要用 getRigidBody(下标)。');
console.log('handle 是全局递增的，跨 world 不归零。');
