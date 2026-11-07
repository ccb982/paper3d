/** _probe-shake: 蹲姿法庭逐帧抖动频谱（临时探针） */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

process.env.SQC_SQUAT_DBG = '1';
process.env.SQC_PD_DBG = '1';
const W_SEC = Number(process.env.W_SEC ?? 2.8);
const T_REL = 2.0;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
ctl.manual.clear();
squatResetLimits(w);
const court: CourtState = squatCourtSetup(w, ctl, 2.0);

const di = (n: string, a: number): number => w.body.dofByName(n, a);
const ang = (n: string, a: number): number => { const i = di(n, a); return i >= 0 ? w.body.dofs[i]!.angle : 0; };
const applied = (n: string, a: number): number => { const i = di(n, a); return i >= 0 ? (w.executor.ledger[i]?.applied ?? 0) : 0; };

const series: Record<string, number[]> = {};
const push = (k: string, v: number): void => { (series[k] ??= []).push(v); };
let modePrev = '';
let modeChanges = 0;
const modeDur: number[] = [];
let lastModeT = T_REL;
const modeCount: Record<string, number> = {};

for (let s = 0; s < Math.round(W_SEC / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = court.t;
  if (t < T_REL) continue;
  const g = globalThis as { __SQC_MODE?: string; __SQC_SHANK_DBG?: Record<string, { fPerp: number; fParallel: number; knee0T: number; foot0T: number; fade: number; align: boolean }> };
  const mode = g.__SQC_MODE ?? '';
  modeCount[mode] = (modeCount[mode] ?? 0) + 1;
  if (mode !== modePrev) {
    if (modePrev) modeDur.push(t - lastModeT);
    modeChanges++; lastModeT = t; modePrev = mode;
  }
  push('knee0L', ang('knee_l', 0));
  push('knee0R', ang('knee_r', 0));
  push('foot0L', ang('foot_l', 0));
  push('foot0R', ang('foot_r', 0));
  push('knee0TqL', applied('knee_l', 0));
  push('knee0TqR', applied('knee_r', 0));
  push('foot0TqL', applied('foot_l', 0));
  push('foot0TqR', applied('foot_r', 0));
  push('knee2TqL', applied('knee_l', 2));
  push('knee2TqR', applied('knee_r', 2));
  push('foot2TqL', applied('foot_l', 2));
  push('foot2TqR', applied('foot_r', 2));
  const d = g.__SQC_SHANK_DBG;
  if (d?.l) { push('fPerpL', d.l.fPerp); push('knee0TL', d.l.knee0T); push('fadeL', d.l.fade); }
  if (d?.r) { push('fPerpR', d.r.fPerp); push('knee0TR', d.r.knee0T); push('fadeR', d.r.fade); }
  const pd = (globalThis as { __PD_PARTS?: Record<string, { target: number; angle: number; vel: number; vLp: number; posTerm: number; dampTerm: number; rawPd: number; ff: number; muscleExtra: number; tau: number }> }).__PD_PARTS;
  const tag: Array<[string, string]> = [['kneeL2', 'knee_l/2'], ['kneeR2', 'knee_r/2'], ['footL2', 'foot_l/2'], ['footR2', 'foot_r/2'], ['kneeL0', 'knee_l/0'], ['footL0', 'foot_l/0']];
  for (const [short, key] of tag) {
    const p = pd?.[key];
    if (!p) continue;
    push(`tgt${short}`, p.target);
    push(`vel${short}`, p.vel);
    push(`pos${short}`, p.posTerm);
    push(`dmp${short}`, p.dampTerm);
    push(`pd${short}`, p.rawPd);
    push(`ff${short}`, p.ff);
    push(`mex${short}`, p.muscleExtra);
    push(`tau${short}`, p.tau);
  }
}

const fs = 1 / w.dt;
function spectrum(x: number[]): Array<{ f: number; m: number }> {
  const n = Math.min(x.length, 128);
  if (n < 32) return [];
  const a = x.slice(0, n);
  const mean = a.reduce((s, v) => s + v, 0) / n;
  const out: Array<{ f: number; m: number }> = [];
  for (let k = 1; k <= 48; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const wnd = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      const v = (a[i]! - mean) * wnd;
      const ph = 2 * Math.PI * k * i / n;
      re += v * Math.cos(ph); im -= v * Math.sin(ph);
    }
    out.push({ f: k * fs / n, m: Math.hypot(re, im) / n });
  }
  return out.sort((p, q) => q.m - p.m);
}
function stats(x: number[]): { rms: number; hf: number; total: number; peak: string } {
  const n = Math.min(x.length, 128);
  const a = x.slice(0, n);
  const mean = a.reduce((s, v) => s + v, 0) / n;
  const rms = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n));
  const sp = spectrum(a);
  const total = sp.reduce((s, p) => s + p.m * p.m, 0);
  const high = sp.filter((p) => p.f >= 10).reduce((s, p) => s + p.m * p.m, 0);
  const top = sp.slice(0, 3).map((p) => `${p.f.toFixed(1)}Hz:${p.m.toFixed(4)}`).join(' ');
  return { rms, hf: total > 0 ? high / total : 0, total, peak: top };
}

console.log(`samples=${series.knee0L?.length ?? 0} fs=${fs.toFixed(0)}Hz modeChanges=${modeChanges} meanModeDur=${(modeDur.reduce((s, v) => s + v, 0) / Math.max(1, modeDur.length)).toFixed(2)}s modes=${JSON.stringify(modeCount)}`);
for (const k of ['knee0L', 'knee0R', 'foot0L', 'foot0R', 'knee0TqL', 'knee0TqR', 'foot0TqL', 'foot0TqR', 'knee2TqL', 'knee2TqR', 'foot2TqL', 'foot2TqR', 'fPerpL', 'fPerpR', 'knee0TL', 'knee0TR', 'fadeL', 'fadeR',
  'tgtkneeL2', 'tgtkneeR2', 'tgtfootL2', 'tgtfootR2', 'velkneeL2', 'velkneeR2', 'velfootL2', 'velfootR2',
  'poskneeL2', 'poskneeR2', 'posfootL2', 'posfootR2', 'dmpkneeL2', 'dmpkneeR2', 'dmpfootL2', 'dmpfootR2',
  'pdkneeL2', 'pdkneeR2', 'pdfootL2', 'pdfootR2', 'ffkneeL2', 'ffkneeR2', 'fffootL2', 'fffootR2',
  'mexkneeL2', 'mexkneeR2', 'tgtkneeL0', 'tgtfootL0', 'velkneeL0', 'velfootL0', 'poskneeL0', 'posfootL0', 'dmpkneeL0', 'dmpfootL0', 'taukneeL0', 'taufootL0']) {
  const x = series[k];
  if (!x || x.length < 32) continue;
  const st = stats(x);
  console.log(`${k.padEnd(8)} rms=${st.rms.toExponential(2)} hf>=10Hz=${(st.hf * 100).toFixed(0).padStart(3)}%  ${st.peak}`);
}
