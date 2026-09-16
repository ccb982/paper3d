// probe4.mjs —— 最终方案验证：以"最靠前的 y 层"为脸面基准
//
// 观察：脸主板、眼睛、眉毛、耳朵都是**各自共面的独立小方板**，y 各不相同。
//       真正贴在脸最前面的那层 = y 最小（局部 -y 朝前）的那层。
// 验证：
//   ① 取 y 最小的那一层顶点（脸主板层）
//   ② 检查它的 x/z 分布是否**左右对称、覆盖整张脸**
//   ③ 若左右不对称 → 说明中间有缝，需要"按对称性修补"或改用多块并集
//
// 同时输出：以"最小 y 层"为脸面时，立绘映射区域的宽高比（这才是该用的值）
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

const head = [];
for (let i=0;i<POS.length;i++){
  let bw=0,bj=-1; for(let k=0;k<4;k++){const w=WGT[i][k]; if(w>bw){bw=w;bj=JNT[i][k];}}
  if (bj===headJ && bw>0.5) head.push(i);
}
const L = [];
const yOf = i => POS[i][1], xOf = i => POS[i][0], zOf = i => POS[i][2];

L.push('=== 头部顶点的 y 层（前后）完整清单：每层有多少点、覆盖多大 ===');
const byY = {};
for (const i of head) { const y=yOf(i).toFixed(6); (byY[y]=byY[y]||[]).push(i); }
const rows = Object.keys(byY).map(y => {
  const g = byY[y], xs=g.map(xOf), zs=g.map(zOf);
  return { y:Number(y), n:g.length,
    xmin:Math.min(...xs), xmax:Math.max(...xs),
    zmin:Math.min(...zs), zmax:Math.max(...zs),
    mny: Math.max(...g.map(i=>Math.abs(NRM[i][1]))) };
}).sort((a,b)=>a.y-b.y);
L.push('  y            n    x范围              z范围              最大|ny|');
for (const r of rows) {
  L.push('  '+r.y.toFixed(6)+'  '+String(r.n).padStart(3)+'  '
    + (r.xmin.toFixed(5)+'..'+r.xmax.toFixed(5)).padEnd(18)
    + (r.zmin.toFixed(5)+'..'+r.zmax.toFixed(5)).padEnd(19)
    + r.mny.toFixed(3));
}
L.push('');

// ① 最靠前的层
const front = rows[0];
const frontVerts = byY[front.y.toFixed(6)];
L.push('=== ① 最靠前的 y 层 = ' + front.y.toFixed(6) + '（脸面基准） ===');
L.push('顶点数 ' + frontVerts.length);
L.push('x 范围 ' + front.xmin.toFixed(6) + ' .. ' + front.xmax.toFixed(6) + '  跨度 ' + (front.xmax-front.xmin).toFixed(6));
L.push('z 范围 ' + front.zmin.toFixed(6) + ' .. ' + front.zmax.toFixed(6) + '  跨度 ' + (front.zmax-front.zmin).toFixed(6));
L.push('左右对称性检查：|xmin| = ' + Math.abs(front.xmin).toFixed(6) + '  vs  xmax = ' + front.xmax.toFixed(6));
L.push('  → 中心偏移 = ' + ((front.xmin+front.xmax)/2).toFixed(6));
L.push('');

// ② 该层顶点的 x 分布（看是不是左右都有点）
L.push('=== ② 该层顶点的 x 分布（按 x 排序） ===');
const sorted = [...frontVerts].sort((a,b) => xOf(a)-xOf(b));
const xvals = [...new Set(sorted.map(i=>xOf(i).toFixed(6)))].sort((a,b)=>Number(a)-Number(b));
L.push('x 取值集合（' + xvals.length + ' 个）：');
for (const xv of xvals) {
  const cnt = sorted.filter(i => xOf(i).toFixed(6) === xv).length;
  L.push('  x=' + xv.padEnd(11) + ' n=' + cnt + '   ' + (Number(xv)<0?'← 左':'→ 右'));
}
L.push('');

// ③ 把"所有 ny<=-0.99 且 y == 最小层" 的顶点合起来（含左右）
const faceMain = head.filter(i => NRM[i][1] <= -0.99 && Math.abs(yOf(i) - front.y) < 1e-6);
L.push('=== ③ 脸面顶点 = (ny<=-0.99) ∧ (y == 最前层) ===');
L.push('顶点数 ' + faceMain.length);
const fmx = faceMain.map(xOf), fmz = faceMain.map(zOf);
L.push('x ' + Math.min(...fmx).toFixed(6) + ' .. ' + Math.max(...fmx).toFixed(6) + '  跨度 ' + (Math.max(...fmx)-Math.min(...fmx)).toFixed(6));
L.push('z ' + Math.min(...fmz).toFixed(6) + ' .. ' + Math.max(...fmz).toFixed(6) + '  跨度 ' + (Math.max(...fmz)-Math.min(...fmz)).toFixed(6));
L.push('宽高比 = ' + ((Math.max(...fmx)-Math.min(...fmx))/(Math.max(...fmz)-Math.min(...fmz))).toFixed(4));
L.push('y 跨度 = ' + (Math.max(...faceMain.map(yOf)) - Math.min(...faceMain.map(yOf))).toFixed(9) + '  ← 应 ≈0');
L.push('');

// ④ 对比：当前生产实现会选中哪些（ny<=-0.95，不筛 y）
const cur = head.filter(i => NRM[i][1] * -1 >= 0.95);
const cx = cur.map(xOf), cz = cur.map(zOf);
L.push('=== ④ 生产当前口径（ny<=-0.95，不筛 y）会选中 ===');
L.push('顶点数 ' + cur.length);
L.push('x ' + Math.min(...cx).toFixed(6) + ' .. ' + Math.max(...cx).toFixed(6) + '  跨度 ' + (Math.max(...cx)-Math.min(...cx)).toFixed(6));
L.push('z ' + Math.min(...cz).toFixed(6) + ' .. ' + Math.max(...cz).toFixed(6) + '  跨度 ' + (Math.max(...cz)-Math.min(...cz)).toFixed(6));
L.push('宽高比 = ' + ((Math.max(...cx)-Math.min(...cx))/(Math.max(...cz)-Math.min(...cz))).toFixed(4));
L.push('y 跨度 = ' + (Math.max(...cur.map(yOf)) - Math.min(...cur.map(yOf))).toFixed(6));
L.push('');
L.push('★ 把耳朵(块3/4)与五官单独去掉后，包围盒的变化：');
L.push('  x 跨度  ' + (Math.max(...cx)-Math.min(...cx)).toFixed(6) + '  →  ' + (Math.max(...fmx)-Math.min(...fmx)).toFixed(6));
L.push('  z 跨度  ' + (Math.max(...cz)-Math.min(...cz)).toFixed(6) + '  →  ' + (Math.max(...fmz)-Math.min(...fmz)).toFixed(6));
L.push('  宽高比  ' + ((Math.max(...cx)-Math.min(...cx))/(Math.max(...cz)-Math.min(...cz))).toFixed(4) + '  →  ' + ((Math.max(...fmx)-Math.min(...fmx))/(Math.max(...fmz)-Math.min(...fmz))).toFixed(4));

fs.writeFileSync(path.join(HERE,'_probe4.txt'), L.join('\n'), 'utf8');
console.log(L.join('\n'));
