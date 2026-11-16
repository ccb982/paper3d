/** probe-lat-writers.ts —— 法庭侧向写手归因：谁在**主动引导侧偏**？
 *
 *  用户（2026-10-26）：『你就看法庭的写手吧 / 完全是乱的 / 主动引导侧偏』
 *
 *  乱不难查（`probe-writers` 已经列出 6 个侧向写手）。难的是证明**谁在把身体推歪**。
 *  判据不是"谁写了侧向"，而是：
 *    ① **一符号偏差**：静息段（放开后 0.5~3.0 s，此时 ξ≈0、载荷 50/50）里
 *       `∫τ dt` 明显不为 0 且**方向单一** ⇒ 它在持续输出一个侧向冲量；
 *    ② **左右不对称**：`τ_l` 与 `τ_r` 的均值不镜像（同侧同号、异侧反号才是镜像）；
 *    ③ **消融**：关掉它，看 `ξz` 的起始漂移方向/幅度怎么变（配合 `?abl=` 使用）。
 *
 *  做法：劫持 `PROPOSALS.push`，按 (src, dofName) 累计**它申请的 τ**；
 *  同时记录每个 DoF 的 `executor.ledger.applied`（最终下发值）用于对账。
 *
 *  用法：node tools/run.mjs probe-lat-writers
 *  env: T_END=6  QUIET_FROM=2.5 QUIET_TO=3.0（静息窗口，相对放开时刻）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';
import { baseAng } from '../src/core/servo/baseTable';
import { PROPOSALS, type DofProposal } from '../src/core/proposalBus';

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const T_END = Number(ENV.T_END ?? 6);
const QF = Number(ENV.QUIET_FROM ?? 2.5);
const QT = Number(ENV.QUIET_TO ?? 3.0);

const ORIG_PUSH = PROPOSALS.push.bind(PROPOSALS);
let CAP: DofProposal[] = [];
(PROPOSALS as unknown as { push: (p: DofProposal) => number }).push = (p: DofProposal): number => {
  CAP.push(p);
  return ORIG_PUSH(p);
};

const w = new World();
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.driveEnabled = true;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState | null;
const body = w.body;
const W = body.sk.massTotal * 9.81;

interface Acc { n: number; sum: number; abs: number; peak: number; frames: number; last: number }
const rec = new Map<string, Acc>();
const bump = (k: string, tau: number, frame: number): void => {
  let a = rec.get(k);
  if (!a) { a = { n: 0, sum: 0, abs: 0, peak: 0, frames: 0, last: -1 }; rec.set(k, a); }
  a.n++; a.sum += tau; a.abs += Math.abs(tau); if (Math.abs(tau) > a.peak) a.peak = Math.abs(tau);
  if (a.last !== frame) { a.last = frame; a.frames++; }
};

/** 侧向 DoF：轴 0（外展/侧屈）与轴 1（扭转） */
const isLat = (name: string, axis: number): boolean =>
  axis === 0 || axis === 1 ? /^(hip|knee|foot|ankle|spine|neck)_/.test(name) || /^spine\d?$|^neck$/.test(name) : false;

let t = 0;
let quiet = false;
const latTrace: string[] = [];
/** 关键侧向通道的即时值（每 0.25 s 打一行） */
const WATCH = [
  'squat.passiveLock @knee_l/1', 'squat.passiveLock @knee_r/1',
  'squat.passiveLock.hip @hip_l/0', 'squat.passiveLock.hip @hip_r/0',
  'squat.ankleVec @foot_l/0', 'squat.ankleVec @foot_r/0',
  'squat.passiveLock.spine @spine1/0', 'squat.passiveLock.spine @spine2/0',
];
const now = new Map<string, number>();
const series: string[] = [];
const brk: string[] = [];
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  CAP = [];
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  t = court ? court.t : w.clock;
  const rt = court ? court.t - (court.settle ?? 2) : t;
  quiet = court !== null && court.released && rt >= QF - 2 && rt <= QT - 2;
  const frame = s;
  now.clear();
  for (const p of CAP) {
    const d = body.dofs[p.dof]!;
    if (!isLat(d.name, d.axis)) continue;
    const nm = `${d.name}/${d.axis}`;
    const k = `${p.src} @${nm}`;
    bump(k, Number(p.tau ?? 0), frame);
    if (quiet) bump(`[静息] ${k}`, Number(p.tau ?? 0), frame);
    now.set(k, (now.get(k) ?? 0) + Number(p.tau ?? 0));
  }
  if (court && court.released && Math.abs(rt / 0.25 - Math.round(rt / 0.25)) < w.dt / 0.25 / 2) {
    const xi = ctl.sensors.com[2]! + ctl.sensors.comVel[2]! / Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!));
    series.push(
      `t=${court.t.toFixed(2)} ξz=${(xi * 1000).toFixed(1).padStart(7)} sp=${[0,0,0].map((_,k)=>{const i2=body.dofByName("spine"+(k+1),0);return i2>=0?(body.dofs[i2]!.angle*57.3).toFixed(1).padStart(6):"     -";}).join("")} fzL-fzR=${((body.footNormalForce('l', w.dt) - body.footNormalForce('r', w.dt)) / W * 100).toFixed(0).padStart(4)}% ` +
      WATCH.map((k) => (now.get(k) ?? 0).toFixed(1).padStart(7)).join(' '),
    );
    // ★ 逐通道分解（drive.lastBreakdown，30ms EMA）：真正回答"谁在侧向推"
    const DBG = ['hip_l/0', 'hip_r/0', 'foot_l/0', 'foot_r/0', 'knee_l/1', 'spine1/0'];
    const row = DBG.map((nm) => {
      const nm2 = nm.slice(0, nm.indexOf('/'));
      const ax = Number(nm.slice(nm.indexOf('/') + 1));
      const di = body.dofByName(nm2, ax);
      if (di < 0) return '   n/a';
      const b = (ctl.warner.drive as unknown as { lastBreakdown: Array<Record<string, number>> }).lastBreakdown[di]!;
      const f = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(1);
      return `${f(b.ff ?? 0)}|${f(b.act ?? 0)}|${f(b.damp ?? 0)}|${f((b.stiff ?? 0) + (b.itb ?? 0) + (b.lum ?? 0))}`;
    });
    brk.push(`t=${court.t.toFixed(2)}  ` + row.map((s) => s.padEnd(22)).join(''));
  }
  if (court && court.released && Math.abs(rt / 0.5 - Math.round(rt / 0.5)) < w.dt / 0.5 / 2) {
    const xi = ctl.sensors.com[2]! + ctl.sensors.comVel[2]! / Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!));
    latTrace.push(`t=${court.t.toFixed(2)} z=${(ctl.sensors.com[2]! * 1000).toFixed(1)}mm vz=${(ctl.sensors.comVel[2]! * 1000).toFixed(0)}mm/s ξz=${(xi * 1000).toFixed(1)}mm`);
  }
  if (court && court.fall >= 0 && court.t >= court.fall + 0.1) break;
}

