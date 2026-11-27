import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.WP_CHROME ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.WP_PORT ?? 5275);
const CDP = Number(process.env.WP_CDP ?? 9232);
const T_END = Number(process.env.WP_TEND ?? 4.0);
const URL = `http://localhost:${PORT}/?SQC_BROWSER_PROBE=1${process.env.WP_QUERY ?? ''}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await wait(200);
  }
  throw new Error(`timeout ${url}`);
}

const profile = mkdtempSync(join(tmpdir(), 'chrome-live-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.on('data', () => {});
const kill = () => { try { chrome.kill(); } catch {} };

try {
  await waitHttp(URL);
  await waitHttp(`http://127.0.0.1:${CDP}/json/version`, 20000);
  const targets = await fetch(`http://127.0.0.1:${CDP}/json/list`).then((r) => r.json());
  const target = targets.find((t) => t.type === 'page');
  if (!target) throw new Error('no page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'eval error');
    return r.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 100; i++) {
    await wait(200);
    if (await evalJs(`!!document.querySelector('[data-act="squatdown"]') && !!document.querySelector('#hud')`)) break;
    if (i === 99) throw new Error('app not ready');
  }
  await wait(800);
  await evalJs(`document.querySelector('[data-act="squatdown"]')?.click()`);
  const realStart = Date.now();
  let n = 0;
  for (let i = 0; i < 200; i++) {
    await wait(200);
    n = await evalJs(`(globalThis.__SQC_PROBE?.frames?.length ?? 0)`);
    if (n >= Math.round(T_END * 200)) break;
    const hud = await evalJs(`document.querySelector('#hud')?.textContent ?? ''`);
    if (hud.includes('倒下@')) break;
  }
  const writers = await evalJs(`(() => { const a = globalThis.__SQC_ALL_WRITERS ?? {}; const out = {}; for (const k of ['foot_l/2','foot_r/2','hip_l/2','hip_r/2','knee_l/2','knee_r/2']) out[k] = a[k] ?? []; return out; })()`);
  const data = await evalJs(`(() => {
    const p = globalThis.__SQC_PROBE;
    if (!p) return null;
    const fr = p.frames.filter((f) => f.t <= ${T_END});
    const pick = fr.map((f) => ({
      t: f.t, fall: f.fall,
      footY: f.footWorldY, footPitch: f.footPitch, footRoll: f.footRoll,
      frameStage: f.frameStage, frameFoot2QRef: f.frameFoot2QRef, frameFoot2Kp: f.frameFoot2Kp, frameFoot2Kd: f.frameFoot2Kd, frameFoot2Tau: f.frameFoot2Tau, frameHip2Tau: f.frameHip2Tau, frameKnee2Tau: f.frameKnee2Tau, frameHip2Total: f.frameHip2Total, frameKnee2Total: f.frameKnee2Total, frameLowerJson: f.frameLowerJson, squatFrameLowerJson: f.squatFrameLowerJson, tsidFeasible: f.tsidFeasible, tsidMessage: f.tsidMessage, tsidBaseResidualMax: f.tsidBaseResidualMax, tsidContactResidualMax: f.tsidContactResidualMax, tsidWLFz: f.tsidWLFz, tsidWRFz: f.tsidWRFz, tsidWLCop: f.tsidWLCop, tsidWRCop: f.tsidWRCop, gripAccFootL: f.gripAccFootL, gripAccFootR: f.gripAccFootR, tsidFoot2Tau: f.tsidFoot2Tau, tsidFoot2TauR: f.tsidFoot2TauR, frameFoot2TauR: f.frameFoot2TauR, tsidHip2Tau: f.tsidHip2Tau, tsidKnee2Tau: f.tsidKnee2Tau,
      footTargetY: f.footTargetY, footTargetPitch: f.footTargetPitch,
      hipY: f.hipY, comY: f.comY, comVY: f.comVY,
      fzL: f.fzL, fzR: f.fzR, fzUse: f.fzUse, fzUseR: f.fzUseR,
      fzDesired: f.fzDesired, fzCmd: f.fzCmd, fzTotalDesired: f.fzTotalDesired, fzShare: f.fzShare,
      fzAbsFloor: f.fzAbsFloor, fzAbsMax: f.fzAbsMax,
      qpFeasible: f.qpFeasible, qpUse: f.qpUse, qpFzL: f.qpFzL, qpFzR: f.qpFzR, qpTotalFz: f.qpTotalFz, qpFzTotal: f.qpFzTotal, qpAY: f.qpAY, qpCopXL: f.qpCopXL, qpCopXR: f.qpCopXR, qpFzRefL: f.qpFzRefL, qpFzRefR: f.qpFzRefR,
      contact: f.contact, contactR: f.contactR, supportCount: f.supportContactCount, latch: f.contactLatch,
      knee2Applied: f.knee2Applied, hip2Applied: f.hip2Applied, foot2Applied: f.foot2Applied, foot1AppliedR: f.foot1AppliedR, foot2AppliedR: f.foot2AppliedR,
      kneeFf: f.kneeFf, hipFf: f.hipFf, idKnee: f.idKnee, idHip: f.idHip, idAnkle: f.idAnkle,
      hipX: f.hipX, kneeX: f.kneeX, kneeY: f.kneeY, footX: f.footX,
      hip2a: f.hip2a, knee2a: f.knee2a, foot2a: f.foot2a,
      staticGate: f.staticGate, ikGate: f.ikGate, ikDev: f.ikDev,
      hipErrFz: f.hipErrFz, hipAccDes: f.hipAccDes, hipTargetForFz: f.hipTargetForFz,
      supportCopX: f.supportCopX, supportCopZ: f.supportCopZ, supportWrenchFeasible: f.supportWrenchFeasible,
      comX: f.comX, comZ: f.comZ,
    }));
    return { n: fr.length, first: pick[0] ?? null, last: pick[pick.length - 1] ?? null, pick };
  })()`);
  mkdirSync('.tmp', { recursive: true });
  writeFileSync('.tmp/chrome-probe.json', JSON.stringify(data, null, 2));
  if (!data) throw new Error('no __SQC_PROBE frames');
  const pick = data.pick;
  const f = (v, n = 3) => (Number.isFinite(v) ? v.toFixed(n) : '-');
  const wallSec = Math.max(1e-6, (Date.now() - realStart) / 1000);
  console.log(`frames=${data.n} firstT=${f(data.first?.t, 2)} lastT=${f(data.last?.t, 2)} wall=${wallSec.toFixed(2)}s fps=${(data.n / wallSec).toFixed(1)}`);
  console.log('last writers', JSON.stringify(writers));
  const every = Math.max(1, Math.round(pick.length / 40));
  console.log('t footY pitch fzL fzR fzUse fzUseR fzTotDes qpUse qpTot qpDes qpAY qpRefL qpRefR qpCopL qpCopR share contact hipY comY');
  for (let i = 0; i < pick.length; i += every) {
    const x = pick[i];
    console.log(`${f(x.t, 2)} ${f(x.footY, 4)} ${f(x.footPitch, 1)} ${f(x.fzL, 0)} ${f(x.fzR, 0)} ${f(x.fzUse, 0)} ${f(x.fzUseR, 0)} ${f(x.fzTotalDesired, 0)} ${x.qpUse} ${f(x.qpTotalFz, 0)} ${f(x.qpFzTotal, 0)} ${f(x.qpAY, 1)} ${f(x.qpFzRefL, 0)} ${f(x.qpFzRefR, 0)} ${f(x.qpCopXL, 3)} ${f(x.qpCopXR, 3)} ${f(x.fzShare, 2)} ${x.contact}/${x.contactR} ${f(x.hipY, 4)} ${f(x.comY, 4)}`);
  }
  console.log('t hipX kneeX knee2a footX hipY footY fzUseL fzUseR fzActL fzActR knee2Ap hip2Ap kneeFf idKnee');
  for (let i = 0; i < pick.length; i += every) {
    const x = pick[i];
    console.log(`${f(x.t, 2)} ${f(x.hipX, 3)} ${f(x.kneeX, 3)} ${f(x.knee2a, 1)} ${f(x.footX, 3)} ${f(x.hipY, 4)} ${f(x.footY, 4)} ${f(x.fzUse, 0)} ${f(x.fzUseR, 0)} ${f(x.fzL, 0)} ${f(x.fzR, 0)} ${f(x.knee2Applied, 0)} ${f(x.hip2Applied, 0)} ${f(x.kneeFf, 0)} ${f(x.idKnee, 0)}`);
  }
  const lifts = pick.filter((x) => x.footY > 0.09);
  const minTot = pick.reduce((m, x) => Math.min(m, x.fzL + x.fzR), Infinity);
  console.log(`liftFrames(footY>0.09)=${lifts.length} firstLiftT=${lifts[0] ? f(lifts[0].t, 2) : '-'} maxFootY=${f(Math.max(...pick.map((x) => x.footY)), 4)} minFzTotal=${f(minTot, 0)}`);
} catch (e) {
  console.error(String(e));
  process.exitCode = 1;
} finally {
  kill();
}
