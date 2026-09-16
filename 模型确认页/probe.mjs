// probe.mjs —— 脸部平面度探针（纯 CPU，不依赖 WebGL / 不依赖浏览器）
//
// 目的：用**射线**真正"摸"一遍正脸，量化它平不平 —— 而不是靠看图感觉。
//
// 做法：
//   ① 解析 GLB，取 Character 网格的 POSITION / NORMAL / TEXCOORD_0 / JOINTS / WEIGHTS
//      + skin 的 inverseBindMatrices + 节点树
//   ② 按 idle 动画第 0.4s 采样骨骼矩阵，做 CPU 蒙皮，把顶点变换到**世界姿态**
//   ③ 在「正脸前方」铺一张网格（例如 24×24 条射线），沿 -Z 方向打向头部
//   ④ 记录每条射线命中的三角形 + 命中深度
//   ⑤ 统计命中深度分布 → 直接给出「脸面起伏 / 脸宽」这个比值
//
// 判据：起伏比 < 2% 才算"平"；当前实测 ~29%（明显的弧面）。
//
// 用法：node probe.mjs  → 生成 probe.txt

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = 'C:/Users/22641/Desktop/架构重置/全新的游戏';
const GLB = path.join(GAME, 'public/models/visitors/visitor_cubeguy.glb');

const buf = fs.readFileSync(GLB);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not GLB');
let off = 12, js = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const s = off + 8;
  if (type === 0x4e4f534a) js = JSON.parse(buf.toString('utf8', s, s + len));
  else if (type === 0x004e4942) bin = buf.subarray(s, s + len);
  off = s + len;
}

// ---------- accessor 读取（支持 byteStride / 各类 componentType） ----------
// ★ 用 DataView：Buffer 只有 readInt8/readUInt8/readInt16LE/… 没有 readFloat32LE
const CT = { 5120: ['getInt8', 1], 5121: ['getUint8', 1], 5122: ['getInt16', 2], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4] };
const LE = { 5120: false, 5121: false, 5122: true, 5123: true, 5125: true, 5126: true };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const DV = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
function readAccessor(ai) {
  const a = js.accessors[ai];
  const bv = js.bufferViews[a.bufferView];
  const comps = NC[a.type];
  const [getter, csize] = CT[a.componentType];
  const little = LE[a.componentType];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || comps * csize;
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const row = [];
    for (let c = 0; c < comps; c++) row.push(DV[getter](base + i * stride + c * csize, little));
    out.push(comps === 1 ? row[0] : row);
  }
  return out;
}

// ---------- 最小 mat4（列主序，与 glTF 一致） ----------
const m4 = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b) {                       // a * b（先 b 后 a）
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k];
    o[c*4+r] = s;
  }
  return o;
}
function fromTRS(t, r, s) {                // 四元数 → 旋转矩阵
  const [x,y,z,w] = r;
  const x2=x+x, y2=y+y, z2=z+z;
  const xx=x*x2, xy=x*y2, xz=x*z2, yy=y*y2, yz=y*z2, zz=z*z2;
  const wx=w*x2, wy=w*y2, wz=w*z2;
  return [
    (1-(yy+zz))*s[0], (xy+wz)*s[0],    (xz-wy)*s[0],    0,
    (xy-wz)*s[1],     (1-(xx+zz))*s[1],(yz+wx)*s[1],    0,
    (xz+wy)*s[2],     (yz-wx)*s[2],    (1-(xx+yy))*s[2],0,
    t[0], t[1], t[2], 1,
  ];
}
const xformP = (m, p) => [
  m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],
  m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],
  m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14],
];
const xformD = (m, p) => [   // 方向（不带平移）
  m[0]*p[0]+m[4]*p[1]+m[8]*p[2],
  m[1]*p[0]+m[5]*p[1]+m[9]*p[2],
  m[2]*p[0]+m[6]*p[1]+m[10]*p[2],
];

// ---------- 网格数据 ----------
const meshNodeIdx = js.nodes.findIndex((n) => n.mesh !== undefined);
const prim = js.meshes[js.nodes[meshNodeIdx].mesh].primitives[0];
const POS = readAccessor(prim.attributes.POSITION);
const NRM = readAccessor(prim.attributes.NORMAL);
const UV  = readAccessor(prim.attributes.TEXCOORD_0);
const JNT = readAccessor(prim.attributes.JOINTS_0);
const WGT = readAccessor(prim.attributes.WEIGHTS_0);
const IDX = readAccessor(prim.indices);

const skin = js.skins[0];
const joints = skin.joints;
const IBM = readAccessor(skin.inverseBindMatrices);