const fmt = (a: Acc): string =>
  `n=${String(a.n).padStart(6)} 帧=${String(a.frames).padStart(4)} meanτ=${(a.sum / Math.max(1, a.n)).toFixed(2).padStart(8)}` +
  ` ∫τdt=${(a.sum * w.dt).toFixed(2).padStart(8)} 峰=${a.peak.toFixed(1).padStart(6)}`;

for (const tag of ['[静息] ', '']) {
  const rows = [...rec.entries()].filter(([k]) => k.startsWith(tag)).sort((a, b) => Math.abs(b[1].sum * w.dt) - Math.abs(a[1].sum * w.dt));
  console.log(`\n════ ${tag === '[静息] ' ? `静息窗口 ${QF}~${QT}s：一符号偏差 = 主动引导侧偏` : `全程 ${T_END}s`} ════`);
  if (!rows.length) { console.log('（无）'); continue; }
  for (const [k, a] of rows.slice(0, 26)) console.log(`  ${k.replace(tag, '').padEnd(46)} ${fmt(a)}`);
}

console.log('\n──── 侧向通道即时值（每 0.25 s，N·m）────');
console.log('  '+['knee_l/1','knee_r/1','hip_l/0','hip_r/0','foot_l/0','foot_r/0','sp1/0','sp2/0'].map((s)=>s.padStart(7)).join(' '));
for (const l of series) console.log('  '+l);
if (court && court.released) {
  console.log('\n──── 标准姿态（base）左右镜像检查（°）────');
  for (const nm of ['hip','knee','foot']) for (const ax of [0,1]) {
    const bl = baseAng(nm+'_l', ax), brm = baseAng(nm+'_r', ax);
    const il = body.dofByName(nm+'_l', ax), ir = body.dofByName(nm+'_r', ax);
    if (bl===undefined||brm===undefined) continue;
    console.log('  '+ (nm+'/'+ax).padEnd(8) + ' base L='+(bl*57.3).toFixed(2).padStart(7)+' R='+(brm*57.3).toFixed(2).padStart(7)+'  L+R='+((bl+brm)*57.3).toFixed(2).padStart(7) + '  nowL='+(il>=0?(body.dofs[il]!.angle*57.3).toFixed(2):'-').padStart(7)+' nowR='+(ir>=0?(body.dofs[ir]!.angle*57.3).toFixed(2):'-').padStart(7));
  }
  for (const nm of ['spine1','spine2','spine3']) { const b = baseAng(nm,0); if (b!==undefined) { const i = body.dofByName(nm,0); console.log('  '+(nm+'/0').padEnd(8)+' base='+(b*57.3).toFixed(2).padStart(7)+'  now='+(i>=0?(body.dofs[i]!.angle*57.3).toFixed(2):'-').padStart(7)); } }
}
console.log('\n──── 逐通道分解 ff|act|damp|stiff+itb+lum（N·m，30ms EMA）────');
console.log('  '+['hip_l/0','hip_r/0','foot_l/0','foot_r/0','knee_l/1','spine1/0'].map((s)=>s.padEnd(22)).join(''));
for (const l of brk) console.log('  '+l);
console.log('\n──── ξz 轨迹（每 0.5 s）────');
for (const l of latTrace) console.log('  ' + l);
console.log(`\nfall=${court && court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}  W=${W.toFixed(0)}N`);
