// 无头浏览器真机冒烟测试：起静态服务器 → Edge headless 经 CDP 驱动 → 选图 → 打包 → 读报告
// 无第三方依赖（用 node 内置 WebSocket + 自己起 http 服务）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const DIST = process.argv[2];
const IMG_DIR = process.argv[3];
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8433, CDP = 9333;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const buf = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('nope');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'edge-atlas-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, sessionId, msgId = 0;
const pending = new Map();

function send(method, params = {}, noSession = false) {
  const id = ++msgId;
  const payload = { id, method, params };
  if (!noSession) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
      return v.webSocketDebuggerUrl;
    } catch { await sleep(250); }
  }
  throw new Error('EDGE_CDP_TIMEOUT');
}

const wsUrl = await connect();
ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.method + ': ' + JSON.stringify(m.error))) : resolve(m.result);
  }
};

const target = await send('Target.createTarget', { url: `http://127.0.0.1:${PORT}/` }, true);
const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, true);
sessionId = attached.sessionId;

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
  return r.result.value;
};

// 1. 等应用挂载
let mounted = false;
for (let i = 0; i < 80; i++) {
  mounted = await evalJs(`!!document.querySelector('.sidebar') || !!document.body.innerText.trim().length`);
  if (mounted) break;
  await sleep(250);
}
const bodyLen = await evalJs('document.body.innerText.length');
console.log('1) 应用挂载:', mounted ? `OK（正文 ${bodyLen} 字）` : 'FAIL');

// 2. 点「打开图集打包器」
const clicked = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('打开图集打包器'));
  if (!b) return false; b.click(); return true;
})()`);
await sleep(600);
const title = await evalJs(`document.body.innerText.includes('图集打包器')`);
console.log('2) 进入图集打包器:', clicked && title ? 'OK' : `FAIL clicked=${clicked} title=${title}`);

// 3. 给 file input 塞图
const doc = await send('DOM.getDocument', { depth: -1 });
const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file][multiple]:not([webkitdirectory])' });
if (!node.nodeId) throw new Error('找不到文件输入框');
const files = process.argv.slice(4);
await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files });
await sleep(2500);
const loaded = await evalJs(`document.body.innerText.match(/清空（(\\d+) 张）/)?.[1] ?? '0'`);
console.log(`3) 载入图片: ${loaded} 张 ${Number(loaded) === files.length ? 'OK' : 'FAIL'}`);

// 4. 设置目标高度 + 打包
await evalJs(`(() => {
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const nums = [...document.querySelectorAll('input[type=number]')];
  setVal(nums[0], 192);      // 目标高度
  setVal(nums[1], 254);      // 颜色数
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('打包并预览'));
  if (!b) return false; b.click(); return true;
})()`);
await sleep(4000);
const report = await evalJs(`(() => {
  const t = document.body.innerText;
  const m = t.match(/报告[\\s\\S]{0,320}/);
  return m ? m[0] : '（无报告）';
})()`);
console.log('4) 打包报告:\n' + report.split('\n').filter(Boolean).map((l) => '     ' + l).join('\n'));

// 5. 预览 canvas 是否真的画了东西
const prev = await evalJs(`(() => {
  const cs = [...document.querySelectorAll('canvas')].filter(c => c.width > 16 && c.height > 16);
  const c = cs[cs.length - 1];
  if (!c) return 'no-canvas';
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let nonBg = 0;
  for (let i = 0; i < d.length; i += 4) if (!(d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200)) nonBg++;
  return c.width + 'x' + c.height + ' 非背景像素 ' + nonBg + '/' + (d.length / 4);
})()`);
console.log('5) 预览画布:', prev);

// 6. 导出（拦截下载：直接调内部逻辑不方便，改为点按钮后检查是否抛错）
const exportOk = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导出 .ftx3.gz'));
  if (!b) return 'no-button';
  if (b.disabled) return 'disabled';
  b.click(); return 'clicked';
})()`);
await sleep(1500);
const errs = await evalJs('window.__errs ? window.__errs.join(" | ") : ""');
console.log('6) 导出按钮:', exportOk, errs ? '页面错误: ' + errs : '');

await send('Page.captureScreenshot', {}).then(async (r) => {
  writeFileSync(join(IMG_DIR, 'ui_smoke.png'), Buffer.from(r.data, 'base64'));
  console.log('截图 -> ui_smoke.png');
});

ws.close();
edge.kill();
server.close();
process.exit(0);
