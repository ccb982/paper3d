// probe20: 找到"脸"的真实范围
// 思路：脸 = 眼睛所在的那个"前表面"。眼睛浮雕 z 0.0210..0.0223 (49.8%高度)
//       → 脸必须覆盖这段高度。逐层扫 y，看哪一层的 z 范围覆盖了眼睛高度且宽
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
const pct = (z) => ((((z - ZBOT) / H) * 100).toFixed(1) + '%');

let out = '';
// ---- A) 法线朝前（ny < -0.9）的顶点，按 z 分层统计 ----
out += `=== A) 法线朝前的顶点 (ny <= -0.9) 按 z 分带 ===\n`;
const frontV = [];
for (let i = 0; i < V; i++) if (NOR[i][1] <= -0.9) frontV.push(i);
out += `总数 ${frontV.length}\n`;
{
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  const yset = new Map();
  for (const i of frontV) {
    y0 = Math.min(y0, POS[i][1]); y1 = Math.max(y1, POS[i][1]);
    z0 = Math.min(z0, POS[i][2]); z1 = Math.max(z1, POS[i][2]);
    x0 = Math.min(x0, POS[i][0]); x1 = Math.max(x1, POS[i][0]);
    const kk = POS[i][1].toFixed(5);
    if (!yset.has(kk)) yset.set(kk, 0);
    yset.set(kk, yset.get(kk) + 1);
  }
  out += `  x ${x0.toFixed(6)}..${x1.toFixed(6)}   y ${y0.toFixed(6)}..${y1.toFixed(6)}   z ${z0.toFixed(6)}..${z1.toFixed(6)} (${pct(z0)}..${pct(z1)})\n`;
  out += `  按 y 值出现次数(y 升序 = 从最前到后):\n`;
  for (const [k, c] of [...yset.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
    out += `     y=${k}  顶点 ${c}\n`;
  }
}

// ---- B) 头部 z 各高度带上，"最靠前的那个顶点"在哪 ----
out += `\n=== B) 头部各高度带(z) -> 该带最靠前的顶点(prev最大)的 y 值 ===\n`;
const NB = 24;
const bands = Array.from({ length: NB }, () => ({ prev: -Infinity, v: -1 }));
for (let i = 0; i < V; i++) {
  const z = POS[i][2];
  if (z < ZBOT || z > ZTOP) continue;
  let b = Math.floor(((z - ZBOT) / H) * NB);
  if (b >= NB) b = NB - 1;
  const pv = -POS[i][1]; // 脸朝 -y，越大越靠前
  if (pv > bands[b].prev) { bands[b].prev = pv; bands[b].v = i; }
}
for (let b = 0; b < NB; b++) {
  const lo = ZBOT + (H * b) / NB, hi = ZBOT + (H * (b + 1)) / NB;
  const t = bands[b];
  if (t.v < 0) { out += `  ${pct(lo).padStart(6)}..${pct(hi).padStart(6)}  (无)\n`; continue; }
  out += `  ${pct(lo).padStart(6)}..${pct(hi).padStart(6)}  z ${lo.toFixed(6)}..${hi.toFixed(6)}  最前顶点 v${String(t.v).padStart(4)}  y ${POS[t.v][1].toFixed(6)}  x ${POS[t.v][0].toFixed(6)}\n`;
}

// ---- C) 眼睛浮雕质心的高度、以及眼睛所在的"面片"法线 ----
out += `\n=== C) 眼睛浮雕 y 范围 & 高度 ===\n`;
{
  const eye = [];
  for (let i = 0; i < V; i++) {
    const z = POS[i][2], y = POS[i][1];
    if (z >= 0.0208 && z <= 0.0223 && y > -0.005707 + 1e-6 && y < -0.0040 && Math.abs(POS[i][0]) >= 0.0017 && Math.abs(POS[i][0]) <= 0.0060) eye.push(i);
  }
  out += `  顶点 ${eye.length}\n`;
  const yy = new Map();
  for (const i of eye) { const k = POS[i][1].toFixed(5); yy.set(k, (yy.get(k) || 0) + 1); }
  for (const [k, c] of [...yy.entries()].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))) out += `     y=${k}  顶点 ${c}\n`;
}

// ---- D) ★ 关键：y 从最前到后，每一"层"的 z 分布（层=精确 y 值聚合）----
out += `\n=== D) 每个精确 y 值的顶点：x范围 / z范围 / 平均法线 ===\n`;
const layer = new Map();
for (let i = 0; i < V; i++) {
  const k = POS[i][1].toFixed(5);
  if (!layer.has(k)) layer.set(k, []);
  layer.get(k).push(i);
}
const keys = [...layer.keys()].sort((a, b) => parseFloat(a) - parseFloat(b));
for (const k of keys) {
  const vs = layer.get(k);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, ny = 0, nz = 0;
  for (const i of vs) {
    x0 = Math.min(x0, POS[i][0]); x1 = Math.max(x1, POS[i][0]);
    z0 = Math.min(z0, POS[i][2]); z1 = Math.max(z1, POS[i][2]);
    ny += NOR[i][1]; nz += NOR[i][2];
  }
  ny /= vs.length; nz /= vs.length;
  out += `  y=${k.padStart(9)}  v${String(vs.length).padStart(4)}  x ${x0.toFixed(6)}..${x1.toFixed(6)}  z ${z0.toFixed(6)}..${z1.toFixed(6)}  (${pct(z0)}..${pct(z1)})  nYavg ${ny.toFixed(2)} nZavg ${nz.toFixed(2)}\n`;
}

fs.writeFileSync(path.join(dir, '_probe20.txt'), out, 'utf8');
console.log('OK', out.length);
