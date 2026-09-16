// probe24: 精确找"挡住脸的头发" —— 从脸正前方沿 -y 打射线，命中的头发面才算"垂在脸前"
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
// 脸区矩形（压平后要给立绘的区域）：x ±0.0070, z 0.0210..0.0260
const FX0 = -0.0070, FX1 = 0.0070, FZ0 = 0.0210, FZ1 = 0.0260;
out += `=== 脸区矩形 x [${FX0},${FX1}]  z [${FZ0},${FZ1}] (${pct(FZ0)}..${pct(FZ1)}) ===\n`;
out += `从脸正前方 (y = -1) 沿 +y 方向对各采样点打射线，第一个命中的三角形若属于"头发(z>=0.026)"则算遮挡。\n\n`;

// Möller–Trumbore
function rayTri(ox, oy, oz, dx, dy, dz, a, b, c) {
  const e1x = POS[b][0] - POS[a][0], e1y = POS[b][1] - POS[a][1], e1z = POS[b][2] - POS[a][2];
  const e2x = POS[c][0] - POS[a][0], e2y = POS[c][1] - POS[a][1], e2z = POS[c][2] - POS[a][2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tx = ox - POS[a][0], ty = oy - POS[a][1], tz = oz - POS[a][2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9 ? t : null;
}

const NX = 21, NZ = 21;
const hitMap = Array.from({ length: NZ }, () => Array.from({ length: NX }, () => '.'));
let hairBlock = 0, otherBlock = 0, noHit = 0;
const hairHitCount = new Map();
for (let jz = 0; jz < NZ; jz++) {
  for (let jx = 0; jx < NX; jx++) {
    const x = FX0 + (FX1 - FX0) * (jx + 0.5) / NX;
    const z = FZ0 + (FZ1 - FZ0) * (jz + 0.5) / NZ;
    let bestT = Infinity, bestTri = -1;
    for (let t = 0; t < IDX.length; t += 3) {
      const tt = rayTri(x, -1.0, z, 0, 1, 0, IDX[t], IDX[t + 1], IDX[t + 2]);
      if (tt !== null && tt < bestT) { bestT = tt; bestTri = t; }
    }
    if (bestTri < 0) { hitMap[jz][jx] = ' '; noHit++; continue; }
    const zs = [POS[IDX[bestTri]][2], POS[IDX[bestTri + 1]][2], POS[IDX[bestTri + 2]][2]];
    const zm = (zs[0] + zs[1] + zs[2]) / 3;
    const ym = (POS[IDX[bestTri]][1] + POS[IDX[bestTri + 1]][1] + POS[IDX[bestTri + 2]][1]) / 3;
    if (zm >= 0.0260) { hitMap[jz][jx] = '#'; hairBlock++; 
      const k = (Math.round(ym * 1000) / 1000).toFixed(3);
      hairHitCount.set(k, (hairHitCount.get(k) || 0) + 1);
    } else { hitMap[jz][jx] = 'o'; otherBlock++; }
  }
}
out += `# = 第一个命中是头发(z>=0.026)   o = 其他几何   空格 = 无命中\n`;
out += `脸区被打射线命中：头发 ${hairBlock} / 其他 ${otherBlock} / 未命中 ${noHit}  （共 ${NX * NZ} 点）\n\n`;
out += `      z-> `;
for (let jx = 0; jx < NX; jx++) out += ((FX0 + (FX1 - FX0) * (jx + 0.5) / NX) * 1000).toFixed(1).padStart(6);
out += `\n`;
for (let jz = NZ - 1; jz >= 0; jz--) {
  const z = FZ0 + (FZ1 - FZ0) * (jz + 0.5) / NZ;
  out += pct(z).padStart(6) + '   ' + hitMap[jz].map(c => c.padStart(5)).join('') + '\n';
}
out += `\n命中头发时该三角形的平均 y（越小=越靠前）：\n`;
for (const [k, n] of [...hairHitCount.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) out += `   y=${k}  ${n} 点\n`;

fs.writeFileSync(path.join(dir, '_probe24.txt'), out, 'utf8');
console.log('OK', out.length);
