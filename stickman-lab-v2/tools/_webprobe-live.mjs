import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.env.WP_PORT ?? 5278);
const CDP = Number(process.env.WP_CDP ?? 9231);
const WAIT = Number(process.env.WP_WAIT ?? 3500);
const URL = `http://localhost:${PORT}/?SQC_SQUAT_DBG=1`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await wait(200);
  }
  throw new Error(`timeout ${url}`);
}

const profile = mkdtempSync(join(tmpdir(), 'edge-live-'));
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
edge.stderr.on('data', () => {});
const kill = () => { try { edge.kill(); } catch {} };

try {
  await waitHttp(URL);
  await waitHttp(`http://127.0.0.1:${CDP}/json/version`, 15000);
  const targets = await fetch(`http://127.0.0.1:${CDP}/json/list`).then((r) => r.json());
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
  for (let i = 0; i < 80; i++) {
    await wait(250);
    const ready = await evalJs(`!!document.querySelector('[data-act="squatcourt"]') && !!document.querySelector('#hud')`);
    if (ready) break;
    if (i === 79) throw new Error('app not ready');
  }
  await wait(1000);
  const sign = process.env.WP_SIGN;
  if (sign) await evalJs(`globalThis.__ENV.SQC_SHANK_ANKLE_SIGN=${JSON.stringify(sign)}`);
  const vsign = process.env.WP_VSIGN;
  if (vsign) await evalJs(`globalThis.__ENV.SQC_HIP_VALGUS0_SIGN=${JSON.stringify(vsign)}`);
  const extra = process.env.WP_ENV;
  if (extra) await evalJs(`Object.assign(globalThis.__ENV, ${extra})`);
  await evalJs(`document.querySelector('[data-act="squatcourt"]')?.click()`);
  for (let i = 0; i < 45; i++) {
    await wait(300);
    const d = await evalJs(`(() => {
      const g = globalThis;
      const hud = document.querySelector('#hud')?.textContent ?? '';
      const tm = hud.match(/当前 t=([0-9.]+)s/);
      const fi = hud.indexOf('✗倒下@');
      const fall = fi >= 0 ? { raw: hud.slice(fi, fi + 40) } : null;
      const h = g.__SQC_SHANK_HUD ?? {};
      const f = g.__HIP_FRAME ?? {};
      const dbg = g.__SQC_SHANK_DBG ?? {};
      const sq = g.__SQUAT_DBG ?? {};
      const id = g.__ID ?? {};
      const jd = (g.__jointDump?.() ?? []).filter((ln) => /^(hip|knee|foot|spine|neck)_/.test(ln));
      const traj = jd.filter((ln) => String(ln).startsWith('hip_l/0') || String(ln).startsWith('hip_l/1') || String(ln).startsWith('hip_l/2') || String(ln).startsWith('knee_l/0') || String(ln).startsWith('spine1/0') || String(ln).startsWith('spine2/0') || String(ln).startsWith('spine3/0') || String(ln).startsWith('neck/0'));
      const bid = g.__BID ?? null;
      const bs = g.__BS ?? null;
      const one = (side) => {
        const x = h[side], y = dbg[side], z = sq[side];
        return x ? { act: x.active, al: x.align, e: x.eLat, soft: x.soft, fade: x.fade,
          fz: side === 'l' ? f.fzL : f.fzR,
          contact: side === 'l' ? f.contactL : f.contactR,
          fric: y?.fric, cop: y?.copIn, raw: y?.raw, chain: y?.chainOk, copZ: y?.copZ,
          sel: z?.shankSelSide, fLat: z?.latF, fPerp: z?.latPerp, latChain: z?.latChain, id: id[side], j2: (() => { const ln = jd.find((x) => x.startsWith('hip_' + side + '/2')); if (!ln) return null; const c = ln.split('	'); return { applied: Number(c[5]), cmd: Number(c[4]), tau: Number(c[3]) }; })() } : null;
      };
      return {
        t: tm ? Number(tm[1]) : null,
        fall,
        mode: g.__SQC_MODE ?? null, push: g.__PUSH_HUD ?? null, stance: g.__STANCE ?? null, traj, stance: g.__STANCE ?? null,
        bid,
        bs,
        L: one('l'), R: one('r'),
      };
    })()`);
    console.log(JSON.stringify(d));
    if (d.fall) break;
  }
} catch (e) {
  console.error(String(e));
  process.exitCode = 1;
} finally {
  kill();
}
