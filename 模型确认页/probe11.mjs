// probe11.mjs —— 复现**生产代码** remapFaceUV 的选择逻辑，看它到底选了哪一面
// 疑点：新逻辑改成"取最靠前那一几何层"后，可能选到了**鼻子/后脑**之类的层。
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
const POS = acc(prim.attributes.POSITION), NRM = acc(prim.attributes.NORMAL), JNT = acc(prim.attributes.JOINTS_0), WGT = acc(prim.attributes.WEIGHTS_0);
const N = POS.count;
const X = (i) => POS.read(i, 0), Y = (i) => POS.read(i, 1), Z = (i) => POS.read(i, 2);
const NY = (i) => NRM.read(i, 1);
const headJoint = gltf.skins[0].joints.findIndex((j) => gltf.nodes[j].name === 'Head');
const isHeadDom = (i) => { let bw = 0, bj = -1; for (let k = 0; k < 4; k++) { const w = WGT.read(i, k); if (w > bw) { bw = w; bj = JNT.read(i, k); } } return bj === headJoint && bw > 0.5; };

// ===== 生产 remapFaceUV 新逻辑 =====
const fAxis = 'y', uAxis = 'z', lrAxis = 'x';
const fSign = -1;  // frontAxis '-y'
const getF = Y, getU = Z, getL = X;
const LAYER_EPS = 1e-5;

let fExtreme = Infinity;
for (let i = 0; i < N; i++) { if (!isHeadDom(i)) continue; const f = getF(i) * fSign; if (f < fExtreme) fExtreme = f; }
P('fExtreme = ' + fExtreme.toFixed(8) + '  (= 脸面层 y * -1 = ' + (fExtreme*fSign).toFixed(6) + ')');

const face = [];
for (let i = 0; i < N; i++) { if (!isHeadDom(i)) continue; if (getF(i)*fSign - fExtreme > LAYER_EPS) continue; face.push(i); }
P('新逻辑选中顶点数 = ' + face.length);
{
  let l0=Infinity,l1=-Infinity,u0=Infinity,u1=-Infinity;
  for (const i of face) { l0=Math.min(l0,getL(i)); l1=Math.max(l1,getL(i)); u0=Math.min(u0,getU(i)); u1=Math.max(u1,getU(i)); }
  P('  x ' + l0.toFixed(6) + '..' + l1.toFixed(6) + '  z ' + u0.toFixed(6) + '..' + u1.toFixed(6));
}

// ===== 旧逻辑（法线阈值 faceFacingMin=0.95）=====
const oldFace = [];
for (let i = 0; i < N; i++) { if (!isHeadDom(i)) continue; if (NY(i)*fSign < 0.95) continue; oldFace.push(i); }
P('\n旧逻辑(法线<-0.95)选中顶点数 = ' + oldFace.length);
{
  let l0=Infinity,l1=-Infinity,u0=Infinity,u1=-Infinity;
  for (const i of oldFace) { l0=Math.min(l0,getL(i)); l1=Math.max(l1,getL(i)); u0=Math.min(u0,getU(i)); u1=Math.max(u1,getU(i)); }
  P('  x ' + l0.toFixed(6) + '..' + l1.toFixed(6) + '  z ' + u0.toFixed(6) + '..' + u1.toFixed(6));
}

// ===== 两者差集：新逻辑多选了谁？少选了谁？ =====
const sNew = new Set(face), sOld = new Set(oldFace);
const extra = face.filter((i) => !sOld.has(i));
const missing = oldFace.filter((i) => !sNew.has(i));
P('\n新逻辑比旧逻辑多选 ' + extra.length + ' 个顶点：');
{
  const byY = new Map();
  for (const i of extra) { const k = getF(i).toFixed(6); if (!byY.has(k)) byY.set(k, []); byY.get(k).push(i); }
  for (const [k, vs] of [...byY.entries()].sort((a,b)=>parseFloat(a[0])-parseFloat(b[0])).slice(0,20)) {
    let l0=Infinity,l1=-Infinity,u0=Infinity,u1=-Infinity;
    for (const i of vs) { l0=Math.min(l0,getL(i)); l1=Math.max(l1,getL(i)); u0=Math.min(u0,getU(i)); u1=Math.max(u1,getU(i)); }
    P('  y=' + k + ' n=' + vs.length + '  x ' + l0.toFixed(6) + '..' + l1.toFixed(6) + ' z ' + u0.toFixed(6) + '..' + u1.toFixed(6));
  }
  if (byY.size > 20) P('  ...共 ' + byY.size + ' 个 y 层');
}
P('新逻辑比旧逻辑少选 ' + missing.length + ' 个顶点');
if (missing.length) {
  const byY = new Map();
  for (const i of missing) { const k = getF(i).toFixed(6); if (!byY.has(k)) byY.set(k, []); byY.get(k).push(i); }
  for (const [k, vs] of [...byY.entries()].sort((a,b)=>parseFloat(a[0])-parseFloat(b[0])).slice(0,10))
    P('  y=' + k + ' n=' + vs.length);
}

// ===== 结论：新逻辑选的那一层，法线朝向如何？ =====
P('\n=== 新逻辑选中层的法线统计（看是不是"朝脸"）===');
let cnt = { face: 0, back: 0, side: 0 };
for (const i of face) { const ny = NY(i)*fSign; if (ny > 0.6) cnt.face++; else if (ny < -0.6) cnt.back++; else cnt.side++; }
P('  法线朝前(>0.6): ' + cnt.face + '   朝后(<-0.6): ' + cnt.back + '   侧/斜: ' + cnt.side);

fs.writeFileSync(path.join(DIR, '_probe11.txt'), out.join('\n'), 'utf8');
console.log('OK');
