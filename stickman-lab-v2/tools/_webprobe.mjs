import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const VITE_PORT = Number(process.env.WP_PORT ?? 5180);
const CDP_PORT = Number(process.env.WP_CDP ?? 9223);
const SEED = process.env.WP_SEED ?? '';
const QUERY = process.env.WP_QUERY ?? '';
const PARAMS = [SEED ? `seed=${SEED}` : '', QUERY].filter(Boolean).join('&');
const URL = `http://127.0.0.1:${VITE_PORT}/${PARAMS ? `?${PARAMS}` : ''}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await wait(200);
  }
  throw new Error(`timeout ${url}`);
}

async function main() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  vite.stdout.on('data', () => {});
  vite.stderr.on('data', (d) => process.stderr.write(d));
  const profile = mkdtempSync(join(tmpdir(), 'edge-webprobe-'));
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  edge.stderr.on('data', () => {});
  const kill = () => { try { edge.kill(); } catch {} try { vite.kill(); } catch {} };
  try {
    await waitHttp(URL);
    await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 15000);
    const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
    const target = targets.find((t) => t.type === 'page');
    if (!target) throw new Error('no page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    };
    const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'eval error');
      return r.result?.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: URL });
    for (let i = 0; i < 60; i++) {
      await wait(500);
      const ready = await evalJs(`!!document.querySelector('[data-act="squatcourt"]') && !!document.querySelector('#hud')`);
      if (ready) break;
      if (i === 59) throw new Error('app not ready');
    }
    await wait(2500);
    const btnInfo = await evalJs(`(()=>{const b=document.querySelector('[data-act="squatcourt"]'); return b ? {text:b.textContent, disabled:b.disabled, cls:b.className} : null})()`);
    console.log('BTN', JSON.stringify(btnInfo));
    await evalJs(`document.querySelector('[data-act="squatcourt"]').click()`);
    let last = '';
    for (let i = 0; i < 160; i++) {
      await wait(250);
      const text = await evalJs(`document.querySelector('#hud')?.textContent ?? ''`);
      last = text;
      const m = text.match(/✗倒下@([0-9.]+)s\s*(.*)/);
      if (m) {
        const raw = Number(m[1]);
        console.log(`WEB fall=${raw.toFixed(3)} reason=${m[2].trim()}`);
        console.log(text.split('\n').slice(0, 10).join('\n'));
        kill();
        process.exit(0);
      }
    }
    console.log('WEB no fall');
    console.log(last.split('\n').slice(0, 10).join('\n'));
    kill();
    ws.close();
  } catch (e) {
    console.error(String(e));
    kill();
    process.exitCode = 1;
  }
}
main();
