// probe7.mjs —— 验证「删眼睛 + 削头发」的判据（只用几何层，不碰法线）
// 目标：给出可用于生产代码的、精确的三角形删除判据，并验证删完后脸面层完好无损。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const GLB = path.join(DIR, 'candidate_cubeguy.glb');
const out = [];
const P = (...a) => { out.push(a.join(' ')); };

const buf = fs.readFileSync(GLB);
const DV = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = DV.getUint32(off, true);
  const type = DV.getUint32(off + 4, true);
  const start = off + 8;
  if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buf.subarray(start, start + len)));
  else if (type === 0x004e4942) bin = buf.subarray(start, start + len);
  off = start + len;
}
const gltf = json;
const BIN = bin;

const getter = (ct) => ct === 5126 ? 'getFloat32' : ct === 5125 ? 'getUint32'
  : ct === 5123 ? 'getUint16' : ct === 5121 ? 'getUint8'
  : ct === 5122 ? 'getInt16' : ct === 5120 ? 'getInt8' : 'getFloat32';
const sizeOf = (ct) => ct === 5126 || ct === 5125 ? 4 : ct === 5123 || ct === 5122 ? 2 : 1;
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const n = NC[a.type], stride = bv.byteStride || (n * sizeOf(a.componentType));
  const g = getter(a.componentType), sz = sizeOf(a.componentType);
  return { count: a.count, n, read: (idx, c) => DV[g](BIN.byteOffset + base + idx * stride + c * sz, true) };
}

// 单网格单 primitive
const prim = gltf.meshes[0].primitives[0];
const POS = accessor(prim.attributes.POSITION);
const NRM = accessor(prim.attributes.NORMAL);
const JNT = prim.attributes.JOINTS_0 !== undefined ? accessor(prim.attributes.JOINTS_0) : null;
const WGT = prim.attributes.WEIGHTS_0 !== undefined ? accessor(prim.attributes.WEIGHTS_0) : null;
const IDX = accessor(prim.indices);

const N = POS.count, T = IDX.count / 3;
P('顶点', N, '三角面', T);

// 头关节索引
const skin = gltf.skins[0];
const headJoint = skin.joints.findIndex((j) => gltf.nodes[j].name === 'Head');
P('Head 关节 index =', headJoint);
const isHeadDom = (i) => {
  let bw = 0, bj = -1;
  for (let k = 0; k < 4; k++) {
    const w = WGT.read(i, k);
    if (w > bw) { bw = w; bj = JNT.read(i, k); }
  }
  return bj === headJoint && bw > 0.5;
};
const X = (i) => POS.read(i, 0), Y = (i) => POS.read(i, 1), Z = (i) => POS.read(i, 2);

// 脸面层：y 最小且严格共面的那一层
let yMin = Infinity;
for (let i = 0; i < N; i++) if (isHeadDom(i)) yMin = Math.min(yMin, Y(i));
const FACE_Y = yMin;
P('\n=== 脸面层 y =', FACE_Y.toFixed(6), '===');
let faceV = [];
for (let i = 0; i < N; i++) if (isHeadDom(i) && Math.abs(Y(i) - FACE_Y) < 1e-6) faceV.push(i);
let fx0 = Infinity, fx1 = -Infinity, fz0 = Infinity, fz1 = -Infinity;
for (const i of faceV) { fx0 = Math.min(fx0, X(i)); fx1 = Math.max(fx1, X(i)); fz0 = Math.min(fz0, Z(i)); fz1 = Math.max(fz1, Z(i)); }
P('脸面层顶点', faceV.length, ' x', fx0.toFixed(6), '..', fx1.toFixed(6), ' z', fz0.toFixed(6), '..', fz1.toFixed(6));
const FACE_Z_TOP = fz1, FACE_Z_BOT = fz0;
P('脸面上沿 z =', FACE_Z_TOP.toFixed(6), '  下沿 z =', FACE_Z_BOT.toFixed(6));

// 统计头部顶点 y 层（找眼睛层的候选 z 带）
P('\n=== 头部主导顶点的 y 层（前 12 个最靠前的层）===');
const layers = new Map();
for (let i = 0; i < N; i++) {
  if (!isHeadDom(i)) continue;
  const key = Y(i).toFixed(6);
  if (!layers.has(key)) layers.set(key, []);
  layers.get(key).push(i);
}
const sorted = [...layers.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
for (const [k, vs] of sorted.slice(0, 12)) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const i of vs) { x0 = Math.min(x0, X(i)); x1 = Math.max(x1, X(i)); z0 = Math.min(z0, Z(i)); z1 = Math.max(z1, Z(i)); }
  P(' y=' + k, ' 顶点' + String(vs.length).padStart(3),
    ' x ' + x0.toFixed(6) + '..' + x1.toFixed(6),
    ' z ' + z0.toFixed(6) + '..' + z1.toFixed(6),
    (Math.abs(parseFloat(k) - FACE_Y) < 1e-6 ? '   ← 脸面层' : ''));
}

// ============================================================
// 删除判据（只用几何，不用法线）
// ============================================================
// 判据 A（头发）：三角形三个顶点全部 min(z) >= 脸面上沿
//   → 头顶区域，删掉后脸面上沿以上全空
const isHairTri = (a, b, c) => Z(a) >= FACE_Z_TOP - 1e-4 && Z(b) >= FACE_Z_TOP - 1e-4 && Z(c) >= FACE_Z_TOP - 1e-4;

