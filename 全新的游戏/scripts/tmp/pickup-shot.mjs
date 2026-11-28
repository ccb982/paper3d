// 临时：进世界后直接触发新的「获得物品」横幅并截图验证布局
import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Users\\22641\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.PROBE_URL || 'http://localhost:5199/?perf=1&wipe=1&seed=1679464028';
const W = 1536, H = 864;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false,
  defaultViewport: { width: W, height: H },
  args: [`--window-size=${W},${H + 40}`, '--disable-background-timer-throttling'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (/获得物品|WorldUIManager|pickup/i.test(t)) console.log('[page]', t);
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__ppEnterWorld === 'function', { timeout: 120000, polling: 200 });
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => window.__ppEnterWorld());
await page.waitForFunction(() => window.__ppWp && window.__ppWp.chunks > 0, { timeout: 90000, polling: 500 });
await page.evaluate(() => { try { window.__ppMode().finishDock(); } catch { /* ignore */ } });
await new Promise((r) => setTimeout(r, 7000));
await page.bringToFront();

const shot = async (name) => {
  await page.screenshot({ path: `scripts/tmp/${name}.png` });
  console.log('截图', name);
};

// 1) 正常获得（×3）
const geo = await page.evaluate(() => {
  const m = window.__ppMode();
  m.worldUIManager.showPickupResult('wood', true, 3);
  const stack = [...document.body.children].find((e) => e.style && e.style.top === '8.97%');
  if (!stack) return { err: 'stack not found' };
  const r = stack.getBoundingClientRect();
  const toast = stack.children[0];
  if (!toast) return { err: 'toast not found', stack: { x: r.x, y: r.y, w: r.width } };
  const t = toast.getBoundingClientRect();
  const bg = getComputedStyle(toast).backgroundImage;
  return {
    stack: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) },
    toast: { x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.width), h: Math.round(t.height) },
    ratio: +(t.width / t.height).toFixed(2),
    plateLoaded: /url\(/.test(bg),
    bgSize: getComputedStyle(toast).backgroundSize,
  };
});
console.log('几何', JSON.stringify(geo, null, 2));
await new Promise((r) => setTimeout(r, 400));
await shot('pickup-1');
await page.screenshot({ path: 'scripts/tmp/pickup-zoom.png', clip: { x: 1180, y: 60, width: 356, height: 150 } });

// 2) 同名合并（×3 + ×1 → ×4）
await page.evaluate(() => window.__ppMode().worldUIManager.showPickupResult('wood', true, 1));
await new Promise((r) => setTimeout(r, 260));
await shot('pickup-2-merge');

// 3) 等退场 + 背包满
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => window.__ppMode().worldUIManager.showPickupResult('herb', false, 1));
await new Promise((r) => setTimeout(r, 400));
await shot('pickup-3-full');

await browser.close();
