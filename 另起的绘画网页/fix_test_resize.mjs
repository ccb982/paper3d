import { forcedFixBrush, rgbToHsl, hslToRgb } from './_fix_bundle.cjs';

// 模拟：原图 64x64 → 缩放 32x32 → 强制修正
const TEX0 = 64;
const bbox0 = { x: 10, y: 10, w: 44, h: 44 };

// 原图：彩色渐变
const bg0 = new Uint8ClampedArray(TEX0 * TEX0 * 4);
for (let y = 0; y < TEX0; y++) for (let x = 0; x < TEX0; x++) {
  const i = (y*TEX0+x)*4;
  if (x >= 10 && x < 54 && y >= 10 && y < 54) {
    const lx = x-10, ly = y-10;
    bg0[i]=80+lx*4; bg0[i+1]=60+ly*4; bg0[i+2]=140+lx+ly; bg0[i+3]=255;
  } else { bg0[i]=bg0[i+1]=bg0[i+2]=0; bg0[i+3]=0; }
}

// ========== 模拟提取（简化：区域按 x 分 4 个，base 是区域平均色） ==========
const w0 = bbox0.w, h0 = bbox0.h;
const regionIdTex0 = new Uint8Array(w0 * h0);
const baseColors0 = [];
for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
  const i = y*w0+x;
  regionIdTex0[i] = Math.floor(x / 11) + 1;
}
for (let id = 1; id <= 4; id++) {
  // 区域平均色
  let rs=0,gs=0,bs=0,n=0;
  for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
    if (regionIdTex0[y*w0+x] === id) {
      const gx=bbox0.x+x, gy=bbox0.y+y;
      const pi=(gy*TEX0+gx)*4;
      rs+=bg0[pi]; gs+=bg0[pi+1]; bs+=bg0[pi+2]; n++;
    }
  }
  const hsl = rgbToHsl(Math.round(rs/n), Math.round(gs/n), Math.round(bs/n));
  baseColors0.push({ id, h: hsl.h, s: hsl.s, l: hsl.l });
}
const deltaPacked0 = new Uint16Array(w0*h0);
for (let i = 0; i < w0*h0; i++) deltaPacked0[i] = ((16&0x1F)<<11)|((32&0x3F)<<5)|(16&0x1F);

// ========== 模拟缩放：64→32 ==========
const TEX1 = 32;
const fScale = TEX1 / TEX0; // 0.5
// 缩放 bg
const bg1 = new Uint8ClampedArray(TEX1*TEX1*4);
for (let y = 0; y < TEX1; y++) for (let x = 0; x < TEX1; x++) {
  const sy = Math.min(TEX0-1, Math.floor(y / fScale));
  const sx = Math.min(TEX0-1, Math.floor(x / fScale));
  const si = (sy*TEX0+sx)*4, di = (y*TEX1+x)*4;
  bg1[di]=bg0[si]; bg1[di+1]=bg0[si+1]; bg1[di+2]=bg0[si+2]; bg1[di+3]=bg0[si+3];
}
// 缩放 bbox
const bbox1 = {
  x: Math.round(bbox0.x * fScale), y: Math.round(bbox0.y * fScale),
  w: Math.round(bbox0.w * fScale), h: Math.round(bbox0.h * fScale),
};
// 缩放 regionIdTex / deltaPacked（最近邻）
const w1 = bbox1.w, h1 = bbox1.h;
const regionIdTex1 = new Uint8Array(w1*h1);
const deltaPacked1 = new Uint16Array(w1*h1);
for (let ny = 0; ny < h1; ny++) for (let nx = 0; nx < w1; nx++) {
  const opy = Math.min(h0-1, Math.floor(ny/fScale));
  const opx = Math.min(w0-1, Math.floor(nx/fScale));
  const oi = opy*w0+opx, ni = ny*w1+nx;
  regionIdTex1[ni] = regionIdTex0[oi];
  deltaPacked1[ni] = deltaPacked0[oi];
}
// baseColors 不变（HSL 不需要缩放）
const baseColors1 = baseColors0.map(c => ({...c}));

// ========== 缩放后强制修正 ==========
const brushCx = Math.floor(w1/2), brushCy = Math.floor(h1/2);
const paintBuffer1 = { data: bg1, width: TEX1 };
const result = forcedFixBrush(regionIdTex1, baseColors1, deltaPacked1, 0n, bbox1, paintBuffer1, TEX1, brushCx, brushCy, 8);

// ========== 验证：修正后笔刷范围合成色 vs target ==========
const colorMap = new Map(baseColors1.map(c=>[c.id,c]));
let bad=0, missing=0, total=0, black=0, trueNoise=0;
const x0 = Math.max(0, brushCx-3), x1 = Math.min(w1-1, x0+7);
const y0 = Math.max(0, brushCy-3), y1 = Math.min(h1-1, y0+7);
for (let py=y0; py<=y1; py++) for (let px=x0; px<=x1; px++) {
  const idx=py*w1+px;
  const cIdx=regionIdTex1[idx];
  if (cIdx===0) continue;
  const base=colorMap.get(cIdx);
  if (!base) { missing++; continue; }
  const gx=bbox1.x+px, gy=bbox1.y+py;
  const pi=(gy*TEX1+gx)*4;
  if (bg1[pi+3]<128) continue;
  const targetRgb=[bg1[pi],bg1[pi+1],bg1[pi+2]];
  const target=rgbToHsl(...targetRgb);
  const packed=deltaPacked1[idx];
  const s=(packed>>11)&0x1F, qh=(packed>>5)&0x3F, ql=packed&0x1F;
  const range=0.5;
  const dH=((qh/63)*1)-0.5, dS=((s/31)*1)-0.5, dL=((ql/31)*1)-0.5;
  const fH=(base.h+dH+1)%1, fS=Math.max(0,Math.min(1,base.s+dS)), fL=Math.max(0,Math.min(1,base.l+dL));
  const rgb=hslToRgb(fH,fS,fL);
  const targetDark = targetRgb[0]<30&&targetRgb[1]<30&&targetRgb[2]<30;
  if (rgb.r<30&&rgb.g<30&&rgb.b<30) { black++; if(!targetDark) trueNoise++; }
  let eH=Math.abs(fH-target.h); if(eH>0.5)eH=1-eH;
  const eS=Math.abs(fS-target.s), eL=Math.abs(fL-target.l);
  if(eH>0.02||eS>0.02||eL>0.02) bad++;
  total++;
}
console.log('缩放后强制修正：像素', total, '不达标', bad, '缺失', missing, '合成黑', black, '真噪点', trueNoise);
console.log(bad===0&&missing===0&&trueNoise===0 ? '✅ 缩放后正常' : '❌ 缩放后有问题');
