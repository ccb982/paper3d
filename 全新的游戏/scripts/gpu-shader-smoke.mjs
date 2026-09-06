import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'node_modules');

const TEST_DIR = process.env.GPU_TEST_DIR || 'C:/Users/22641/AppData/Local/Temp/opencode/gpuhazard';

const MIME = {
  '.html': 'text/html', '.glsl': 'text/plain', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (url === '/' || url === '/test.html') {
    file = path.join(TEST_DIR, 'test.html');
  } else if (url.startsWith('/three/')) {
    file = path.join(ROOT, 'three', 'build', url.replace('/three/', ''));
  } else if (url === '/hazard_core.glsl') {
    file = path.join(TEST_DIR, 'hazard_core.glsl');
  } else {
    file = path.join(TEST_DIR, url);
  }
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
await page.setViewport({ width: 200, height: 200 });
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
const outPath = process.env.GPU_OUT || path.join(__dirname, '..', '.tmp-gpu-out.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result));
console.log('OUTPUT saved to', outPath);
await browser.close();
server.close();