// ---------- 节点世界矩阵（静态 bind pose） ----------
const parentOf = new Array(js.nodes.length).fill(-1);
js.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parentOf[c] = i)));
function localOf(n) {
  if (n.matrix) return n.matrix.slice();
  return fromTRS(n.translation || [0,0,0], n.rotation || [0,0,0,1], n.scale || [1,1,1]);
}
const worldCache = new Array(js.nodes.length).fill(null);
function worldOf(i) {
  if (worldCache[i]) return worldCache[i];
  const l = localOf(js.nodes[i]);
  const p = parentOf[i];
  const w = p < 0 ? l : mul(worldOf(p), l);
  worldCache[i] = w;
  return w;
}

const nodeOfJoint = joints.map((jn) => {
  // glTF skin.joints 存的就是节点索引
  return jn;
});

// ---------- CPU 蒙皮（bind pose；idle 第 0 帧与 bind 差异极小，用于量平面度足够） ----------
const skinMat = joints.map((jn, j) => mul(worldOf(jn), IBM[j]));
const meshWorld = worldOf(meshNodeIdx);

function skinnedPos(i) {
  const p = POS[i];
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 4; k++) {
    const w = WGT[i][k];
    if (w === 0) continue;
    const m = skinMat[JNT[i][k]];
    x += w * (m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12]);
    y += w * (m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13]);
    z += w * (m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]);
  }
  const q = xformP(meshWorld, [x, y, z]);
  return q;
}

// ---------- 三角形 ----------
const triCount = IDX.length / 3;
const V = POS.map((_, i) => skinnedPos(i));

// ★ 顶点级分类：头部主导 / 正脸（法线前向，与生产同判定）
//   局部前向 = -y（相对 mesh 节点），换算到"世界朝向"要看 meshWorld 的旋转。
//   这里不猜符号：把 mesh 节点的局部 -y 方向变换到世界，得到 faceDirW。
const headJointIdx = joints.findIndex((jn) => js.nodes[jn].name === 'Head');
const isHeadDom = new Array(POS.length).fill(false);
for (let i = 0; i < POS.length; i++) {
  let bw = 0, bj = -1;
  for (let k = 0; k < 4; k++) { const w = WGT[i][k]; if (w > bw) { bw = w; bj = JNT[i][k]; } }
  isHeadDom[i] = (bj === headJointIdx && bw > 0.5);
}
const headVerts = [];
for (let i = 0; i < POS.length; i++) if (isHeadDom[i]) headVerts.push(i);

const hx = headVerts.map(i => V[i][0]), hy = headVerts.map(i => V[i][1]), hz = headVerts.map(i => V[i][2]);
const hbox = {
  x: [Math.min(...hx), Math.max(...hx)],
  y: [Math.min(...hy), Math.max(...hy)],
  z: [Math.min(...hz), Math.max(...hz)],
};

// ★★ 局面前向轴 -y → 世界方向（带符号，不猜）
const faceDirW = xformD(meshWorld, [0, -1, 0]);
const flen = Math.hypot(...faceDirW);
const FD = faceDirW.map(v => v / flen);
const FACE_Z_SIGN = Math.sign(FD[2]) || 1;
// 眼睛/相机在 faceDirW 指向的那一侧；用最靠前的顶点定位平面
const zOf = (i) => V[i][2] * FACE_Z_SIGN;
const zsAll = headVerts.map(zOf);
const zFront = Math.max(...zsAll);      // 脸最前处（朝相机）
const zBack  = Math.min(...zsAll);

// ★ 正脸顶点 = 头部主导 + 法线朝前（法线方向 · 世界前向 > 阈值）
const NV = NRM;   // 局部法线；用 meshWorld 旋转到世界
const facingMin = 0.95;
const faceVerts = [];
for (const i of headVerts) {
  const nW = xformD(meshWorld, NV[i]);
  const dot = (nW[0]*FD[0] + nW[1]*FD[1] + nW[2]*FD[2]) /
              (Math.hypot(...nW) || 1);
  if (dot >= facingMin) faceVerts.push(i);
}
const fvx = faceVerts.map(i => V[i][0]), fvy = faceVerts.map(i => V[i][1]);
const faceBox = {
  x: [Math.min(...fvx), Math.max(...fvx)],
  y: [Math.min(...fvy), Math.max(...fvy)],
};

