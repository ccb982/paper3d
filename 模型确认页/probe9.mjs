// probe9.mjs —— 搞清头部到底是不是封闭盒壳；耳朵在哪；头发该按什么切
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const GLB = path.join(DIR, 'candidate_cubeguy.glb');
const out = []; const P = (...a) => out.push(a.join(' '));

const buf = fs.readFileSync(GLB);
const DV = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let off = 12, gltf = null, BIN = null;
while (off < buf.length) {
  const len = DV.getUint32(off, true), type = DV.getUint32(off + 4, true), s = off + 8;
  if (type === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(buf.subarray(s, s + len)));
  else if (type === 0x004e4942) BIN = buf.subarray(s, s + len);
  off = s + len;
}
const gt = (ct) => ct === 5126 ? 'getFloat32' : ct === 5125 ? 'getUint32' : ct === 5123 ? 'getUint16' : ct === 5121 ? 'getUint8' : ct === 5122 ? 'getInt16' : 'getInt8';
const so = (ct) => ct === 5126 || ct === 5125 ? 4 : ct === 5123 || ct === 5122 ? 2 : 1;
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function acc(i) { const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView]; const base = (bv.byteOffset || 0) + (a.byteOffset || 0); const n = NC[a.type], stride = bv.byteStride || (n * so(a.componentType)); const g = gt(a.componentType), sz = so(a.componentType); return { count: a.count, read: (idx, c) => DV[g](BIN.byteOffset + base + idx * stride + c * sz, true) }; }
const prim = gltf.meshes[0].primitives[0];
const POS = acc(prim.attributes.POSITION), NRM = acc(prim.attributes.NORMAL), JNT = acc(prim.attributes.JOINTS_0), WGT = acc(prim.attributes.WEIGHTS_0), IDX = acc(prim.indices);
const N = POS.count, T = IDX.count / 3;
const X = (i) => POS.read(i, 0), Y = (i) => POS.read(i, 1), Z = (i) => POS.read(i, 2);
const NX = (i) => NRM.read(i, 0), NY = (i) => NRM.read(i, 1), NZ = (i) => NRM.read(i, 2);
const headJoint = gltf.skins[0].joints.findIndex((j) => gltf.nodes[j].name === 'Head');
const isHeadDom = (i) => { let bw = 0, bj = -1; for (let k = 0; k < 4; k++) { const w = WGT.read(i, k); if (w > bw) { bw = w; bj = JNT.read(i, k); } } return bj === headJoint && bw > 0.5; };

const hv = [];
for (let i = 0; i < N; i++) if (isHeadDom(i)) hv.push(i);
let hx0 = Infinity, hx1 = -Infinity, hy0 = Infinity, hy1 = -Infinity, hz0 = Infinity, hz1 = -Infinity;
for (const i of hv) { hx0 = Math.min(hx0, X(i)); hx1 = Math.max(hx1, X(i)); hy0 = Math.min(hy0, Y(i)); hy1 = Math.max(hy1, Y(i)); hz0 = Math.min(hz0, Z(i)); hz1 = Math.max(hz1, Z(i)); }
P('头部主导顶点', hv.length);
P('  包围盒 x', hx0.toFixed(6), '..', hx1.toFixed(6));
P('          y', hy0.toFixed(6), '..', hy1.toFixed(6));
P('          z', hz0.toFixed(6), '..', hz1.toFixed(6));

// 关键：z >= FACE_Z_TOP (0.026036) 的头部顶点有多少？它们是不是一整块"盖子"？
const TOP = 0.026036;
const topV = hv.filter((i) => Z(i) >= TOP - 1e-4);
P('\n=== z >= ' + TOP + ' 的头部顶点:', topV.length, '===');
let tz1 = -Infinity, tz0 = Infinity;
for (const i of topV) { tz0 = Math.min(tz0, Z(i)); tz1 = Math.max(tz1, Z(i)); }
P('   z', tz0.toFixed(6), '..', tz1.toFixed(6));

// 法线分布（这些"头顶"顶点是不是朝上的盖子 ny 小、nz 大）
let upN = 0, otherN = 0;
for (const i of topV) { if (NZ(i) > 0.7) upN++; else otherN++; }
P('   法线 nz>0.7（朝上的顶盖）:', upN, ' 其他:', otherN);

