// probe8.mjs —— 修正两处判据
// ① 眼睛：y 在 [FACE_Y, -0.0042]（**在脸面层之后**，不是之前！）
// ② 头发：加了 x 约束，排除耳朵
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const GLB = path.join(DIR, 'candidate_cubeguy.glb');
const out = [];
const P = (...a) => { out.push(a.join(' ')); };

const buf = fs.readFileSync(GLB);
const DV = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let off = 12, gltf = null, BIN = null;
while (off < buf.length) {
  const len = DV.getUint32(off, true);
  const type = DV.getUint32(off + 4, true);
  const start = off + 8;
  if (type === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(buf.subarray(start, start + len)));
  else if (type === 0x004e4942) BIN = buf.subarray(start, start + len);
  off = start + len;
}
const gt = (ct) => ct === 5126 ? 'getFloat32' : ct === 5125 ? 'getUint32' : ct === 5123 ? 'getUint16' : ct === 5121 ? 'getUint8' : ct === 5122 ? 'getInt16' : 'getInt8';
const so = (ct) => ct === 5126 || ct === 5125 ? 4 : ct === 5123 || ct === 5122 ? 2 : 1;
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function acc(i) {
  const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const n = NC[a.type], stride = bv.byteStride || (n * so(a.componentType));
  const g = gt(a.componentType), sz = so(a.componentType);
  return { count: a.count, read: (idx, c) => DV[g](BIN.byteOffset + base + idx * stride + c * sz, true) };
}
const prim = gltf.meshes[0].primitives[0];
const POS = acc(prim.attributes.POSITION), JNT = acc(prim.attributes.JOINTS_0), WGT = acc(prim.attributes.WEIGHTS_0), IDX = acc(prim.indices);
const N = POS.count, T = IDX.count / 3;
const X = (i) => POS.read(i, 0), Y = (i) => POS.read(i, 1), Z = (i) => POS.read(i, 2);
const skin = gltf.skins[0];
const headJoint = skin.joints.findIndex((j) => gltf.nodes[j].name === 'Head');
const isHeadDom = (i) => { let bw = 0, bj = -1; for (let k = 0; k < 4; k++) { const w = WGT.read(i, k); if (w > bw) { bw = w; bj = JNT.read(i, k); } } return bj === headJoint && bw > 0.5; };

let yMin = Infinity;
for (let i = 0; i < N; i++) if (isHeadDom(i)) yMin = Math.min(yMin, Y(i));
const FACE_Y = yMin;
let fz1 = -Infinity;
for (let i = 0; i < N; i++) if (isHeadDom(i) && Math.abs(Y(i) - FACE_Y) < 1e-6) fz1 = Math.max(fz1, Z(i));
const FACE_Z_TOP = fz1;
P('FACE_Y =', FACE_Y.toFixed(6), ' FACE_Z_TOP =', FACE_Z_TOP.toFixed(6));

// ============================================================
// 耳朵层的真实 z 范围：以 y≈-0.0019 为锚
// ============================================================
const EAR_Y = -0.001901;
let earZ0 = Infinity, earZ1 = -Infinity, earX = 0, earV = 0;
for (let i = 0; i < N; i++) {
  if (!isHeadDom(i)) continue;
  if (Math.abs(Y(i) - EAR_Y) > 0.0005) continue;
  earV++; earZ0 = Math.min(earZ0, Z(i)); earZ1 = Math.max(earZ1, Z(i)); earX = Math.max(earX, Math.abs(X(i)));
}
P('耳朵层(y≈-0.0019): 顶点' + earV, ' z', earZ0.toFixed(6), '..', earZ1.toFixed(6), ' max|x|', earX.toFixed(6));

// 耳朵层顶点里 z >= FACE_Z_TOP 的有几个？
let earHigh = [];
for (let i = 0; i < N; i++) {
  if (!isHeadDom(i)) continue;
  if (Math.abs(Y(i) - EAR_Y) > 0.0005) continue;
  if (Z(i) >= FACE_Z_TOP - 1e-4) earHigh.push(i);
}
P('耳朵层中 z >= FACE_Z_TOP 的顶点:', earHigh.length);
{
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const i of earHigh) { x0 = Math.min(x0, X(i)); x1 = Math.max(x1, X(i)); z0 = Math.min(z0, Z(i)); z1 = Math.max(z1, Z(i)); }
  if (earHigh.length) P('    x', x0.toFixed(6), '..', x1.toFixed(6), ' z', z0.toFixed(6), '..', z1.toFixed(6));
}

