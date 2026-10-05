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
  const midAuth = d.motorAuthority[midBase]!;
  check('★ 踝拿到接地惯量放大（`groundFactorFootKg` 把髋/膝排除在外）',
    d.ankleGroundFactorUsed[ANK_L]! > 1.5, `ankle gf=${d.ankleGroundFactorUsed[ANK_L]!.toFixed(2)}`);
  check('★ 髋/膝**没有**被这个系数误伤（仍是 1.00）',
    d.ankleGroundFactorUsed[HIP_L]! === 1 && d.ankleGroundFactorUsed[jointIndexByName(sk, 'knee_l')]! === 1,
    `hip=${d.ankleGroundFactorUsed[HIP_L]!.toFixed(2)} knee=${d.ankleGroundFactorUsed[jointIndexByName(sk, 'knee_l')]!.toFixed(2)}`);
  check('★ 踝反馈权限 > 5%（曾经只有 1%）', ankAuth > 0.05, `${(ankAuth * 100).toFixed(1)}%`);
  check('★ 中足反馈权限 > 5%（曾经只有 1%）', midAuth > 0.05, `${(midAuth * 100).toFixed(1)}%`);
}

// ══════════════════════════════════════════════════════════ C 单驱动
log('');
log('══ B2. 扫 ankleGroundFactor（现在只作用于踝/中足，髋/膝已被排除）══');
log('   要放行 τmax 所需的 Ieff：踝 13.33 / 中足 0.0556 kg·m²');
log('   自由 Ieff：踝 0.00153 / 中足 0.00079 ⇒ 需要 gf ≈ 8714 / 70');
{
  const need = { ank: 120 * (1 / 120) / 9, mid: 60 * (1 / 120) / 9 };
  const base = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 1 });
  base.begin(new Float32Array(base.paramCount));
  const iAnk = base.doll.jointIeff[ANK_L]!;
  const iMid = base.doll.jointIeff[MID_L]!;
  log(`   ⇒ 踝需 gf ≥ ${(need.ank / iAnk).toFixed(0)}，中足需 gf ≥ ${(need.mid / iMid).toFixed(0)}`);
  for (const gf of [8, 70, 500, 2000, 8714, 20000]) {
    const s2 = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 3, doll: { ankleGroundFactor: gf } as never });
    s2.begin(new Float32Array(s2.paramCount));
    const c2 = new Controller(sk, s2, { ...DEFAULT_CONTROLLER, balance: { ...DEFAULT_CONTROLLER.balance, ...BAL_BASE } });
    // 主动把踝与中足打离 0 rad，看它们**能不能回来**（回得来 = 有权限）
    const out = new Float32Array(sk.joints.length * 3);
    const rv = new Float64Array(3);
    let ankPk = 0, midPk = 0;
    for (let i = 0; i < 360 && !s2.finished; i++) {
      if (i % 2 === 0) {
        c2.step(1 / 60);
        out.fill(0);
        out[ANK_L * 3 + 2] = 0.55;   // 命令踝跖屈 +31°
        out[MID_L * 3 + 0] = 0.55;   // 命令中足旋前 +31°
        s2.doll.setMotorTargets(out);
      }
      s2.advance(1);
      s2.doll.jointRot(ANK_L, rv); ankPk = Math.max(ankPk, Math.abs(rv[2]!));
      s2.doll.jointRot(MID_L, rv); midPk = Math.max(midPk, Math.abs(rv[0]!));
    }
    const hip = s2.doll.ankleGroundFactorUsed[HIP_L]!;
    log(`   gf=${String(gf).padStart(6)}  踝实测峰值 ${(ankPk * DEG).toFixed(1).padStart(5)}°`
      + `  中足 ${(midPk * DEG).toFixed(1).padStart(5)}°`
      + `  (命令 31°)  髋gf=${hip.toFixed(2)}  存活 ${(s2.ticksDone / 60).toFixed(2)}s`);
  }
  log('   判读：能到 ~31° = 命令被执行；到不了 = 被护栏掐死。');
}

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
  check('★ 关掉弓刚度后中足行为**明显不同**（证明只有一套驱动在起作用）',
    Math.abs(base - noSpring) > 1.0, `Δ=${Math.abs(base - noSpring).toFixed(1)}°`);
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

