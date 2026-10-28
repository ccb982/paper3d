/** _tmp-freeze-ab: 冻结期「大腿朝中线拧」的 A/B 归因
 *
 *  已实测（_tmp-freeze-dof / _tmp-freeze-pose2）：
 *    冻结期 0→2s（squatCourtSetup 网页默认 env）：
 *      thigh_l yaw 89.1° → 137.4°（大腿正面转向中线 = 膝盖朝内）+48.3°
 *      shin_l   yaw 90.0° →  82.2°                        −7.8°
 *      ⇒ 大腿相对小腿拧 55.2°
 *      膝位置（膝z−踝z）3.1cm 外 → 1.5cm 外（位置只内移 1.6cm）
 *      ⇒ **是「朝向拧」不是「位置塌」**
 *
 *  本探针对每个配置重跑一遍冻结期，输出：
 *    Δthigh yaw / Δshin yaw / Δ膝vs踝 / 终态 hip_l/0,hip_l/1,knee_l/0,knee_l/1 角
 *    以及 hip_l/2 / knee_l/2 的平均施加力矩（矢状基础力）
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

interface Config { name: string; env: Record<string, string> }
const CONFIGS: Config[] = [
  { name: '① 网页默认（baseline）', env: {} },
  { name: '② 关驱动 SQC_NODRIVE=1', env: { SQC_NODRIVE: '1' } },
  { name: '③ 关重力 SQC_GONS=0', env: { SQC_GONS: '0' } },
  { name: '④ 不清零速度 SQC_ZERO=0', env: { SQC_ZERO: '0' } },
  { name: '⑤ 关矢状基础力 SQC_PAIR_OFF=1', env: { SQC_PAIR_OFF: '1' } },
  { name: '⑥ 关踝前馈 SQC_ANKLE_FF=0', env: { SQC_ANKLE_FF: '0' } },
  { name: '⑦ 关髋软限位 SQC_HIP_SOFT=0', env: { SQC_HIP_SOFT: '0' } },
  { name: '⑧ 关踝被动 SQC_FRONTAL_PASSIVE=0', env: { SQC_FRONTAL_PASSIVE: '0' } },
  { name: '⑨ 关回正写手 SQC_HIP_STRATEGY=0', env: { SQC_HIP_STRATEGY: '0' } },
  { name: '⑩ 全关（NO_DRIVE+GONS=0+PAIR_OFF）', env: { SQC_NODRIVE: '1', SQC_GONS: '0', SQC_PAIR_OFF: '1', SQC_ANKLE_FF: '0' } },
];

const ORIG = { ...E };
const setEnv = (cfg: Config): void => {
  for (const k of Object.keys(E)) delete E[k];
  Object.assign(E, ORIG, cfg.env);
};

interface Res {
  dThigh: number; dShin: number; dKneeVsAnkle: number;
  hip0: number; hip1: number; knee0: number; knee1: number;
  hip2Tau: number; knee2Tau: number;
}

const run = (cfg: Config): Res => {
  setEnv(cfg);
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;
  const yawBody = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const kz = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const ang = (nm: string, ax: number): number => {
    const i = body.dofByName(nm, ax);
    return i < 0 ? NaN : body.dofs[i]!.angle * D;
  };
  const t0 = { thigh: yawBody('thigh_l'), shin: yawBody('shin_l'), ka: kz('knee_l') - kz('foot_l') };
  let hip2Sum = 0, knee2Sum = 0, n = 0;
  const ex = (w as unknown as { executor?: { ledger: Array<{ applied: number }> } }).executor;
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    if (ex) {
      hip2Sum += ex.ledger[body.dofByName('hip_l', 2)]?.applied ?? 0;
      knee2Sum += ex.ledger[body.dofByName('knee_l', 2)]?.applied ?? 0;
      n++;
    }
  }
  const t1 = { thigh: yawBody('thigh_l'), shin: yawBody('shin_l'), ka: kz('knee_l') - kz('foot_l') };
  return {
    dThigh: t1.thigh - t0.thigh,
    dShin: t1.shin - t0.shin,
    dKneeVsAnkle: (t1.ka - t0.ka) * 100,
    hip0: ang('hip_l', 0), hip1: ang('hip_l', 1),
    knee0: ang('knee_l', 0), knee1: ang('knee_l', 1),
    hip2Tau: n ? hip2Sum / n : 0, knee2Tau: n ? knee2Sum / n : 0,
  };
};

console.log('\n════ 冻结期「大腿朝中线拧」A/B 归因（2s 冻结）════');
console.log('  配置                              | Δ大腿yaw  Δ小腿yaw | Δ膝vs踝 | 终态 hip0  hip1  knee0 knee1 | 均 hip2τ  knee2τ');
for (const cfg of CONFIGS) {
  const r = run(cfg);
  console.log(
    `  ${cfg.name.padEnd(33)} | ${r.dThigh.toFixed(1).padStart(7)} ${r.dShin.toFixed(1).padStart(8)} |` +
    ` ${r.dKneeVsAnkle.toFixed(2).padStart(6)} |` +
    ` ${r.hip0.toFixed(1).padStart(6)} ${r.hip1.toFixed(1).padStart(5)} ${r.knee0.toFixed(1).padStart(5)} ${r.knee1.toFixed(1).padStart(5)} |` +
    ` ${r.hip2Tau.toFixed(1).padStart(7)} ${r.knee2Tau.toFixed(1).padStart(6)}`,
  );
}
console.log('\n★ Δ大腿yaw 越大 = 大腿正面越朝中线（膝盖朝内）');
console.log('★ Δ膝vs踝 正 = 膝相对踝往外（负 = 内收）');
console.log('★ hip0=髋额状轴  hip1=髋扭转轴  knee0=膝扭转轴(rest 8°=外八偏置)  knee1=膝额状轴');