// ---------- 射线求交（Möller–Trumbore） ----------
function rayTri(o, d, a, b, c) {
  const e1 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const e2 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const pv = [d[1]*e2[2]-d[2]*e2[1], d[2]*e2[0]-d[0]*e2[2], d[0]*e2[1]-d[1]*e2[0]];
  const det = e1[0]*pv[0] + e1[1]*pv[1] + e1[2]*pv[2];
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tv = [o[0]-a[0], o[1]-a[1], o[2]-a[2]];
  const u = (tv[0]*pv[0] + tv[1]*pv[1] + tv[2]*pv[2]) * inv;
  if (u < 0 || u > 1) return null;
  const qv = [tv[1]*e1[2]-tv[2]*e1[1], tv[2]*e1[0]-tv[0]*e1[2], tv[0]*e1[1]-tv[1]*e1[0]];
  const v = (d[0]*qv[0] + d[1]*qv[1] + d[2]*qv[2]) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2[0]*qv[0] + e2[1]*qv[1] + e2[2]*qv[2]) * inv;
  return t > 1e-9 ? t : null;
}

// ★ 预筛"正脸三角形"：三个顶点都属正脸集合的三角形
const faceSet = new Set(faceVerts);
const faceTris = [];
for (let f = 0; f < triCount; f++) {
  const a = IDX[f*3], b = IDX[f*3+1], c = IDX[f*3+2];
  if (faceSet.has(a) && faceSet.has(b) && faceSet.has(c)) faceTris.push(f);
}

const NX = 32, NY = 32;   // 32×32 = 1024 条射线
function shoot(nx, ny, restrictToFace) {
  // ★ 射线范围严格限制在**正脸包围盒**内（不再扫头部整体 → 不会打到后脑/身体）
  const x0 = faceBox.x[0], x1 = faceBox.x[1];
  const y0 = faceBox.y[0], y1 = faceBox.y[1];
  const ox = x0 + (x1-x0) * (nx + 0.5) / NX;
  const oy = y0 + (y1-y0) * (ny + 0.5) / NY;
  const o = [ox, oy, (zFront + 5) * FACE_Z_SIGN];
  const d = [0, 0, -FACE_Z_SIGN];
  let bt = Infinity, bestTri = -1;
  const list = restrictToFace ? faceTris : null;
  if (list) {
    for (const f of list) {
      const a = V[IDX[f*3]], b = V[IDX[f*3+1]], c = V[IDX[f*3+2]];
      const t = rayTri(o, d, a, b, c);
      if (t !== null && t < bt) { bt = t; bestTri = f; }
    }
  } else {
    for (let f = 0; f < triCount; f++) {
      const a = V[IDX[f*3]], b = V[IDX[f*3+1]], c = V[IDX[f*3+2]];
      const t = rayTri(o, d, a, b, c);
      if (t !== null && t < bt) { bt = t; bestTri = f; }
    }
  }
  if (bestTri < 0) return null;
  return { z: (o[2] - bt) * FACE_Z_SIGN, tri: bestTri };   // z 统一成"越大越靠前"
}

const hits = [];
const grid = [];
for (let j = 0; j < NY; j++) {
  const rowH = [];
  for (let i = 0; i < NX; i++) {
    const h = shoot(i, j, true);   // ★ 只在"正脸三角形"里求交
    rowH.push(h);
    if (h) hits.push({ i, j, z: h.z });
  }
  grid.push(rowH);
}

// ---------- 统计 ----------
const L = [];
L.push('=== 脸部平面度探针（射线法·CPU 蒙皮） ===');
L.push('');
L.push('mesh 节点局部 -y → 世界前向 = [' + FD.map(v=>v.toFixed(4)).join(', ') + ']');
L.push('射线：' + NX + ' x ' + NY + ' = ' + (NX*NY) + ' 条，沿世界前向反向打进');
L.push('      范围 = **正脸顶点包围盒**（不含头部其他面）');
L.push('正脸三角形数：' + faceTris.length + ' / ' + triCount);
L.push('命中：' + hits.length + ' 条  (' + (100*hits.length/(NX*NY)).toFixed(1) + '%)');
L.push('');
L.push('头部包围盒（世界）：');
L.push('  X ' + hbox.x[0].toFixed(5) + ' .. ' + hbox.x[1].toFixed(5) + '  宽 ' + (hbox.x[1]-hbox.x[0]).toFixed(5));
L.push('  Y ' + hbox.y[0].toFixed(5) + ' .. ' + hbox.y[1].toFixed(5) + '  高 ' + (hbox.y[1]-hbox.y[0]).toFixed(5));
L.push('  Z ' + hbox.z[0].toFixed(5) + ' .. ' + hbox.z[1].toFixed(5) + '  深 ' + (hbox.z[1]-hbox.z[0]).toFixed(5));
L.push('');
L.push('正脸顶点包围盒：');
L.push('  X ' + faceBox.x[0].toFixed(5) + ' .. ' + faceBox.x[1].toFixed(5) + '  宽 ' + (faceBox.x[1]-faceBox.x[0]).toFixed(5));
L.push('  Y ' + faceBox.y[0].toFixed(5) + ' .. ' + faceBox.y[1].toFixed(5) + '  高 ' + (faceBox.y[1]-faceBox.y[0]).toFixed(5));
L.push('  正脸顶点数 ' + faceVerts.length + ' / 头部 ' + headVerts.length + ' / 总 ' + POS.length);
L.push('');

