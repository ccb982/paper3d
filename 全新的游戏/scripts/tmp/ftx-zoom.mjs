// 临时：3× 放大截图 /ui/获得物品.ftx3.gz，带坐标尺，便于对齐槽位
import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Users\\22641\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:5199';
const FILE = process.env.FTX_FILE || '/ui/获得物品.ftx3.gz';
const ZOOM = Number(process.env.ZOOM || 3);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false,
  defaultViewport: { width: 1400, height: 600 }, args: ['--window-size=1440,640'],
});
const page = await browser.newPage();
await page.goto(`${BASE}/src/vendor/player/FtxAsset.ts`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async ({ url, zoom }) => {
  const { FtxAsset } = await import('/src/vendor/player/FtxAsset.ts');
  const { compositeFrameToCanvas } = await import('/src/fx/tex/ftxComposite.ts');
  const asset = await FtxAsset.load(encodeURI(url));
  const c = compositeFrameToCanvas(asset, 0);
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#606060';
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:relative;width:${c.width * zoom}px;height:${c.height * zoom}px;`;
  c.style.cssText = `width:${c.width * zoom}px;height:${c.height * zoom}px;image-rendering:pixelated;display:block;`;
  wrap.appendChild(c);
  // 每 20 源像素画一条刻度（10px 细线 / 100px 粗线）
  for (let x = 0; x <= c.width; x += 20) {
    const line = document.createElement('div');
    line.style.cssText = `position:absolute;left:${x * zoom}px;top:0;width:1px;height:100%;background:${x % 100 === 0 ? 'rgba(0,255,255,.9)' : 'rgba(0,255,255,.35)'};`;
    wrap.appendChild(line);
  }
  for (let y = 0; y <= c.height; y += 20) {
    const line = document.createElement('div');
    line.style.cssText = `position:absolute;left:0;top:${y * zoom}px;width:100%;height:1px;background:${y % 100 === 0 ? 'rgba(0,255,255,.9)' : 'rgba(0,255,255,.35)'};`;
    wrap.appendChild(line);
  }
  document.body.appendChild(wrap);
  window.__size = { w: c.width, h: c.height };
}, { url: FILE, zoom: ZOOM });
const size = await page.evaluate(() => window.__size);
console.log('帧尺寸', size);
await page.screenshot({ path: 'scripts/tmp/ftx-zoom.png', clip: { x: 0, y: 0, width: size.w * ZOOM + 2, height: size.h * ZOOM + 2 } });
await browser.close();
