// probe6.mjs —— 定位"眼睛"与"头发"两处几何（用于删除/削平）
//
// 已知：头是很多层共面小方板叠起来的。
//   眼睛候选：y=-0.005522 层，x ±0.0021..±0.0055，z 0.02111..0.02201（在脸面下方）
//   头发候选：z 更大的那批（z > 0.02604，即脸面上边缘之上）
//   顶面候选：法线 ny 接近 0 / 朝 +z 的面（头顶）
//
// 目标：把"非脸面"的头部三角形按区域分类，给出每类的
//       —— 三角形数 / 顶点数 / bbox / 法线朝向 / 在贴图上的 UV 取值
//       以便决定删哪些、以及删掉后脸上会不会留洞
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = 'C:/Users/22641/Desktop/架构重置/全新的游戏';
const GLB = path.join(GAME, 'public/models/visitors/visitor_cubeguy.glb');

const buf = fs.readFileSync(GLB);
let off = 12, js = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), s = off + 8;
  if (type === 0x4e4f534a) js = JSON.parse(buf.toString('utf8', s, s + len));
  else if (type === 0x004e4942) bin = buf.subarray(s, s + len);
  off = s + len;
}
const CT = { 5120:['getInt8',1],5121:['getUint8',1],5122:['getInt16',2],5123:['getUint16',2],5125:['getUint32',4],5126:['getFloat32',4] };
const LE = { 5120:false,5121:false,5122:true,5123:true,5125:true,5126:true };
const NC = { SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16 };
const DV = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
function readA(ai) {
  const a = js.accessors[ai], bv = js.bufferViews[a.bufferView];
  const c = NC[a.type], [g,cs] = CT[a.componentType], le = LE[a.componentType];
  const base = (bv.byteOffset||0)+(a.byteOffset||0), st = bv.byteStride || c*cs;
  const o = [];
  for (let i=0;i<a.count;i++){const r=[];for(let k=0;k<c;k++)r.push(DV[g](base+i*st+k*cs,le));o.push(c===1?r[0]:r);}
  return o;
}
const mn = js.nodes.findIndex(n => n.mesh !== undefined);
const pr = js.meshes[js.nodes[mn].mesh].primitives[0];
const POS = readA(pr.attributes.POSITION);
const NRM = readA(pr.attributes.NORMAL);
const UV  = readA(pr.attributes.TEXCOORD_0);
const JNT = readA(pr.attributes.JOINTS_0);
const WGT = readA(pr.attributes.WEIGHTS_0);
const IDX = readA(pr.indices);
const joints = js.skins[0].joints;
const headJ = joints.findIndex(j => js.nodes[j].name === 'Head');
const neckJ = joints.findIndex(j => js.nodes[j].name === 'Neck');

const L = [];
const isHead = [], isHeadOrNeck = [];
for (let i=0;i<POS.length;i++){
  let bw=0,bj=-1; for(let k=0;k<4;k++){const w=WGT[i][k]; if(w>bw){bw=w;bj=JNT[i][k];}}
  isHead[i] = (bj===headJ && bw>0.5);
  isHeadOrNeck[i] = (bj===headJ || bj===neckJ) && bw>0.5;
}

// 脸面层基准
const FACE_Y = -0.005707;
const isFaceTri = (t) => t.every(v => isHead[v] && Math.abs(POS[v][1]-FACE_Y) < 1e-6);
const faceTriSet = new Set();
for (let f=0; f<IDX.length/3; f++) {
  const t = [IDX[f*3],IDX[f*3+1],IDX[f*3+2]];
  if (isFaceTri(t)) faceTriSet.add(f);
}
// 脸面顶点
const faceVerts = new Set();
for (const f of faceTriSet) for (let k=0;k<3;k++) faceVerts.add(IDX[f*3+k]);

L.push('=== 基准：脸面层 y=' + FACE_Y + ' ===');
L.push('三角形 ' + faceTriSet.size + '，顶点 ' + faceVerts.size);
const fxs=[...faceVerts].map(i=>POS[i][0]), fzs=[...faceVerts].map(i=>POS[i][2]);
const FB = { x:[Math.min(...fxs),Math.max(...fxs)], z:[Math.min(...fzs),Math.max(...fzs)] };
L.push('x ' + FB.x[0].toFixed(6) + '..' + FB.x[1].toFixed(6) + '   z ' + FB.z[0].toFixed(6) + '..' + FB.z[1].toFixed(6));
L.push('');

// ---- 把头部所有"非脸面"的三角形分类 ----
const others = [];
for (let f=0; f<IDX.length/3; f++) {
  const t = [IDX[f*3],IDX[f*3+1],IDX[f*3+2]];
  if (!t.some(v => isHead[v])) continue;
  if (faceTriSet.has(f)) continue;
  others.push(f);
}
L.push('头部相关但非脸面的三角形：' + others.length);
L.push('');

