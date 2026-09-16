// probe25: 精确检查「压平条件」对眼睛浮雕 / 各层的命中情况
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
const V = POS.length;
const ZTOP = 0.028388, ZBOT = 0.014933, H = ZTOP - ZBOT;
const pct = (z) => ((((z - ZBOT) / H) * 100).toFixed(1) + '%');

// ★ 还要看蒙皮属性，判断 headDom
const JNT = readAccessor(prim.attributes.JOINTS_0);
const WGT = readAccessor(prim.attributes.WEIGHTS_0);
// Head 关节索引 = 8（probe 实测）
const HEAD_J = 8;
const isHeadDom = (i) => {
  let bw = 0, bj = -1;
  for (let k = 0; k < 4; k++) {
    const w = WGT[i][k];
    if (w > bw) { bw = w; bj = JNT[i][k]; }
  }
  return bj === HEAD_J && bw > 0.5;
};

let out = '';
out += `=== 检查压平条件命中情况 ===\n`;
out += `压平条件： z ∈ [0.014933, 0.026036] ∧ proj=-y >= 0.0038 ∧ headDom(Head 权重>0.5)\n\n`;

const CNT = { all: 0, headDom: 0, inZ: 0, inProj: 0, hit: 0 };
const missByProj = [];
const missByZ = [];
const missByDom = [];
const hitList = [];
for (let i = 0; i < V; i++) {
  CNT.all++;
  const dom = isHeadDom(i);
  if (dom) CNT.headDom++;
  const z = POS[i][2], y = POS[i][1], proj = -y;
  const inZ = z >= 0.014933 && z <= 0.026036;
  const inP = proj >= 0.0038;
  if (inZ) CNT.inZ++;
  if (inZ && inP) CNT.inProj++;
  if (dom && inZ && inP) { CNT.hit++; hitList.push(i); }
  else {
    if (inZ && inP && !dom) missByDom.push(i);
    else if (dom && inZ && !inP) missByProj.push(i);
    else if (dom && !inZ && inP) missByZ.push(i);
  }
}
out += `总顶点 ${CNT.all}\n`;
out += `  headDom(Head 主导)   ${CNT.headDom}\n`;
out += `  z 在 [0.0149,0.0260] ${CNT.inZ}\n`;
out += `  z 且在 proj>=0.0038  ${CNT.inProj}\n`;
out += `  ★ 三条全满足(会压平) ${CNT.hit}\n`;
out += `  被 headDom 挡掉:     ${missByDom.length}\n`;
out += `  被 proj<0.0038 挡掉: ${missByProj.length}\n`;
out += `  被 z 范围挡掉:       ${missByZ.length}\n\n`;

// 眼睛浮雕顶点的检查
out += `=== 眼睛浮雕顶点逐个检查 ===\n`;
const eye = [];
for (let i = 0; i < V; i++) {
  const z = POS[i][2], y = POS[i][1];
  if (z >= 0.0208 && z <= 0.0223 && y > -0.005707 + 1e-6 && y < -0.0040 && Math.abs(POS[i][0]) >= 0.0017 && Math.abs(POS[i][0]) <= 0.0060) eye.push(i);
}
out += `眼睛浮雕候选 ${eye.length} 个顶点：\n`;
let eyeHit = 0, eyeDom0 = 0, eyeProjLow = 0;
for (const i of eye) {
  const dom = isHeadDom(i);
  const proj = -POS[i][1];
  const inP = proj >= 0.0038;
  if (dom && inP) eyeHit++;
  if (!dom) eyeDom0++;
  if (!inP) eyeProjLow++;
}
out += `  会压平: ${eyeHit} / ${eye.length}   (headDom 不满足 ${eyeDom0}, proj<0.0038 ${eyeProjLow})\n`;
out += `  眼睛顶点 proj 范围: ${Math.min(...eye.map(i => -POS[i][1])).toFixed(6)} .. ${Math.max(...eye.map(i => -POS[i][1])).toFixed(6)}\n`;
out += `  眼睛顶点 headDom 情况（前 20 个）：\n`;
for (const i of eye.slice(0, 20)) {
  let bw = 0, bj = -1;
  for (let k = 0; k < 4; k++) { const w = WGT[i][k]; if (w > bw) { bw = w; bj = JNT[i][k]; } }
  out += `    v${String(i).padStart(4)}  y ${POS[i][1].toFixed(6)} proj ${(-POS[i][1]).toFixed(6)}  z ${POS[i][2].toFixed(6)}  x ${POS[i][0].toFixed(6)}  主导jnt ${bj} w ${bw.toFixed(3)}\n`;
}

// ★ hitList 的实际范围（这就是被压平的"脸面"）
out += `\n=== 被压平的顶点集范围 (= 实际的"脸面") ===\n`;
{
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const i of hitList) {
    x0 = Math.min(x0, POS[i][0]); x1 = Math.max(x1, POS[i][0]);
    z0 = Math.min(z0, POS[i][2]); z1 = Math.max(z1, POS[i][2]);
    y0 = Math.min(y0, POS[i][1]); y1 = Math.max(y1, POS[i][1]);
  }
  out += `  x ${x0.toFixed(6)}..${x1.toFixed(6)} (宽 ${(x1 - x0).toFixed(6)})\n`;
  out += `  y ${y0.toFixed(6)}..${y1.toFixed(6)} (深 ${(y1 - y0).toFixed(6)})\n`;
  out += `  z ${z0.toFixed(6)}..${z1.toFixed(6)} (高 ${(z1 - z0).toFixed(6)}, ${pct(z0)}..${pct(z1)})\n`;
  out += `  宽高比 ${((x1 - x0) / (z1 - z0)).toFixed(4)}\n`;
}

// ★ 头正面的真实范围（不受 headDom 限制）
out += `\n=== 若不要求 headDom，只按 z∈[0.0149,0.0260] ∧ proj>=0.0038 ===\n`;
{
  const s = [];
  for (let i = 0; i < V; i++) {
    const z = POS[i][2], proj = -POS[i][1];
    if (z >= 0.014933 && z <= 0.026036 && proj >= 0.0038) s.push(i);
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const i of s) { x0 = Math.min(x0, POS[i][0]); x1 = Math.max(x1, POS[i][0]); z0 = Math.min(z0, POS[i][2]); z1 = Math.max(z1, POS[i][2]); }
  out += `  顶点 ${s.length}   x ${x0.toFixed(6)}..${x1.toFixed(6)} (宽 ${(x1 - x0).toFixed(6)})   z ${z0.toFixed(6)}..${z1.toFixed(6)} (高 ${(z1 - z0).toFixed(6)})\n`;
  out += `  宽高比 ${((x1 - x0) / (z1 - z0)).toFixed(4)}\n`;
}

fs.writeFileSync(path.join(dir, '_probe25.txt'), out, 'utf8');
console.log('OK', out.length);
