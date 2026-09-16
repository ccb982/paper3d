// probe21: 找"真正的脸" —— 用「局部分辨率密度」定义五官集中区
// 手法：统计头部每个空间格子(x,z)里有多少顶点/面 —— 五官细节多的地方密度高
import fs from 'node:fs';
import path from 'node:path';
const dir = 'C:/Users/22641/Desktop/架构重置/模型确认页';
const glb = fs.readFileSync(path.join(dir, 'candidate_cubeguy.glb'));
let off = 12, json = null, bin = null;
while (off < glb.length) {
  const len = glb.readUInt32LE(off), type = glb.readUInt32LE(off + 4);
  const data = glb.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}
const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(i) {
  const a = json.accessors[i], size = COMP[a.componentType], n = NUM[a.type];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || size * n;
  const out = [];
  for (let k = 0; k < a.count; k++) {
    const rec = [];
    for (let c = 0; c < n; c++) {
      const o = base + k * stride + c * size;
      let v; switch (a.componentType) {
        case 5126: v = bin.readFloatLE(o); break;
        case 5125: v = bin.readUInt32LE(o); break;
        case 5123: v = bin.readUInt16LE(o); break;
        case 5121: v = bin.readUInt8(o); break;
        case 5122: v = bin.readInt16LE(o); break;
        case 5120: v = bin.readInt8(o); break;
      } rec.push(v);
    }
    out.push(n === 1 ? rec[0] : rec);
  }
  return out;
}
const prim = json.meshes[0].primitives[0];
const POS = readAccessor(prim.attributes.POSITION);
const IDX = readAccessor(prim.indices);
const V = POS.length;
const ZTOP = 0.028388, ZBOT = 0.014933, H = ZTOP - ZBOT;
const pct = (z) => ((((z - ZBOT) / H) * 100).toFixed(1) + '%');

// ★ 只统计"头部 y 在前 1/3"（即 y <= -0.0038）的三角形 —— 只看前脸区
const FRONT_Y = -0.0038;
const triArea = [];
let out = '';
out += `=== 前脸区(y <= ${FRONT_Y}) 三角面按 (x,z) 网格密度 ===\n`;
const GX = 14, GZ = 20;
const xr = [-0.0075, 0.0075], zr = [ZBOT, ZTOP];
const grid = Array.from({ length: GZ }, () => Array.from({ length: GX }, () => 0));
let cnt = 0;
for (let t = 0; t < IDX.length; t += 3) {
  const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
  const ym = (POS[a][1] + POS[b][1] + POS[c][1]) / 3;
  if (ym > FRONT_Y) continue;
  const zm = (POS[a][2] + POS[b][2] + POS[c][2]) / 3;
  const xm = (POS[a][0] + POS[b][0] + POS[c][0]) / 3;
  if (zm < zr[0] || zm > zr[1]) continue;
  if (xm < xr[0] || xm > xr[1]) continue;
  let gi = Math.floor(((xm - xr[0]) / (xr[1] - xr[0])) * GX);
  let gj = Math.floor(((zm - zr[0]) / (zr[1] - zr[0])) * GZ);
  gi = Math.max(0, Math.min(GX - 1, gi)); gj = Math.max(0, Math.min(GZ - 1, gj));
  grid[gj][gi]++; cnt++;
}
out += `前脸区三角面总数 ${cnt}\n\n`;
out += `      x ->  ${Array.from({length:GX},(_,i)=>(((xr[0]+(xr[1]-xr[0])*(i+0.5)/GX)*1000).toFixed(1)).padStart(7)).join('')}\n`;
for (let j = GZ - 1; j >= 0; j--) {
  const zl = zr[0] + (zr[1] - zr[0]) * j / GZ, zh = zr[0] + (zr[1] - zr[0]) * (j + 1) / GZ;
  out += `${pct((zl+zh)/2).padStart(6)} ${Array.from({length:GX},(_,i)=>String(grid[j][i]).padStart(7)).join('')}\n`;
}

// ★ 每个 (x,z) 格子里"最靠前的顶点 y" —— 表面前后起伏图
out += `\n=== 前脸区 每格"最靠前顶点 y 的绝对值"（越大=越往前凸）===\n`;
const fgrid = Array.from({ length: GZ }, () => Array.from({ length: GX }, () => -Infinity));
for (let i = 0; i < V; i++) {
  const y = POS[i][1], z = POS[i][2], x = POS[i][0];
  if (y > FRONT_Y) continue;
  if (z < zr[0] || z > zr[1] || x < xr[0] || x > xr[1]) continue;
  let gi = Math.floor(((x - xr[0]) / (xr[1] - xr[0])) * GX);
  let gj = Math.floor(((z - zr[0]) / (zr[1] - zr[0])) * GZ);
  gi = Math.max(0, Math.min(GX - 1, gi)); gj = Math.max(0, Math.min(GZ - 1, gj));
  if (-y > fgrid[gj][gi]) fgrid[gj][gi] = -y;
}
out += `      x ->  ${Array.from({length:GX},(_,i)=>(((xr[0]+(xr[1]-xr[0])*(i+0.5)/GX)*1000).toFixed(1)).padStart(7)).join('')}\n`;
for (let j = GZ - 1; j >= 0; j--) {
  const zl = zr[0] + (zr[1] - zr[0]) * j / GZ, zh = zr[0] + (zr[1] - zr[0]) * (j + 1) / GZ;
  const row = fgrid[j].map((v) => (v === -Infinity ? '   --' : (v * 1000).toFixed(2).padStart(7)));
  out += `${pct((zl+zh)/2).padStart(6)} ${row.join('')}\n`;
}

// ★ 前脸区的"每个 z 高度"上，本高度带的三角形里，最小 y（最靠前）与最大 y
out += `\n=== 前脸区 逐 z 高度带：三角形数 / 最靠前 y / 最靠后 y / 该带 x 范围 ===\n`;
const NB = 20;
for (let b = 0; b < NB; b++) {
  const zl = ZBOT + (H * b) / NB, zh = ZBOT + (H * (b + 1)) / NB;
  let n = 0, ymin = Infinity, ymax = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (let t = 0; t < IDX.length; t += 3) {
    const a = IDX[t], bb = IDX[t + 1], cc = IDX[t + 2];
    const zm = (POS[a][2] + POS[bb][2] + POS[cc][2]) / 3;
    if (zm < zl || zm >= zh) continue;
    const ym = (POS[a][1] + POS[bb][1] + POS[cc][1]) / 3;
    if (ym > FRONT_Y) continue;
    n++;
    ymin = Math.min(ymin, ym); ymax = Math.max(ymax, ym);
    for (const v of [a, bb, cc]) { x0 = Math.min(x0, POS[v][0]); x1 = Math.max(x1, POS[v][0]); }
  }
  if (n === 0) { out += `${pct((zl+zh)/2).padStart(6)}  (无)\n`; continue; }
  out += `${pct((zl+zh)/2).padStart(6)}  z ${zl.toFixed(6)}..${zh.toFixed(6)}  面 ${String(n).padStart(4)}  最前y ${ymin.toFixed(6)}  最后y ${ymax.toFixed(6)}  x ${x0.toFixed(6)}..${x1.toFixed(6)}\n`;
}
fs.writeFileSync(path.join(dir, '_probe21.txt'), out, 'utf8');
console.log('OK', out.length);
