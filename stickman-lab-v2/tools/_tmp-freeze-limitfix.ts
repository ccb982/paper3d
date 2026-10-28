/** _tmp-freeze-limitfix: 决定性验证 —— 冻结期大腿拧转是否由「限位通道」造成
 *
 *  已实测（tools/_tmp-freeze-dof.ts，冻结期 0→2s）：
 *    knee_l/1  t=0: 角=+14.50°  限位=-8..8   ← 摆姿就超限 6.5°
 *              t=2: 角=-5.06°   ⇒ 被限位通道从 +14.5 硬拽到 -5（走了 19.5°！）
 *    knee_l/0  t=0: 角=-0.02°（限位 -6..6 正常）
 *              t=2: 角=+8.42°  ← 又被耦合带出限位
 *    ⇒ 膝的限位冲量作用在**大腿的子体**上 ⇒ 反作用力矩拧大腿
 *    ⇒ 大腿相对躯干 yaw +47.6°（=视觉「膝盖朝内」）
 *
 *  本探针 A/B：
 *    ① 现状
 *    ② LIMITS_OFF=1（整个限位通道关）
 *    ③ 膝逻辑轴1 限位放宽到 ±20°（摆姿不再越限）
 *    ④ 膝逻辑轴0+1 都放宽到 ±20°
 *    ⑤ 只放宽轴1 到 ±20° 且把轴0 也放到 ±10°
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;

interface Res {
  dThigh: number; dShin: number; dKa: number;
  k0: number; k1: number; viol: string[];
}

const run = (patch: (body: World['body']) => void): Res => {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;
  patch(body);
  const yaw = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const kz = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
  const viol: string[] = [];
  for (const d of body.dofs) {
    if (!/^(hip|knee|foot)_/.test(d.name)) continue;
    const a = d.angle * D;
    if (a > d.max * D + 0.5) viol.push(`${d.name}/${d.axis} ${a.toFixed(1)}>${(d.max * D).toFixed(1)}`);
    if (a < d.min * D - 0.5) viol.push(`${d.name}/${d.axis} ${a.toFixed(1)}<${(d.min * D).toFixed(1)}`);
  }
  const t0 = { th: yaw('thigh_l'), sh: yaw('shin_l'), ka: kz('knee_l') - kz('foot_l') };
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
  }
  return {
    dThigh: yaw('thigh_l') - t0.th,
    dShin: yaw('shin_l') - t0.sh,
    dKa: (kz('knee_l') - kz('foot_l') - t0.ka) * 100,
    k0: ang('knee_l', 0), k1: ang('knee_l', 1),
    viol,
  };
};

/** 改某关节某逻辑轴的控制限位（rad） */
const setLim = (body: World['body'], name: string, ax: number, deg: number): void => {
  const i = body.dofByName(name, ax);
  if (i < 0) return;
  const d = body.dofs[i]!;
  d.min = -deg / D;
  d.max = deg / D;
  const ej = d.engineJoint as unknown as { setLimits?: (a: number, b: number) => void } | null;
  if (d.engineLimited && ej?.setLimits) ej.setLimits(d.rest + d.min, d.rest + d.max);
};

console.log('\n════ 冻结期：限位通道是不是大腿拧转的元凶 ════');
const cases: Array<[string, (b: World['body']) => void]> = [
  ['① 现状', () => { /* 不改 */ }],
  ['② LIMITS_OFF=1（限位通道全关）', () => { E.LIMITS_OFF = '1'; }],
  ['③ 膝轴1 → ±20°', (b) => { setLim(b, 'knee_l', 1, 20); setLim(b, 'knee_r', 1, 20); }],
  ['④ 膝轴0/轴1 → ±20°', (b) => {
    for (const sd of ['l', 'r'] as const) { setLim(b, `knee_${sd}`, 0, 20); setLim(b, `knee_${sd}`, 1, 20); }
  }],
  ['⑤ 膝轴0 → ±10°，轴1 → ±20°', (b) => {
    for (const sd of ['l', 'r'] as const) { setLim(b, `knee_${sd}`, 0, 10); setLim(b, `knee_${sd}`, 1, 20); }
  }],
  ['⑥ 膝轴0/1 放宽 + LIMITS_OFF=1', (b) => {
    E.LIMITS_OFF = '1';
    for (const sd of ['l', 'r'] as const) { setLim(b, `knee_${sd}`, 0, 20); setLim(b, `knee_${sd}`, 1, 20); }
  }],
];
const origLim = E.LIMITS_OFF;
for (const [name, patch] of cases) {
  if (E.LIMITS_OFF !== origLim) delete E.LIMITS_OFF;
  const r = run(patch);
  console.log(
    `  ${name.padEnd(30)} Δ大腿yaw=${r.dThigh.toFixed(1).padStart(7)} Δ小腿yaw=${r.dShin.toFixed(1).padStart(7)}` +
    ` Δ膝vs踝=${r.dKa.toFixed(2).padStart(6)}cm | 终态 knee0=${r.k0.toFixed(1).padStart(6)} knee1=${r.k1.toFixed(1).padStart(6)}` +
    ` | 起始越限: ${r.viol.length ? r.viol.join(' ') : '无'}`,
  );
}