// 分类判据
const cat = (f) => {
  const t = [IDX[f*3],IDX[f*3+1],IDX[f*3+2]];
  const ys = t.map(v=>POS[v][1]), zs = t.map(v=>POS[v][2]), xs = t.map(v=>POS[v][0]);
  const ymax = Math.max(...ys), zmax = Math.max(...zs), zmin = Math.min(...zs);
  const nys = t.map(v=>NRM[v][1]);
  const nyMin = Math.min(...nys);          // 最朝前的那个
  const allFaceV = t.every(v => faceVerts.has(v));
  // 眼睛：在脸面 z 范围内，但 y 明显比脸面靠后（-0.0054 ~ -0.00555），且 x 在脸内
  if (ymax > FACE_Y + 1e-6 && ymax < -0.00535 && zmin >= 0.0209 && zmax <= 0.0221) return '眼睛层(y≈-0.00552)';
  if (ymax > -0.00545 && ymax < -0.00530 && zmin >= 0.0185 && zmax <= 0.0206) return '嘴/下巴层(y≈-0.00540)';
  if (ymax > -0.00540 && ymax < -0.00535) return '细层(y≈-0.005386)';
  if (zmin >= FB.z[1] - 1e-6) return '★脸面上方(头发候选 z>=0.02604)';
  if (ymax > -0.0040 && zmax <= 0.0220) return '耳朵层(y≈-0.0019, z低)';
  if (nyMin < -0.6) return '前向斜面(ny<-0.6)';
  if (nyMin < -0.2) return '侧/顶斜面(-0.6<=ny<-0.2)';
  return '背向/底部(ny>=-0.2)';
};
const cats = new Map();
for (const f of others) {
  const k = cat(f);
  if (!cats.has(k)) cats.set(k, []);
  cats.get(k).push(f);
}
L.push('=== 非脸面三角形的分类 ===');
for (const [k, fs] of [...cats.entries()].sort((a,b)=>b[1].length-a[1].length)) {
  const vs = new Set();
  for (const f of fs) for (let i=0;i<3;i++) vs.add(IDX[f*3+i]);
  const xs=[...vs].map(i=>POS[i][0]), ys=[...vs].map(i=>POS[i][1]), zs=[...vs].map(i=>POS[i][2]);
  L.push('');
  L.push(k + '  三角形 ' + fs.length + '  顶点 ' + vs.size);
  L.push('   x ' + Math.min(...xs).toFixed(6) + '..' + Math.max(...xs).toFixed(6)
    + '   y ' + Math.min(...ys).toFixed(6) + '..' + Math.max(...ys).toFixed(6)
    + '   z ' + Math.min(...zs).toFixed(6) + '..' + Math.max(...zs).toFixed(6));
}

// ---- 头顶（z 高于脸面上沿的所有头部三角形）明细 ----
L.push('');
L.push('=== 头顶区域（z 最小值 > 脸面上沿 ' + FB.z[1].toFixed(5) + '）的三角形 ===');
const top = [];
for (let f=0; f<IDX.length/3; f++) {
  const t = [IDX[f*3],IDX[f*3+1],IDX[f*3+2]];
  if (!t.some(v=>isHead[v])) continue;
  const zmin = Math.min(...t.map(v=>POS[v][2]));
  if (zmin > FB.z[1] - 1e-9) top.push(t);
}
L.push('共 ' + top.length + ' 个三角形');
for (const t of top.slice(0, 40)) {
  L.push('  ' + t.map(v => 'v'+String(v).padStart(4)+'('+POS[v].map(x=>x.toFixed(5)).join(',')+') n=('+NRM[v].map(x=>x.toFixed(2)).join(',')+')').join(' | '));
}
if (top.length > 40) L.push('  ...（还有 ' + (top.length-40) + ' 个）');
L.push('');

// ---- 眼睛层的全部三角形明细 ----
L.push('=== 眼睛层（x 有正负、z 在 0.0185..0.0221 之间、且法线朝前）明细 ===');
const eyeCand = [];
for (let f=0; f<IDX.length/3; f++) {
  const t = [IDX[f*3],IDX[f*3+1],IDX[f*3+2]];
  if (!t.some(v=>isHead[v])) continue;
  const zs = t.map(v=>POS[v][2]);
  if (Math.min(...zs) >= 0.0209 && Math.max(...zs) <= 0.0221) eyeCand.push([f,t]);
}
L.push('共 ' + eyeCand.length + ' 个');
const byY = new Map();
for (const [f,t] of eyeCand) {
  const y = POS[t[0]][1].toFixed(6);
  (byY.get(y) || byY.set(y, []).get(y)).push([f,t]);
}
for (const [y, arr] of [...byY.entries()].sort((a,b)=>Number(a[0])-Number(b[0]))) {
  L.push(' y=' + y + '  ' + arr.length + ' 个三角形');
  for (const [f,t] of arr) {
    L.push('   tri'+String(f).padStart(4)+'  ' + t.map(v=>'v'+String(v).padStart(4)+'('+POS[v][0].toFixed(5)+','+POS[v][2].toFixed(5)+')').join(' | '));
  }
}

fs.writeFileSync(path.join(HERE,'_probe6.txt'), L.join('\n'), 'utf8');
console.log(L.join('\n').slice(0, 11000));
