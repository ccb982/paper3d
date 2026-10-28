/** _tmp-base: 基础力层审计 + 被动刚度实测
 *
 *  ① 每根腿轴的 rest 角（机械中立位）—— 被动刚度的目标该是什么
 *  ② 每个轴的写手按「层」分类：基础力(pair/base/被动) vs 回正力(active)
 *  ③ 被动刚度 A/B：开/关时 踝额状/踝扭转/踝矢状 的实际变化 + 泄漏量
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { jointPlane } from '../src/core/servo/jointPlane';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const g = globalThis as unknown as { __PROPLOG?: Array<[number, string, number, string]> };
const E: Record<string, string> = globalThis.process!.env;
const ORIG = { ...E };
const D = 180 / Math.PI;
const PLANE_ZH: Record<string, string> = { frontal: '额', sagittal: '矢', torsion: '扭' };

/** 层归属：按 kind + channel + src 判定 */
const layerOf = (kind: string, src: string): string => {
  if (kind === 'pair') return '基础力';
  if (src.includes('legTension')) return '被动';
  if (src.includes('hipStrategy') || src.includes('ankleCoP')) return '回正';
  if (src.includes('fallSupport') || src.includes('leanReflex') || src.includes('upperRighting')) return '反射';
  if (src.includes('ankleFF')) return '基础力';
  return `其他(${src})`;
};

const runOne = (label: string, cfg: Record<string, string>): void => {
  for (const k of Object.keys(E)) delete E[k];
  Object.assign(E, ORIG, cfg);
  g.__PROPLOG = [];
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;

  const total = Math.round(2.4 / w.dt);
  const relStep = Math.round(2.0 / w.dt);
  const peak = { a0: 0, a1: 0, a2: 0 };
  for (let s = 0; s < total; s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    if (s === relStep) {
      g.__PROPLOG!.length = 0;
      // 记录释放瞬间的读数（被动刚度的目标从哪来）
      for (const [k, ax] of [['foot_l', 0], ['foot_l', 1], ['foot_l', 2]] as Array<[string, number]>) {
        const d = body.dofs[body.dofByName(k, ax)]!;
        if (ax === 0) peak.a0 = d.angle * D;
        if (ax === 1) peak.a1 = d.angle * D;
        if (ax === 2) peak.a2 = d.angle * D;
      }
    }
  }

  console.log(`\n──── ${label} ────`);
  console.log(`  踝读数(释放瞬间) 额状=${peak.a0.toFixed(2)}° 扭转=${peak.a1.toFixed(2)}° 矢状=${peak.a2.toFixed(2)}°`);

  // 写手按层归类
  const perDof = new Map<number, Map<string, { layer: string; n: number; tau: number }>>();
  for (const [dof, kind, val, src] of g.__PROPLOG!) {
    let m = perDof.get(dof);
    if (!m) { m = new Map(); perDof.set(dof, m); }
    const layer = layerOf(kind, src);
    const key = `${layer}|${src}[${kind}]`;
    const a = m.get(key) ?? { layer, n: 0, tau: 0 };
    a.n++; a.tau += val;
    m.set(key, a);
  }
  console.log('  轴           | 平面 | rest(机械中立) | 写手（层 · 次数 · 平均τ）');
  for (const d of body.dofs) {
    if (!/^(hip|knee|foot|ankle)_/.test(d.name)) continue;
    const pl = jointPlane(body, d.name, d.axis) ?? '?';
    const m = perDof.get(d.dofIndex);
    const layers = new Set([...(m?.values() ?? [])].map((a) => a.layer));
    const desc = m && m.size
      ? [...m.values()].map((a) => `${a.layer}·${a.n}·${(a.tau / a.n).toFixed(1)}`).join('  ')
      : '★ 无';
    console.log(
      `  ${(d.name + '/' + d.axis).padEnd(11)} | ${PLANE_ZH[pl]!} | ${(d.rest * D).toFixed(2).padStart(7)}° |` +
      ` ${layers.size > 1 ? '⚠ ' : '  '}${desc}`,
    );
  }
};

runOne('默认（被动刚度开）', {});
runOne('关被动刚度', { SQC_LEG_TENSION: '0' });
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
