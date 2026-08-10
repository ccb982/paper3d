// 纯逻辑复现：forcedFixBrush 的量化合并是否产生黑灰
// 用真实量化函数（从 ftxCore 复制）
const q = (d, r, levels) => Math.round(((Math.max(-r, Math.min(r, d)) + r) / (2 * r)) * levels);
const dq = (e, r, levels) => ((e / levels) * 2 * r) - r;
const quantizeH = (d, r) => q(d, r, 63);
const quantizeS = (d, r) => q(d, r, 31);
const quantizeL = (d, r) => q(d, r, 31);
const dequantizeH = (e, r) => dq(e, r, 63);
const dequantizeS = (e, r) => dq(e, r, 31);
const dequantizeL = (e, r) => dq(e, r, 31);

// 模拟：一个像素 target=S=0.5,L=0.5, 邻居 base=同色但 S=0.6
// 验证 tryFixWithBase 逻辑：能否合并？合并后合成色？
function tryFix(target, base, range) {
  const dH = 0; // 简化 H
  const dS = target.s - base.s;
  const dL = target.l - base.l;
  const qS_v = quantizeS(dS, range);
  const backS = dequantizeS(qS_v, range);
  const errS = Math.abs((base.s + backS) - target.s);
  return { dS, backS, errS, qS_v };
}
// 各种 target/base 组合
const combos = [
  { t: {s:0.5,l:0.5}, b: {s:0.5,l:0.5}, r: 0.25 },
  { t: {s:0.5,l:0.5}, b: {s:0.6,l:0.5}, r: 0.25 },
  { t: {s:0.5,l:0.5}, b: {s:0.55,l:0.55}, r: 0.25 },
  { t: {s:0.3,l:0.3}, b: {s:0.5,l:0.5}, r: 0.25 },
  { t: {s:0.3,l:0.3}, b: {s:0.5,l:0.5}, r: 0.5 },
];
for (const c of combos) {
  const r = tryFix(c.t, c.b, c.r);
  console.log(`target(S${c.t.s},L${c.t.l}) base(S${c.b.s},L${c.b.l}) r=${c.r}: dS=${r.dS.toFixed(3)} qS=${r.qS_v} backS=${r.backS.toFixed(4)} errS=${r.errS.toFixed(4)} ${r.errS <= 0.02 ? '达标' : '不达标'}`);
}
