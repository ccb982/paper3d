// probe3.mjs —— 用"连通块 + 共面性"把脸面从耳朵/五官里分出来
// 思路：脸面是一块**独立共面片**。做法：
//   ① 只取 ny <= -0.99 的顶点（所有"纯正视"面片：脸主板、五官、耳朵）
//   ② 按 y 值分层，每层按 x/z 邻接做**连通块**分组
//   ③ 每块统计：顶点数 / x跨度 / z跨度 / 是否严格共面
//   ④ 最大的那块 = 脸主板；找出它之后，耳朵/五官就被隔离了
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
const frontal = head.filter(i => NRM[i][1] <= -0.99);

// 三角形邻接（只保留三顶点都在 frontal 的三角形）
const fset = new Set(frontal);
const tris = [];
for (let f=0; f<IDX.length/3; f++) {
  const t = [IDX[f*3], IDX[f*3+1], IDX[f*3+2]];
  if (t.every(v => fset.has(v))) tris.push(t);
}
// 并查集
const par = new Map();
const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
const uni = (a,b) => { const ra=find(a), rb=find(b); if(ra!==rb) par.set(ra,rb); };
for (const v of frontal) par.set(v, v);
for (const t of tris) { uni(t[0],t[1]); uni(t[1],t[2]); }

const groups = new Map();
for (const v of frontal) {
  const r = find(v);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(v);
}

const L = [];
L.push('=== 正视面片（ny<=-0.99）的连通块分解 ===');
L.push('正视顶点 ' + frontal.length + '，纯正视三角形 ' + tris.length);
L.push('连通块 ' + groups.size + ' 个：');
L.push('');
L.push('#   顶点数  y值        x跨度      z跨度      严格共面?  x范围            z范围');
const list = [...groups.values()].sort((a,b)=>b.length-a.length);
list.forEach((g, gi) => {
  const ys = [...new Set(g.map(i=>POS[i][1].toFixed(6)))];
  const xs = g.map(i=>POS[i][0]), zs = g.map(i=>POS[i][2]);
  const xsp = Math.max(...xs)-Math.min(...xs), zsp = Math.max(...zs)-Math.min(...zs);
  L.push(String(gi).padStart(2) + '  ' + String(g.length).padStart(6) + '  '
    + (ys.length===1 ? ys[0] : '('+ys.length+'层)').padEnd(10)
    + xsp.toFixed(6).padEnd(11) + zsp.toFixed(6).padEnd(11)
    + (ys.length===1 ? '是' : '否').padEnd(10)
    + (Math.min(...xs).toFixed(5)+'..'+Math.max(...xs).toFixed(5)).padEnd(17)
    + Math.min(...zs).toFixed(5)+'..'+Math.max(...zs).toFixed(5));
});
L.push('');

// 最大块 = 脸主板
const main = list[0];
const mys = [...new Set(main.map(i=>POS[i][1].toFixed(6)))];
L.push('=== 最大连通块（= 脸主板） ===');
L.push('顶点数 ' + main.length + '，y 取值 ' + mys.join(' / '));
const mxs = main.map(i=>POS[i][0]), mzs = main.map(i=>POS[i][2]);
L.push('x 范围 ' + Math.min(...mxs).toFixed(6) + ' .. ' + Math.max(...mxs).toFixed(6) + '  跨度 ' + (Math.max(...mxs)-Math.min(...mxs)).toFixed(6));
L.push('z 范围 ' + Math.min(...mzs).toFixed(6) + ' .. ' + Math.max(...mzs).toFixed(6) + '  跨度 ' + (Math.max(...mzs)-Math.min(...mzs)).toFixed(6));
L.push('y 跨度 ' + (Math.max(...main.map(i=>POS[i][1])) - Math.min(...main.map(i=>POS[i][1]))).toFixed(9));
L.push('→ 宽高比 x/z = ' + ((Math.max(...mxs)-Math.min(...mxs))/(Math.max(...mzs)-Math.min(...mzs))).toFixed(4));
L.push('');

L.push('=== 按 x 跨度过滤：哪些块像是"耳朵"（贴在最外侧、且 x 超出脸主板） ===');
const faceXMax = Math.max(...mxs), faceXMin = Math.min(...mxs);
for (const g of list) {
  const gx = g.map(i=>POS[i][0]);
  const gxmax = Math.max(...gx), gxmin = Math.min(...gx);
  const outside = gxmax > faceXMax + 1e-6 || gxmin < faceXMin - 1e-6;
  if (outside) {
    const gz = g.map(i=>POS[i][2]);
    L.push('  块' + list.indexOf(g) + '  n=' + g.length
      + '  x ' + gxmin.toFixed(6) + '..' + gxmax.toFixed(6)
      + '  z ' + Math.min(...gz).toFixed(5) + '..' + Math.max(...gz).toFixed(5)
      + '  y取 ' + [...new Set(g.map(i=>POS[i][1].toFixed(6)))].join('/')
      + '  ← x 超出脸主板 [-' + Math.abs(faceXMin).toFixed(6) + ', ' + faceXMax.toFixed(6) + ']');
  }
}
L.push('');

L.push('=== 只取脸主板 → 重新计算"脸宽/脸高"（供 remapFaceUV 用） ===');
L.push('uAxis(=局部 z 高度) 范围 ' + Math.min(...mzs).toFixed(6) + ' .. ' + Math.max(...mzs).toFixed(6));
L.push('lrAxis(=局部 x 左右) 范围 ' + Math.min(...mxs).toFixed(6) + ' .. ' + Math.max(...mxs).toFixed(6));
L.push('脸宽/脸高 = ' + ((Math.max(...mxs)-Math.min(...mxs))/(Math.max(...mzs)-Math.min(...mzs))).toFixed(4));
L.push('');
L.push('★ 若脸主板是严格共面（y 单层），则**无需削平**：');
L.push('  当前立绘变形的真因 = 耳朵把包围盒撑大 → 立绘被拉伸并偏移。');

fs.writeFileSync(path.join(HERE,'_probe3.txt'), L.join('\n'), 'utf8');
console.log(L.join('\n'));
