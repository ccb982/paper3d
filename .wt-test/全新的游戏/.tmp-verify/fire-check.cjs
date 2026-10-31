const { createFireballAsset } = require('./build/services/fx/SolidBulletAsset.js');
const asset = createFireballAsset();
const img = asset.getFramePair(0).base.image;
const { data, width: w, height: h } = img;
console.log('texture', w, 'x', h, 'world =', 0.8, 'x', (0.8 * h / w).toFixed(2), 'm');
const chars = [' ', '.', ':', '*', '#', '@'];
for (let y = 0; y < h; y += 2) {
  let line = '';
  let maxR = 0;
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 0.5) { line += ' '; continue; }
    const l = data[i + 2];
    line += chars[Math.min(5, Math.max(1, Math.round(l * 5)))];
  }
  // 该行填充宽度 → 看"火舌"起伏
  let n = 0; for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] >= 0.5) n++;
  maxR = n;
  console.log(String(y).padStart(3, '0') + '|' + line + '| ' + maxR);
}
// 极坐标半径起伏：验证"火舌"（非正圆）
let minR = 99, maxR2 = 0;
for (let a = 0; a < 64; a++) {
  const th = a / 64 * Math.PI * 2;
  let rr = 0;
  for (let t = 0; t < 1; t += 0.002) {
    const x = Math.round(32 + Math.cos(th) * t * 32);
    const y = Math.round(32 + Math.sin(th) * t * 32);
    if (x < 0 || y < 0 || x >= w || y >= h) break;
    if (data[(y * w + x) * 4 + 3] >= 0.5) rr = t;
  }
  minR = Math.min(minR, rr); maxR2 = Math.max(maxR2, rr);
}
console.log('radius min/max =', minR.toFixed(3), maxR2.toFixed(3), '→ 起伏', ((maxR2 / minR - 1) * 100).toFixed(1) + '%');
