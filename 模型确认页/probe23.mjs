// probe23: 模拟最终方案 —— 压平前脸片 + 删前刘海，检查是否有洞/破面
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

let out = '';
// 方案参数
const FACE_Z0 = 0.0210;   // 前脸片下界（眼睛下沿）
const FACE_Z1 = 0.026036; // 前脸片上界（发际线）
const FRONT_Y = -0.0038;  // 前脸区的 y 上界（y 越小越靠前）
const HAIR_Z = 0.0260;    // 头发下界

// 模拟：删掉哪些面
let delHairFront = 0, delHairBack = 0, delEye = 0;
const kept = [];
for (let t = 0; t < IDX.length; t += 3) {
  const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
  const vs = [a, b, c];
  const zs = vs.map((v) => POS[v][2]);
  const ys = vs.map((v) => POS[v][1]);
  const zm = (zs[0] + zs[1] + zs[2]) / 3;
  const ym = (ys[0] + ys[1] + ys[2]) / 3;
  // 头发前半（靠近脸）
  if (zm >= HAIR_Z && ym < 0) { delHairFront++; continue; }
  if (zm >= HAIR_Z && ym >= 0) { delHairBack++; kept.push(t); continue; }
  kept.push(t);
}
out += `=== 模拟删除 ===\n`;
out += `  删前刘海(头发 z>=${HAIR_Z} 且 y<0):  ${delHairFront} 面\n`;
out += `  保留后脑头发(z>=${HAIR_Z} 且 y>=0): ${delHairBack} 面\n`;
out += `  原总面数 ${IDX.length / 3}  保留 ${kept.length}  删除 ${delHairFront}\n`;

// 检查：删掉前刘海后，发际线处是否留下"悬空边"（该边只有一个相邻面 = 洞的边界）
const edgeCount = new Map();
const ekey = (i, j) => (i < j ? i + ':' + j : j + ':' + i);
for (const t of kept) {
  const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
  for (const [i, j] of [[a, b], [b, c], [c, a]]) {
    const k = ekey(i, j);
    edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
  }
}
let boundary = 0;
const boundaryEdges = [];
for (const [k, n] of edgeCount) if (n === 1) {
  boundary++;
  const [i, j] = k.split(':').map(Number);
  boundaryEdges.push({ i, j, z: (POS[i][2] + POS[j][2]) / 2, y: (POS[i][1] + POS[j][1]) / 2 });
}
out += `\n  删后边界边(单面边)总数: ${boundary}\n`;
// 按 z 分布看边界边在哪
const bz = new Map();
for (const e of boundaryEdges) { const k = (Math.round(e.z * 2000) / 2000).toFixed(4); bz.set(k, (bz.get(k) || 0) + 1); }
out += `  边界边 z 分布（top15）：\n`;
for (const [k, n] of [...bz.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  out += `     z=${k} (${pct(parseFloat(k))})  ${n} 条\n`;
}

// ---- 压平模拟：把前脸片顶点压到 y = -0.0058 ----
out += `\n=== 压平模拟：前脸片顶点 (y<=${FRONT_Y} 且 z∈[${FACE_Z0},${FACE_Z1}]) ===\n`;
const faceV = [];
for (let i = 0; i < V; i++) {
  const y = POS[i][1], z = POS[i][2];
  if (y <= FRONT_Y && z >= FACE_Z0 && z <= FACE_Z1) faceV.push(i);
}
out += `  压平顶点数 ${faceV.length}\n`;
{
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const i of faceV) {
    x0 = Math.min(x0, POS[i][0]); x1 = Math.max(x1, POS[i][0]);
    z0 = Math.min(z0, POS[i][2]); z1 = Math.max(z1, POS[i][2]);
    y0 = Math.min(y0, POS[i][1]); y1 = Math.max(y1, POS[i][1]);
  }
  out += `  x ${x0.toFixed(6)}..${x1.toFixed(6)} (宽 ${(x1 - x0).toFixed(6)})\n`;
  out += `  y ${y0.toFixed(6)}..${y1.toFixed(6)} (深 ${(y1 - y0).toFixed(6)})\n`;
  out += `  z ${z0.toFixed(6)}..${z1.toFixed(6)} (高 ${(z1 - z0).toFixed(6)}, ${pct(z0)}..${pct(z1)})\n`;
  out += `  → 压平后这些顶点全在 y=-0.0058 平面上\n`;
  out += `  → 脸区宽高比 = ${((x1 - x0) / (z1 - z0)).toFixed(4)}  (立绘应取同比例才不变形)\n`;
}
// 压平后，原本属于"耳朵"的顶点会不会被误压？看 |x| 大的
out += `\n  前脸片顶点的 |x| 分布：\n`;
{
  const bx = new Map();
  for (const i of faceV) { const ax = Math.abs(POS[i][0]); const k = (Math.round(ax * 1000) / 1000).toFixed(3); bx.set(k, (bx.get(k) || 0) + 1); }
  for (const [k, n] of [...bx.entries()].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))) out += `     |x|=${k}  ${n} 个\n`;
}

fs.writeFileSync(path.join(dir, '_probe23.txt'), out, 'utf8');
console.log('OK', out.length);
