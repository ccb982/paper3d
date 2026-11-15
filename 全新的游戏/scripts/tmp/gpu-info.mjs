// 读取浏览器实际使用的 GPU / 画布像素尺寸（10 秒，不进世界）
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://localhost:5173/?perf=1';
const CHROME = process.env.CHROME_PATH
  || 'C:\\Users\\22641\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: null,
  args: ['--window-size=1920,1080', '--start-maximized'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__ppEnterWorld === 'function', { timeout: 120000, polling: 200 });
await new Promise((r) => setTimeout(r, 3000));

const info = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const canvas = document.querySelector('canvas');
  return {
    dpr: window.devicePixelRatio,
    inner: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height} avail ${window.screen.availWidth}x${window.screen.availHeight}`,
    glVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '?',
    glRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?',
    maxTex: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0,
    canvasCss: canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : 'none',
    canvasBuf: canvas ? `${canvas.width}x${canvas.height}` : 'none',
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