// 用并查集把 z>=TOP 的三角形分解成连通块，看是不是"一整块头发"还是"耳朵尖"
const topTris = [];
for (let t = 0; t < T; t++) {
  const a = IDX.read(t * 3, 0), b = IDX.read(t * 3 + 1, 0), c = IDX.read(t * 3 + 2, 0);
  if (Z(a) >= TOP - 1e-4 && Z(b) >= TOP - 1e-4 && Z(c) >= TOP - 1e-4) topTris.push(t);
}
const par = new Map();
const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); };
const vOf = new Map(); // 顶点 -> 三角
for (const t of topTris) {
  for (let k = 0; k < 3; k++) {
    const v = IDX.read(t * 3 + k, 0);
    if (!par.has(v)) par.set(v, v);
    if (!vOf.has(v)) vOf.set(v, []);
    vOf.get(v).push(t);
  }
}
for (const t of topTris) {
  const a = IDX.read(t * 3, 0), b = IDX.read(t * 3 + 1, 0), c = IDX.read(t * 3 + 2, 0);
  uni(a, b); uni(b, c); uni(c, a);
}
const groups = new Map();
for (const t of topTris) {
  const r = find(IDX.read(t * 3, 0));
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(t);
}
P('\n=== z>=TOP 的三角形连通块:', groups.size, '块 ===');
const gl = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [r, ts] of gl.slice(0, 8)) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const vs = new Set();
  for (const t of ts) for (let k = 0; k < 3; k++) { const i = IDX.read(t * 3 + k, 0); vs.add(i); x0 = Math.min(x0, X(i)); x1 = Math.max(x1, X(i)); y0 = Math.min(y0, Y(i)); y1 = Math.max(y1, Y(i)); z0 = Math.min(z0, Z(i)); z1 = Math.max(z1, Z(i)); }
  P('  面' + String(ts.length).padStart(4), ' 顶点' + String(vs.size).padStart(4),
    ' x ' + x0.toFixed(6) + '..' + x1.toFixed(6), ' y ' + y0.toFixed(6) + '..' + y1.toFixed(6), ' z ' + z0.toFixed(6) + '..' + z1.toFixed(6));
}

// ★ 换个思路：整块头顶"盖子" = 从上方看是封闭的。检查 z>=TOP 的三角形是否覆盖整个头横截面
// → 看这些三角形的 x/y 覆盖是否就是头的完整横截面
P('\n=== 头顶横截面覆盖 ===');
{
  const ts = topTris;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of ts) for (let k = 0; k < 3; k++) { const i = IDX.read(t * 3 + k, 0); x0 = Math.min(x0, X(i)); x1 = Math.max(x1, X(i)); y0 = Math.min(y0, Y(i)); y1 = Math.max(y1, Y(i)); }
  P('  头顶三角面 x', x0.toFixed(6), '..', x1.toFixed(6), ' y', y0.toFixed(6), '..', y1.toFixed(6));
  P('  头部整体   x', hx0.toFixed(6), '..', hx1.toFixed(6), ' y', hy0.toFixed(6), '..', hy1.toFixed(6));
}

// 耳朵在哪？找 max|x| 最大的头部顶点，看它们的 z
P('\n=== 最外侧顶点（|x| 最大）===');
const byAbsX = hv.slice().sort((a, b) => Math.abs(X(b)) - Math.abs(X(a)));
for (const i of byAbsX.slice(0, 12)) {
  P('  顶点' + i, ' x', X(i).toFixed(6), ' y', Y(i).toFixed(6), ' z', Z(i).toFixed(6), ' n=(' + NX(i).toFixed(2) + ',' + NY(i).toFixed(2) + ',' + NZ(i).toFixed(2) + ')');
}

// 眼睛层：z 0.0210..0.0223 的头部顶点，按 y 分层，去掉"耳朵/侧壳"
P('\n=== z 在 0.0208..0.0223 的头部顶点按 y 层 ===');
const eyeCand = hv.filter((i) => Z(i) >= 0.0208 && Z(i) <= 0.0223 && Y(i) > -0.005707 - 1e-6);
const ey = new Map();
for (const i of eyeCand) { const k = Y(i).toFixed(6); if (!ey.has(k)) ey.set(k, []); ey.get(k).push(i); }
for (const [k, vs] of [...ey.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
  let ax = 0, z0 = Infinity, z1 = -Infinity, xs = [];
  for (const i of vs) { ax = Math.max(ax, Math.abs(X(i))); z0 = Math.min(z0, Z(i)); z1 = Math.max(z1, Z(i)); xs.push(X(i)); }
  xs.sort((a, b) => a - b);
  P('  y=' + k, ' 顶点' + String(vs.length).padStart(3), ' max|x| ' + ax.toFixed(6), ' z ' + z0.toFixed(6) + '..' + z1.toFixed(6), ' x ' + xs[0].toFixed(4) + '..' + xs[xs.length - 1].toFixed(4));
}

fs.writeFileSync(path.join(DIR, '_probe9.txt'), out.join('\n'), 'utf8');
console.log('OK');
