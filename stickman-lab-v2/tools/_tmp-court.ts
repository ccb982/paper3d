/** _tmp-court: 只读蹲姿法庭（`squatCourtSetup` 路径）—— 2026-10-26 版。
 *
 *  用户：『我只想让你看看蹲姿法庭的情况 / 回读关节世界位置和关节写手，还有关节力矩 /
 *         关键是髋和上身保持不住』
 *  用户：『静置期就是我的设计，不用管。释放后髋和上身是不是有问题？
 *         而且到底有没有调整的写手指令？有没有多写手乱了？先别改』
 *
 *  所以本探针回答三件事，**不改 src**：
 *    ① 释放后各关节的实际状态：世界锚点 / 角 / 角速度 / τ / 缺口
 *    ② 到底有没有「调整」写手 —— 把 τ 拆成
 *         pair 通道 = base(常数,释放瞬间捕获) + kp·(ref−θ) − kd·ω(随误差变)
 *       「调整」只可能来自后两项；若它们 ≈0 而 base 占满，就是「只会托、不会纠」。
 *    ③ 是否多写手打架 —— 劫持 PROPOSALS.push 抓**完整**提案（含 pri/channel/kind），
 *       复刻 control.ts:222 的仲裁规则，标出「✔胜出 / ✘被淘汰」，
 *       并统计同一 DoF 本帧是否被**多种 kind** 同时施加（pair+torque 是相加、不互斥）。
 *
 *  另加「需求」列：用 `squatDynamicSupport`（按当前姿势每帧反解静态支撑力矩）
 *  作为 need，与 applied 对比 —— 这是「髋/上身为什么撑不住」的直接读数。
 *
 *  运行：npx tsx?  实际走 tools/run.mjs 打包；env:
 *    T_END=6 DTP=0.25
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { squatCourtSetup, type CourtState } from '../src/core/court';
import { squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { PROPOSALS, type DofProposal } from '../src/core/proposalBus';
import { squatDynamicSupport } from '../src/core/servo/squatGravity';
import { baseParams } from '../src/core/servo/baseTable';

// ★★★ 抓**完整**提案对象（含 pri / channel / kind / c / rad / tau）——
//   `__PROPLOG` 只有 [dof, kind, value, src]，看不到仲裁，也看不到 c / ref。
const ORIG_PUSH = PROPOSALS.push.bind(PROPOSALS);
let CAP: DofProposal[] = [];
(PROPOSALS as unknown as { push: (p: DofProposal) => number }).push = (p: DofProposal): number => {
  CAP.push(p);
  return ORIG_PUSH(p);
};

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const T_END = Number(ENV.T_END ?? 6);
const DT_PRINT = Number(ENV.DTP ?? 0.25);
const VERBOSE = String(ENV.WR ?? '1') === '1';
/** ★ 用户（2026-10-26）：『上身重力为 0，蹲下法庭还是歪的 ⇒ 下身写手也有问题』
 *  GUP=1 → 把上身刚体的 gravityScale 置 0（=上身零重量，下半身单独受检）。 */
const GUP = String(ENV.GUP ?? '0') === '1';
/** 只留腰椎以下参与受力：躯干/脊柱/颈/头/臂/手 */
const UPPER_KEYS = ['torso', 'spine1', 'spine2', 'spine3', 'spine4', 'neck', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
/** 关心的关节；轴 2 = 矢状（俯仰），轴 0 = 侧向（滚转）——实测倒地方向是**侧向**，两轴都要看 */
const WATCH: Array<[string, number]> = [
  ['hip_l', 2], ['hip_r', 2],
  ['spine1', 2], ['spine2', 2], ['spine3', 2],
  ['neck', 2],
  ['knee_l', 2], ['foot_l', 2],
    // ── 侧向轴（滚转链）
  ['hip_l', 0], ['hip_r', 0],
  ['spine1', 0], ['spine2', 0], ['spine3', 0],
  ['knee_l', 0], ['foot_l', 0],
  ['foot_r', 0], ['foot_r', 2],
];

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
Math.random = mulberry32(101);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;

w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset();
ctl.resetCourt();
squatResetLimits(w);

const body = w.body;

/** 法庭就位（内部会摆姿 + switchPoseState('squat') + 捕获） */
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
console.log(`[就位] settle=${court.settle}s  comY=${((ctl.sensors.com[1] ?? 0) * 100).toFixed(1)}cm  ` +
  `pitch0=${(court.p0 * 57.29578).toFixed(0)}° roll0=${(court.r0 * 57.29578).toFixed(0)}°`);

const DEG = 57.29578;
const dofIdx = new Map<string, number>();
for (const [n, a] of WATCH) dofIdx.set(`${n}/${a}`, body.dofByName(n, a));

const ti = body.indexByKey.get('spine4') ?? body.indexByKey.get('spine3');
const needBuf = new Float64Array(body.dofs.length);
const copBufL = new Float64Array(3);
const copBufR = new Float64Array(3);

/** 复刻 control.ts:222-229 的仲裁：key=`dof|kind|channel`，pri 大者胜，平局后者胜 */
function arbitrate(cap: DofProposal[]): Set<DofProposal> {
  const best = new Map<string, DofProposal>();
  for (const p of cap) {
    if (p.kind === 'antiG') continue;
    const k = `${p.dof}|${p.kind}|${p.channel ?? 'default'}`;
    const cur = best.get(k);
    if (!cur || (p.pri ?? 0) >= (cur.pri ?? 0)) best.set(k, p);
  }
  return new Set(best.values());
}

/** 每帧统计：一个 DoF 被几种 kind 施加（pair 走执行层、torque 走 drive，两者相加） */
function kindCountByDof(cap: DofProposal[], winners: Set<DofProposal>): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const p of cap) {
    if (!winners.has(p)) continue;
    if (p.kind === 'antiG') continue;
    const arr = m.get(p.dof);
    const tag = `${p.kind}:${p.src ?? '?'}`;
    if (arr) { if (!arr.includes(tag)) arr.push(tag); } else m.set(p.dof, [tag]);
  }
  return m;
}

