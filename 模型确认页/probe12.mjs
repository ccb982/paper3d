// probe12.mjs —— 用**修正后**的逻辑（proj 最大 = 最靠前）复算，确认选中的是脸
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
const NY = (i) => NRM.read(i, 1);
const headJoint = gltf.skins[0].joints.findIndex((j) => gltf.nodes[j].name === 'Head');
const isHeadDom = (i) => { let bw = 0, bj = -1; for (let k = 0; k < 4; k++) { const w = WGT.read(i, k); if (w > bw) { bw = w; bj = JNT.read(i, k); } } return bj === headJoint && bw > 0.5; };

const fSign = -1;
const getF = Y, getU = Z, getL = X;
const LAYER_EPS = 1e-5;

// 修正后：proj 最大 = 最靠前
let projMax = -Infinity;
for (let i = 0; i < N; i++) { if (!isHeadDom(i)) continue; const p = getF(i)*fSign; if (p > projMax) projMax = p; }
P('projMax = ' + projMax.toFixed(8) + '  → 选中层 y = ' + (projMax*fSign).toFixed(6));
const face = [];
for (let i = 0; i < N; i++) { if (!isHeadDom(i)) continue; if (projMax - getF(i)*fSign > LAYER_EPS) continue; face.push(i); }
P('选中顶点数 = ' + face.length);
{
  let l0=Infinity,l1=-Infinity,u0=Infinity,u1=-Infinity, fwd=0,bwd=0;
  for (const i of face) {
    l0=Math.min(l0,getL(i)); l1=Math.max(l1,getL(i)); u0=Math.min(u0,getU(i)); u1=Math.max(u1,getU(i));
    const ny = NY(i)*fSign; if (ny>0.6) fwd++; else if (ny<-0.6) bwd++;
  }
  P('  x ' + l0.toFixed(6) + '..' + l1.toFixed(6) + '  z ' + u0.toFixed(6) + '..' + u1.toFixed(6));
  P('  法线朝前 ' + fwd + ' / 朝后 ' + bwd + '   ' + (fwd>bwd ? '✔ 是脸' : '✘ 还是后脑！'));
}

// 修正后的剪裁统计
const CG_FACE_Z_TOP=0.026036, CG_EYE_Z0=0.0208, CG_EYE_Z1=0.0223, CG_EYE_AX0=0.0017, CG_EYE_AX1=0.0060, CG_EYE_Y_MAX=-0.0040;
let faceTop=-Infinity;
for (const i of face) faceTop=Math.max(faceTop,getU(i));
P('\n脸面上沿 z = ' + faceTop.toFixed(6));

const eyeProjMax = CG_EYE_Y_MAX * fSign;
const isEye = (i) => { const u=getU(i), ax=Math.abs(getL(i)), p=getF(i)*fSign; if(u<CG_EYE_Z0||u>CG_EYE_Z1)return false; if(ax<CG_EYE_AX0||ax>CG_EYE_AX1)return false; if(p>=projMax-LAYER_EPS)return false; if(p<eyeProjMax)return false; return true; };
const isHair = (i) => getU(i) >= faceTop - 1e-4;

let hair=0, eye=0;
for (let t=0;t<T;t++){ const a=IDX.read(t*3,0),b=IDX.read(t*3+1,0),c=IDX.read(t*3+2,0);
  if(isHair(a)&&isHair(b)&&isHair(c)){hair++;continue;} if(isEye(a)&&isEye(b)&&isEye(c)){eye++;continue;} }
P('★ 删头发 ' + hair + ' 面，删眼睛 ' + eye + ' 面，剩 ' + (T-hair-eye) + '/' + T);

// 安全性：脸面层 40 面不能被误删
const faceSet = new Set(face);
const inFace = (t) => [0,1,2].every((k)=>faceSet.has(IDX.read(t*3+k,0)));
let hairOnFace=0, eyeOnFace=0;
for (let t=0;t<T;t++){ const a=IDX.read(t*3,0),b=IDX.read(t*3+1,0),c=IDX.read(t*3+2,0);
  if(inFace(t)){ if(isHair(a)&&isHair(b)&&isHair(c))hairOnFace++; if(isEye(a)&&isEye(b)&&isEye(c))eyeOnFace++; } }
P('头发判据误伤脸面层: ' + hairOnFace + ' (须0)   眼睛判据误伤脸面层: ' + eyeOnFace + ' (须0)');

// 耳朵不动
const earSet=new Set();
for(let i=0;i<N;i++) if(isHeadDom(i)&&Math.abs(Y(i)+0.001901)<0.0005) earSet.add(i);
let eyeEar=0, hairEar=0;
for(let t=0;t<T;t++){ const a=IDX.read(t*3,0),b=IDX.read(t*3+1,0),c=IDX.read(t*3+2,0);
  const touch=(i)=>earSet.has(i);
  if(isEye(a)&&isEye(b)&&isEye(c)&&(touch(a)||touch(b)||touch(c)))eyeEar++;
  if(isHair(a)&&isHair(b)&&isHair(c)&&(touch(a)||touch(b)||touch(c)))hairEar++; }
P('眼睛判据碰耳朵: ' + eyeEar + '   头发判据碰耳朵: ' + hairEar + ' (须0)');

fs.writeFileSync(path.join(DIR, '_probe12.txt'), out.join('\n'), 'utf8');
console.log('OK');
