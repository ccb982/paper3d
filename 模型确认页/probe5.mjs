// probe5.mjs —— 把"头部正前方"的所有三角形列成拓扑图，看清脸到底由哪些面组成
//   范围：头部主导 + 局部 y <= -0.0045（含脸面层与所有五官浮雕层，但排除耳朵 -0.0019）
//   输出：① 每个三角形 → 所在 y 层 + 顶点坐标
//        ② 按 y 层汇总：层号 / 三角形数 / x 跨度 / z 跨度 / 是否连成一片
//        ③ 找出"覆盖最广的那一层" → 那就是脸面
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

const isHead = [];
for (let i=0;i<POS.length;i++){
  let bw=0,bj=-1; for(let k=0;k<4;k++){const w=WGT[i][k]; if(w>bw){bw=w;bj=JNT[i][k];}}
  isHead[i] = (bj===headJ && bw>0.5);
}
const L = [];
const fmt = (v,n=5) => v.toFixed(n);

// 收集"头部主导 且 所有顶点 y<=-0.0045" 的三角形（= 正脸区域，排除耳朵）
const faceTris = [];
for (let f=0; f<IDX.length/3; f++) {
  const t = [IDX[f*3], IDX[f*3+1], IDX[f*3+2]];
  if (!t.every(v => isHead[v])) continue;
  if (!t.every(v => POS[v][1] <= -0.0045)) continue;
  faceTris.push(t);
}
L.push('正脸区域三角形数（头主导 ∧ 三顶点 y<=-0.0045）：' + faceTris.length);
L.push('');

// 按 y 层汇总
const byY = new Map();
for (const t of faceTris) {
  const ys = [...new Set(t.map(v => POS[v][1].toFixed(6)))];
  const key = ys.length === 1 ? ys[0] : '混合[' + ys.map(v=>Number(v).toFixed(4)).join(',') + ']';
  if (!byY.has(key)) byY.set(key, []);
  byY.get(key).push(t);
}
L.push('=== 按 y 层汇总 ===');
L.push('y 层              三角形数  涉及顶点数  x 跨度      z 跨度      最大|ny|');
const keys = [...byY.keys()].sort((a,b) => {
  const na = parseFloat(a), nb = parseFloat(b);
  if (isNaN(na) || isNaN(nb)) return (isNaN(na)?1:0)-(isNaN(nb)?1:0);
  return na-nb;
});
for (const k of keys) {
  const ts = byY.get(k);
  const vs = [...new Set(ts.flat())];
  const xs = vs.map(v=>POS[v][0]), zs = vs.map(v=>POS[v][2]);
  const mny = Math.max(...vs.map(v => Math.abs(NRM[v][1])));
  L.push(k.padEnd(18) + String(ts.length).padStart(7) + String(vs.length).padStart(10) + '  '
    + (Math.min(...xs).toFixed(5)+'..'+Math.max(...xs).toFixed(5)).padEnd(19)
    + (Math.min(...zs).toFixed(5)+'..'+Math.max(...zs).toFixed(5)).padEnd(19)
    + mny.toFixed(3));
}
L.push('');

// 逐层明细
L.push('=== 逐层三角形明细 ===');
for (const k of keys) {
  const ts = byY.get(k);
  const vs = [...new Set(ts.flat())];
  const xs = vs.map(v=>POS[v][0]), zs = vs.map(v=>POS[v][2]);
  L.push('');
  L.push('--- y 层 ' + k + '  三角形 ' + ts.length + ' 个，顶点 ' + vs.length + ' 个'
    + '  x ' + Math.min(...xs).toFixed(5) + '..' + Math.max(...xs).toFixed(5)
    + '  z ' + Math.min(...zs).toFixed(5) + '..' + Math.max(...zs).toFixed(5));
  if (ts.length <= 20) {
    for (const t of ts) {
      L.push('   ' + t.map(v => 'v'+v+'('+fmt(POS[v][0])+','+fmt(POS[v][1])+','+fmt(POS[v][2])+')').join(' | '));
    }
  } else {
    L.push('   （' + ts.length + ' 个，略）顶点 x 取值：'
      + [...new Set(xs.map(v=>v.toFixed(5)))].sort((a,b)=>Number(a)-Number(b)).join(' '));
  }
}

fs.writeFileSync(path.join(HERE,'_probe5.txt'), L.join('\n'), 'utf8');
console.log('written _probe5.txt  lines=' + L.length);
console.log(L.slice(0, 60).join('\n'));