const bp = baseParams() as unknown as { pairKs?: number; pairBs?: number; pairC?: number };
const KS = Number(ENV.SQ_PAIR_KS ?? bp.pairKs ?? 200);
const BS = Number(ENV.SQ_PAIR_BS ?? bp.pairBs ?? 6);

let lastPrint = -1;
const multiKindSeen = new Map<string, number>();
/** 跨帧累计：每个 关节/轴 到底被哪些 写手:kind 碰过 */
const owners = new Map<string, Set<string>>();
/** 写手"沉默率"：某 src 在多少帧里**根本没提案**（全帧计，不含静置期） */
const srcFrames = new Map<string, number>();
let releasedFrames = 0;

for (let i = 0; i < Math.round(T_END / w.dt); i++) {
  if (GUP) for (const k of UPPER_KEYS) {
    const bi = body.indexByKey.get(k);
    if (bi !== undefined) body.bodies[bi]!.setGravityScale(0, false);
  }
  CAP = [];
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  // ★ 仲裁发生在 control.step 里（`advance` 内），它**先**仲裁再清空。
  //   `advance` 之后 CAP 里剩下的只有 squatFrame 刚推的（下一帧才仲裁），
  //   所以本帧生效的一批必须包含 advance 之前的。CAP 是全帧并集，直接分析即可，
  //   只是要记住「squatFrame 那批其实在下一帧生效」——写手归属仍然正确。
  const cap = CAP;
  CAP = [];
  // ★ 每帧（不是每个打印点）累计写手归属，避免采样漏掉
  {
    const win0 = arbitrate(cap);
    if (court.released) {
      releasedFrames++;
      const seen = new Set<string>();
      for (const p of cap) seen.add(p.src ?? '?');
      for (const s of seen) srcFrames.set(s, (srcFrames.get(s) ?? 0) + 1);
    }
    for (const p of cap) {
      if (p.kind === 'antiG' || !win0.has(p)) continue;
      const dd = body.dofs[p.dof];
      if (!dd) continue;
      const key = `${dd.name}/${dd.axis}`;
      const set = owners.get(key) ?? new Set<string>();
      set.add(`${p.kind}:${p.src ?? '?'}`);
      owners.set(key, set);
    }
  }

  if (w.clock - lastPrint < DT_PRINT) continue;
  lastPrint = w.clock;

  // ── 需求（按当前姿势每帧反解的静态支撑力矩）
  squatDynamicSupport(body, needBuf);

  const c = ctl.sensors.com;
  let pitch = NaN, roll = NaN, tx = NaN, ty = NaN;
  if (ti !== undefined) {
    const rb = body.bodies[ti]!;
    const p = rb.translation();
    tx = p.x; ty = p.y;
    const q = rb.rotation();
    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const uz = 2 * (q.w * q.x + q.y * q.z);
    pitch = Math.atan2(ux, uy) * DEG;
    roll = Math.atan2(uz, Math.hypot(ux, uy)) * DEG;
  }
  const hipBi = body.indexByKey.get('hip_l');
  const hipY = hipBi !== undefined ? body.bodies[hipBi]!.translation().y : NaN;
  const grav = (w.world.gravity as { y: number }).y;
  const winners = arbitrate(cap);
  const kindMap = kindCountByDof(cap, winners);

  console.log(`\n── t=${w.clock.toFixed(2)}s ${court.released ? '放开' : '静置'} ` +
    `comY=${((c[1] ?? 0) * 100).toFixed(1)} comX=${((c[0] ?? 0) * 100).toFixed(1)} comZ=${((c[2] ?? 0) * 100).toFixed(1)} ` +
    `hipY=${(hipY * 100).toFixed(1)} 躯干=(${(tx * 100).toFixed(1)},${(ty * 100).toFixed(1)}) pitch=${pitch.toFixed(0)}° roll=${roll.toFixed(0)}° ` +
    `fz=${body.footNormalForce('l', w.dt).toFixed(0)}/${body.footNormalForce('r', w.dt).toFixed(0)} ` +
    `outScale=${w.drive.outputScale.toFixed(2)} g=${grav.toFixed(1)}` +
    (court.fall >= 0 ? `  ✗判死@${court.fall.toFixed(2)} (${court.reason})` : ''));

  // ── 侧向闭环读数：CoP 在哪 / CP 误差多大 / 侧向伺服开没开
  {
    const okL = body.footCoP('l', w.dt, copBufL);
    const okR = body.footCoP('r', w.dt, copBufR);
    const Ls = ctl.lateral.state;
    console.log(`   LAT comZ=${((c[2] ?? 0) * 1000).toFixed(0)}mm velZ=${((ctl.sensors.comVel[2] ?? 0) * 1000).toFixed(1)}mm/s ` +
      `CoPz=${okL ? ((copBufL[1] ?? 0) * 1000).toFixed(0) : '--'}/${okR ? ((copBufR[1] ?? 0) * 1000).toFixed(0) : '--'}mm ` +
      `(踝z=${(body.dofs[body.dofByName('foot_l', 2)]!.anchorWorld[2]! * 1000).toFixed(0)}/${(body.dofs[body.dofByName('foot_r', 2)]!.anchorWorld[2]! * 1000).toFixed(0)}) ` +
      `xiZ=${(Ls.xiZ * 1000).toFixed(0)} refZ=${(Ls.refZ * 1000).toFixed(0)} ttb=${Ls.ttb.toFixed(2)} ` +
      `servo=${ctl.lateralServo.active ? 'ON' : 'off'} copReq=${(ctl.lateralServo.copReq * 1000).toFixed(0)}mm`);
  }

  for (const [n, a] of WATCH) {
    const di = body.dofByName(n, a);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    const l = body.executor.ledger[di]!;
    const ap = l.applied;
    const occ = 100 * Math.abs(ap) / Math.max(1, d.tauMax);
    const anc = d.anchorWorld;
    const need = needBuf[di]!;
    const gap = need - ap;

    // ── pair 通道的真实内容（执行层状态，不是提案）
    const ch = body.executor.pairBank.channel(di);
    const isFoot = /^(foot|ankle)_/.test(n);
    const ks = KS * (isFoot ? 0.3 : 1);
    const bs = BS * (isFoot ? 0.3 : 1);
    const kp = Math.min(2 * ch.c * ks, 0.5 * 4 * Math.max(1e-6, d.inertiaLow) / (w.dt * w.dt));
    const kd = Math.min(2 * ch.c * bs, 0.8 * 2 * Math.max(1e-6, d.inertiaLow) / w.dt);
    const sgn = /^knee_/.test(n) ? -1 : 1;
    const dev = ch.ref - d.angle;
    const pd = (kp * dev * sgn) - (kd * d.vel * sgn);
    const baseT = ch.base;

    console.log(`   ${`${n}/${a}`.padEnd(9)} 锚=(${((anc[0] ?? 0) * 100).toFixed(1)},${((anc[1] ?? 0) * 100).toFixed(1)},${((anc[2] ?? 0) * 100).toFixed(1)}) ` +
      `ang=${(d.angle * DEG).toFixed(1).padStart(7)}° ω=${d.vel.toFixed(2).padStart(6)} | ` +
      `τ=${ap.toFixed(0).padStart(6)}/${d.tauMax.toFixed(0).padStart(4)}(${occ.toFixed(0).padStart(3)}%)` +
      `[cmd=${l.cmd.toFixed(0)} pair=${(l.pair ?? 0).toFixed(0)} pas=${l.passive.toFixed(0)} lim=${l.limit.toFixed(1)}${l.saturated ? ' SAT' : ''}] ` +
      `需求=${need.toFixed(0).padStart(5)} 缺口=${gap.toFixed(0).padStart(5)} ` +
      `限=[${(d.min * DEG).toFixed(0)},${(d.max * DEG).toFixed(0)}]${d.engineLimited ? 'eng' : ''} ` +
      `轴w=(${d.axisWorld[0]!.toFixed(2)},${d.axisWorld[1]!.toFixed(2)},${d.axisWorld[2]!.toFixed(2)})`);
    // ── pair 通道拆解：「调整」能力 = kp·dev − kd·ω；base 是释放瞬间捕获的常数
    const kinds = kindMap.get(di) ?? [];
    if (kinds.length > 1) multiKindSeen.set(`${n}/${a}`, (multiKindSeen.get(`${n}/${a}`) ?? 0) + 1);
    for (const k of kinds) {
      const key = `${n}/${a}`;
      const set = owners.get(key) ?? new Set<string>();
      set.add(k);
      owners.set(key, set);
    }
    if (ch.c > 1e-3) {
      console.log(`            pair实际: c=${ch.c.toFixed(2)} ref=${(ch.ref * DEG).toFixed(1)}° base=${baseT.toFixed(0)} ` +
        `kp=${kp.toFixed(0)} dev=${(dev * DEG).toFixed(1)}° kd=${kd.toFixed(1)} ⇒ PD=${pd.toFixed(1)} ` +
        `(base占${(100 * Math.abs(baseT) / Math.max(1e-6, Math.abs(baseT) + Math.abs(pd))).toFixed(0)}%)` +
        (kinds.length > 1 ? `  ⚠多写手[${kinds.join(' + ')}]` : ''));
    } else if (kinds.length > 1) {
      console.log(`            ⚠多写手[${kinds.join(' + ')}]`);
    }
    if (VERBOSE) {
      const mine = cap.filter((p) => p.dof === di);
      if (mine.length) {
        const txt = mine.map((p) => {
          const win = winners.has(p);
          const extra = p.kind === 'pair'
            ? `c=${(p.c ?? 0).toFixed(2)},ref=${((p.rad ?? 0) * DEG).toFixed(1)}°,τ=${(p.tau ?? 0).toFixed(0)}`
            : p.kind === 'angle'
              ? `rad=${((p.rad ?? 0) * DEG).toFixed(1)}°,kp=${p.kp ?? '-'}`
              : `τ=${(p.tau ?? 0).toFixed(1)}`;
          return `${win ? '✔' : '✘'}${p.src ?? '?'}(${p.kind},pri=${p.pri}${p.channel ? `,ch=${p.channel}` : ''},${extra})`;
        });
        console.log(`            写手: ${txt.join('  ')}`);
      } else {
        console.log(`            写手: —（本帧无提案；pair 状态是上一帧残留）`);
      }
    }
  }
}

