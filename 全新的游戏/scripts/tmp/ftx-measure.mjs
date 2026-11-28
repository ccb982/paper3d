// 临时：量出底图内各元素精确边界（源像素坐标）
import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Users\\22641\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:5199';
const FILE = process.env.FTX_FILE || '/ui/获得物品.ftx3.gz';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false, defaultViewport: { width: 900, height: 500 },
});
const page = await browser.newPage();
await page.goto(`${BASE}/src/vendor/player/FtxAsset.ts`, { waitUntil: 'domcontentloaded' });
const out = await page.evaluate(async (url) => {
  const { FtxAsset } = await import('/src/vendor/player/FtxAsset.ts');
  const { compositeFrameToCanvas } = await import('/src/fx/tex/ftxComposite.ts');
  const a = await FtxAsset.load(encodeURI(url));
  const c = compositeFrameToCanvas(a, 0);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height;
  const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const bbox = (pred) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] > 8 && pred(x, y, i)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  // 1) 不透明整体
  const opaque = bbox(() => true);
  // 2) 高亮文字（亮度 > 200）
  const text = bbox((x, y, i) => lum(i) > 200);
  // 3) 金色装饰（R,G 明显高于 B，且不太亮/不太暗）
  const gold = bbox((x, y, i) => d[i] > 90 && d[i + 1] > 70 && d[i + 2] < d[i] * 0.6);
  // 4) 每列平均亮度（找金色条右边界 / 面板右边界）
  const colAvg = [];
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) s += lum((y * W + x) * 4);
    colAvg.push(+(s / H).toFixed(1));
  }
  const avgLum = colAvg.reduce((p, q) => p + q, 0) / W;
  return { W, H, opaque, text, gold, avgLum: +avgLum.toFixed(1), colAvg };
}, FILE);
console.log('尺寸', out.W, 'x', out.H);
console.log('不透明整体', out.opaque);
console.log('高亮文字', out.text, '→ 归一化 x', (out.text.x0 / out.W).toFixed(3), '~', (out.text.x1 / out.W).toFixed(3));
console.log('金色装饰', out.gold, '→ 归一化 x', (out.gold.x0 / out.W).toFixed(3), '~', (out.gold.x1 / out.W).toFixed(3));
console.log('整图平均亮度', out.avgLum);
console.log('每 10 列平均亮度:', out.colAvg.filter((_, i) => i % 10 === 0).join(' '));
await browser.close();