// ============================================================
// 修正判据
// ============================================================
// 头发：三顶点 z >= FACE_Z_TOP，且 |x| 在脸宽范围内（排除耳朵的高处凸起）
const HAIR_AX_MAX = 0.0074;  // 脸面层 max|x| = 0.006489，放宽一点
const isHairTri = (a, b, c) => {
  for (const i of [a, b, c]) {
    if (Z(i) < FACE_Z_TOP - 1e-4) return false;
    if (Math.abs(X(i)) > HAIR_AX_MAX) return false;
  }
  return true;
};
// 眼睛：y 在 (FACE_Y, -0.0042]（脸面层之后），z 0.0208..0.0223，|x| 0.0017..0.006
const isEyeVert = (i) => {
  const z = Z(i), ax = Math.abs(X(i)), y = Y(i);
  if (z < 0.0208 || z > 0.0223) return false;
  if (ax < 0.0017 || ax > 0.0060) return false;
  if (y <= FACE_Y + 1e-6) return false;   // 修正：必须在脸面层之后
  if (y > -0.0040) return false;
  return true;
};
const isEyeTri = (a, b, c) => isEyeVert(a) && isEyeVert(b) && isEyeVert(c);

let hairTris = [], eyeTris = [];
for (let t = 0; t < T; t++) {
  const a = IDX.read(t * 3, 0), b = IDX.read(t * 3 + 1, 0), c = IDX.read(t * 3 + 2, 0);
  if (isHairTri(a, b, c)) hairTris.push(t);
  else if (isEyeTri(a, b, c)) eyeTris.push(t);
}
P('\n=== 修正后判据统计 ===');
P('★ 头发:', hairTris.length, '个三角面');
{
  let z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (const t of hairTris) for (let k = 0; k < 3; k++) {
    const i = IDX.read(t * 3 + k, 0);
    z0 = Math.min(z0, Z(i)); z1 = Math.max(z1, Z(i)); x0 = Math.min(x0, X(i)); x1 = Math.max(x1, X(i));
  }
  P('    z', z0.toFixed(6), '..', z1.toFixed(6), ' x', x0.toFixed(6), '..', x1.toFixed(6));
}
P('★ 眼睛:', eyeTris.length, '个三角面');
{
  const yl = new Set();
  let z0 = Infinity, z1 = -Infinity, xx = 0;
  for (const t of eyeTris) for (let k = 0; k < 3; k++) {
    const i = IDX.read(t * 3 + k, 0);
    z0 = Math.min(z0, Z(i)); z1 = Math.max(z1, Z(i)); xx = Math.max(xx, Math.abs(X(i)));
    yl.add(Y(i).toFixed(6));
  }
  P('    z', z0.toFixed(6), '..', z1.toFixed(6), ' max|x|', xx.toFixed(6));
  P('    y 层:', [...yl].sort((a, b) => parseFloat(a) - parseFloat(b)).join(', '));
}

// 安全性
const faceV = new Set();
for (let i = 0; i < N; i++) if (isHeadDom(i) && Math.abs(Y(i) - FACE_Y) < 1e-6) faceV.add(i);
const inFace = (t) => [0, 1, 2].every((k) => faceV.has(IDX.read(t * 3 + k, 0)));
P('\n=== ★ 安全性验证 ===');
P('头发判据命中脸面层:', hairTris.filter(inFace).length, '(须 0)');
P('眼睛判据命中脸面层:', eyeTris.filter(inFace).length, '(须 0)');
const earSet = new Set();
for (let i = 0; i < N; i++) if (isHeadDom(i) && Math.abs(Y(i) - EAR_Y) < 0.0005) earSet.add(i);
const touchesEar = (t) => [0, 1, 2].some((k) => earSet.has(IDX.read(t * 3 + k, 0)));
P('头发判据涉及耳朵层:', hairTris.filter(touchesEar).length, '(须 0)');
P('眼睛判据涉及耳朵层:', eyeTris.filter(touchesEar).length, '(须 0)');

// 嘴/下巴层会不会被眼睛判据误伤？（y=-0.005397, z 0.01857..0.02047 → z 低于 0.0208，安全）
const mouthSet = new Set();
for (let i = 0; i < N; i++) if (isHeadDom(i) && Math.abs(Y(i) + 0.005397) < 1e-6) mouthSet.add(i);
P('眼睛判据涉及嘴/下巴层:', eyeTris.filter((t) => [0, 1, 2].some((k) => mouthSet.has(IDX.read(t * 3 + k, 0)))).length, '(须 0)');

P('\n删后面数:', T - hairTris.length - eyeTris.length, '/', T);
fs.writeFileSync(path.join(DIR, '_probe8.txt'), out.join('\n'), 'utf8');
console.log('OK');