console.log(`\n[结束] t=${w.clock.toFixed(2)} court=${court.fall >= 0 ? `fall@${court.fall.toFixed(2)} ${court.reason}` : 'holding'} ` +
  `comY=${((ctl.sensors.com[1] ?? 0) * 100).toFixed(1)}cm pitch=${(court.peakPitch * DEG).toFixed(0)}° roll=${(court.peakRoll * DEG).toFixed(0)}°`);
if (multiKindSeen.size) {
  console.log(`⚠ 多写手（同帧同轴 >1 kind）: ${[...multiKindSeen.entries()].map(([k, v]) => `${k}×${v}帧`).join('  ')}`);
} else {
  console.log('多写手（同帧同轴 >1 kind）: 无');
}

// ── 全局写手归属（跨全帧累计）：一眼看出哪个轴根本没人写
console.log('\n[写手归属 · 矢状/侧向]');
for (const [k, set] of [...owners.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!/\/(0|2)$/.test(k)) continue;
  const arr = [...set];
  console.log(`   ${k.padEnd(10)} ${arr.length} 个: ${arr.join('  ')}${arr.length > 1 ? '   ⚠' : ''}`);
}

// ── 写手沉默率：释放后有多少帧它**压根没提案**（不是输出 0，是没进总线）
console.log(`\n[写手沉默率 · 释放后 ${releasedFrames} 帧]`);
for (const [s, n] of [...srcFrames.entries()].sort((a, b) => a[1] - b[1])) {
  const pct = 100 * (1 - n / Math.max(1, releasedFrames));
  console.log(`   ${s.padEnd(26)} 出现 ${String(n).padStart(4)} 帧  沉默 ${pct.toFixed(0).padStart(3)}%`);
}
