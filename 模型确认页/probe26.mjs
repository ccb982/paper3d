// probe26: 验证 UV 映射方向 —— 用实际 flattenFacePlate 算出的 UV，反推它在 canvas 上的像素位置
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
// 贴图信息
out0();
function out0() {
  const prim = json.meshes[0].primitives[0];
  const POS = readAccessor(prim.attributes.POSITION);
  const UV = readAccessor(prim.attributes.TEXCOORD_0);
  const V = POS.length;
  const ZBOT = 0.014933, ZTOP = 0.028388, H = ZTOP - ZBOT;
  const pct = (z) => ((((z - ZBOT) / H) * 100).toFixed(1) + '%');

  // 复现 flattenFacePlate 的选点
  const pz0 = 0.014933, pz1 = 0.026036, projMin = 0.0038;
  const plate = [];
  for (let i = 0; i < V; i++) {
    const z = POS[i][2], proj = -POS[i][1];
    if (z < pz0 || z > pz1) continue;
    if (proj < projMin) continue;
    plate.push(i);
  }
  let l0 = Infinity, l1 = -Infinity, u0 = Infinity, u1 = -Infinity;
  for (const i of plate) { l0 = Math.min(l0, POS[i][0]); l1 = Math.max(l1, POS[i][0]); u0 = Math.min(u0, POS[i][2]); u1 = Math.max(u1, POS[i][2]); }
  const lw = l1 - l0, uh = u1 - u0;
  // 立绘区
  const FR = { u0: 0, u1: 0.4434, v0: 0.62, v1: 1 };
  const PAD = 0.5 / 32;
  const pu = FR.u0 + PAD, pu1 = FR.u1 - PAD, pv = FR.v0 + PAD, pv1 = FR.v1 - PAD;
  const faceRatio = lw / uh, regRatio = (pu1-pu)/(pv1-pv);
  const uu0 = pu, uu1 = pu1, vv0 = pv, vv1 = pv1;

  let out = '';
  out += `=== UV 映射参数 ===\n`;
  out += `脸面 l0..l1 = ${l0.toFixed(6)}..${l1.toFixed(6)}  宽 ${lw.toFixed(6)}\n`;
  out += `脸面 u0..u1 = ${u0.toFixed(6)}..${u1.toFixed(6)}  高 ${uh.toFixed(6)}\n`;
  out += `脸宽高比 faceRatio = ${faceRatio.toFixed(4)}   立绘区宽高比 regRatio = ${regRatio.toFixed(4)}\n`;
  out += `走的分支: ${faceRatio >= regRatio ? '脸更宽→横铺+纵裁' : '脸更竖→纵铺+横裁'}\n`;
  out += `最终 uu ${uu0.toFixed(4)}..${uu1.toFixed(4)}   vv ${vv0.toFixed(4)}..${vv1.toFixed(4)}\n\n`;

  out += `=== 各顶点映射结果（抽 12 个：z 从低到高）===\n`;
  const sorted = [...plate].sort((a, b) => POS[a][2] - POS[b][2]);
  const step = Math.max(1, Math.floor(sorted.length / 12));
  for (let k = 0; k < sorted.length; k += step) {
    const i = sorted[k];
    const tl = (POS[i][0] - l0) / lw, tu = (POS[i][2] - u0) / uh;
    const uu = uu0 + tl * (uu1 - uu0), vv = vv0 + (1 - tu) * (vv1 - vv0);
    // 反推 canvas 像素（flipY=false → 像素 y = v * S）
    const S = 512;
    out += `  v${String(i).padStart(4)}  x ${POS[i][0].toFixed(5)} z ${POS[i][2].toFixed(6)} (${pct(POS[i][2])})  tl ${tl.toFixed(3)} tu ${tu.toFixed(3)}  ->  uv (${uu.toFixed(4)}, ${vv.toFixed(4)})  px (${(uu * S).toFixed(1)}, ${(vv * S).toFixed(1)})\n`;
  }
  out += `\n★ 立绘在 canvas 上的实际矩形: x 0..${(6 / 32 * 512).toFixed(0)}  y ${(23 / 32 * 512).toFixed(0)}..512\n`;
  out += `★ 映射用到的子矩形:      x ${(uu0 * 512).toFixed(1)}..${(uu1 * 512).toFixed(1)}  y ${(vv0 * 512).toFixed(1)}..${(vv1 * 512).toFixed(1)}\n`;
  out += `\n★ 检查：tu 大（z 高=额头）→ vv 小（图顶）。而立绘画在 canvas 的 y=${(23 / 32 * 512).toFixed(0)}..512（图右下）。\n`;
  out += `   → 额头会映射到立绘的**顶部**吗？取决于立绘区在 v 上的布局。\n`;
  out += `   立绘区 v0=23/32=${(23 / 32).toFixed(4)} v1=1 → canvas y ${(23 / 32 * 512).toFixed(0)}..512\n`;
  out += `   映射子矩形 y ${(vv0 * 512).toFixed(1)}..${(vv1 * 512).toFixed(1)} ← 这段在立绘内\n`;

  fs.writeFileSync(path.join(dir, '_probe26.txt'), out, 'utf8');
  console.log('OK', out.length);
}
