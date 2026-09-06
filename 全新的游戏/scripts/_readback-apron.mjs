// ============================================================================
// 最终渲染回读：墙裙（platform apron）顶部四条边的实际渲染像素亮度
// ============================================================================
// Node 端：起 static server 提供 three module + 本测试 HTML
// Chrome headless：真实 canvas 石纹材质 + onBeforeCompile dirMod 注入 +
//   真实光照（SunCycle 6:00 太阳 + GameLights 半球/平行光）渲染墙裙
//   俯视 + 斜视，逐条边回读顶面/立面中段像素亮度 → 判定"两条亮两条暗"
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'node_modules');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (url === '/' || url === '/test.html') file = path.join(__dirname, '.tmp-readback', 'test.html');
  else if (url.startsWith('/three/')) file = path.join(ROOT, 'three', 'build', url.replace('/three/', ''));
  else file = path.join(__dirname, '.tmp-readback', url);
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404); res.end('missing ' + url); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log('server on', port);

const { default: puppeteer } = await import('puppeteer-core');
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 480 });
const messages = [];
page.on('console', (msg) => messages.push(msg.text()));
page.on('pageerror', (e) => messages.push('PAGEERROR: ' + e.message));
await page.goto(`http://127.0.0.1:${port}/test.html`);
try {
  await page.waitForFunction('document.body.dataset.ready === "1"', { timeout: 30000 });
} catch (e) {
  console.log('TIMEOUT waiting ready. messages:');
  console.log(messages.join('\n'));
  process.exit(1);
}
const result = await page.evaluate(() => window.__out);
console.log('===READBACK-OUTPUT-START===');
console.log(JSON.stringify(result));
console.log('===READBACK-OUTPUT-END===');
await browser.close();
server.close();