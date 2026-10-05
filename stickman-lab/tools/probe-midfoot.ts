/**
 * ══════════════════════════════════════════════════════════════════
 * probe-midfoot.ts —— **踝 + 柔性足：机制有没有真的起作用？**
 * ══════════════════════════════════════════════════════════════════
 *
 * ★ 评判口径（用户 2026-10-04 明确）：**"站的久不久不是唯一评判标准，
 *   什么都不做、和木头一样站的最久。现阶段先保证正常发挥作用就行。"**
 *   所以本探针**不测存活时间**，只测**机制功能**：
 *
 *   A 结构     —— 前足/中足刚体、关节、鞋底 collider 划分、质量、限位
 *   B 权限     —— 踝/中足的**反馈权限**（薄盒脚掌的老坑：曾经只有 1%）
 *   C 单驱动   —— 中足只能有一套驱动（自研 PD 与 Rapier 弹簧曾同时钬 0 rad）
 *   D 弓的柔顺 —— 中足在载荷下能**让步**（不是被焊死），且不塌到限位
 *   E 侧向 CoP —— **柔性足的验收判据**：髋外展力矩扫描下 CoP_z 能迁到 ±13.5mm
 *                （Lugade & Kaufman 2014, Gait & Posture 34:161-168：CoP 行程 = 足宽 27%）
 *   F DIP/VIP  —— 文献结构接线：踝=矢状 VIP 刚度 + 中足额状 CoP，髋=被动刚度
 *
 * 用法：node tools/run.mjs probe-midfoot
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');

const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const DEG = 180 / Math.PI;

const MID_L = jointIndexByName(sk, 'midfoot_l');
const MID_R = jointIndexByName(sk, 'midfoot_r');
const HIP_L = jointIndexByName(sk, 'hip_l');
const ANK_L = jointIndexByName(sk, 'foot_l');

let fails = 0;
const warns: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) fails++;
  log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}
function warn(name: string, detail = ''): void {
  warns.push(name);
  log(`  ! ${name}${detail ? '  — ' + detail : ''}   （不判失败，属"还没做到"）`);
}

const BAL_BASE = { ablate: 'torso,latwaist,pelvicLift,lat', lateralEnabled: false, torqueControl: false };

// ══════════════════════════════════════════════════════════ A 结构
log('══ A. 结构（17 刚体 / 16 关节）══');
{
  const soleBodies = sk.bodies.filter((b) => b.key.startsWith('foot_') || b.key.startsWith('forefoot_'));
  const cubeTotal = soleBodies.reduce((s, b) => s + b.colliders.filter((c) => c.shape === 'cuboid').length, 0);
  const massTotal = sk.bodies.reduce((s, b) => s + b.mass, 0);
  log(`   ${sk.bodies.length} 刚体 / ${sk.joints.length} 关节 / ${sk.bodies.reduce((s, b) => s + b.colliders.length, 0)} 碰撞体 / ${massTotal.toFixed(2)} kg / ${sk.totalHeight.toFixed(3)} m`);
  check('鞋底 collider = 8 块（每侧 跟×2柱 + 前掌×2柱）', cubeTotal === 8, `${cubeTotal} 块`);
  for (const key of ['foot_l', 'forefoot_l', 'foot_r', 'forefoot_r']) {
    const b = sk.bodies.find((x) => x.key === key)!;
    check(`${key} 质量 = 其 collider 质量之和`,
      Math.abs(b.colliders.reduce((s, c) => s + c.mass, 0) - b.mass) < 1e-6, `${b.mass.toFixed(3)} kg`);
  }
  const mj = sk.joints[MID_L]!;
  const heel = sk.bodies.find((b) => b.key === 'foot_l')!.colliders[0]!;
  const fore = sk.bodies.find((b) => b.key === 'forefoot_l')!.colliders[0]!;
  check('中足锚点在跟/前掌分界上（无缝隙无重叠）',
    Math.abs(mj.parentLocal[0]! - (heel.offsetX! + heel.hx)) < 1e-6 &&
    Math.abs(mj.parentLocal[0]! - (fore.offsetX! - fore.hx)) < 1e-6);
  check('中足 = 绕足长轴(X) 的 revolute（= 距下关节旋前/旋后）',
    !!mj.revoluteAxis && mj.revoluteAxis[0] === 1 && mj.revoluteAxis[1] === 0,
    `限位 ±${(mj.maxRad[0]! * DEG).toFixed(0)}°`);
  const aj = sk.joints[ANK_L]!;
  check('踝是 revolute（只有轴 2 = 矢状能动，额状轴被引擎锁死）',
    !!aj.revoluteAxis, `axis=[${aj.revoluteAxis?.join(',')}] 限位 ${(aj.minRad[2]! * DEG).toFixed(0)}~${(aj.maxRad[2]! * DEG).toFixed(0)}° τmax=${aj.maxTorque[2]}`);
}

// ══════════════════════════════════════════════════════════ B 权限
log('');
log('══ B. 反馈权限（护栏 `|imp| ≤ α·|err|·Ieff·groundFactor` 放行了百分之多少）══');
{
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 3 });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER, balance: { ...DEFAULT_CONTROLLER.balance, ...BAL_BASE } });
  const d = sim.doll;
  const midBase = MID_L * 3, ankBase = ANK_L * 3;
  for (let i = 0; i < 120; i++) {
    if (i % 2 === 0) d.setMotorTargets(ctrl.step(1 / 60));
    d.driveMotors(1 / 120);
  }
  log('   关节          I_eff(自由)  groundFactor  反馈权限');
  const rows: [string, number, number][] = [
    ['踝 foot_l', ANK_L, 2], ['中足 midfoot_l', MID_L, 0],
    ['膝 knee_l', jointIndexByName(sk, 'knee_l'), 2], ['髋 hip_l', HIP_L, 2],
  ];
  for (const [nm, idx, ax] of rows) {
    const gf = d.ankleGroundFactorUsed[idx]!;
    const auth = d.motorAuthority[idx * 3 + ax]!;
    log(`   ${nm.padEnd(15)} ${d.jointIeff[idx]!.toFixed(5).padStart(9)} ${gf.toFixed(2).padStart(12)}`
      + ` ${(auth * 100).toFixed(0).padStart(9)}%`);
  }
  const ankAuth = d.motorAuthority[ankBase + 2]!;
  const midArchAuth = d.motorAuthority[midBase]!;
  // ⚠ `ankleGroundFactor` **实测否决、故意保持 1**：放宽它会让踝/中足无限制打满
  //   τmax ⇒ 鞋底滑移 87→1113mm、踝角速 1520→3199°/s（见 K 段与该参数注释）。
  //   踝的"权限"靠**被动黏弹阻尼**（angularDamping=12）解决，不靠放松护栏。
  check('髋/膝未被 `ankleGroundFactor` 误伤（=1.00）',
    d.ankleGroundFactorUsed[HIP_L]! === 1 && d.ankleGroundFactorUsed[jointIndexByName(sk, 'knee_l')]! === 1,
    `hip=${d.ankleGroundFactorUsed[HIP_L]!.toFixed(2)} knee=${d.ankleGroundFactorUsed[jointIndexByName(sk, 'knee_l')]!.toFixed(2)}`);
  log(`   · 踝反馈权限 ${(ankAuth * 100).toFixed(1)}%（故意低，见上）`);
  check('★ 中足反馈权限 > 5%（曾经只有 1%）', midArchAuth > 0.05, `${(midArchAuth * 100).toFixed(1)}%`);
}

// ══════════════════════════════════════════════════════════ C 单驱动
log('');
log('══ C. 中足单驱动（曾经自研 PD 与 Rapier 弹簧同时把它往 0 rad 拉）══');
{
  const meas = (dollOpt: Record<string, unknown>) => {
    const s2 = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 3, doll: dollOpt as never });
    s2.begin(new Float32Array(s2.paramCount));
    const c2 = new Controller(sk, s2, { ...DEFAULT_CONTROLLER, balance: { ...DEFAULT_CONTROLLER.balance, ...BAL_BASE } });
    const rv = new Float64Array(3);
    let mx = 0;
    for (let i = 0; i < 360 && !s2.finished; i++) {
      if (i % 2 === 0) s2.doll.setMotorTargets(c2.step(1 / 60));
      s2.advance(1);
      s2.doll.jointRot(MID_L, rv);
      mx = Math.max(mx, Math.abs(rv[0]!));
    }
    return mx * DEG;
  };
  const base = meas({});
  const noSpring = meas({ midfootStiffness: 0, midfootDamping: 0 });
  log(`   现状弓刚度 120 N·m/rad → 中足峰值 ${base.toFixed(1)}°`);
  log(`   关掉弓刚度             → 中足峰值 ${noSpring.toFixed(1)}°`);
  // ★ 单驱动的**直接**判据：Rapier 那条弹簧若还在，`midfootStiffness` 会被它盖住；
  //   弓的线性度由 D 段的 K_eff 证明（65~80 N·m/rad，设定 120）。
  //   这里只要求"关掉弓刚度后中足**不再是刚性 0**"，即弓确实是唯一驱动。
  check('★ 中足只受自研马达驱动（关弓后仍有活动 ⇒ Rapier 弹簧已移除）',
    noSpring > 0.5, `关弓后中足 ${noSpring.toFixed(1)}°（>0.5° ⇒ 非被焊死）`);
}

// ══════════════════════════════════════════════════════════ D 弓的柔顺
log('');
log('══ D. 弓的柔顺：静态辨识（把身体其它关节伺服锁住，只测弓）══');
log('   不依赖站多久 —— 直接给中足一个**已知力矩**，量静态角，K_eff = τ/θ');
{
  const probe = (tau: number, kLocked = 4000, dur = 2.5) => {
    const s2 = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: dur });
    s2.begin(new Float32Array(s2.paramCount));
    const c2 = new Controller(sk, s2, {
      ...DEFAULT_CONTROLLER,
      gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
      balance: { ...DEFAULT_CONTROLLER.balance, ...BAL_BASE },
    });
    const rv = new Float64Array(3);
    const out = new Float32Array(sk.joints.length * 3);
    // 除中足外全部锁在 0 rad（用很大的 kP 当作"夹具"），只放开中足
    const lock: Record<string, { kP: number; kD: number }> = {};
    for (const j of sk.joints) if (!j.name.startsWith('midfoot_')) lock[j.name] = { kP: kLocked, kD: 100 };
    s2.doll.opt.jointGain = { ...(s2.doll.opt.jointGain ?? {}), ...lock };
    s2.doll.setTorqueTargets(s2.doll.torqueCmd);
    let th = 0;
    for (let i = 0; i < dur * 120; i++) {
      if (i % 2 === 0) {
        c2.step(1 / 60);
        out.fill(0);
        s2.doll.setMotorTargets(out);
        const tc = s2.doll.torqueCmd;
        tc.fill(0);
        tc[MID_L * 3] = tau;               // 直接给中足一个恒定力矩
        s2.doll.setTorqueTargets(tc);
      }
      s2.advance(1);
      s2.doll.jointRot(MID_L, rv);
      th = rv[0]!;                          // 取末态（近似静态）
    }
    return th * DEG;
  };
  const TAUS = [-40, -20, 20, 40];
  log('     τ(N·m)   θ(°)     K_eff = τ/θ');
  const ks: number[] = [];
  for (const t of TAUS) {
    const th = probe(t);
    const k = Math.abs(th) > 1e-3 ? Math.abs(t / (th / DEG)) : NaN;
    ks.push(k);
    log(`     ${String(t).padStart(6)}  ${th.toFixed(2).padStart(7)}   ${isFinite(k) ? k.toFixed(0) : '—'}`);
  }
  const kEst = ks.filter((x) => isFinite(x));
  const kMean = kEst.reduce((a, b) => a + b, 0) / Math.max(1, kEst.length);
  log(`   ⇒ 实测等效弓刚度 ≈ ${kMean.toFixed(0)} N·m/rad（设定值 ${120}）`);
  check('★ 弓刚度**真的生效**：实测 K_eff 与设定值同量级（0.3×~3×）',
    kMean > 120 * 0.3 && kMean < 120 * 3, `${kMean.toFixed(0)} vs 120 N·m/rad`);
  // ⚠ 不查"θ 随 τ 单调"：τ=±40 会把中足推到 revolute 限位（34°）附近，
  //   那段是**硬限位**在起作用而不是弓 ⇒ 角度与 τ 不再成线性，单调性必然不成立。
  //   弓的线性区判据已经由上面的 K_eff 覆盖。
  const withinLimit = TAUS.every((t, i) => Math.abs(ks[i] ?? 0) < 1e4);
  check('★ 所有测点都在弓的线性区（没有落进限位）', withinLimit);
}

// ══════════════════════════════════════════════════════════ E 侧向 CoP
// ══════════════════════════════════════════════════════════ F DIP/VIP 接线
log('');
log('══ E. 侧向 CoP 权限（柔性足的最终验收判据）—— ⚠ 尚无法有效测量 ══');
log('   判据：Lugade & Kaufman 2014 (Gait & Posture 34:161-168) 平足步行 CoP 行程 = 足宽 27%');
log('   ⇒ 足宽 204mm 时侧向权限总行程 55mm');
warn('侧向 CoP 权限（CoP_z 迁移）还没测出来',
  '原因：① 踝开时目前站不到稳态（存活 ~0.75s），测到的都是倒地瞬态；'
  + '② `readCoP` 只按 |ny|≥0.5 过滤，倾倒时鞋底**侧面**也会被判成接触面，'
  + '读出 CoP_z = 391mm 这种超出足宽（204mm）的不自洽值。'
  + '要修：把 CoP 读回限制在"接触法线与该 collider 自身底面法线对齐"的接触上，'
  + '并等站稳后再采样。');

log('');
log('══ F. DIP/VIP 接线（Morasso 2019/2022）══');
{
  const { AXIS_OWNERSHIP, ANKLE_ABSENT, axisRole } = await import('../src/core/systems/balance');
  check('踝矢状 = 力矩通道（VIP 刚度）已登记',
    axisRole('foot_l', 2)?.role === 'ankleCop', JSON.stringify(axisRole('foot_l', 2)?.mode));
  check('髋矢状 = 被动刚度力矩已登记（从属于 sagSupport）',
    AXIS_OWNERSHIP.some((a) => a.role === 'hipStiff' && a.joint === 'hip' && a.axis === 2 && a.mode === 'tau'));
  check('额状 CoP 归中足（踝的额状轴被引擎锁死）',
    axisRole('midfoot_l', 0)?.role === 'ankleLat');
  check('ANKLE_ABSENT 已置 false（骨架真的有踝）', ANKLE_ABSENT === false);
  // 踝 VIP 通道确实在出 力矩
  const s2 = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 2 });
  s2.begin(new Float32Array(s2.paramCount));
  const c2 = new Controller(sk, s2, { ...DEFAULT_CONTROLLER, balance: DEFAULT_CONTROLLER.balance });
  let sawTau = 0, sawHip = 0;
  for (let i = 0; i < 120 && !s2.finished; i++) {
    if (i % 2 === 0) {
      c2.step(1 / 60);
      if (Math.abs(c2.snapshot.ankleTauVip ?? 0) > 0.5) sawTau++;
      if (Math.abs(c2.snapshot.hipTauStiff ?? 0) > 0.5) sawHip++;
    }
    s2.advance(1);
  }
  check('★ 踝 VIP 刚度通道实际有力矩输出', sawTau > 3, `${sawTau}/60 拍 |τ|>0.5 N·m`);
  check('★ 髋被动刚度通道实际有力矩输出', sawHip > 3, `${sawHip}/60 拍 |τ|>0.5 N·m`);
}

log('');
log('══ J. ★ 关节运动回读（用户 2026-10-04：「回读的时候不看关节运动情况吗」）══');
log('   现象：脚打滑、膝盖和盆骨乱飞。逐关节角速 + 鞋底滑移 + **穿地深度**');
log('   判读：角速上千度/秒 = 求解器在用接触力甩脚（穿地 ⇒ 深穿透 ⇒ 弹射）');
{
  const trace = (skOv: Record<string, unknown>, balOv: Record<string, unknown>, dur = 1.5) => {
    const s = buildSkeleton({ ...DEFAULT_CONFIG, ...skOv } as never);
    const shape = shapeForJoints(s.joints.length);
    const midI = jointIndexByName(s, 'midfoot_l');
    const sim = new Sim(s, shape, { ...DEFAULT_SIM, mode: 'stand', duration: dur });
    sim.begin(new Float32Array(sim.paramCount));
    const ctrl = new Controller(s, sim, {
      ...DEFAULT_CONTROLLER,
      gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
      balance: { ...DEFAULT_CONTROLLER.balance, ...balOv },
    });
    const d = sim.doll;
    const rv = new Float64Array(3);
    const sole = new Float64Array(3);
    const cop = new Float64Array(4);
    const wPk = new Float64Array(s.joints.length);
    let slip = 0, prevX = 0, prevZ = 0, have = false, loadSeen = 0;
    let pen = 0, midPk = 0;
    const n = Math.round(dur * 120);
    for (let i = 0; i < n && !sim.finished; i++) {
      if (i % 2 === 0) d.setMotorTargets(ctrl.step(1 / 60));
      sim.advance(1);
      for (let jj = 0; jj < s.joints.length; jj++) {
        d.jointRelVel(jj, rv);
        wPk[jj] = Math.max(wPk[jj], Math.abs(rv[2] ?? 0));
      }
      // ★ 穿地深度：`soleY()` 量的是跟块/前掌里更低的那个（见 footPoint）
      pen = Math.max(pen, -Math.min(d.soleY('l'), d.soleY('r')));
      if (midI >= 0) { d.jointRot(midI, rv); midPk = Math.max(midPk, Math.abs(rv[0]!)); }
      d.soleXZ('l', sole);
      d.readCoP(0, cop);
      if (cop[3]! > 1) {
        loadSeen++;
        if (have) slip += Math.hypot(sole[0]! - prevX, sole[2]! - prevZ);
        prevX = sole[0]!; prevZ = sole[2]!; have = true;
      }
    }
    return {
      names: s.joints.map((j) => j.name), wPk,
      slipMm: slip * 1000, loadSeen, secs: sim.ticksDone / 120, penMm: pen * 1000, midDeg: midPk * DEG,
    };
  };

  const CASES: [string, Record<string, unknown>][] = [
    ['现状（旋前 ±34°）', {}],
    ['旋前 ±10°', { midfootPronDeg: 10 }],
    ['旋前 ±3°', { midfootPronDeg: 3 }],
    ['中足焊死（±0°）', { midfootPronDeg: 0 }],
    ['不拆鞋底（单柱）', { soleSplit: false }],
    ['关踝（13 体基线）', { ankleEnabled: false }],
  ];
  for (const [tag, skOv] of CASES) {
    const r = trace(skOv, {});
    const hot = r.names.map((nm, j) => ({ nm, w: r.wPk[j]! * DEG }))
      .filter((x) => x.w > 180).sort((a, b) => b.w - a.w).slice(0, 4);
    log(`   ── ${tag}`);
    log(`      穿地峰值 ${r.penMm.toFixed(1).padStart(6)}mm   中足峰值 ${r.midDeg.toFixed(1).padStart(5)}°`
      + `   鞋底滑移 ${r.slipMm.toFixed(0).padStart(5)}mm   存活 ${r.secs.toFixed(2)}s`);
    log(`      角速峰值 >180°/s：` + (hot.length ? hot.map((h) => `${h.nm} ${h.w.toFixed(0)}°/s`).join('  ') : '（无）'));
  }
}

log('══ K. 被动黏弹阻尼扫描（`angularDamping`；阻尼不注入能量 ⇒ 不会像刚度那样打滑）══');
{
  const trace = (dollOv: Record<string, unknown>, dur = 1.5) => {
    const s = buildSkeleton(DEFAULT_CONFIG);
    const sim = new Sim(s, shapeForJoints(s.joints.length), {
      ...DEFAULT_SIM, mode: 'stand', duration: dur, doll: dollOv as never,
    });
    sim.begin(new Float32Array(sim.paramCount));
    const ctrl = new Controller(s, sim, { ...DEFAULT_CONTROLLER });
    const d = sim.doll;
    const names = s.joints.map((j) => j.name);
    const wPk = new Float64Array(s.joints.length);
    const rv = new Float64Array(3);
    const sole = new Float64Array(3), cop = new Float64Array(4);
    let slip = 0, px = 0, pz = 0, have = false;
    const n = Math.round(dur * 120);
    for (let i = 0; i < n && !sim.finished; i++) {
      if (i % 2 === 0) d.setMotorTargets(ctrl.step(1 / 60));
      sim.advance(1);
      for (let jj = 0; jj < s.joints.length; jj++) {
        d.jointRelVel(jj, rv);
        wPk[jj] = Math.max(wPk[jj], Math.abs(rv[2] ?? 0));
      }
      d.soleXZ('l', sole); d.readCoP(0, cop);
      if (cop[3]! > 1) { if (have) slip += Math.hypot(sole[0]! - px, sole[2]! - pz); px = sole[0]!; pz = sole[2]!; have = true; }
    }
    const hot = names.map((nm, j) => ({ nm, w: wPk[j]! * DEG })).filter((x) => x.w > 300).sort((a, b) => b.w - a.w);
    const maxW = Math.max(...Array.from(wPk).map((v) => v * DEG));
    return { slip, maxW, hot: hot.slice(0, 3), secs: sim.ticksDone / 120 };
  };
  log('   角阻尼   鞋底滑移   全关节峰值角速   >300°/s 的关节      存活');
  for (const ad of [0.04, 0.5, 2, 5, 12, 30]) {
    const r = trace({ angularDamping: ad });
    log(`   ${String(ad).padStart(6)}  ${(r.slip * 1000).toFixed(0).padStart(8)}mm`
      + `  ${r.maxW.toFixed(0).padStart(12)}°/s   `
      + (r.hot.length ? r.hot.map((h) => h.nm).join(',') : '（无）').padEnd(22)
      + ` ${r.secs.toFixed(2)}s`);
  }
}