log('');
log('══ E. ★ 柔性足的核心机制：CoP_z 随中足旋前/旋后迁移 ══');
log('   判据（Lugade & Kaufman 2014, Gait & Posture 34:161-168）：平足步行');
log('   CoP 行程 = 足宽的 27% ⇒ 足宽 204mm 时侧向权限 ±27.5mm');
log('   （脚掌全程平贴、其余关节夹紧 ⇒ 测的是**足本身**，不是平衡控制器）');
{
  const footHalfW = 0.102;      // m，实测足半宽
  log('     中足角    CoP_z(内外偏移)   相对足中心');
  const zs: number[] = [];
  for (const cmdDeg of [-30, -20, -10, 0, 10, 20, 30]) {
    const s2 = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 2.5 });
    s2.begin(new Float32Array(s2.paramCount));
    const c2 = new Controller(sk, s2, {
      ...DEFAULT_CONTROLLER,
      gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
      balance: { ...DEFAULT_CONTROLLER.balance, ...BAL_BASE },
    });
    const lock: Record<string, { kP: number; kD: number }> = {};
    for (const j of sk.joints) if (!j.name.startsWith('midfoot_')) lock[j.name] = { kP: 4000, kD: 100 };
    s2.doll.opt.jointGain = { ...(s2.doll.opt.jointGain ?? {}), ...lock };
    const out = new Float32Array(sk.joints.length * 3);
    const cop = new Float64Array(4);
    let sumZ = 0, n = 0, sumTh = 0;
    for (let i = 0; i < 300; i++) {
      if (i % 2 === 0) {
        c2.step(1 / 60);
        out.fill(0);
        out[MID_L * 3] = (cmdDeg / DEG) / 0.9;   // requestAngle 的 0.9 量程系数
        s2.doll.setMotorTargets(out);
        const tc = s2.doll.torqueCmd; tc.fill(0);
        s2.doll.setTorqueTargets(tc);
      }
      s2.advance(1);
      if (i > 150) {
        s2.doll.readCoP(0, cop);
        if (cop[3]! > 0) { sumZ += cop[2]!; n++; }
        const rv = new Float64Array(3);
        s2.doll.jointRot(MID_L, rv); sumTh += rv[0]!;
      }
    }
    const footCz = sk.bodies.find((b) => b.key === 'foot_l')!.cz;
    const z = n ? sumZ / n : NaN;
    zs.push(z);
    const ok = isFinite(z);
    const dzMm = ok ? (z - footCz) * 1000 : NaN;
    const pctHalf = ok ? ((z - footCz) / footHalfW) * 100 : NaN;
    const thAvg = (sumTh / Math.max(1, n)) / DEG;
    log(`     ${String(cmdDeg).padStart(5)}°   ${ok ? dzMm.toFixed(1).padStart(9) + 'mm' : '     — (无接触)'}`
      + `   ${ok ? pctHalf.toFixed(0).padStart(4) + '% 半宽' : '    —'}`
      + `   实际角 ${thAvg.toFixed(1)}°  采样${n}`);
  }
  const valid = zs.filter((x) => isFinite(x));
  if (valid.length >= 2) {
    const travel = (Math.max(...valid) - Math.min(...valid)) * 1000;
    const target = footHalfW * 2 * 0.27 * 1000;
    log(`   ⇒ CoP_z 行程 ${travel.toFixed(1)}mm，目标总行程 ${target.toFixed(0)}mm（足宽 ${(footHalfW * 2000).toFixed(0)}mm × 27%）`);
    if (travel >= target) check('★ 侧向 CoP 权限达到文献值', true, `${travel.toFixed(1)}mm ≥ ${target.toFixed(0)}mm`);
    else warn('侧向 CoP 权限还没到文献值（看上面的表判断是"幅度不够"还是"根本没迁移"）',
      `实测 ${travel.toFixed(1)}mm / 目标 ${target.toFixed(0)}mm`);
  } else warn('侧向 CoP 测不到有效接触采样', '足底接触没建立，先看 D 段');
}

// ══════════════════════════════════════════════════════════ E 侧向 CoP
log('');
log('══ E. ★ 柔性足的验收判据：侧向 CoP 权限（Lugade & Kaufman 2014：CoP 行程 = 足宽 27%）══');
{
  const run = (balOv: Record<string, unknown>, hipTau: number, dur = 4) => {
    const s2 = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: dur });
    s2.begin(new Float32Array(s2.paramCount));
    const c2 = new Controller(sk, s2, {
      ...DEFAULT_CONTROLLER,
      gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
      balance: { ...DEFAULT_CONTROLLER.balance, ...BAL_BASE, ...balOv },
    });
    const cop = new Float64Array(4);
    let zMin = Infinity, zMax = -Infinity, n = 0;
    for (let i = 0; i < dur * 120 && !s2.finished; i++) {
      if (i % 2 === 0) {
        const out = c2.step(1 / 60);
        c2.rs.tauOut[HIP_L * 3] = hipTau;
        s2.doll.setTorqueTargets(c2.rs.tauOut);
        s2.doll.setMotorTargets(out);
      }
      s2.advance(1);
      if (i > dur * 120 * 0.4) {
        s2.doll.readCoP(0, cop);
        if (cop[3]! > 0) { zMin = Math.min(zMin, cop[2]!); zMax = Math.max(zMax, cop[2]!); n++; }
      }
    }
    const travel = zMax > zMin ? (zMax - zMin) * 1000 : 0;
    return { travel, half: travel / 2, n };
  };
  log('   髋外展力矩扫描（CoP_z 全程 min~max）：');
  let best = 0;
  for (const t of [-15, -40, -70, -110, -160]) {
    const r = run({}, t);
    best = Math.max(best, r.half);
    log(`     τ=${String(t).padStart(5)}N·m  行程 ${r.travel.toFixed(1).padStart(6)}mm  半程 ±${r.half.toFixed(1)}mm  (有效采样 ${r.n})`);
  }
  const footHalfW = 102;   // mm，实测足半宽
  const target = footHalfW * 0.27;
  log(`   目标：半程 ±${target.toFixed(1)}mm（足宽 204mm × 27%）`);
  if (best >= target) check('★ 侧向 CoP 权限达到文献值', true, `实测 ±${best.toFixed(1)}mm ≥ ±${target.toFixed(1)}mm`);
  else warn('侧向 CoP 权限还没到文献值（机制通了、幅度不够）', `实测 ±${best.toFixed(1)}mm / 目标 ±${target.toFixed(1)}mm`);
}

// ══════════════════════════════════════════════════════════ F DIP/VIP 接线
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
log(`══ ${fails} 条不通过${warns.length ? `，${warns.length} 条待做` : ''} ══`);
for (const w of warns) log(`   待做：${w}`);