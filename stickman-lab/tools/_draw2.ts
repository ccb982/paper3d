import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { DEFAULT_SIM, Sim } = await import('../src/core/sim');
const { DEFAULT_CONFIG, buildSkeleton } = await import('../src/core/skeleton');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
await import('../src/core/ragdoll');
{ const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm'); const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any; const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name); (im[i.module] ??= {})[i.name] = f; }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports); }

const sk: any = buildSkeleton({ ...DEFAULT_CONFIG });
const SHAPE = shapeForJoints(sk.joints.length);
const cfg: any = { ...DEFAULT_CONTROLLER, balance: { ...(DEFAULT_CONTROLLER as any).balance, kVipAnkle: Math.round(1.5 * 627) } };
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, cfg);
for (let i = 0; i < 120; i++) { (sim as unknown as { motor: { set(v: Float32Array): void } }).motor.set(ctrl.step(1 / 60)); sim.advance(1); }
const d: any = sim.doll;

const qmul = (a, b) => ({ x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y, y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x, z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w, w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z });
const qinv = (a) => ({ x: -a.x, y: -a.y, z: -a.z, w: a.w });
const qAxis = (ax, ang) => { const s = Math.sin(ang/2); return { x: ax.x*s, y: ax.y*s, z: ax.z*s, w: Math.cos(ang/2) }; };
const qapply = (q, v) => {
  const ix = q.w*v.x + q.y*v.z - q.z*v.y, iy = q.w*v.y + q.z*v.x - q.x*v.z;
  const iz = q.w*v.z + q.x*v.y - q.y*v.x, iw = -q.x*v.x - q.y*v.y - q.z*v.z;
  return { x: ix*q.w + iw*-q.x + iy*-q.z - iz*-q.y, y: iy*q.w + iw*-q.y + iz*-q.x - ix*-q.z, z: iz*q.w + iw*-q.z + ix*-q.y - iy*-q.x };
};
const restVisualQuatOf = (tilt, yaw) => qmul(qAxis({x:0,y:1,z:0}, yaw || 0), qAxis({x:1,y:0,z:0}, tilt));

const bd: any = sk.bodies.find((b) => b.key === 'foot_l');
const body: any = (d.bodies as any[])[(d as any).indexByKey.get('foot_l')];
const qNow: any = body.rotation();
const bt: any = body.translation();
const D = 180 / Math.PI;

console.log('=== 承重脚 foot_l（站姿，K_a=1.5K_crit，3s）===');
console.log('刚体平移 mm = (' + (bt.x*1000).toFixed(0) + ', ' + (bt.y*1000).toFixed(1) + ', ' + (bt.z*1000).toFixed(0) + ')');
console.log('静倾角 = ' + (bd.restTiltRad*D).toFixed(1) + '   外八yaw = ' + (bd.restYawRad*D).toFixed(1));

const cols = (d as any).soleCols[0];
const pts = [];
for (const col of cols) {
  const t = col.translation();        // 世界系
  const he = col.halfExtents();
  const ax = qapply(qNow, { x: he.x, y: 0, z: 0 });
  const az = qapply(qNow, { x: 0, y: 0, z: he.z });
  const ex = Math.hypot(ax.x, ax.z), ez = Math.hypot(az.x, az.z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push({ x: t.x + sx*ex, z: t.z + sz*ez });
}
const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
console.log('\n=== 物理 collider 足迹（世界系）===');
console.log('前后(X) ' + (x0*1000).toFixed(0) + ' .. ' + (x1*1000).toFixed(0) + ' mm  => 长 ' + ((x1-x0)*1000).toFixed(0) + ' mm');
console.log('横向(Z) ' + (z0*1000).toFixed(0) + ' .. ' + (z1*1000).toFixed(0) + ' mm  => 宽 ' + ((z1-z0)*1000).toFixed(0) + ' mm');
console.log('collider 定义 hx(局部X/前后)=70.2mm  hz(局部Z/横向)=25.0mm');

const qPlate = qmul(qNow, qmul(qinv(restVisualQuatOf(bd.restTiltRad, bd.restYawRad)), qAxis({x:0,y:1,z:0}, Math.PI/2)));
const pX = qapply(qPlate, { x: 1, y: 0, z: 0 });
const pZ = qapply(qPlate, { x: 0, y: 0, z: 1 });
const pY = qapply(qPlate, { x: 0, y: 1, z: 0 });
const cX = qapply(qNow, { x: 1, y: 0, z: 0 });
const dir = (v) => (v.x > 0.7 ? '前(+X)' : v.x < -0.7 ? '后(-X)' : '侧向');
console.log('\ncollider 长边(局部X) 世界 = (' + cX.x.toFixed(2) + ', ' + cX.z.toFixed(2) + ')  指向 ' + dir(cX));
console.log('贴图板 X 轴     世界 = (' + pX.x.toFixed(2) + ', ' + pX.z.toFixed(2) + ')  指向 ' + dir(pX));
console.log('贴图板 Z 轴     世界 = (' + pZ.x.toFixed(2) + ', ' + pZ.z.toFixed(2) + ')  指向 ' + dir(pZ));
console.log('贴图板 Y 轴（板"上"）世界 y 分量 = ' + pY.y.toFixed(3));

const COLS = 58, ROWS = 22;
const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
const put = (x, z, ch) => {
  const cx = Math.round(((x - x0) / Math.max(1e-9, x1 - x0)) * (COLS - 1));
  const cz = Math.round(((z - z0) / Math.max(1e-9, z1 - z0)) * (ROWS - 1));
  if (cz >= 0 && cz < ROWS && cx >= 0 && cx < COLS) grid[cz][cx] = ch;
};
for (const p of pts) put(p.x, p.z, '#');
const cc = { x: (x0+x1)/2, z: (z0+z1)/2 };
const arrow = (vx, vz, ch) => { for (let t = 0.15; t <= 1.0; t += 0.055) put(cc.x + vx*(x1-x0)*0.5*t, cc.z + vz*(z1-z0)*0.5*t, ch); };
arrow(cX.x, cX.z, 'C');
arrow(pX.x, pX.z, 'P');
console.log('\n=== 俯视图（+X 向前 ->，+Z 向左 向上）===');
for (const row of grid) console.log('  |' + row.join('') + '|');
console.log('\n  # = collider 足迹    C = collider 长边    P = 贴图板 X 轴');
const dot = cX.x*pX.x + cX.z*pX.z;
console.log('\n★ collider 长边 vs 贴图板 X 轴夹角 = ' + (Math.acos(Math.max(-1, Math.min(1, dot)))*D).toFixed(1) + '°');
console.log('  90° => 贴图板相对 collider 转了 90°，靴子以侧面朝向观众');