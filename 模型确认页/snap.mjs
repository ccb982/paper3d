// 通用无头截图：node snap.mjs <html> <png> [w] [h]
// 绕开中文路径：截图先落到 ASCII 临时目录，再拷回目标
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';

const DIR = 'C:\\Users\\22641\\Desktop\\架构重置\\模型确认页';
const [html, png, wArg, hArg] = process.argv.slice(2);
const W = Number(wArg) || 1400;
const H = Number(hArg) || 400;
if (!html || !png) { console.error('usage: node snap.mjs <html> <png> [w] [h]'); process.exit(2); }

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
let chrome = CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome && process.env.LOCALAPPDATA) {
  for (const rel of ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe']) {
    const p = path.join(process.env.LOCALAPPDATA, rel);
    if (fs.existsSync(p)) { chrome = p; break; }
  }
}
if (!chrome) { console.error('chrome not found'); process.exit(3); }

const STAGE = path.join(os.tmpdir(), 'wb_shot');   // ASCII 路径
fs.mkdirSync(STAGE, { recursive: true });
const stamp = Date.now();
const stageHtml = path.join(STAGE, 'h' + stamp + '.html');
const stagePng = path.join(STAGE, 'p' + stamp + '.png');
const prof = path.join(STAGE, 'prof' + stamp);
fs.mkdirSync(prof, { recursive: true });

// HTML 复制到 ASCII 路径。
// ★ 若 HTML 里有**相对引用**（<script src="x.js">），必须一并把同目录的兄弟文件
//   复制过去 —— 否则 staging 目录里 404，页面脚本直接 ReferenceError（静默白屏）。
fs.copyFileSync(path.join(DIR, html), stageHtml);
{
  const htmlText = fs.readFileSync(path.join(DIR, html), 'utf8');
  const refs = [...htmlText.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)["']/g)]
    .map((m) => m[1])
    .filter((r) => !/^(https?:|\/\/|data:)/i.test(r));
  for (const r of new Set(refs)) {
    const src = path.join(DIR, r);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      fs.copyFileSync(src, path.join(STAGE, path.basename(r)));
      console.log('  + asset ' + r);
    }
  }
  // 记录以便收尾清理
  globalThis.__stagedAssets = [...new Set(refs)]
    .map((r) => path.join(STAGE, path.basename(r)))
    .filter((p) => fs.existsSync(p));
}

const args = [
  '--headless=new',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--force-device-scale-factor=1',
  '--virtual-time-budget=15000',
  '--user-data-dir=' + prof,
  '--window-size=' + W + ',' + H,
  '--screenshot=' + stagePng,
  'file:///' + stageHtml.replace(/\\/g, '/'),
];

const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let err = '';
child.stderr.on('data', (d) => { err += d.toString(); });
child.on('exit', (code) => {
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ }
  if (fs.existsSync(stagePng)) {
    fs.copyFileSync(stagePng, path.join(DIR, png));
    const sz = fs.statSync(path.join(DIR, png)).size;
    try {
      fs.unlinkSync(stagePng); fs.unlinkSync(stageHtml);
      for (const a of (globalThis.__stagedAssets || [])) { try { fs.unlinkSync(a); } catch { /* ignore */ } }
    } catch { /* ignore */ }
    console.log('OK ' + png + ' ' + sz + 'B (exit=' + code + ')');
  } else {
    console.error('NO SHOT exit=' + code);
    console.error(err.split('\n').filter(l => l.includes('ERROR') || l.includes('Fail')).slice(-8).join('\n'));
    process.exit(1);
  }
});
