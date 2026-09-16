// probe10.mjs —— 现场推翻/确认"前向轴"：把局部轴按 mesh 节点的真实变换算到世界，看脸到底朝哪
// 关键：之前记的"局部 -y → 世界 +Z"是**上一轮笔记**，必须现场重算，不能信笔记。
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

// ---- 找 mesh 节点，拿它的局部变换（TRS）----
let meshNode = -1, meshNodeName = '';
for (let i = 0; i < gltf.nodes.length; i++) {
  const n = gltf.nodes[i];
  if (n.mesh !== undefined && n.skin !== undefined) { meshNode = i; meshNodeName = n.name || ''; }
}
P('=== mesh 节点 ===');
P('node index', meshNode, 'name', meshNodeName);
const mn = gltf.nodes[meshNode];
P('translation', JSON.stringify(mn.translation || null));
P('rotation   ', JSON.stringify(mn.rotation || null));
P('scale      ', JSON.stringify(mn.scale || null));
P('mesh', mn.mesh, 'skin', mn.skin);

// 手算四元数 → 3x3 矩阵（无 scale 时）：把局部轴向量变换到父空间
function quatToMat(q) {
  const [x, y, z, w] = q;
  return [
    [1-2*(y*y+z*z), 2*(x*y - z*w),   2*(x*z + y*w)],
    [2*(x*y + z*w), 1-2*(x*x+z*z),   2*(y*z - x*w)],
    [2*(x*z - y*w), 2*(y*z + x*w),   1-2*(x*x+y*y)],
  ];
}
const q = mn.rotation || [0, 0, 0, 1];
const M = quatToMat(q);
const apply = (v) => [0, 1, 2].map((r) => M[r][0]*v[0] + M[r][1]*v[1] + M[r][2]*v[2]);
const fmt = (v) => '[' + v.map((x) => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(4)).join(', ') + ']';
P('\n=== 局部轴 → 父空间（按 mesh 节点 rotation）===');
for (const [nm, v] of [['+x', [1,0,0]], ['-x', [-1,0,0]], ['+y', [0,1,0]], ['-y', [0,-1,0]], ['+z', [0,0,1]], ['-z', [0,0,-1]]]) {
  P('  局部 ' + nm.padEnd(3) + ' → ' + fmt(apply(v)));
}

// ---- 但脸到底在哪？不猜 —— 用"头部顶点在父空间的分布"找哪一面是脸。
// 脸的判据：头顶不是脸；脸在"有五官浮雕"的那一侧。五官 = 那 100 个眼睛浮雕三角形。
// 算出眼睛浮雕的质心（父空间），它就是脸的方向。
const eyeVerts = new Set();
for (let t = 0; t < T; t++) {
  const a = IDX.read(t*3,0), b = IDX.read(t*3+1,0), c = IDX.read(t*3+2,0);
  const ok = (i) => { const u = Z(i), ax = Math.abs(X(i)), y = Y(i); return u >= 0.0208 && u <= 0.0223 && ax >= 0.0017 && ax <= 0.0060 && y > -0.005707+1e-6 && y <= -0.0040; };
  if (ok(a) && ok(b) && ok(c)) { eyeVerts.add(a); eyeVerts.add(b); eyeVerts.add(c); }
}
let ex = 0, ey = 0, ez = 0;
for (const i of eyeVerts) { ex += X(i); ey += Y(i); ez += Z(i); }
ex /= eyeVerts.size; ey /= eyeVerts.size; ez /= eyeVerts.size;
P('\n=== 眼睛浮雕质心（局部）===');
P('  (' + ex.toFixed(6) + ', ' + ey.toFixed(6) + ', ' + ez.toFixed(6) + ')   顶点数 ' + eyeVerts.size);
P('  → 脸的局部前向 ≈ ' + fmt([ex, ey, ez]));

// 头部整体质心
let hx=0,hy=0,hz=0,hn=0;
for (let i=0;i<N;i++) if (isHeadDom(i)) { hx+=X(i); hy+=Y(i); hz+=Z(i); hn++; }
hx/=hn; hy/=hn; hz/=hn;
P('头质心 (' + hx.toFixed(6) + ', ' + hy.toFixed(6) + ', ' + hz.toFixed(6) + ')');
// 脸方向 = 从"头中轴"指向眼睛质心
const faceVec = [ex - 0, ey - 0, 0];   // x/z 中轴近似 0
P('脸方向（眼睛质心 - 头横截面中心）: ' + fmt([ex, ey, 0]));

// ---- 关键复算：局部 -y 变换到父空间是哪个方向 ----
P('\n=== 结论 ===');
P('局部 -y → 父空间 ' + fmt(apply([0,-1,0])));
P('局部 +y → 父空间 ' + fmt(apply([0, 1,0])));
P('眼睛浮雕质心的 y 分量 ' + ey.toFixed(6) + ' → 脸在局部 ' + (ey < 0 ? '-y' : '+y') + ' 方向');
P('眼睛浮雕变换到父空间 = ' + fmt(apply([ex,ey,ez])));

fs.writeFileSync(path.join(DIR, '_probe10.txt'), out.join('\n'), 'utf8');
console.log('OK');