// 判据 B（眼睛）：在脸面层之下（更靠前）的"贴片"，且落在眼睛所在的 z 带 + |x| 带
//   眼睛实测：z 0.0210..0.0221，|x| 0.0020..0.0057，y ∈ [-0.00553, -0.00423]
//   注意 y > -0.0057 → 在脸面层"之后"（贴片是浮脸前面的浮雕，y 更小=更靠前）
const EYE_Z0 = 0.0208, EYE_Z1 = 0.0223;
const EYE_AX0 = 0.0017, EYE_AX1 = 0.0060;
const isEyeVert = (i) => {
  const z = Z(i), ax = Math.abs(X(i)), y = Y(i);
  if (z < EYE_Z0 || z > EYE_Z1) return false;
  if (ax < EYE_AX0 || ax > EYE_AX1) return false;
  // 必须在脸面层前面（更靠前 = y 更小）—— 排除脸面层自身与更深的结构
  if (y >= FACE_Y - 1e-6) return false;
  if (y < -0.0060) return false;   // 排除更外的杂物
  return true;
};
const isEyeTri = (a, b, c) => isEyeVert(a) && isEyeVert(b) && isEyeVert(c);

// 统计
let hairTris = [], eyeTris = [];
for (let t = 0; t < T; t++) {
  const a = IDX.read(t * 3, 0), b = IDX.read(t * 3 + 1, 0), c = IDX.read(t * 3 + 2, 0);
  if (isHairTri(a, b, c)) hairTris.push(t);
  else if (isEyeTri(a, b, c)) eyeTris.push(t);
}
P('\n=== 判据统计 ===');
P('★ 头发（三角三顶点 z 全 >= ' + FACE_Z_TOP.toFixed(6) + '）:', hairTris.length, '个三角面');

// 头发层 z 分布
{
  let z0 = Infinity, z1 = -Infinity;
  for (const t of hairTris) for (let k = 0; k < 3; k++) { const z = Z(IDX.read(t * 3 + k, 0)); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  P('    z 范围', z0.toFixed(6), '..', z1.toFixed(6));
}
P('★ 眼睛（z ' + EYE_Z0 + '..' + EYE_Z1 + '，|x| ' + EYE_AX0 + '..' + EYE_AX1 + '，y 更靠前）:', eyeTris.length, '个三角面');
{
  let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity, xx = 0;
  const yl = new Set();
  for (const t of eyeTris) for (let k = 0; k < 3; k++) {
    const i = IDX.read(t * 3 + k, 0);
    z0 = Math.min(z0, Z(i)); z1 = Math.max(z1, Z(i));
    y0 = Math.min(y0, Y(i)); y1 = Math.max(y1, Y(i));
    xx = Math.max(xx, Math.abs(X(i))); yl.add(Y(i).toFixed(6));
  }
  P('    z', z0.toFixed(6), '..', z1.toFixed(6), ' y', y0.toFixed(6), '..', y1.toFixed(6), ' max|x|', xx.toFixed(6));
  P('    涉及 y 层:', [...yl].sort((a, b) => parseFloat(a) - parseFloat(b)).join(', '));
}

// ★ 关键验证：删完后，脸面层的三角形是否一个都没被误删？
const faceVTri = new Set();
let faceTriCount = 0;
for (let t = 0; t < T; t++) {
  const a = IDX.read(t * 3, 0), b = IDX.read(t * 3 + 1, 0), c = IDX.read(t * 3 + 2, 0);
  const fy = (i) => Math.abs(Y(i) - FACE_Y) < 1e-6;
  if (fy(a) && fy(b) && fy(c)) { faceTriCount++; faceVTri.add(t); }
}
P('\n=== ★ 安全性验证 ===');
P('脸面层三角形总数:', faceTriCount);
const hairHit = hairTris.filter((t) => faceVTri.has(t)).length;
const eyeHit = eyeTris.filter((t) => faceVTri.has(t)).length;
P('头发判据命中脸面层三角面:', hairHit, '(必须为 0)');
P('眼睛判据命中脸面层三角面:', eyeHit, '(必须为 0)');

// 眼睛判据是否会误伤耳朵？（耳朵 y≈-0.0019、|x| 到 0.0068、z 0.0149..0.0220）
let earHitByEye = 0;
for (const t of eyeTris) {
  for (let k = 0; k < 3; k++) {
    const i = IDX.read(t * 3 + k, 0);
    if (Math.abs(Y(i) + 0.0019) < 0.0005) { earHitByEye++; break; }
  }
}
P('眼睛判据涉及"耳朵层(y≈-0.0019)"的三角面:', earHitByEye, '(必须为 0 = 耳朵不动)');

// 头发判据是否会误伤耳朵/侧脑壳？（耳朵 z 最高 0.021975 < 0.026036）
let earInHair = 0, earVSet = new Set();
for (let i = 0; i < N; i++) if (isHeadDom(i) && Math.abs(Y(i) + 0.0019) < 0.0005) earVSet.add(i);
for (const t of hairTris) for (let k = 0; k < 3; k++) if (earVSet.has(IDX.read(t * 3 + k, 0))) { earInHair++; break; }
P('头发判据涉及"耳朵层"的三角面:', earInHair, '(必须为 0 = 耳朵不动)');

// 删完后剩下的三角面数 + 顶点是否孤立
P('\n删后面数:', T - hairTris.length - eyeTris.length, '/', T,
  ' (删头发', hairTris.length, '+ 眼睛', eyeTris.length, ')');

fs.writeFileSync(path.join(DIR, '_probe7.txt'), out.join('\n'), 'utf8');
console.log('OK -> _probe7.txt');
