// probe19: 逐层(y 切片)看头部"最前面各层"的形状，找出哪一层才是"脸"
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
const NOR = readAccessor(prim.attributes.NORMAL);
const IDX = readAccessor(prim.indices);
const V = POS.length;

const ZTOP = 0.028388, ZBOT = 0.014933, H = ZTOP - ZBOT;
const pct = (z) => ((((z - ZBOT) / H) * 100).toFixed(1) + '%').padStart(6);

// 头的中心 x/z
let cx = 0, cz = 0;
for (let i = 0; i < V; i++) { cx += POS[i][0]; cz += POS[i][2]; }
cx /= V; cz /= V;

// 只看"头部区域"：z >= ZBOT（本来就是头）且 y 在头部范围
const EPS = 1e-5;

let out = '';
// 逐 y 切片（从最前 -0.005707 到最后 +0.005707），每片宽度 0.0002
out += `=== 沿 y 切片（前 -> 后），每片 0.0002 宽 ===\n`;
out += `片序号  y范围                        顶点数  三角数   x范围                    z范围            头高占比\n`;

// 预先建三角形 -> 顶点
const trisByY = [];
for (let t = 0; t < IDX.length; t += 3) {
  const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
  const ym = (POS[a][1] + POS[b][1] + POS[c][1]) / 3;
  trisByY.push({ ym, a, b, c });
}

const ys = [];
for (let y = -0.005707; y <= 0.005707 + 1e-9; y += 0.0002) ys.push(y);

for (let si = 0; si < ys.length; si++) {
  const y0 = ys[si], y1 = y0 + 0.0002;
  const vs = [], ts = [];
  for (let i = 0; i < V; i++) if (POS[i][1] >= y0 && POS[i][1] < y1) vs.push(i);
  for (const t of trisByY) if (t.ym >= y0 && t.ym < y1) ts.push(t);
  if (vs.length === 0 && ts.length === 0) continue;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const i of vs) {
    x0 = Math.min(x0, POS[i][0]); x1 = Math.max(x1, POS[i][0]);
    z0 = Math.min(z0, POS[i][2]); z1 = Math.max(z1, POS[i][2]);
  }
  if (vs.length === 0) { x0 = x1 = z0 = z1 = NaN; }
  out += `${String(si).padStart(3)}  ${y0.toFixed(6)}..${y1.toFixed(6)}  ${String(vs.length).padStart(4)}  ${String(ts.length).padStart(5)}   ${(isNaN(x0) ? '   --' : x0.toFixed(6) + '..' + x1.toFixed(6)).padEnd(22)}  ${(isNaN(z0) ? '--' : z0.toFixed(6) + '..' + z1.toFixed(6)).padEnd(19)} ${isNaN(z0) ? '' : pct(z0) + '..' + pct(z1)}\n`;
}

// 更细：只看 y <= -0.0035 的"前半部"，逐切片列出顶点
out += `\n=== 前半部（y <= -0.0035）逐切片顶点明细 ===\n`;
const front = [];
for (let i = 0; i < V; i++) if (POS[i][1] <= -0.0035) front.push(i);
front.sort((a, b) => POS[a][1] - POS[b][1] || POS[a][2] - POS[b][2]);
let curY = null;
for (const i of front) {
  if (curY === null || Math.abs(POS[i][1] - curY) > 1e-7) {
    curY = POS[i][1];
    out += `\n--- y = ${curY.toFixed(6)} ---\n`;
  }
  out += `   v${String(i).padStart(4)}  x ${POS[i][0].toFixed(6).padStart(10)} (${(POS[i][0] - cx >= 0 ? '+' : '')}${(POS[i][0] - cx).toFixed(6)})  z ${POS[i][2].toFixed(6)} ${pct(POS[i][2])}  n(${NOR[i][0].toFixed(2)},${NOR[i][1].toFixed(2)},${NOR[i][2].toFixed(2)})\n`;
}

fs.writeFileSync(path.join(dir, '_probe19.txt'), out, 'utf8');
console.log('OK', out.length);
