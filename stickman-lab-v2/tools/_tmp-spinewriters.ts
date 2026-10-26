/** _tmp-spinewriters: 蹲姿保持期「到底是谁在写脊柱」的写手普查。
 *  用真实链路：法庭摆姿 → 释放 → 若干个时间点抓一帧的全部 propose（__PROPLOG）。
 *  ★ 目的：不靠读代码推断，直接列出 src / kind / 参数 / 该帧实际施加力矩。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const SEED = Number(process.env.SEED ?? 1);
Math.random = mulberry32(SEED * 100 + 1);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = true;
for (let s = 0; s < Math.round(2.0 / w.dt); s++) { supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l'); w.advance(1); }
ctl.actions.abort();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
w.controller = ctl;
w.driveEnabled = true;
w.reset();
ctl.resetCourt();
squatResetLimits(w);
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
const body = w.body;

const deg = (r: number): string => (r * 57.2958).toFixed(1);
/** 关注轴：脊柱三段矢状 + 髋/膝/踝矢状（对照） */
const WATCH: Array<[string, number]> = [
  ['spine1', 2], ['spine2', 2], ['spine3', 2],
  ['hip_l', 2], ['knee_l', 2], ['foot_l', 2],
];
const watchIdx = new Map<number, string>();
for (const [n, ax] of WATCH) {
  const i = body.dofByName(n, ax);
  if (i >= 0) watchIdx.set(i, `${n}/${ax}`);
}

const STAMPS = [0.2, 0.6, 1.2, 2.0];
let nextStamp = 0;
const g = globalThis as { __PROPLOG?: Array<[number, string, number, string]> };
console.log('t      dof        src                     kind     param    applied');
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  const doStamp = court.released && nextStamp < STAMPS.length && court.t - court.settle >= STAMPS[nextStamp]!;
  if (doStamp) g.__PROPLOG = [];
  supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (doStamp) {
    const t = court.t - court.settle;
    const log = g.__PROPLOG ?? [];
    const acc = new Map<string, { kind: string; param: number; n: number }>();
    for (const [dof, kind, param, src] of log) {
      const nm = watchIdx.get(dof);
      if (!nm) continue;
      const k = `${nm}|${src}|${kind}`;
      const cur = acc.get(k);
      if (cur) { cur.param = param; cur.n++; }
      else acc.set(k, { kind, param, n: 1 });
    }
    console.log(`──── t=${t.toFixed(2)}s  proposals=${log.length} ────`);
    for (const [k, v] of acc) {
      const [nm, src, kind] = k.split('|') as [string, string, string];
      const di = body.dofByName(nm.split('/')[0]!, Number(nm.split('/')[1]));
      const app = di >= 0 ? body.executor.appliedOf(di).toFixed(1) : '-';
      const param = kind === 'pair' ? `ref=${deg(v.param)}°` : `tau=${v.param.toFixed(1)}`;
      console.log(`  ${nm.padEnd(9)} ${src.padEnd(23)} ${kind.padEnd(8)} ${param.padEnd(14)} applied=${app.padStart(6)}${v.n > 1 ? ` ×${v.n}` : ''}`);
    }
    // 角度现状
    const angs = WATCH.map(([n, ax]) => {
      const i = body.dofByName(n, ax);
      return i >= 0 ? `${n}=${deg(body.dofs[i]!.angle)}°` : '';
    }).filter(Boolean).join(' ');
    console.log(`  [now] ${angs}`);
    nextStamp++;
    g.__PROPLOG = undefined;
  }
  if (court.fall >= 0) break;
}
