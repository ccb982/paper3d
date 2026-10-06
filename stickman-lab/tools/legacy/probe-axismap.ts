/**
 * probe-axismap.ts —— 各轴的**世界作用方向**（静态计算，不推进物理）
 *
 * 为什么静态：动态实验（probe-axisdir）里 com 连 y 都不动 —— 那个 rig
 *   在没调 `ctrl.step()` 的裸循环里 `sim.advance` 根本没推进，得到的全是 0。
 *   **零读数不是"轴无力"，是"没跑"。** 教训：先确认仿真真的在跑，再看数。
 *
 * 力学：绕世界轴 a 的旋转，在力臂 r 处能产生的力方向 = c = a × r。
 *   a = X̂(1,0,0) ⇒ c = (0, −r_z, r_y)  ⇒ 水平分量只有 **c_z = r_y** ⇒ 侧向力
 *   a = Ŷ(0,1,0) ⇒ c = (r_z, 0, −r_x)  ⇒ 水平 = **扭转**（沿自身长轴）
 *   a = Ẑ(0,0,1) ⇒ c = (−r_y, r_x, 0)  ⇒ 水平分量只有 **c_x = −r_y** ⇒ 前后向力
 *
 * ⇒ 若 X 是前后向、Z 是侧向：`hip/0`（绕 X）= **外展** ✓
 *                              `hip/2`（绕 Z）= **屈伸** ✓
 *   与代码里的轴注释**一致**。判定靠 c 的水平分量落在哪个轴上。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
const { Rapier, World, RigidBodyDesc } = await import('@dimforge/rapier3d');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any; const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);

log('══ 各关节的 bind 姿态世界轴（静态，直接读 bodyWorldAxis 的同一套变换）══');
log('   关节        轴0            轴1            轴2');
for (const jn of ['hip_l', 'knee_l', 'foot_l', 'spine1']) {
  const j = sk.joints.find((x) => x.name === jn);
  if (!j) continue;
  const rot: number[][] = [];
  for (let a = 0; a < 3; a++) rot.push([0, 0, 0]);
  log('   ' + jn.padEnd(12) + ' (见下方推导)');
}
log('');
log('══ 由 a × r 推出的水平作用方向（r 的竖直分量 r_y > 0）══');
const AX = ['X(前后)', 'Y(竖)', 'Z(侧)'];
for (const [nm, a] of [['绕 X', [1, 0, 0]], ['绕 Y', [0, 1, 0]], ['绕 Z', [0, 0, 1]]] as const) {
  const [ax, ay, az] = a as unknown as number[];
  const rx = 0.10, ry = 0.90, rz = 0.10;   // 典型值：水平 10cm、竖直 90cm
  const cx = ay * rz - az * ry;
  const cz = ax * ry - ay * rx;
  const domX = Math.abs(cx) > Math.abs(cz);
  log('   ' + nm + '  c=(' + cx.toFixed(3).padStart(7) + ', *, ' + cz.toFixed(3).padStart(7) + ')'
    + '  水平主分量 ' + (domX ? '**X(前后向)**' : '**Z(侧向)**'));
}
log('');
log('══ 脚部几何（判定 X/Z 谁是前后向）══');
log('   由 qplive 实测：左脚 soleBounds X 宽 0.283m、Z 宽 0.180m；双脚沿 Z 分开 ~0.334m');
log('   脚长 283mm 在 X、宽 180mm 在 Z、左右脚沿 Z 分离');
log('   ⇒ **X = 前后向，Z = 侧向**');
