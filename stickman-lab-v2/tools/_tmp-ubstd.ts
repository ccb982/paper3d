/** _tmp-ubstd.ts —— 单腿站立·标准发力数据（2026-10-15；用户："冻结抬腿后的上身（盆骨也要冻结）；
 *  测承重腿和摆动腿的力矩+上身自身的重量；你自己估算上身各个部分的力矩；手动写进'上身不发力、
 *  其他部分照常发力'的身体试跑；多试试就能得到正确的数据"）
 *
 *  MODE=meas（默认）：冻结测量 → 写 .tmp/ubstd.json（供 inj 读）
 *    抬腿真实完成(isLiftDone) + FREEZE_DELAY 时刻：
 *      上身上下文全关(setUpperOff) + 刚体上身（含盆骨：世界冻结+脊柱超刚锁）+ 脊柱 pair 命令清零
 *    → MEAS 秒后取末 1s 窗口：
 *      · 承重腿/摆动腿：实测（executor 总账 applied）+ 净值（breakdown）+ 静态需求（gravityComp）
 *      · 上身：逐部件质量账（质量/重量/绕腰与绕支撑髋的力矩贡献）——"上身各个部分"
 *      · 脊柱 6 轴：静态需求 = 写回数据（自己估算：m·g×力臂 沿轴投影；与 gravityComp 交叉对账）
 *
 *  MODE=inj：手动写回试验
 *    同种子/同历史；抬腿后同刻：上身上下文全关（不冻结）+ pair 清零；
 *    每帧把 JSON 的脊柱力矩 ×SCALE×SIGN 写进脊柱 6 轴（executor 通道）；腿照常发力。
 *    判据（相对注入起点）：前后±20°/左右±10°/偏移±5cm，首违止——观察身体能否静止。
 *
 *  env：SEED=0 / FREEZE_DELAY=0.40 / MEAS=2.5 / RUN=4 / SCALE=1 / S0=SCALE / S2=SCALE / SIGN=1 /
 *       GCSPINE=1（0=把自动重力补偿在脊柱 6 轴上抵消——"上身真的一点力也不出"）/ PAIR0=1 /
 *       HOLD_KP=0 / HOLD_KD=0（可选：把脊柱角 PD 钉在注入起点姿态——对照用）
 */
import './_boot';
import fs from 'node:fs';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';
import { setUpperOff } from '../src/core/servo/rescue';

const ENV = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});
const MODE = ENV.MODE ?? 'meas';
const SEED = Number(ENV.SEED ?? 0);
const FREEZE_DELAY = Number(ENV.FREEZE_DELAY ?? 1.00);   // ★ 2026-10-15 用户：抬腿 1s 再锁定/冻结
const MEAS = Number(ENV.MEAS ?? 2.5);
const RUN = Number(ENV.RUN ?? 4.0);
const SCALE = Number(ENV.SCALE ?? 1);
const S0 = Number(ENV.S0 ?? SCALE);
const S2 = Number(ENV.S2 ?? SCALE);
const SIGN = Number(ENV.SIGN ?? 1);
const GCSPINE = String(ENV.GCSPINE ?? '1') === '1';
const PAIR0 = String(ENV.PAIR0 ?? '1') === '1';
const HOLD_KP = Number(ENV.HOLD_KP ?? 0);
const HOLD_KD = Number(ENV.HOLD_KD ?? 0);
const TRACE = String(ENV.TRACE ?? '0') === '1';
const TRACE_T = Number(ENV.TRACE_T ?? 0.5);
const KEEPUPPER = String(ENV.KEEPUPPER ?? '0') === '1';
const SPRING0 = String(ENV.SPRING0 ?? '0') === '1';   // 写回附：抵消脊柱骨性弹簧（kIap→初始位置保持的意思）
const DATA_FILE = '.tmp/ubstd.json';
const G = 9.81;
const DEG = 180 / Math.PI;

interface UBStd {
  seed: number;
  freezeDelay: number;
  poseSpine: Record<string, number>;
  tauSpine: Record<string, number>;
  poseLeg: Record<string, number>;
  tauLegDemand: Record<string, number>;
  appliedLeg: Record<string, number>;
  mass: { upper: number; weight: number };
}

const key = (n: string, ax: number): string => `${n}/${ax}`;

// ─── 世界与控制器 ───
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
resetFootLateral();
if (SEED) {
  (Math as { random: () => number }).random = mulberry32(SEED * 100 + 1);
  const tPre = 0.5 + Math.random() * 8;
  for (let s = 0; s < Math.round(tPre / w.dt); s++) w.advance(1);
  console.log(`预历史 SEED=${SEED} tPre=${tPre.toFixed(1)}s`);
}
ctl.actions.play('singleLegR');

const driveOf = (): {
  lastBreakdown: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }>;
  commandMusclePair(di: number, c: number, ref: number): void;
  legReflex: { side: string | null };
} => (ctl.warner as unknown as { drive: never }).drive;
const drv = driveOf();
const supSide = (): string => drv.legReflex.side ?? 'r';

const SPINE: Array<[string, number]> = [
  ['spine1', 0], ['spine1', 2], ['spine2', 0], ['spine2', 2], ['spine3', 0], ['spine3', 2],
];
const legList = (side: string): Array<[string, number]> => [
  [`hip_${side}`, 0], [`hip_${side}`, 2], [`knee_${side}`, 2], [`foot_${side}`, 0], [`foot_${side}`, 2],
];
const PARTS: Array<[string, RegExp]> = [
  ['头', /^head$/],
  ['左上臂', /^arm_l$/], ['左前臂', /^hand_l$/],
  ['右上臂', /^arm_r$/], ['右前臂', /^hand_r$/],
  ['躯干1(torso)', /^torso$/], ['躯干2(spine2)', /^spine2$/],
  ['躯干3(spine3)', /^spine3$/], ['躯干4(spine4)', /^spine4$/],
];

const brk = (di: number): { net: number; servo: number; act: number; ff: number; damp: number } => {
  const b = drv.lastBreakdown[di] ?? { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0 };
  return { net: b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp, servo: b.servo, act: b.act, ff: b.ff, damp: b.damp };
};
const gcBuf = new Float64Array(w.body.dofs.length);
const gc = (n: string, ax: number): number => {
  const di = w.body.dofByName(n, ax);
  return di >= 0 ? gcBuf[di]! : 0;
};
/** 自己估算：某自由度"托住其子树重力"的静态力矩（= u·(r×F) 沿轴投影取反；与 gravityComp 同式交叉对账） */
const estTau = (di: number): number => {
  if (di < 0) return 0;
  const d = w.body.dofs[di]!;
  const u = d.axisWorld, a = d.anchorWorld;
  let tau = 0;
  for (const bi of w.body.subtree[d.joint]!) {
    const rb = w.body.bodies[bi]!;
    const c = rb.worldCom();
    const Fy = rb.mass() * w.world.gravity.y;
    const tx = -(c.z - a[2]!) * Fy;
    const tz = (c.x - a[0]!) * Fy;
    tau += u[0]! * tx + u[2]! * tz;
  }
  return -tau;
};

