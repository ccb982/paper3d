/** probe-righting-audit.ts —— 「回正写手到底干了什么、真的发力了吗」
 *
 *  用户（2026-10-27）：『你为啥不好好审查蹲下法庭的回正写手都干的什么，真的发力了吗』
 *
 *  为什么不能用 `probe-writers` 的提案量代替：**提案 ≠ 力**。一个提案要经过四道闸才落到关节上：
 *    ① 总线仲裁（同 dof|kind|channel 只留一个）
 *    ② `kind:'pair'` 不是力矩，是 `(c, ref, base)` ⇒ 真力矩由 `pairTorque` 在执行层算，
 *       而且 **`ref − θ` 才是"回正力"，`base` 是基础力** —— 两者必须分开记账，否则
 *       "回正力到底出没出力"这个问题根本回答不了。
 *    ③ `t = clamp(l.cmd + l.pair, ±τmax)` ⇒ 被 τmax 削掉的部分**不会出现在 applied 里**
 *    ④ 限位通道 `l.limit` 单独叠加（不过 τmax）
 *
 *  所以本探针只读**执行层账本** `executor.ledger[i] = {cmd, pair, passive, limit, applied, saturated}`，
 *  并把 `pair` 拆成 `base`（基础力）与 `pair − base`（回正 PD）两笔。
 *
 *  用法：node tools/run.mjs probe-righting-audit
 *        T_END=6 …   QUIET 窗口用 QF/QT（相对放开时刻）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const T_END = Number(ENV.T_END ?? 6);

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

const bank = (w.executor as unknown as {
  pairBank: { channel(i: number): { c: number; ref: number; base: number } };
}).pairBank;
const ledger = w.executor.ledger as unknown as Array<{
  cmd: number; pair: number; passive: number; limit: number; applied: number; saturated: boolean;
}>;

/** 回正相关 DoF：外展/侧屈（0）、扭转（1）、以及承担基础力的矢状（2，只作对照） */
const SET: Array<[string, number, string]> = [
  ['hip_l', 0, '骨盆回平/侧移'], ['hip_r', 0, '骨盆回平/侧移'],
  ['knee_l', 1, '小腿扭转锁'], ['knee_r', 1, '小腿扭转锁'],
  ['hip_l', 1, '髋扭转锁'], ['hip_r', 1, '髋扭转锁'],
  ['spine1', 0, '躯干侧屈'], ['spine2', 0, '躯干侧屈'], ['spine3', 0, '躯干侧屈'],
  ['foot_l', 0, '踝 roll'], ['foot_r', 0, '踝 roll'],
  ['hip_l', 2, '矢状 基础力(对照)'], ['knee_l', 2, '矢状 基础力(对照)'],
];

interface Acc {
  n: number; absApplied: number; absPair: number; absPd: number; absBase: number; absCmd: number;
  absLimT: number; satF: number; zeroF: number; absDev: number; capPair: number; absVel: number;
}
const acc = new Map<string, Acc>();
const frameSeries: string[] = [];
let t = 0;

