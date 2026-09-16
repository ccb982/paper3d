// 临时调试脚本：起 vite → 用 puppeteer 截图房间（验证极简改版视觉效果）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '.workbuddy', 'shots');
const PORT = 5199;
const shots = JSON.parse(process.argv[2] ?? '[]');

let vite = null;
async function probe(port) {
  try {
    const r = await fetch(`http://localhost:${port}/room-preview.html`);
    return r.ok;
  } catch { return false; }
}
let port = 5199;
if (await probe(5173)) {
  port = 5173; // 复用已在跑的 dev server（用户开着）
  console.log('reuse dev server on 5173');
} else {
  vite = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'],
  });
  vite.stderr.on('data', () => {});
  for (let i = 0; i < 120 && !(await probe(port)); i++) await new Promise((r) => setTimeout(r, 500));
  console.log('vite ready:', await probe(port));
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=swiftshader', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'],
});
fs.mkdirSync(OUT, { recursive: true });

for (const s of shots) {
  const page = await browser.newPage();
  await page.setViewport({ width: s.w ?? 1280, height: s.h ?? 720, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await page.goto(`http://localhost:${port}/${s.page ?? 'room-preview.html'}${s.qs ?? ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await new Promise((r) => setTimeout(r, s.wait ?? 8000));
  if (s.keys) {
    for (const k of s.keys) {
      await page.keyboard.down(k);
      await new Promise((r) => setTimeout(r, s.keyMs ?? 900));
      await page.keyboard.up(k);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  await page.screenshot({ path: path.join(OUT, s.name) });
  console.log('shot:', s.name, '| errors:', logs.slice(0, 5).join(' | ') || '(none)');
  await page.close();
}

await browser.close();
vite?.kill('SIGKILL');
process.exit(0);
