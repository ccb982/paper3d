// probe18: 判定「最靠前层」是"一整片脸"还是"脸 + 额头/前发盖"两块
// 手法：把最靠前层的三角形按「共享边」做连通块拆分，再看每块的 z 范围 / x 范围
import fs from 'node:fs';
import path from 'node:path';

const dir = 'C:/Users/22641/Desktop/架构重置/模型确认页';
const glb = fs.readFileSync(path.join(dir, 'candidate_cubeguy.glb'));

// ---- GLB 解析 ----
let off = 12;
let json = null, bin = null;
while (off < glb.length) {
  const len = glb.readUInt32LE(off);
  const type = glb.readUInt32LE(off + 4);
  const data = glb.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(i) {
  const a = json.accessors[i];
  const [Arr, size] = COMP[a.componentType];
  const n = NUM[a.type];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || size * n;
  const out = [];
  for (let k = 0; k < a.count; k++) {
    const rec = [];
    for (let c = 0; c < n; c++) {
      const o = base + k * stride + c * size;
      let v;
      switch (a.componentType) {
        case 5126: v = bin.readFloatLE(o); break;
        case 5125: v = bin.readUInt32LE(o); break;
        case 5123: v = bin.readUInt16LE(o); break;
        case 5122: v = bin.readInt16LE(o); break;
        case 5121: v = bin.readUInt8(o); break;
        case 5120: v = bin.readInt8(o); break;
      }
      rec.push(v);
    }
    out.push(n === 1 ? rec[0] : rec);
  }
  return out;
}

const mesh = json.meshes[0];
const prim = mesh.primitives[0];
const POS = readAccessor(prim.attributes.POSITION);
const NOR = readAccessor(prim.attributes.NORMAL);
const UV = readAccessor(prim.attributes.TEXCOORD_0);
const IDX = readAccessor(prim.indices);

// scale 100 的节点 → 回到"本文坐标"（原始值）
const fSign = -1; // 脸朝 -y
const prev = (f) => f * fSign; // 越大越靠前

const V = POS.length;

// ---- 1) 找最靠前层 ----
let projMax = -Infinity;
for (let i = 0; i < V; i++) projMax = Math.max(projMax, prev(POS[i][1]));
const LAYER_EPS = 1e-5;
const faceSet = new Set();
for (let i = 0; i < V; i++) if (prev(POS[i][1]) >= projMax - LAYER_EPS) faceSet.add(i);

// ---- 2) 取"两端点都在 faceSet"的三角形 ----
const tris = [];
for (let t = 0; t < IDX.length; t += 3) {
  const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
  if (faceSet.has(a) && faceSet.has(b) && faceSet.has(c)) tris.push([a, b, c]);
}

// ---- 3) 按共享边做连通块 ----
const edgeMap = new Map();
const key = (i, j) => (i < j ? i + ':' + j : j + ':' + i);
for (let ti = 0; ti < tris.length; ti++) {
  const [a, b, c] = tris[ti];
  for (const [i, j] of [[a, b], [b, c], [c, a]]) {
    const k = key(i, j);
    if (!edgeMap.has(k)) edgeMap.set(k, []);
    edgeMap.get(k).push(ti);
  }
}
// union-find over triangles
const par = tris.map((_, i) => i);
const find = (x) => (par[x] === x ? x : (par[x] = find(par[x])));
const uni = (x, y) => { x = find(x); y = find(y); if (x !== y) par[x] = y; };
for (const [, list] of edgeMap) for (let k = 1; k < list.length; k++) uni(list[0], list[k]);

const groups = new Map();
for (let ti = 0; ti < tris.length; ti++) {
  const r = find(ti);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(ti);
}

let out = '';
out += `最靠前层(prev 最大) projMax=${projMax.toFixed(6)}  顶点 ${faceSet.size}  三角 ${tris.length}\n`;
out += `连通块数: ${groups.size}\n\n`;

const stats = [];
for (const [r, list] of groups) {
  const vs = new Set();
  for (const ti of list) for (const v of tris[ti]) vs.add(v);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  let nx = 0, ny = 0, nz = 0;
  for (const v of vs) {
    x0 = Math.min(x0, POS[v][0]); x1 = Math.max(x1, POS[v][0]);
    y0 = Math.min(y0, POS[v][1]); y1 = Math.max(y1, POS[v][1]);
    z0 = Math.min(z0, POS[v][2]); z1 = Math.max(z1, POS[v][2]);
    nx += NOR[v][0]; ny += NOR[v][1]; nz += NOR[v][2];
  }
  const inv = 1 / (vs.size || 1);
  stats.push({ tris: list.length, verts: vs.size, x0, x1, z0, z1, y0, y1, nx: nx * inv, ny: ny * inv, nz: nz * inv, vs, list });
}
stats.sort((a, b) => b.tris - a.tris);
const ZTOP = 0.028388, ZBOT = 0.014933, H = ZTOP - ZBOT;
for (let i = 0; i < stats.length; i++) {
  const s = stats[i];
  const pct = (z) => ((((z - ZBOT) / H) * 100).toFixed(1) + '%').padStart(6);
  out += `块#${i}  三角 ${String(s.tris).padStart(4)}  顶点 ${String(s.verts).padStart(3)}\n`;
  out += `     x ${s.x0.toFixed(6)}..${s.x1.toFixed(6)}  (宽 ${(s.x1 - s.x0).toFixed(6)})\n`;
  out += `     y ${s.y0.toFixed(6)}..${s.y1.toFixed(6)}\n`;
  out += `     z ${s.z0.toFixed(6)}..${s.z1.toFixed(6)}   头高占比 ${pct(s.z0)} .. ${pct(s.z1)}\n`;
  out += `     平均法线 (${s.nx.toFixed(3)}, ${s.ny.toFixed(3)}, ${s.nz.toFixed(3)})\n`;
  out += `     顶点列表(z 升序):\n`;
  const arr = [...s.vs].sort((a, b) => POS[a][2] - POS[b][2]);
  for (const v of arr) {
    out += `        v${String(v).padStart(4)}  x ${POS[v][0].toFixed(6).padStart(10)}  z ${POS[v][2].toFixed(6)}  ${pct(POS[v][2])}  uv(${UV[v][0].toFixed(4)},${UV[v][1].toFixed(4)})\n`;
  }
  out += '\n';
}

// ---- 4) 这层顶点的"邻接顶点"里，有多少不在本层（即是否连到更后面的几何）----
out += `=== 最靠前层顶点的"外连"情况（该顶点所属三角形里，别的顶点不在本层）===\n`;
const vTris = new Map();
for (let t = 0; t < IDX.length; t += 3) {
  for (const v of [IDX[t], IDX[t + 1], IDX[t + 2]]) {
    if (!vTris.has(v)) vTris.set(v, []);
    vTris.get(v).push(t);
  }
}
let extCount = 0;
for (const v of faceSet) {
  const ts = vTris.get(v) || [];
  let hasExt = false;
  for (const t of ts) {
    for (const w of [IDX[t], IDX[t + 1], IDX[t + 2]]) if (!faceSet.has(w)) hasExt = true;
  }
  if (hasExt) extCount++;
}
out += `层内有"外连"的顶点数: ${extCount} / ${faceSet.size}\n`;

fs.writeFileSync(path.join(dir, '_probe18.txt'), out, 'utf8');
console.log('OK', out.length);