if (hits.length) {
  const zs = hits.map(h => h.z).sort((a,b) => a-b);
  const zMin = zs[0], zMax = zs[zs.length-1];
  const zMean = zs.reduce((a,b)=>a+b,0) / zs.length;
  const zMed = zs[Math.floor(zs.length/2)];
  const span = zMax - zMin;
  const faceW = faceBox.x[1] - faceBox.x[0];
  L.push('命中深度 z（越大越靠前）：');
  L.push('  min  ' + zMin.toFixed(6));
  L.push('  中位 ' + zMed.toFixed(6));
  L.push('  均值 ' + zMean.toFixed(6));
  L.push('  max  ' + zMax.toFixed(6));
  L.push('  跨度 ' + span.toFixed(6));
  L.push('');
  L.push('★ 平面度判据：');
  L.push('  脸宽(X)          = ' + faceW.toFixed(6));
  L.push('  深度跨度          = ' + span.toFixed(6));
  L.push('  起伏/脸宽         = ' + (100*span/faceW).toFixed(2) + '%');
  L.push('  标准差            = ' + Math.sqrt(zs.reduce((a,b)=>a+(b-zMean)**2,0)/zs.length).toFixed(6));
  L.push('  → ' + (span/faceW < 0.02 ? '✔ 平（<2%）' : span/faceW < 0.06 ? '△ 略弧' : '✘ 明显弧面'));
  L.push('');
  // 深度直方图
  const BINS = 14;
  const hist = new Array(BINS).fill(0);
  for (const z of zs) hist[Math.min(BINS-1, Math.floor((z-zMin)/(span||1e-9)*BINS))]++;
  L.push('深度分布直方图（左=远 右=近）：');
  const mx = Math.max(...hist);
  for (let b = 0; b < BINS; b++) {
    const zv = zMin + span*(b+0.5)/BINS;
    L.push('  ' + zv.toFixed(5) + '  ' + '#'.repeat(Math.round(40*hist[b]/mx)) + ' ' + hist[b]);
  }
  L.push('');
  // 逐列（u = X）深度剖面
  L.push('逐列深度剖面（列 i 的命中 z 中位数）：');
  const cols = [];
  for (let i = 0; i < NX; i++) {
    const col = hits.filter(h => h.i === i).map(h => h.z).sort((a,b)=>a-b);
    cols.push(col.length ? col[Math.floor(col.length/2)] : null);
  }
  const cs = cols.filter(v => v !== null);
  const cMin = Math.min(...cs), cMax = Math.max(...cs);
  for (let i = 0; i < NX; i++) {
    if (cols[i] === null) { L.push('  c' + String(i).padStart(2) + '  --'); continue; }
    const rel = (cols[i]-cMin)/Math.max(1e-9, cMax-cMin);
    L.push('  c' + String(i).padStart(2) + '  ' + cols[i].toFixed(5) + '  ' + '#'.repeat(Math.round(30*rel)));
  }
  L.push('');
  L.push('  ^ 两端浅、中间深 → **弧面**；各列等高 → **平面**');
  L.push('');
  // ★ 关键结论：只看"中心区"（面片主体）的平面度，排除四周圆角
  const cxs = faceBox.x[0], cxe = faceBox.x[1];
  const core = hits.filter(h => {
    const ox = cxs + (cxe-cxs) * (h.i + 0.5) / NX;
    const pad = (cxe-cxs) * 0.15;
    return ox > cxs + pad && ox < cxe - pad;
  });
  if (core.length) {
    const czs = core.map(h => h.z).sort((a,b)=>a-b);
    const cspan = czs[czs.length-1] - czs[0];
    L.push('★ 只看中心区（去掉左右各 15% 边缘圆角）：');
    L.push('  命中 ' + core.length + ' 条');
    L.push('  深度跨度 ' + cspan.toFixed(6) + '   起伏/脸宽 ' + (100*cspan/faceW).toFixed(2) + '%');
    L.push('  中位 ' + czs[Math.floor(czs.length/2)].toFixed(6) + '  min ' + czs[0].toFixed(6) + '  max ' + czs[czs.length-1].toFixed(6));
    L.push('  → ' + (cspan/faceW < 0.02 ? '✔ 平（<2%）' : cspan/faceW < 0.06 ? '△ 略弧' : '✘ 明显弧面'));
  }
}

fs.writeFileSync(path.join(HERE, 'probe.txt'), L.join('\n'), 'utf8');
console.log(L.join('\n'));
