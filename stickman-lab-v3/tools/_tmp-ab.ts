/** _tmp-ab: 蹲下法庭 A/B —— 逐配置跑一遍，输出：判死 / 关键读数峰值
 *
 *  指标口径修正：
 *   · 只统计**判死前**的帧（排除死亡瞬间的爆炸帧）
 *   · 额状/矢状读数取 max|值|；膝踝间距取「两侧绝对差之和」
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
const ORIG = { ...E };

interface Row {
  name: string;
  fall: string;
  ankle: number;   // 踝额状 max|deg|
  knee: number;    // 膝额状 max|deg|
  kneeGap: number; // 膝踝 z 间距和 (cm)
  yaw: number;     // 大腿vs小腿 yaw max|deg|
  footSag: number; // 踝矢状 max|deg|
}

const run = (name: string, cfg: Record<string, string>, until = 4.0): Row => {
  for (const k of Object.keys(E)) delete E[k];
  Object.assign(E, ORIG, cfg);
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;
  const row: Row = { name, fall: '未判死', ankle: 0, knee: 0, kneeGap: 0, yaw: 0, footSag: 0 };
  const az = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
  const yawOf = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const frames: number[] = [];
  for (let s = 0; s < Math.round(until / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    if (court.fall >= 0) break;
    frames.push(s);
    row.ankle = Math.max(row.ankle, Math.abs(ang('foot_l', 0)), Math.abs(ang('foot_r', 0)));
    row.knee = Math.max(row.knee, Math.abs(ang('knee_l', 1)), Math.abs(ang('knee_r', 1)));
    row.footSag = Math.max(row.footSag, Math.abs(ang('foot_l', 2)), Math.abs(ang('foot_r', 2)));
    row.yaw = Math.max(row.yaw, Math.abs(yawOf('thigh_l') - yawOf('shin_l')));
    row.kneeGap = Math.max(row.kneeGap, (Math.abs(az('knee_l') - az('foot_l')) + Math.abs(az('knee_r') - az('foot_r'))) * 100);
  }
  row.fall = court.fall >= 0 ? `t=${court.fall.toFixed(2)} ${court.reason}` : '未判死';
  return row;
};

const cfgs: Array<[string, Record<string, string>]> = [
  ['当前默认', {}],
  ['KEEP=0(旧语义)', { SQC_KEEP_ANG_TABLE: '0' }],
  ['KEEP=1(不覆盖)', { SQC_KEEP_ANG_TABLE: '1' }],
  ['关被动张力', { SQC_LEG_TENSION: '0' }],
  ['关hip策略', { SQC_HIP_STRATEGY: '0' }],
  ['关踝矢状前馈', { SQC_ANKLE_FF: '0' }],
];

console.log('\n════ 蹲下法庭 A/B（放开 t=2.0s，跑 4s，指标只算判死前）════');
console.log(' 配置              | 判死                | 踝额状  膝额状  踝矢状 | 大腿vs小腿 | 膝踝间距');
const rows: Row[] = [];
for (const [n, c] of cfgs) rows.push(run(n, c));
for (const r of rows) {
  console.log(
    ` ${r.name.padEnd(16)} | ${r.fall.padEnd(19)} | ${r.ankle.toFixed(1).padStart(5)}° ${r.knee.toFixed(1).padStart(6)}° ${r.footSag.toFixed(1).padStart(6)}° |` +
    ` ${r.yaw.toFixed(1).padStart(8)}° | ${r.kneeGap.toFixed(1).padStart(6)}cm`,
  );
}
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
