import { spawn } from 'node:child_process';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 5199;
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: ['ignore', 'ignore', 'pipe'] });
vite.stderr.on('data', () => {});
async function probe() { try { return (await fetch(`http://127.0.0.1:${PORT}/room-preview.html`)).ok; } catch { return false; } }
for (let i = 0; i < 120 && !(await probe()); i++) await new Promise(r => setTimeout(r, 500));
console.log('ready:', await probe());

const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 450 });
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(0, 160), r.failure()?.errorText));
try {
  await page.goto(`http://127.0.0.1:${PORT}/room-preview.html?room=base`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.log('domcontentloaded ok');
} catch (e) {
  console.log('goto failed:', e.message.slice(0, 200));
}
await new Promise(r => setTimeout(r, 5000));
console.log('readyState:', await page.evaluate(() => document.readyState), 'roomReady:', await page.evaluate(() => window.__roomReady ?? false));
await browser.close();
vite.kill('SIGKILL');
process.exit(0);