// ═══════════════════════════ 咚 MODE=meas：冻结测量 ═══════════════════════════
if (MODE === 'meas') {
  let tLift = -1, t0 = -1;
  const frozen: Array<{ idx: number; p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }> = [];
  const accA = new Map<string, { s: number; s2: number; n: number }>();
  const accN = new Map<string, { s: number; s2: number; n: number }>();
  const accS = new Map<string, { s: number; s2: number; n: number }>();
  const accG = new Map<string, { s: number; s2: number; n: number }>();
  const acc = (m: Map<string, { s: number; s2: number; n: number }>, k: string, v: number): void => {
    const a = m.get(k) ?? { s: 0, s2: 0, n: 0 };
    a.s += v; a.s2 += v * v; a.n++; m.set(k, a);
  };
  let fzMin = 1e9, fzMax = -1e9, fzS = 0, fzS2 = 0, fzN = 0;
  const maxSteps = Math.round(14.0 / w.dt);
  // ── 临时审计：冻结窗口内谁在写 spine1/0 的伺服目标（若次数=0 → 伺服来自更早的残留目标） ──
  const si01 = w.body.dofByName('spine1', 0);
  const audit = new Map<string, { n: number; tgt: number; kp: number }>();
  let frameNo = 0;
  {
    const drvA = drv as unknown as { setAngle(i: number, rad: number, kp?: number, kd?: number): void };
    const orig = drvA.setAngle.bind(drv);
    drvA.setAngle = (i: number, rad: number, kp?: number, kd?: number): void => {
      if (i === si01 && t0 >= 0 && frameNo > Math.round((14.0 - MEAS) / w.dt)) {
        const e = new Error();
        const st = (e.stack ?? '').split(String.fromCharCode(10)).slice(2, 6).map((l) => l.trim().replace(/^at /, '')).join(' ← ');
        const k = st.slice(0, 160);
        const a = audit.get(k) ?? { n: 0, tgt: rad, kp: kp ?? -1 };
        a.n++; audit.set(k, a);
      }
      orig(i, rad, kp, kd);
    };
  }
  for (let s = 0; s < maxSteps; s++) {
    frameNo = s;
    const t = s * w.dt;
    if (tLift >= 0 && t0 < 0 && t >= tLift + FREEZE_DELAY) {
      t0 = t;
      setUpperOff(true);
      // ★ 纯世界冻结（无伺服——用户："单腿站立是统一的调控，没有伺服"）：捕获位姿 → 每帧回置+清零速度
      for (const k of ['spine1', 'spine2', 'spine3', 'spine4', 'torso', 'arm_l', 'arm_r', 'hand_l', 'hand_r']) {
        const idx = w.body.indexByKey.get(k);
        if (idx === undefined) continue;
        const rb = w.body.bodies[idx]!;
        frozen.push({ idx, p: { ...rb.translation() }, q: { ...rb.rotation() } });
      }
      console.log(`★冻结上身(含盆骨·纯世界冻结·无伺服) @t=${t.toFixed(2)}s (抬腿后${(t - tLift).toFixed(2)}s)`);
    }
    for (const f of frozen) {
      const rb = w.body.bodies[f.idx] as unknown as {
        setTranslation(t: { x: number; y: number; z: number }, w: boolean): void;
        setRotation(q: { x: number; y: number; z: number; w: number }, w: boolean): void;
        setLinvel(v: { x: number; y: number; z: number }, w: boolean): void;
        setAngvel(v: { x: number; y: number; z: number }, w: boolean): void;
      };
      rb.setTranslation(f.p, true);
      rb.setRotation(f.q, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    const armed = t0 >= 0;
    w.advance(1, () => {
      if (!armed) return;
      if (PAIR0) for (const [n, ax] of SPINE) drv.commandMusclePair(w.body.dofByName(n, ax), 0, 0);
    });
    if (tLift < 0 && isLiftDone()) { tLift = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
    if (t0 >= 0) {
      const dt0 = t - t0;
      if (dt0 >= MEAS - 1.0 && dt0 <= MEAS) {
        for (const [n, ax] of SPINE) {
          const di = w.body.dofByName(n, ax);
          if (di < 0) continue;
          acc(accS, key(n, ax), w.executor.appliedOf(di));
          acc(accA, key(n, ax), brk(di).net);
        }
        for (const side of [supSide(), supSide() === 'l' ? 'r' : 'l']) {
          for (const [n, ax] of legList(side)) {
            const di = w.body.dofByName(n, ax);
            if (di < 0) continue;
            const d = w.body.dofs[di]!;
            acc(accG, key(n, ax), d.angle * DEG);
            if (d.engineMotor) { acc(accA, key(n, ax), d.motorTqEst ?? 0); continue; }
            acc(accA, key(n, ax), w.executor.appliedOf(di));
            acc(accN, key(n, ax), brk(di).net);
          }
        }
        {
          const f0 = ctl.sensors.feet[supSide() === 'r' ? 1 : 0]!;
          fzS += f0.fz; fzS2 += f0.fz * f0.fz; fzN++;
          if (f0.fz < fzMin) fzMin = f0.fz;
          if (f0.fz > fzMax) fzMax = f0.fz;
        }
      }
      if (dt0 >= MEAS) break;
    }
  }
  if (t0 < 0) { console.log('✘ 未能进入冻结态（没抬腿？）'); process.exit(1); }

  // ── 终态：静态需求 + 质量账 ──
  w.body.gravityComp(gcBuf, w.world.gravity.y);
  const r1 = (v: number): string => v.toFixed(1).padStart(7);
  console.log(`\n【上身质量账】总 70kg / 687N；上身=躯干4段+头+双臂手`);
  const aWaist = w.body.dofs[w.body.dofByName('spine1', 0)]!.anchorWorld;
  const uWaistL = w.body.dofs[w.body.dofByName('spine1', 0)]!.axisWorld;
  const uWaistS = w.body.dofs[w.body.dofByName('spine1', 2)]!.axisWorld;
  const sup = supSide();
  const aHip = w.body.dofs[w.body.dofByName(`hip_${sup}`, 0)]!.anchorWorld;
  const uHipL = w.body.dofs[w.body.dofByName(`hip_${sup}`, 0)]!.axisWorld;
  const mom = (a: Float64Array, u: Float64Array, c: { x: number; y: number; z: number }, m: number): number => {
    const Fy = m * w.world.gravity.y;
    return u[0]! * (-(c.z - a[2]!) * Fy) + u[2]! * ((c.x - a[0]!) * Fy);
  };
  let mUp = 0, wUp = 0, mLatWaist = 0, mSagWaist = 0, mLatHip = 0;
  console.log('  部件          质量kg    重量N    绕腰轴0    绕腰轴2    绕支撑髋0 (N·m)');
  for (const [pname, re] of PARTS) {
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (const [k, i] of w.body.indexByKey.entries()) {
      if (!re.test(k)) continue;
      const rb = w.body.bodies[i]!;
      const c = rb.worldCom(); const bm = rb.mass();
      m += bm; cx += bm * c.x; cy += bm * c.y; cz += bm * c.z;
    }
    if (m <= 0) continue;
    cx /= m; cy /= m; cz /= m;
    const c = { x: cx, y: cy, z: cz };
    const tL = mom(aWaist, uWaistL, c, m), tS = mom(aWaist, uWaistS, c, m), tH = mom(aHip, uHipL, c, m);
    mUp += m; wUp += m * G; mLatWaist += tL; mSagWaist += tS; mLatHip += tH;
    console.log(`  ${pname.padEnd(13)} ${m.toFixed(2).padStart(6)} ${(m * G).toFixed(1).padStart(7)} ${r1(tL)} ${r1(tS)} ${r1(tH)}`);
  }
  console.log(`  ${'合计'.padEnd(13)} ${mUp.toFixed(2).padStart(6)} ${wUp.toFixed(1).padStart(7)} ${r1(mLatWaist)} ${r1(mSagWaist)} ${r1(mLatHip)}`);

  console.log(`\n【脊柱 6 轴】估算=Σ部件 m·g×力臂沿轴投影（写回数据）；gc=引擎精确对账；实测=冻结末窗口（总账/净值）`);
  const poseSpine: Record<string, number> = {};
  const tauSpine: Record<string, number> = {};
  for (const [n, ax] of SPINE) {
    const di = w.body.dofByName(n, ax);
    if (di < 0) continue;
    const est = estTau(di), gcv = gcBuf[di]!;
    const ang = w.body.dofs[di]!.angle;
    poseSpine[key(n, ax)] = ang;
    tauSpine[key(n, ax)] = Math.round(est * 10) / 10;
    console.log(`  ${key(n, ax).padEnd(9)} 角=${(ang * DEG).toFixed(1).padStart(6)}°  估算=${r1(est)}  gc=${r1(gcv)}`);
  }
  if (String(ENV.AUDIT ?? '0') === '1') {
    console.log(`【脊柱末帧通道分解·AUDIT】（骨刚/Hill/伺服/FF/阻尼 → 总账；pair=C/ref/角/vel）`);
    for (const [n, ax] of SPINE) {
      const di = w.body.dofByName(n, ax);
      if (di < 0) continue;
      const b = drv.lastBreakdown[di] ?? { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0 };
      const pc = (drv as unknown as { pairC: Float64Array }).pairC;
      const pr = (drv as unknown as { pairRef: Float64Array }).pairRef;
      const d0 = w.body.dofs[di]!;
      console.log(`  ${key(n, ax).padEnd(9)} ${b.stiff.toFixed(1).padStart(6)} ${b.act.toFixed(1).padStart(6)} ${b.servo.toFixed(1).padStart(6)} ${b.ff.toFixed(1).padStart(6)} ${b.damp.toFixed(1).padStart(6)} → ${w.executor.appliedOf(di).toFixed(1)} | pair c=${(pc[di] ?? 0).toFixed(2)} cTgt=${(drv.pairCTarget[di] ?? 0).toFixed(2)} ref=${(pr[di] ?? 0).toFixed(3)} 角=${d0.angle.toFixed(3)} vel=${d0.vel.toFixed(2)}`);
    }
    const dA = drv as unknown as { target: Float64Array; kp: Float64Array };
    const t01 = dA.target[si01]!;
    console.log(`【审计·spine1/0】drive 残留目标=${Number.isNaN(t01) ? 'NaN（已清）' : t01.toFixed(4)} kp=${dA.kp[si01]!.toFixed(0)}  冻结窗口内 setAngle 调用=${audit.size === 0 ? '0 次 → 伺服项=更早写入的残留目标（幽灵）' : audit.size + ' 处写手'}`);
    let n = 0;
    for (const [st, a] of audit) { if (n++ >= 5) break; console.log(`   写手[${a.n}次] tgt=${Number.isNaN(a.tgt) ? 'NaN' : a.tgt.toFixed(3)} kp=${a.kp.toFixed(0)} ← ${st}`); }
  }

  const mSd = (m: Map<string, { s: number; s2: number; n: number }>, k: string): { m: number; sd: number } => {
    const a = m.get(k);
    if (!a || !a.n) return { m: 0, sd: 0 };
    const mm = a.s / a.n;
    return { m: mm, sd: Math.sqrt(Math.max(0, a.s2 / a.n - mm * mm)) };
  };
  console.log(`\n【腿链】冻结态·末窗口 均值±标准差（实测=总账；净值=写手通道出力；值/波动越小越稳）`);
  const poseLeg: Record<string, number> = {};
  const tauLegDemand: Record<string, number> = {};
  const appliedLeg: Record<string, number> = {};
  for (const side of [sup, sup === 'l' ? 'r' : 'l'] as const) {
    const tag = side === sup ? '承重' : '摆动';
    for (const [n, ax] of legList(side)) {
      const di = w.body.dofByName(n, ax);
      if (di < 0) continue;
      const d = w.body.dofs[di]!;
      poseLeg[key(n, ax)] = d.angle;
      const A = mSd(accA, key(n, ax)), N = mSd(accN, key(n, ax)), G = mSd(accG, key(n, ax));
      if (d.engineMotor) {
        console.log(`  ${tag} ${key(n, ax).padEnd(9)} 电机τest=${A.m.toFixed(1)}±${A.sd.toFixed(1)}`);
        continue;
      }
      appliedLeg[key(n, ax)] = Math.round(A.m * 10) / 10;
      tauLegDemand[key(n, ax)] = Math.round(gcBuf[di]! * 10) / 10;
      console.log(`  ${tag} ${key(n, ax).padEnd(9)} 实测=${A.m.toFixed(1).padStart(7)}±${A.sd.toFixed(1).padStart(5)}  净值=${N.m.toFixed(1).padStart(6)}±${N.sd.toFixed(1).padStart(5)}  需求gc=${gcBuf[di]!.toFixed(1).padStart(6)}  角度=${G.m.toFixed(1).padStart(5)}±${G.sd.toFixed(2).padStart(4)}°`);
    }
  }
  {
    const fzM = fzN ? fzS / fzN : 0;
    const fzSd = fzN ? Math.sqrt(Math.max(0, fzS2 / fzN - fzM * fzM)) : 0;
    console.log(`  ▲支撑脚 fz：均=${fzM.toFixed(0)}±${fzSd.toFixed(0)}N  范围=[${fzMin.toFixed(0)},${fzMax.toFixed(0)}]（体重 687N；波动小=支撑腿稳）`);
  }

  // ★ 2026-10-15 "维持单腿站立所需的力"（用户："你自己测这个力，写入基础力"）：
  //   需求 = 上身+摆动腿+骨盆 绕支撑各轴的静矩（冻结态精确）；各轴本来不对称（重心偏）
  console.log(`
【维持力·需求（上身+摆动腿+骨盆 绕支撑各轴；写入基础力用）】`);
  {
    const sSide = supSide();
    const sfx = sSide === 'l' ? '_l' : '_r';
    // ★ 逐关节正确排除集（用户："每个部分对力的需求不同"）：髋=远端五件；膝=不含大腿；踝=不含小腿
    const distalOf = (jn: string): Set<string> => {
      const thigh = `thigh${sfx}`, shin = `shin${sfx}`, foot = `foot${sfx}`, arch = `arch${sfx}`, mfoot = `mfoot${sfx}`;
      if (jn === 'hip') return new Set([thigh, shin, foot, arch, mfoot]);
      if (jn === 'knee') return new Set([shin, foot, arch, mfoot]);
      return new Set([foot, arch, mfoot]);
    };
    for (const [n, ax] of [[`hip_${sSide}`, 0], [`hip_${sSide}`, 2], [`knee_${sSide}`, 0], [`knee_${sSide}`, 2], [`foot_${sSide}`, 0], [`foot_${sSide}`, 2]] as Array<[string, number]>) {
      const di = w.body.dofByName(n, ax);
      if (di < 0) continue;
      const excl = distalOf(n.split('_')[0]!);
      const d0 = w.body.dofs[di]!;
      const u = d0.axisWorld, a0 = d0.anchorWorld;
      let tau = 0;
      for (const [kk, bi] of w.body.indexByKey.entries()) {
        if (excl.has(kk)) continue;
        const rb = w.body.bodies[bi]!;
        const c = rb.worldCom();
        const Fy = rb.mass() * w.world.gravity.y;
        tau += u[0]! * (-(c.z - a0[2]!) * Fy) + u[2]! * ((c.x - a0[0]!) * Fy);
      }
      console.log(`  ${n}/${ax}（近端载荷=其余全身）= ${(-tau).toFixed(1)} N·m`);
    }
  }

  const out: UBStd = {
    seed: SEED, freezeDelay: FREEZE_DELAY,
    poseSpine, tauSpine, poseLeg, tauLegDemand, appliedLeg,
    mass: { upper: Math.round(mUp * 10) / 10, weight: Math.round(wUp * 10) / 10 },
  };
  fs.mkdirSync('.tmp', { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 1));
  console.log(`\n→ 写回数据已保存 ${DATA_FILE}（脊柱 6 轴 tauSpine；inj 模式读取）`);
}

// ═══════════════════════════ 咚 MODE=inj：手动写回试验 ═══════════════════════════
if (MODE === 'inj') {
  if (!fs.existsSync(DATA_FILE)) { console.log(`✘ 缺 ${DATA_FILE}——先跑 MODE=meas`); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as UBStd;
  console.log(`【写回配置】SCALE=${SCALE} S0=${S0} S2=${S2} SIGN=${SIGN} GCSPINE=${GCSPINE ? 1 : 0} PAIR0=${PAIR0 ? 1 : 0} HOLD_KP=${HOLD_KP}`);
  const inj: Array<{ di: number; tau: number; name: string; kp: number }> = [];
  for (const [n, ax] of SPINE) {
    const di = w.body.dofByName(n, ax);
    const st = data.tauSpine[key(n, ax)];
    if (di < 0 || st === undefined) continue;
    const tau = SIGN * (ax === 0 ? S0 : S2) * st;
    inj.push({ di, tau, name: key(n, ax), kp: HOLD_KP });
    console.log(`  ${key(n, ax).padEnd(9)} ← ${tau.toFixed(1).padStart(7)} N·m（写回数据 ${st.toFixed(1)}）`);
  }
  const pose0: number[] = inj.map((it) => w.body.dofs[it.di]!.angle);

  let tLift = -1, t0 = -1;
  let com0 = [0, 0, 0], pitch0 = 0, roll0 = 0;
  let tViol = -1, why = '';
  let printedLive = false;
  const gBuf2 = new Float64Array(w.body.dofs.length);
  const maxSteps = Math.round(16.0 / w.dt);
  let nextMark = 0;
  for (let s = 0; s < maxSteps; s++) {
    const t = s * w.dt;
    if (tLift >= 0 && t0 < 0 && t >= tLift + FREEZE_DELAY) {
      t0 = t;
      if (!KEEPUPPER) setUpperOff(true);
      com0 = [ctl.sensors.com[0]!, ctl.sensors.com[1]!, ctl.sensors.com[2]!];
      pitch0 = ctl.sensors.torsoTilt[0]!;
      roll0 = ctl.sensors.torsoTilt[1]!;
      nextMark = t;
      console.log(`★上身力全关+写入标准力矩 @t=${t.toFixed(2)}s (抬腿后${(t - tLift).toFixed(2)}s) 起点: pitch=${(pitch0 * DEG).toFixed(1)}° roll=${(roll0 * DEG).toFixed(1)}° comX=${(com0[0]! * 100).toFixed(1)}cm comZ=${(com0[2]! * 100).toFixed(1)}cm`);
    }
    const armed = t0 >= 0;
    w.advance(1, () => {
      if (!armed || KEEPUPPER) return;
      if (PAIR0) for (const [n, ax] of SPINE) drv.commandMusclePair(w.body.dofByName(n, ax), 0, 0);
      if (!GCSPINE) {
        w.body.gravityComp(gBuf2, w.world.gravity.y);
        for (const it of inj) w.executor.addTorque(it.di, -gBuf2[it.di]!);
      }
      if (SPRING0) {
        const iap = (drv as unknown as { opt: { iapSpineStiffness: number } }).opt.iapSpineStiffness;
        for (const [n, ax] of SPINE) {
          const di = w.body.dofByName(n, ax);
          if (di < 0) continue;
          const ribK = n === 'spine1' ? 1 : n === 'spine2' ? 2 : 3;
          w.executor.addTorque(di, iap * ribK * w.body.dofs[di]!.angle);   // 抵消骨性弹簧 kIap×(0−θ)
        }
      }
      for (let k = 0; k < inj.length; k++) {
        const it = inj[k]!;
        let tau = it.tau;
        if (HOLD_KP > 0) tau += -HOLD_KP * (w.body.dofs[it.di]!.angle - pose0[k]!) - HOLD_KD * w.body.dofs[it.di]!.vel;
        w.executor.addTorque(it.di, tau);
      }
    });
    if (tLift < 0 && isLiftDone()) { tLift = t; nextMark = t - 1e-9; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
    if (t0 >= 0 && !printedLive && t - t0 >= 0.1) {
      printedLive = true;
      w.body.gravityComp(gBuf2, w.world.gravity.y);
      const seg = inj.map((it) => `${it.name}[写${it.tau.toFixed(1)} gc${gBuf2[it.di]!.toFixed(1)} 总${w.executor.appliedOf(it.di).toFixed(1)}]`);
      console.log(`【回写实况·注入后0.1s】 ${seg.join(' ')}`);
    }
    if (t0 >= 0 && tViol < 0) {
      const dP = ctl.sensors.torsoTilt[0]! - pitch0;
      const dR = ctl.sensors.torsoTilt[1]! - roll0;
      const dx = ctl.sensors.com[0]! - com0[0]!;
      const dz = ctl.sensors.com[2]! - com0[2]!;
      if (Math.abs(dP) > 20 / DEG) { tViol = t; why = `前后${(dP * DEG).toFixed(1)}°>±20°`; }
      else if (Math.abs(dR) > 10 / DEG) { tViol = t; why = `左右${(dR * DEG).toFixed(1)}°>±10°`; }
      else if (Math.abs(dx) > 0.05 || Math.abs(dz) > 0.05) { tViol = t; why = `偏移(dx=${(dx * 100).toFixed(1)},dz=${(dz * 100).toFixed(1)})cm>±5cm`; }
      else if (ctl.sensors.com[1]! < com0[1]! - 0.20) { tViol = t; why = '躯干高度掉>20cm（倒）'; }
    }
    if (t >= 1.5 && t >= nextMark) {
      const pitchA = ctl.sensors.torsoTilt[0]! * DEG, rollA = ctl.sensors.torsoTilt[1]! * DEG;
      const armed = t0 >= 0;
      const dP = armed ? pitchA - pitch0 * DEG : 0, dR = armed ? rollA - roll0 * DEG : 0;
      const dx = armed ? (ctl.sensors.com[0]! - com0[0]!) * 100 : 0;
      const dz = armed ? (ctl.sensors.com[2]! - com0[2]!) * 100 : 0;
      const supS = supSide();
      const fz = ctl.sensors.feet[supS === 'r' ? 1 : 0]!.fz;
      const angs = inj.map((it) => (w.body.dofs[it.di]!.angle * DEG).toFixed(1)).join('/');
      const tail = armed ? `rel(前${dP.toFixed(1).padStart(5)},左${dR.toFixed(1).padStart(5)},${dx.toFixed(1).padStart(4)},${dz.toFixed(1).padStart(4)}cm)` : '（注入前·绝对角）';
      const jd = (n: string, ax: number): string => { const di2 = w.body.dofByName(n, ax); return di2 >= 0 ? (w.body.dofs[di2]!.angle * DEG).toFixed(0).padStart(4) : '   -'; };
      const jf = (n: string, ax: number): string => {
        const di2 = w.body.dofByName(n, ax);
        if (di2 < 0) return '    -';
        const d0 = w.body.dofs[di2]!;
        const v = d0.engineMotor ? (d0.motorTqEst ?? 0) : w.executor.appliedOf(di2);
        return `${v >= 0 ? '+' : ''}${v.toFixed(0)}`.padStart(5);
      };
      const joints = `摆(髋2=${jd('hip_l', 2)},膝2=${jd('knee_l', 2)},髋0=${jd('hip_l', 0)}) 支角(髋2=${jd('hip_r', 2)},膝2=${jd('knee_r', 2)},髋0=${jd('hip_r', 0)}) 支力(髋0=${jf('hip_r', 0)},髋2=${jf('hip_r', 2)},膝0=${jf('knee_r', 0)},膝2=${jf('knee_r', 2)},踝0=${jf('foot_r', 0)},踝2=${jf('foot_r', 2)})`;
      console.log(`${tLift < 0 ? `T=${t.toFixed(2)}s` : `+${(t - tLift).toFixed(2)}s`} 前=${pitchA.toFixed(1).padStart(5)} 左=${rollA.toFixed(1).padStart(5)} ${tail} fz=${fz.toFixed(0).padStart(4)} ${joints} 脊角=${angs}`);
      nextMark = Math.round((t + TRACE_T) * 100) / 100;
    }
    if (t0 >= 0 && tViol > 0 && !TRACE && t >= tViol) {
      const dP = (ctl.sensors.torsoTilt[0]! - pitch0) * DEG, dR = (ctl.sensors.torsoTilt[1]! - roll0) * DEG;
      const dx = (ctl.sensors.com[0]! - com0[0]!) * 100, dz = (ctl.sensors.com[2]! - com0[2]!) * 100;
      console.log(`✘首违: ${why}  com=(${dx.toFixed(1)},${dz.toFixed(1)})cm  @+${(tViol - t0).toFixed(2)}s`);
      break;
    }
    if (t0 >= 0 && t - t0 > RUN) break;
  }
  if (t0 < 0) { console.log('✘ 未能进入注入态（没抬腿？）'); process.exit(1); }
  const tEnd = Math.min(RUN, tViol < 0 ? RUN : tViol - t0);
  const dP = (ctl.sensors.torsoTilt[0]! - pitch0) * DEG, dR = (ctl.sensors.torsoTilt[1]! - roll0) * DEG;
  const dx = (ctl.sensors.com[0]! - com0[0]!) * 100, dz = (ctl.sensors.com[2]! - com0[2]!) * 100;
  const verdict = tViol < 0 ? '✔ 静止达标（判据内活满全场）' : `✘ 首违 @+${(tViol - t0).toFixed(2)}s（${why}）`;
  console.log(`\n【判决】${verdict}  尾态: 前=${dP.toFixed(1)}° 左=${dR.toFixed(1)}° com=(${dx.toFixed(1)},${dz.toFixed(1)})cm  存活=${tEnd.toFixed(2)}s`);
}

// ═══════════════════════════ 咚 MODE=scan：找"最接近静止"的冻结时点 ═══════════════════════════
if (MODE === 'scan') {
  let tLift = -1;
  const maxSteps = Math.round(12.0 / w.dt);
  let best = { t: -1, m: 1e9, comX: 0, comZ: 0, pitch: 0, roll: 0, copX: 0, copZ: 0, v: 0, fz: 0 };
  for (let s = 0; s < maxSteps; s++) {
    w.advance(1);
    const t = s * w.dt;
    if (tLift < 0 && isLiftDone()) { tLift = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
    if (tLift < 0) continue;
    const dtL = t - tLift;
    if (dtL < 0.15 || dtL > 3.0) continue;
    const supS = supSide();
    const f = ctl.sensors.feet[supS === 'r' ? 1 : 0]!;
    if (!f.copValid) continue;
    const com = ctl.sensors.com;
    const cv = ctl.sensors.comVel;
    const dCop = Math.hypot(com[0]! - f.copX, com[2]! - f.copZ);
    const tilt = (Math.abs(ctl.sensors.torsoTilt[0]!) + Math.abs(ctl.sensors.torsoTilt[1]!)) * DEG;
    const vcom = Math.hypot(cv[0]!, cv[1]!, cv[2]!);
    const m = dCop + tilt * 0.004 + vcom * 0.8;
    if (m < best.m) best = { t: dtL, m, comX: com[0]!, comZ: com[2]!, pitch: ctl.sensors.torsoTilt[0]!, roll: ctl.sensors.torsoTilt[1]!, copX: f.copX, copZ: f.copZ, v: vcom, fz: f.fz };
    if (s % Math.round(0.25 / w.dt) === 0) {
      console.log(`+${dtL.toFixed(2)}s 指标=${m.toFixed(4)} dCoP=${dCop.toFixed(4)} 倾=${tilt.toFixed(1)}° vCoM=${vcom.toFixed(3)} fz=${f.fz.toFixed(0)}`);
    }
  }
  console.log(`\n【最接近静止】+${best.t.toFixed(2)}s 指标=${best.m.toFixed(4)} dCoP=${Math.hypot(best.comX - best.copX, best.comZ - best.copZ).toFixed(4)}m 倾=${((Math.abs(best.pitch) + Math.abs(best.roll)) * DEG).toFixed(1)}° vCoM=${best.v.toFixed(3)}m/s fz=${best.fz.toFixed(0)}N`);
  console.log(`→ 建议 FREEZE_DELAY=${best.t.toFixed(2)}`);
}

if (MODE === 'open') {
  console.log(`【全开环】抬腿后 ${FREEZE_DELAY}s：全控制器停 + pair 全清零；唯一支撑=实时静态重力补偿（标准数据）`);
  let tLift = -1, t0 = -1;
  let com0 = [0, 0, 0], pitch0 = 0, roll0 = 0;
  let tViol = -1, why = '';
  const gBuf3 = new Float64Array(w.body.dofs.length);
  const maxSteps = Math.round(16.0 / w.dt);
  let nextMark = 0;
  for (let s = 0; s < maxSteps; s++) {
    const t = s * w.dt;
    if (tLift >= 0 && t0 < 0 && t >= tLift + FREEZE_DELAY) {
      t0 = t;
      setUpperOff(true);
      com0 = [ctl.sensors.com[0]!, ctl.sensors.com[1]!, ctl.sensors.com[2]!];
      pitch0 = ctl.sensors.torsoTilt[0]!;
      roll0 = ctl.sensors.torsoTilt[1]!;
      w.controller = null;
      nextMark = t - 1e-9;
      console.log(`★开环 @t=${t.toFixed(2)}s (抬腿后${(t - tLift).toFixed(2)}s) 起点: pitch=${(pitch0 * DEG).toFixed(1)}° roll=${(roll0 * DEG).toFixed(1)}° comX=${(com0[0]! * 100).toFixed(1)}cm comZ=${(com0[2]! * 100).toFixed(1)}cm`);
    }
    w.advance(1, () => {
      if (t0 < 0) return;
      for (let i = 0; i < w.body.dofs.length; i++) drv.commandMusclePair(i, 0, 0);
      w.body.gravityComp(gBuf3, w.world.gravity.y);
      for (const d of w.body.dofs) {
        if (d.engineMotor) continue;
        const tau = gBuf3[d.dofIndex]!;
        if (tau !== 0) w.executor.addTorque(d.dofIndex, tau);
      }
    });
    if (tLift < 0 && isLiftDone()) { tLift = t; nextMark = t - 1e-9; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
    if (t0 >= 0) ctl.sensors.update(w.dt);   // 控制器已停：手动刷新传感器（每步一次）
    if (t0 >= 0 && tViol < 0) {
      const dP = ctl.sensors.torsoTilt[0]! - pitch0;
      const dR = ctl.sensors.torsoTilt[1]! - roll0;
      const dx = ctl.sensors.com[0]! - com0[0]!;
      const dz = ctl.sensors.com[2]! - com0[2]!;
      if (Math.abs(dP) > 20 / DEG) { tViol = t; why = `前后${(dP * DEG).toFixed(1)}°>±20°`; }
      else if (Math.abs(dR) > 10 / DEG) { tViol = t; why = `左右${(dR * DEG).toFixed(1)}°>±10°`; }
      else if (Math.abs(dx) > 0.05 || Math.abs(dz) > 0.05) { tViol = t; why = `偏移(dx=${(dx * 100).toFixed(1)},dz=${(dz * 100).toFixed(1)})cm>±5cm`; }
      else if (ctl.sensors.com[1]! < com0[1]! - 0.20) { tViol = t; why = '躯干高度掉>20cm（倒）'; }
    }
    if (t >= 1.5 && t >= nextMark) {
      const pitchA = ctl.sensors.torsoTilt[0]! * DEG, rollA = ctl.sensors.torsoTilt[1]! * DEG;
      const armed = t0 >= 0;
      const dP = armed ? pitchA - pitch0 * DEG : 0, dR = armed ? rollA - roll0 * DEG : 0;
      const dx = armed ? (ctl.sensors.com[0]! - com0[0]!) * 100 : 0;
      const dz = armed ? (ctl.sensors.com[2]! - com0[2]!) * 100 : 0;
      const supS = supSide();
      const fz = ctl.sensors.feet[supS === 'r' ? 1 : 0]!.fz;
      const tail = armed ? `rel(前${dP.toFixed(1).padStart(5)},左${dR.toFixed(1).padStart(5)},${dx.toFixed(1).padStart(5)},${dz.toFixed(1).padStart(5)}cm)` : '（开环前·绝对角）';
      console.log(`+${(t - tLift).toFixed(2)}s 前=${pitchA.toFixed(1).padStart(5)} 左=${rollA.toFixed(1).padStart(5)} ${tail} fz=${fz.toFixed(0).padStart(4)}`);
      nextMark = Math.round((t + TRACE_T) * 100) / 100;
    }
    if (t0 >= 0 && t - t0 > RUN) break;
  }
  if (t0 < 0) { console.log('✘ 未能进入开环态（没抬腿？）'); process.exit(1); }
  const dP = (ctl.sensors.torsoTilt[0]! - pitch0) * DEG, dR = (ctl.sensors.torsoTilt[1]! - roll0) * DEG;
  const dx = (ctl.sensors.com[0]! - com0[0]!) * 100, dz = (ctl.sensors.com[2]! - com0[2]!) * 100;
  const verdict = tViol < 0 ? '✔ 静止达标（判据内活满全场）' : `✘ 首违 @+${(tViol - t0).toFixed(2)}s（${why}）`;
  console.log(`\n【判决】${verdict}  尾态: 前=${dP.toFixed(1)}° 左=${dR.toFixed(1)}° com=(${dx.toFixed(1)},${dz.toFixed(1)})cm`);
}

// ═══════════════════════════ 咚 MODE=score：基础挡对照打分行 ═══════════════════════════
if (MODE === 'score') {
  // ★ SWOFF=1：屏蔽摆动腿 pair 写手（"只有支撑腿"隔离测试）
  const SWOFF = String(ENV.SWOFF ?? '0') === '1';
  if (SWOFF) {
    const drvA = drv as unknown as { commandMusclePair(di: number, c: number, ref: number): void };
    const orig = drvA.commandMusclePair.bind(drv);
    const swSuffix = (drv.legReflex.side ?? 'r') === 'r' ? '_l' : '_r';
    drvA.commandMusclePair = (di: number, c: number, ref: number): void => {
      const d0 = w.body.dofs[di];
      if (d0 && d0.name.endsWith(swSuffix)) return;
      orig(di, c, ref);
    };
    console.log(`★SWOFF：摆动腿 pair 写手已屏蔽（suffix=${swSuffix}）`);
  }
  let tLift = -1, fallT = -1, com0y = 0, com0z = 0;
  // ★ 无重量隔离测试（用户："只有支撑腿，或者上身没有重量的测试"）：直接改质量（避免与重力补偿打架）
  const NWUP = String(ENV.NWUP ?? '0') === '1';   // 上身零重量（质量→0.05kg/节）
  const NWSW = String(ENV.NWSW ?? '0') === '1';   // 摆动腿零重量
  const UPPER_KEYS = ['spine1', 'spine2', 'spine3', 'spine4', 'torso', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
  const swSfx = (drv.legReflex.side ?? supSide()) === 'r' ? '_l' : '_r';
  const swingKeysList = (['thigh', 'shin', 'foot', 'arch', 'mfoot'] as const).map((p) => `${p}${swSfx}`);
  // 力度抵消法：每步给目标体施升力（抵消重力），同时抵消控制器对这些轴的重力补偿（防双重上推）
  const nwKeys: string[] = [];
  const nwGcDofs: number[] = [];
  if (NWUP) {
    nwKeys.push(...UPPER_KEYS);
    for (const sn of ['spine1', 'spine2', 'spine3']) for (const ax of [0, 1, 2]) {
      const di = w.body.dofByName(sn, ax);
      if (di >= 0) nwGcDofs.push(di);
    }
    console.log('★NWUP：上身零重量（升力抵消 + 同步抵消重力补偿）');
  }
  if (NWSW) {
    nwKeys.push(...swingKeysList);
    for (const [jn, ax] of [['hip', 0], ['hip', 1], ['hip', 2], ['knee', 0], ['knee', 1], ['knee', 2], ['foot', 0], ['foot', 1], ['foot', 2]] as Array<[string, number]>) {
      const di = w.body.dofByName(`${jn}${swSfx}`, ax);
      if (di >= 0) nwGcDofs.push(di);
    }
    console.log('★NWSW：摆动腿零重量（升力抵消 + 同步抵消重力补偿）');
  }
  const nwBuf = new Float64Array(w.body.dofs.length);
  const nwStep = (): void => {
    for (const k of nwKeys) {
      const ix = w.body.indexByKey.get(k);
      if (ix === undefined) continue;
      const rb = w.body.bodies[ix]!;
      const m = rb.mass();
      if (m > 0) rb.applyImpulse({ x: 0, y: m * 9.81 * w.dt, z: 0 }, true);
    }
    if (nwGcDofs.length) {
      w.body.gravityComp(nwBuf, w.world.gravity.y);
      for (const di of nwGcDofs) w.executor.addTorque(di, -nwBuf[di]!);
    }
  };
  let n = 0, rollS = 0, pitchS = 0, rollSgn = 0, dzSgn = 0, dySgn = 0, dyS2 = 0, dyMax = 0;
  let nfz = 0, fzS = 0, fzS2 = 0;
  const supAcc = new Map<string, { s: number; s2: number; n: number }>();
  const demAcc = new Map<string, { s: number; n: number }>();   // ★ 需求（上身+摆动腿+盆骨 绕支撑轴）
  const SCORE_T = Number(ENV.SCORE_T ?? 3.5);
  const maxSteps = Math.round((SCORE_T + 2.5) / w.dt);
  const WLOG = String(ENV.WLOG ?? '0') === '1';
  // ★ SUPPORT_FF=1：支撑腿需求前馈实验（用户："承重腿稳定输出略多一点的力就行"）
  const SUPPORT_FF = String(ENV.SUPPORT_FF ?? '0') === '1';
  if (SUPPORT_FF) {
    const drvA = drv as unknown as { commandMusclePair(di: number, c: number, ref: number): void };
    const orig = drvA.commandMusclePair.bind(drv);
    const supTh0 = new Map<number, number>();
    const demandOf = (di: number): number => {
      const d0 = w.body.dofs[di]!;
      const u = d0.axisWorld, a0 = d0.anchorWorld;
      const sSide = drv.legReflex.side ?? 'r';
      const sfx = sSide === 'l' ? '_l' : '_r';
      const excl = new Set(['thigh', 'shin', 'foot', 'arch', 'mfoot'].map((p) => `${p}${sfx}`));
      let tau = 0;
      for (const [kk, bi] of w.body.indexByKey.entries()) {
        if (excl.has(kk)) continue;
        const rb = w.body.bodies[bi]!;
        const c = rb.worldCom();
        const Fy = rb.mass() * w.world.gravity.y;
        tau += u[0]! * (-(c.z - a0[2]!) * Fy) + u[2]! * ((c.x - a0[0]!) * Fy);
      }
      return -tau;
    };
    drvA.commandMusclePair = (di: number, c: number, ref: number): void => {
      const sSide = drv.legReflex.side;
      if (sSide !== null) {
        const nm = w.body.dofs[di]!.name;
        const isSup = nm.endsWith(`_${sSide}`) && /^(hip|knee|foot|ankle)_/.test(nm);
        if (isSup) {
          if (!supTh0.has(di)) supTh0.set(di, w.body.dofs[di]!.angle);
          const th0 = supTh0.get(di)!;
          const margin = Number(ENV.SUPPORT_MARGIN ?? 0.15);
          const dem = demandOf(di);
          const refNew = th0 + (dem * (1 + margin)) / Math.max(1e-6, c * 1100 * 1.1);
          orig(di, c, refNew);
          return;
        }
      } else {
        supTh0.clear();
      }
      orig(di, c, ref);
    };
    console.log('★SUPPORT_FF：支撑腿 pair 参考角=θ₀+需求×1.15/(C·K·kStage)');
  }
  let wlogOpened = false;
  let calcDone = false;
  let zvDone = false;
  for (let s = 0; s < maxSteps; s++) {
    if (WLOG && !wlogOpened && tLift >= 0 && s * w.dt - tLift > 0.2) {
      (globalThis as { __WRITELOG?: Array<[number, number, string, number, string]> }).__WRITELOG = [];
      wlogOpened = true;
    }
    w.advance(1, () => { if (nwKeys.length || nwGcDofs.length) nwStep(); });
    const t = s * w.dt;
    if (tLift < 0 && isLiftDone()) { tLift = t; com0y = ctl.sensors.com[1]!; com0z = ctl.sensors.com[2]!; if (String(ENV.PROPLOG ?? '0') === '1') (globalThis as { __PROPLOG?: unknown[] }).__PROPLOG = []; }
    if (tLift < 0 && s % Math.round(1.0 / w.dt) === 0) {
      console.log(`  [t=${(s * w.dt).toFixed(1)}s 未抬] phase=${ctl.actions.status.phase ?? '-'} fzL=${ctl.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl.sensors.feet[1]!.fz.toFixed(0)}`);
    }
    if (tLift < 0) continue;
    const dtL = t - tLift;
    if (String(ENV.LIFTWAVE ?? '0') === '1' && dtL <= 1.45 && Math.abs(dtL * 20 - Math.round(dtL * 20)) < 1e-6) {
      const demOf2 = (di: number): number => {
        const d0 = w.body.dofs[di]!;
        const u = d0.axisWorld, a0 = d0.anchorWorld;
        const sSide2 = supSide();
        const sfx2 = sSide2 === 'l' ? '_l' : '_r';
        const excl2 = new Set(['thigh', 'shin', 'foot', 'arch', 'mfoot'].map((p2) => `${p2}${sfx2}`));
        let tau = 0;
        for (const [kk, bi] of w.body.indexByKey.entries()) {
          if (excl2.has(kk)) continue;
          const rb = w.body.bodies[bi]!;
          const c = rb.worldCom();
          const Fy = rb.mass() * w.world.gravity.y;
          tau += u[0]! * (-(c.z - a0[2]!) * Fy) + u[2]! * ((c.x - a0[0]!) * Fy);
        }
        return -tau;
      };
      const h0d = w.body.dofByName('hip_r', 0), h2d = w.body.dofByName('hip_r', 2);
      const f0 = h0d >= 0 ? `${brk(h0d).net.toFixed(0).padStart(4)}(需${demOf2(h0d).toFixed(0).padStart(5)})` : '-';
      const f2 = h2d >= 0 ? `${brk(h2d).net.toFixed(0).padStart(4)}(需${demOf2(h2d).toFixed(0).padStart(5)})` : '-';
      console.log(`LW +${dtL.toFixed(2)} h0=${f0}  h2=${f2}`);
    }
    const pitch = ctl.sensors.torsoTilt[0]!, roll = ctl.sensors.torsoTilt[1]!;
    // ★ 2026-10-15 用户："手动让姿势改为抬腿后，初始的力就是基础力"——静态判决：
    //   抬腿后某刻全体速度清零（去掉历史动量），看纯基础力能否从静止站住
    if (String(ENV.ZV ?? '0') === '1' && tLift >= 0 && !zvDone && dtL >= Number(ENV.ZV_T ?? 0.15)) {
      zvDone = true;
      for (const rb of w.body.bodies) {
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      console.log(`★ZV：全体速度清零 @+${dtL.toFixed(2)}s（纯基础力静态判决起点）`);
    }
    const fallen = Math.abs(pitch) > Math.PI / 4 || Math.abs(roll) > Math.PI / 4 || ctl.sensors.com[1]! < com0y - 0.25;
    if (fallT < 0 && fallen) fallT = dtL;
    if (fallT < 0 && dtL > 0.5 && dtL < 2.5) {
      rollS += Math.abs(roll); pitchS += Math.abs(pitch); n++;
      rollSgn += roll; dzSgn += ctl.sensors.com[2]! - com0z;
      {
        const supS = supSide();
        const dS = w.body.dofByName(`hip_${supS}`, 0), dW = w.body.dofByName(`hip_${supS === 'l' ? 'r' : 'l'}`, 0);
        if (dS >= 0 && dW >= 0) {
          const dy = w.body.dofs[dS]!.anchorWorld[1]! - w.body.dofs[dW]!.anchorWorld[1]!;
          dySgn += dy; dyS2 += dy * dy;
          if (Math.abs(dy) > dyMax) dyMax = Math.abs(dy);
        }
      }
      const fz = ctl.sensors.feet[supSide() === 'r' ? 1 : 0]!.fz;
      fzS += fz; fzS2 += fz * fz; nfz++;
      {
        const sSide = supSide();
        for (const [n, ax] of [[`hip_${sSide}`, 0], [`hip_${sSide}`, 2], [`knee_${sSide}`, 2], [`foot_${sSide}`, 2]] as Array<[string, number]>) {
          const di = w.body.dofByName(n, ax);
          if (di < 0) continue;
          const d0 = w.body.dofs[di]!;
          const v = d0.engineMotor ? (d0.motorTqEst ?? 0) : brk(di).net;
          const a = supAcc.get(`${n}/${ax}`) ?? { s: 0, s2: 0, n: 0 };
          a.s += v; a.s2 += v * v; a.n++; supAcc.set(`${n}/${ax}`, a);
        }
      }
      {
        // ★ 需求（用户："上身+摆动腿的力矩需求可以算出来"）：上身+摆动腿+盆骨 绕支撑各轴的重力矩
        const sSide = supSide();
        const sfx = sSide === 'l' ? '_l' : '_r';
        const excl = new Set(['thigh', 'shin', 'foot', 'arch', 'mfoot'].map((p) => `${p}${sfx}`));
        for (const [n, ax] of [[`hip_${sSide}`, 0], [`hip_${sSide}`, 2], [`knee_${sSide}`, 2], [`foot_${sSide}`, 2]] as Array<[string, number]>) {
          const di = w.body.dofByName(n, ax);
          if (di < 0) continue;
          const d0 = w.body.dofs[di]!;
          const u = d0.axisWorld, a0 = d0.anchorWorld;
          let tau = 0;
          for (const [kk, bi] of w.body.indexByKey.entries()) {
            if (excl.has(kk)) continue;
            const rb = w.body.bodies[bi]!;
            const c = rb.worldCom();
            const Fy = rb.mass() * w.world.gravity.y;
            tau += u[0]! * (-(c.z - a0[2]!) * Fy) + u[2]! * ((c.x - a0[0]!) * Fy);
          }
          const dv = -tau;   // 维持所需（与 actuator 约定一致）
          const a = demAcc.get(`${n}/${ax}`) ?? { s: 0, n: 0 };
          a.s += dv; a.n++; demAcc.set(`${n}/${ax}`, a);
        }
      }
    }
    if (String(ENV.SUP_WAVE ?? '0') === '1' && tLift >= 0 && dtL > 1.0 && dtL < 1.35 && s % 8 === 0) {
      const diW = w.body.dofByName('hip_r', 0);
      if (diW >= 0) {
        const d0W = w.body.dofs[diW]!;
        const prW = (drv as unknown as { pairRef: Float64Array }).pairRef;
        console.log(`W ${dtL.toFixed(2)} λ=${prW[diW]!.toFixed(3)} 角=${d0W.angle.toFixed(3)} vel=${d0W.vel.toFixed(2)} dev=${(prW[diW]! - d0W.angle).toFixed(3)} tq=${brk(diW).net.toFixed(0)}`);
      }
    }
    if (String(ENV.CALC ?? '0') === '1' && tLift >= 0 && !calcDone && dtL >= Number(ENV.CALC_T ?? 2.0)) {
      calcDone = true;
      const sSide = supSide();
      const sfxC = sSide === 'l' ? '_l' : '_r';
      const exclC = new Set(['thigh', 'shin', 'foot', 'arch', 'mfoot'].map((p) => `${p}${sfxC}`));
      console.log(`══ CALC @+${dtL.toFixed(2)}s 支撑=${sSide} ══`);
      for (const ax of [0, 1, 2]) {
        for (const jn of ['hip', 'knee', 'foot']) {
          const diC = w.body.dofByName(`${jn}_${sSide}`, ax);
          if (diC < 0) continue;
          const d0C = w.body.dofs[diC]!;
          const uC = d0C.axisWorld, a0C = d0C.anchorWorld;
          let tauC = 0;
          for (const [kk, bi] of w.body.indexByKey.entries()) {
            if (exclC.has(kk)) continue;
            const rb = w.body.bodies[bi]!;
            const cC = rb.worldCom();
            const Fy = rb.mass() * w.world.gravity.y;
            tauC += uC[0]! * (-(cC.z - a0C[2]!) * Fy) + uC[2]! * ((cC.x - a0C[0]!) * Fy);
          }
          const appC = d0C.engineMotor ? (d0C.motorTqEst ?? 0) : brk(diC).net;
          console.log(`  ${`${jn}_${sSide}/${ax}`.padEnd(9)} 需求=${(-tauC).toFixed(1).padStart(7)}  应用=${appC.toFixed(1).padStart(7)}  上限=${(d0C.tauMax ?? 0).toFixed(0).padStart(4)}  角=${(d0C.angle * 57.29578).toFixed(1).padStart(6)}°`);
        }
      }
      const supFootC = ctl.sensors.feet[sSide === 'l' ? 0 : 1]!;
      console.log(`  脚: fz=${supFootC.fz.toFixed(0)}N  CoM−脚心(z)=${((ctl.sensors.com[2]! - supFootC.z) * 100).toFixed(1)}cm  等效侧踝矩=${(supFootC.fz * Math.abs(ctl.sensors.com[2]! - supFootC.z)).toFixed(1)}N·m`);
    }
    if (fallT >= 0 && dtL > fallT + 0.5) break;
    if (dtL > SCORE_T) break;
  }
  const rM = n ? (rollS / n) * DEG : 0, pM = n ? (pitchS / n) * DEG : 0;
  const rSg = n ? (rollSgn / n) * DEG : 0, dzSg = n ? (dzSgn / n) * 100 : 0, dySg = n ? (dySgn / n) * 100 : 0;
  const dySd = n ? Math.sqrt(Math.max(0, dyS2 / n - (dySgn / n) * (dySgn / n))) * 100 : 0;
  const fzM = nfz ? fzS / nfz : 0;
  const fzSd = nfz ? Math.sqrt(Math.max(0, fzS2 / nfz - fzM * fzM)) : 0;
  console.log(`SCORE B=[${ENV.UPPER_B ?? '默认'}] K=${ENV.UPPER_K ?? 150} KN=${ENV.UPPER_KN ?? '-'} KP=${ENV.UPPER_KP ?? '-'} BSIDE=${ENV.UPPER_BSIDE ?? '-'} SCALE=${ENV.UPPER_SCALE ?? 1}  →  存活=${fallT < 0 ? `>${SCORE_T}s(未倒)` : fallT.toFixed(2) + 's'}  |roll|均=${rM.toFixed(1)}° 侧漂(带号)=${rSg.toFixed(1)}° 躯干dz=${dzSg.toFixed(1)}cm 髋dy=${dySg.toFixed(2)}±${dySd.toFixed(2)}cm(峰${(dyMax * 100).toFixed(1)})  |pitch|均=${pM.toFixed(1)}°  fz=${fzM.toFixed(0)}±${fzSd.toFixed(0)}N`);
  {
    const seg = [...supAcc.entries()].map(([k, a]) => {
      const m = a.s / Math.max(1, a.n);
      const sd = Math.sqrt(Math.max(0, a.s2 / Math.max(1, a.n) - m * m));
      const d = demAcc.get(k);
      const dm = d ? d.s / Math.max(1, d.n) : 0;
      const [nmK, axK] = k.split('/');
      const diK = w.body.dofByName(nmK!, Number(axK));
      const capK = diK >= 0 ? (drv as unknown as { pairCap: Float64Array }).pairCap[diK]! : Number.POSITIVE_INFINITY;
      return `${k}=${m.toFixed(0)}±${sd.toFixed(0)}(需求${dm.toFixed(0)},cap${Number.isFinite(capK) ? capK.toFixed(0) : '∞'})`;
    }).join('  ');
    console.log(`   支撑腿力矩(净值·窗口) vs 需求(上身+摆动腿+盆骨): ${seg || '无'}`);
  }
  if (String(ENV.PROPLOG ?? '0') === '1') {
    const g = (globalThis as { __PROPLOG?: Array<[number, string, number, string]> }).__PROPLOG ?? [];
    const lat = new Map<string, { n: number; s: number; last: number }>();
    for (const [di, kind, val, src] of g) {
      const nm = w.body.dofs[di]?.name ?? `d${di}`;
      if (!/^(hip|knee|foot|ankle|arch|mfoot)_/.test(nm)) continue;   // 下身
      const ax = w.body.dofs[di]?.axis;
      if (ax !== 0 && !/mfoot/.test(nm)) continue;   // 侧向=轴0（mfoot 全收）
      const k = `${nm}/${ax}|${kind}|${src}`;
      const a2 = lat.get(k) ?? { n: 0, s: 0, last: val };
      a2.n++; a2.s += val; a2.last = val; lat.set(k, a2);
    }
    console.log(`【提案日志·下身侧向(轴0)写手·自抬腿起】条目=${g.length}`);
    [...lat.entries()].sort((a3, b3) => b3[1].n - a3[1].n).slice(0, 20).forEach(([k, a3]) => {
      console.log(`  ${String(a3.n).padStart(6)}× ${k.padEnd(40)} 均=${(a3.s / a3.n).toFixed(3)} last=${a3.last.toFixed(3)}`);
    });
  }
  if (WLOG) {
    const g = (globalThis as { __WRITELOG?: Array<[number, number, string, number, string]> }).__WRITELOG ?? [];
    const agg = new Map<string, { n: number; last: number; kind: string; caller: string }>();
    for (const [, di, kind, val, st] of g) {
      if (kind === 'exec') continue;   // 只看"命令层"写手
      const frames = st.split('|').map((s) => s.trim());
      const caller = frames.find((f) => !/Drive\.(trace|setTorque|setAngle|commandMusclePair)|ManualControl\.(setAngle|step)|Executor\./.test(f)) ?? frames[0] ?? '';
      const callerShort = caller.replace(/.*[\\/]core[\\/]/, '').replace(/\(.*$/, '').trim().slice(0, 46);
      const nm = w.body.dofs[di]?.name ?? `dof${di}`;
      const key = `${kind}|${nm}|${callerShort}`;
      const a = agg.get(key) ?? { n: 0, last: val, kind, caller: callerShort };
      a.n++; a.last = val; agg.set(key, a);
    }
    console.log(`【WLOG·全身体写手普查·末段】条目=${g.length}  唯一(通道×关节×写手)=${agg.size}`);
    [...agg.values()].sort((a, b) => b.n - a.n).slice(0, 24).forEach((a) => {
      console.log(`  ${String(a.n).padStart(6)}× ${a.kind.padEnd(5)} ${a.caller.padEnd(46)} last=${a.last.toFixed(1)}`);
    });
  }
}
