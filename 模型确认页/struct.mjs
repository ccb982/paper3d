// struct.mjs —— 查清「正脸 67 顶点」到底是怎么连成面的
// 目的：解释探针里"X 跨度 129.7 但只命中 20 条"的矛盾
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
  const comps = NC[a.type], [g,cs] = CT[a.componentType], le = LE[a.componentType];
  const base = (bv.byteOffset||0)+(a.byteOffset||0), stride = bv.byteStride || comps*cs;
  const out = [];
  for (let i=0;i<a.count;i++){const r=[];for(let c=0;c<comps;c++)r.push(DV[g](base+i*stride+c*cs,le));out.push(comps===1?r[0]:r);}
  return out;
}
const meshNode = js.nodes.findIndex(n => n.mesh !== undefined);
const prim = js.meshes[js.nodes[meshNode].mesh].primitives[0];
const POS = readA(prim.attributes.POSITION);
const NRM = readA(prim.attributes.NORMAL);
const UV  = readA(prim.attributes.TEXCOORD_0);
const JNT = readA(prim.attributes.JOINTS_0);
const WGT = readA(prim.attributes.WEIGHTS_0);
const IDX = readA(prim.indices);
const joints = js.skins[0].joints;
const headJ = joints.findIndex(j => js.nodes[j].name === 'Head');

const L = [];
const isHead = [], isFace = [];
for (let i=0;i<POS.length;i++){
  let bw=0,bj=-1; for(let k=0;k<4;k++){const w=WGT[i][k]; if(w>bw){bw=w;bj=JNT[i][k];}}
  isHead[i] = (bj===headJ && bw>0.5);
  isFace[i] = isHead[i] && (NRM[i][1] * -1 >= 0.95);   // 局部 -y 前向
}
const faceV=[], headV=[];
for(let i=0;i<POS.length;i++){ if(isFace[i])faceV.push(i); if(isHead[i])headV.push(i); }

L.push('正脸顶点 '+faceV.length+'  头部主导顶点 '+headV.length);
L.push('');
L.push('=== 1. 正脸顶点的局部坐标分布（看它们是不是一圈轮廓） ===');
const byZ = {};
for (const i of faceV) { const z = POS[i][2].toFixed(5); (byZ[z] = byZ[z]||[]).push(i); }
L.push('按局部 z（高度）分层：');
for (const z of Object.keys(byZ).sort((a,b)=>a-b)) {
  const arr = byZ[z];
  const xs = arr.map(i=>POS[i][0]);
  L.push('  z='+z+'  n='+String(arr.length).padStart(2)
    +'  x '+Math.min(...xs).toFixed(5)+'..'+Math.max(...xs).toFixed(5)
    +'  y '+Math.min(...arr.map(i=>POS[i][1])).toFixed(5)+'..'+Math.max(...arr.map(i=>POS[i][1])).toFixed(5));
}
L.push('');

L.push('=== 2. 每个正脸顶点的 (x,y,z) 明细 ===');
for (const z of Object.keys(byZ).sort((a,b)=>a-b)) {
  for (const i of byZ[z]) {
    L.push('  v'+String(i).padStart(4)+'  x='+POS[i][0].toFixed(6)+'  y='+POS[i][1].toFixed(6)+'  z='+POS[i][2].toFixed(6)+'  n=('+NRM[i].map(v=>v.toFixed(2)).join(',')+')');
  }
}
L.push('');

L.push('=== 3. 含正脸顶点的三角形：三顶点构成（看面部是哪些顶点围的） ===');
const triWithFace = [];
for (let f=0; f<IDX.length/3; f++) {
  const a=IDX[f*3],b=IDX[f*3+1],c=IDX[f*3+2];
  const n = (isFace[a]?1:0)+(isFace[b]?1:0)+(isFace[c]?1:0);
  if (n>0) triWithFace.push({f,a,b,c,n});
}
L.push('含至少 1 个正脸顶点的三角形：'+triWithFace.length);
const all3 = triWithFace.filter(t=>t.n===3);
const mix  = triWithFace.filter(t=>t.n>0 && t.n<3);
L.push('  三顶点全是正脸：'+all3.length);
L.push('  混合（部分正脸）：'+mix.length);
L.push('');
L.push('全部是正脸的三角形明细：');
for (const t of all3) {
  L.push('  tri'+String(t.f).padStart(4)+'  '+[t.a,t.b,t.c].map(v=>
    'v'+v+'('+POS[v].map(x=>x.toFixed(4)).join(',')+')').join(' | '));
}
L.push('');
L.push('混合三角形的"非正脸顶点"是谁：');
const otherSet = new Set();
for (const t of mix) for (const v of [t.a,t.b,t.c]) if (!isFace[v]) otherSet.add(v);
L.push('  涉及 '+otherSet.size+' 个非正脸顶点');
const byZ2 = {};
for (const i of otherSet) { const z=POS[i][2].toFixed(5); (byZ2[z]=byZ2[z]||0); byZ2[z]++; }
for (const z of Object.keys(byZ2).sort((a,b)=>a-b)) L.push('    z='+z+'  n='+byZ2[z]);
L.push('');

L.push('=== 4. 这些"非正脸顶点"的法线（看它们朝哪） ===');
let cnt=0;
for (const i of otherSet) {
  if (cnt++>40) break;
  L.push('  v'+String(i).padStart(4)+'  nhd=('+NRM[i].map(v=>v.toFixed(2)).join(',')+')  pos=('+POS[i].map(v=>v.toFixed(5)).join(',')+')');
}
L.push('');

L.push('=== 5. 头部所有顶点按法线 -y 分量分桶 ===');
const buckets = {};
for (const i of headV) {
  const ny = NRM[i][1];
  const b = ny.toFixed(2);
  buckets[b] = (buckets[b]||0)+1;
}
for (const k of Object.keys(buckets).sort((a,b)=>Number(a)-Number(b))) L.push('  ny='+k+'  n='+buckets[k]);
L.push('');

L.push('=== 6. 头部顶点在局部 y（前后）上的分布 ===');
const yb = {};
for (const i of headV) { const y=POS[i][1].toFixed(5); yb[y]=(yb[y]||0)+1; }
for (const k of Object.keys(yb).sort((a,b)=>Number(a)-Number(b))) L.push('  y='+k+'  n='+yb[k]);

fs.writeFileSync(path.join(HERE,'_struct.txt'), L.join('\n'), 'utf8');
console.log(L.join('\n').slice(0, 12000));
