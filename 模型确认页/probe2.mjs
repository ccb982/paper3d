// probe2.mjs —— 最终定论：脸到底平不平 / 那 8 个 y=-0.0019 的点是什么
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
const JNT = readA(prim.attributes.JOINTS_0);
const WGT = readA(prim.attributes.WEIGHTS_0);
const IDX = readA(prim.indices);
const joints = js.skins[0].joints;
const headJ = joints.findIndex(j => js.nodes[j].name === 'Head');

const head = [];
for (let i=0;i<POS.length;i++){
  let bw=0,bj=-1; for(let k=0;k<4;k++){const w=WGT[i][k]; if(w>bw){bw=w;bj=JNT[i][k];}}
  if (bj===headJ && bw>0.5) head.push(i);
}

const L = [];
const yOf = i => POS[i][1], zOf = i => POS[i][2], xOf = i => POS[i][0];

L.push('=== A. 不同阈值下"正脸"顶点的前后(y)跨度 ===');
L.push('');
L.push('阈值     顶点数    y 层数   y 跨度        说明');
for (const t of [0.90, 0.95, 0.98, 0.99, 1.00 - 1e-6]) {
  const sel = head.filter(i => NRM[i][1] * -1 >= t);
  const ys = [...new Set(sel.map(i => yOf(i).toFixed(6)))].sort((a,b)=>Number(a)-Number(b));
  const ymin = Math.min(...sel.map(yOf)), ymax = Math.max(...sel.map(yOf));
  L.push(String(t.toFixed(6)).padEnd(8) + String(sel.length).padStart(5) + String(ys.length).padStart(8)
    + '   ' + (ymax-ymin).toFixed(6).padEnd(12) + ' y 层: ' + ys.join(' / '));
}
L.push('');

L.push('=== B. 严格取 ny <= -0.99（纯正视面片） ===');
const strict = head.filter(i => NRM[i][1] <= -0.99);
const sys = [...new Set(strict.map(i => yOf(i).toFixed(6)))].sort((a,b)=>Number(a)-Number(b));
L.push('顶点数 ' + strict.length + '，y 取值集合 = [' + sys.join(', ') + ']');
const smin = Math.min(...strict.map(yOf)), smax = Math.max(...strict.map(yOf));
L.push('y 跨度 = ' + (smax - smin).toFixed(9) + '  (' + ((smax-smin)*1000).toFixed(4) + ' mm @模型单位)');
const sxmin = Math.min(...strict.map(xOf)), sxmax = Math.max(...strict.map(xOf));
const szmin = Math.min(...strict.map(zOf)), szmax = Math.max(...strict.map(zOf));
L.push('x 跨度 = ' + (sxmax - sxmin).toFixed(6) + '  z 跨度 = ' + (szmax - szmin).toFixed(6));
L.push('→ 前后起伏 / 脸宽 = ' + (100*(smax-smin)/(sxmax-sxmin)).toFixed(4) + '%');
L.push('→ 前后起伏 / 脸高 = ' + (100*(smax-smin)/(szmax-szmin)).toFixed(4) + '%');
L.push('');

L.push('=== C. 那批 y=-0.0019 的顶点在哪？（是否属于脸面） ===');
const outliers = head.filter(i => yOf(i) > -0.0045 && NRM[i][1] * -1 >= 0.9);
L.push('候选 ' + outliers.length + ' 个：');
for (const i of outliers) {
  L.push('  v'+String(i).padStart(4)
    +'  pos=('+POS[i].map(v=>v.toFixed(6)).join(', ')+')'
    +'  nrm=('+NRM[i].map(v=>v.toFixed(2)).join(',')+')');
}
// 它们参与多少三角形、邻接谁
L.push('');
L.push('它们参与的三角形（看邻接顶点在哪个 y 层）：');
let n = 0;
for (let f=0; f<IDX.length/3 && n<24; f++) {
  const tri = [IDX[f*3], IDX[f*3+1], IDX[f*3+2]];
  if (!tri.some(v => outliers.includes(v))) continue;
  n++;
  L.push('  tri'+String(f).padStart(4)+'  ' + tri.map(v =>
    'v'+v+'(y='+yOf(v).toFixed(6)+',z='+zOf(v).toFixed(5)+',x='+xOf(v).toFixed(5)+')').join(' | '));
}
L.push('');

L.push('=== D. 头部 y 层与"每层 x 跨度"（看每层是不是一块完整平面） ===');
const layers = {};
for (const i of head) { const y = yOf(i).toFixed(6); (layers[y]=layers[y]||[]).push(i); }
const keys = Object.keys(layers).sort((a,b)=>Number(b)-Number(a)).slice(0, 12);
L.push('y 值(靠前→靠后)   顶点数   x跨度      z跨度      最大|ny|');
for (const y of keys) {
  const arr = layers[y];
  const xs = arr.map(xOf), zs2 = arr.map(zOf);
  const mny = Math.max(...arr.map(i => Math.abs(NRM[i][1])));
  L.push(y.padEnd(14) + String(arr.length).padStart(5) + '   '
    + (Math.max(...xs)-Math.min(...xs)).toFixed(6).padEnd(11)
    + (Math.max(...zs2)-Math.min(...zs2)).toFixed(6).padEnd(11)
    + mny.toFixed(3));
}
L.push('');

L.push('=== E. 结论 ===');
L.push('若 ny<=-0.99 那层的 y 跨度 ≈ 0 → 脸**本来就是平的**，无需削平。');

fs.writeFileSync(path.join(HERE,'_probe2.txt'), L.join('\n'), 'utf8');
console.log(L.join('\n'));
