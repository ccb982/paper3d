// probe22: 头发( z >= 0.0260 ) 按前后(y)分层 —— 找"靠近脸的前刘海"与"后面头发"的分界
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
// 头发判据 z >= 0.0260（含发际线）
const HAIR_Z = 0.0260;
const hairV = [];
for (let i = 0; i < V; i++) if (POS[i][2] >= HAIR_Z) hairV.push(i);
out += `=== 头发区 (z >= ${HAIR_Z}) 共 ${hairV.length} 个顶点 ===\n`;
out += `按 y 值（前后）分组统计：\n`;
out += `   y值       顶点数   x范围                 z范围\n`;
const byY = new Map();
for (const i of hairV) { const k = POS[i][1].toFixed(5); if (!byY.has(k)) byY.set(k, []); byY.get(k).push(i); }
for (const k of [...byY.keys()].sort((a, b) => parseFloat(a) - parseFloat(b))) {
  const vs = byY.get(k);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const i of vs) { x0 = Math.min(x0, POS[i][0]); x1 = Math.max(x1, POS[i][0]); z0 = Math.min(z0, POS[i][2]); z1 = Math.max(z1, POS[i][2]); }
  out += `  ${k.padStart(9)}  ${String(vs.length).padStart(5)}   ${x0.toFixed(6)}..${x1.toFixed(6)}   ${z0.toFixed(6)}..${z1.toFixed(6)} (${pct(z0)}..${pct(z1)})\n`;
}

// 头发区的连通块
out += `\n=== 头发区连通块（三角形按共享边）===\n`;
const hairSet = new Set(hairV);
const tris = [];
for (let t = 0; t < IDX.length; t += 3) {
  const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
  if (hairSet.has(a) && hairSet.has(b) && hairSet.has(c)) tris.push([a, b, c]);
}
const em = new Map(); const key = (i, j) => (i < j ? i + ':' + j : j + ':' + i);
for (let ti = 0; ti < tris.length; ti++) {
  const [a, b, c] = tris[ti];
  for (const [i, j] of [[a, b], [b, c], [c, a]]) { const k = key(i, j); if (!em.has(k)) em.set(k, []); em.get(k).push(ti); }
}
const par = tris.map((_, i) => i);
const find = (x) => (par[x] === x ? x : (par[x] = find(par[x])));
for (const [, l] of em) for (let k = 1; k < l.length; k++) { const a = find(l[0]), b = find(l[k]); if (a !== b) par[a] = b; }
const grp = new Map();
for (let ti = 0; ti < tris.length; ti++) { const r = find(ti); if (!grp.has(r)) grp.set(r, []); grp.get(r).push(ti); }
const gs = [];
for (const [, l] of grp) {
  const vs = new Set(); for (const ti of l) for (const v of tris[ti]) vs.add(v);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of vs) { x0 = Math.min(x0, POS[v][0]); x1 = Math.max(x1, POS[v][0]); z0 = Math.min(z0, POS[v][2]); z1 = Math.max(z1, POS[v][2]); y0 = Math.min(y0, POS[v][1]); y1 = Math.max(y1, POS[v][1]); }
  gs.push({ n: l.length, vn: vs.size, x0, x1, z0, z1, y0, y1 });
}
gs.sort((a, b) => b.n - a.n);
for (let i = 0; i < gs.length; i++) {
  const g = gs[i];
  out += `  块#${i}  面 ${String(g.n).padStart(4)}  顶点 ${String(g.vn).padStart(3)}   x ${g.x0.toFixed(6)}..${g.x1.toFixed(6)}   y ${g.y0.toFixed(6)}..${g.y1.toFixed(6)}   z ${g.z0.toFixed(6)}..${g.z1.toFixed(6)} (${pct(g.z0)}..${pct(g.z1)})\n`;
}

// ★ 关键：z 在 [0.0260, 0.0266] 这一带（发际线正上方）的顶点 —— 这就是"靠近脸的头发"
out += `\n=== 发际线那一带 z 0.0260..0.0266 的顶点（= 靠近脸的头发）===\n`;
{
  const band = [];
  for (let i = 0; i < V; i++) if (POS[i][2] >= 0.0260 && POS[i][2] <= 0.0266) band.push(i);
  out += `  顶点 ${band.length}\n`;
  band.sort((a, b) => POS[a][1] - POS[b][1]);
  for (const i of band) out += `    v${String(i).padStart(4)}  x ${POS[i][0].toFixed(6).padStart(10)}  y ${POS[i][1].toFixed(6)}  z ${POS[i][2].toFixed(6)}\n`;
}

fs.writeFileSync(path.join(dir, '_probe22.txt'), out, 'utf8');
console.log('OK', out.length);
