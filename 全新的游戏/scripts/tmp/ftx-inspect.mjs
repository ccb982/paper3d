// 临时：检查 /ui/获得物品.ftx3.gz 的帧数/帧名/尺寸，并把各帧拼成一张 contact sheet 截图
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH
  || 'C:\\Users\\22641\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:5199';
const FILE = process.env.FTX_FILE || '/ui/获得物品.ftx3.gz';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: 1600, height: 1000 },
  args: ['--window-size=1600,1040'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}/src/vendor/player/FtxAsset.ts`, { waitUntil: 'domcontentloaded' });

const info = await page.evaluate(async (url) => {
  const { FtxAsset } = await import('/src/vendor/player/FtxAsset.ts');
  const { compositeFrameToCanvas } = await import('/src/fx/tex/ftxComposite.ts');
  const asset = await FtxAsset.load(encodeURI(url));
  const frames = [];
  for (let i = 0; i < asset.frameCount; i++) {
    const f = asset.getFtxFrame(i);
    frames.push({ i, name: f && f.name, w: f && f.width, h: f && f.height });
  }
  // 拼图：每帧一行
  const root = document.createElement('div');
  root.style.cssText = 'background:#2a2a30;color:#fff;font:14px monospace;padding:8px;';
  for (let i = 0; i < asset.frameCount; i++) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
    const lab = document.createElement('div');
    lab.textContent = `#${i}`;
    lab.style.cssText = 'width:40px';
    const c = compositeFrameToCanvas(asset, i);
    c.style.cssText = 'background:repeating-conic-gradient(#555 0% 25%,#333 0% 50%) 50%/16px 16px;';
    row.appendChild(lab); row.appendChild(c);
    root.appendChild(row);
  }
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.appendChild(root);
  return { frameCount: asset.frameCount, frames };
}, FILE);

console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'scripts/tmp/ftx-sheet.png', fullPage: true });
await browser.close();