for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  t = court ? court.t : w.clock;
  if (!court || !court.released) continue;
  const rel = court.t - (court.settle ?? 2);

  for (const [nm, ax, tag] of SET) {
    const i = body.dofByName(nm, ax);
    if (i < 0) continue;
    const d = body.dofs[i]!;
    const l = ledger[i]!;
    const ch = bank.channel(i);
    const k = `${nm}/${ax} ${tag}`;
    let a = acc.get(k);
    if (!a) {
      a = { n: 0, absApplied: 0, absPair: 0, absPd: 0, absBase: 0, absCmd: 0, absLimT: 0, satF: 0, zeroF: 0, absDev: 0, capPair: 0, absVel: 0 };
      acc.set(k, a);
    }
    const pd = l.pair - ch.base;          // ★ 回正 PD（pair 里除 base 之外的部分）
    a.n++;
    a.absApplied += Math.abs(l.applied);
    a.absPair += Math.abs(l.pair);
    a.absPd += Math.abs(pd);
    a.absBase += Math.abs(ch.base);
    a.absCmd += Math.abs(l.cmd);
    a.absLimT += Math.abs(l.limit) / Math.max(1e-6, w.dt);
    a.absDev += Math.abs(ch.ref - d.angle);
    a.absVel += Math.abs(d.vel);
    if (l.saturated) a.satF++;
    if (Math.abs(l.applied) < 0.5) a.zeroF++;
    if (Math.abs(l.pair) >= d.tauMax - 1e-6) a.capPair++;
  }

  // 每 0.5 s 打一行关键通道的「实际下发 τ」与「回正 PD」
  const key = ['hip_l/0', 'hip_r/0', 'knee_l/1', 'foot_l/0', 'foot_r/0', 'spine1/0'];
  if (Math.abs(rel / 0.5 - Math.round(rel / 0.5)) < w.dt / 0.5 / 2) {
    const cells = key.map((k) => {
      const nm = k.slice(0, k.indexOf('/'));
      const ax = Number(k.slice(k.indexOf('/') + 1));
      const i = body.dofByName(nm, ax);
      if (i < 0) return '    n/a';
      const l = ledger[i]!;
      const ch = bank.channel(i);
      return `${l.applied.toFixed(0)}|${(l.pair - ch.base).toFixed(0)}`.padStart(10);
    });
    frameSeries.push(`t=${court.t.toFixed(2)}  ` + cells.join(''));
  }
  if (court.fall >= 0 && court.t >= court.fall + 0.1) break;
}

const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : '-');
console.log('\n════ 执行层账本：回正写手「真的发力了吗」（放开后，N·m）════');
console.log('DoF                          τmax  帧数  |applied|  用权%  |pair|  其中PD(回正)  base(基础力)  PD占比   |cmd|  限位等效τ  饱和帧%  近零帧%  |ref−θ|°');
for (const [nm, ax, tag] of SET) {
  const i = body.dofByName(nm, ax);
  if (i < 0) continue;
  const d = body.dofs[i]!;
  const a = acc.get(`${nm}/${ax} ${tag}`);
  if (!a || !a.n) continue;
  const n = a.n;
  const pdShare = a.absPd + a.absBase > 1e-9 ? (a.absPd / (a.absPd + a.absBase) * 100) : 0;
  console.log(
    `${(nm + '/' + ax).padEnd(9)} ${tag.padEnd(18).slice(0, 18)} ${fmt(d.tauMax, 0).padStart(5)} ${String(n).padStart(5)}` +
    ` ${fmt(a.absApplied / n).padStart(9)} ${fmt(a.absApplied / n / Math.max(1e-9, d.tauMax) * 100, 0).padStart(6)}` +
    ` ${fmt(a.absPair / n).padStart(7)} ${fmt(a.absPd / n).padStart(13)} ${fmt(a.absBase / n).padStart(12)}` +
    ` ${fmt(pdShare, 0).padStart(7)}% ${fmt(a.absCmd / n).padStart(6)} ${fmt(a.absLimT / n).padStart(10)}` +
    ` ${fmt(a.satF / n * 100, 0).padStart(7)}% ${fmt(a.zeroF / n * 100, 0).padStart(7)}% ${fmt(a.absDev / n * 57.3, 2).padStart(8)}`,
  );
}

console.log('\n════ 时间序列：applied | 回正PD（每 0.5 s，N·m）════');
console.log('  ' + ['hip_l/0', 'hip_r/0', 'knee_l/1', 'foot_l/0', 'foot_r/0', 'spine1/0'].map((s) => s.padStart(10)).join(''));
for (const l of frameSeries) console.log('  ' + l);
console.log(`\nfall=${court && court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}  W=${W.toFixed(0)}N`);
