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
log('══ A. 结构（真实人脚形状的柔性足）══');
{
  const soleBodies = sk.bodies.filter((b) => b.key === 'foot_l' || b.key === 'foot_r');
  const cubes = soleBodies.map((b) => b.colliders.filter((c) => c.shape === 'cuboid'));
  const massTotal = sk.bodies.reduce((s, b) => s + b.mass, 0);
  log(`   ${sk.bodies.length} 刚体 / ${sk.joints.length} 关节 / ${sk.bodies.reduce((s, b) => s + b.colliders.length, 0)} 碰撞体 / ${massTotal.toFixed(2)} kg / ${sk.totalHeight.toFixed(3)} m`);
  log(`   鞋底 = 每侧 ${cubes[0]!.length} 块（足跟 / 外侧柱 / 内侧弓·后 / 内侧弓·前 / 跖骨头 / 趾）`);
  check('鞋底 collider = 每侧 6 块', cubes.every((c) => c.length === 6), cubes.map((c) => c.length).join('/'));
  for (const b of soleBodies) {
    check(`${b.key} 质量 = 其 collider 质量之和`,
      Math.abs(b.colliders.reduce((s, c) => s + c.mass, 0) - b.mass) < 1e-6,
      `${b.mass.toFixed(3)} kg`);
  }
  // ★ 内侧弓必须**离地**（这是侧向 CoP 权限的来源，见 skeleton.buildSoleBlocks 注释）
  {
    const soleBottom = Math.min(...soleBodies[0]!.colliders.map((c) => c.offsetY - c.hy));
    const arch = soleBodies[0]!.colliders.filter((c) => (c as unknown as { _label?: string })._label?.includes('内侧弓'));
    const gnd = soleBodies[0]!.colliders.filter((c) => !(c as unknown as { _label?: string })._label?.includes('内侧弓'));
    const archRise = Math.min(...arch.map((c) => c.offsetY - c.hy)) - soleBottom;
    const gndLow = Math.min(...gnd.map((c) => c.offsetY - c.hy)) - soleBottom;
    log(`   鞋底平面 y=${(soleBottom * 1000).toFixed(1)}mm；内侧弓最低点高出 ${(archRise * 1000).toFixed(1)}mm；接地块高出 ${(gndLow * 1000).toFixed(1)}mm`);
    check('★ 内侧弓离地（>10mm），接地块着地（<2mm）',
      archRise > 0.010 && gndLow < 0.002, `弓 ${(archRise * 1000).toFixed(1)}mm / 底 ${(gndLow * 1000).toFixed(1)}mm`);
    // ★ 两条载荷路径是按**足弓区的 x 区间**分开的（不是按 z）：
    //   外侧柱 x∈[-0.435,-0.145]（着地）· 内侧弓 x∈[-0.435,0.145]（离地）
    //   ⇒ 在共存的 x 区间里，内侧离地、外侧着地 = Jeon & Cho 说的两条独立路径。
    const col = soleBodies[0]!.colliders.find((c) => (c as unknown as { _label?: string })._label === '外侧柱');
    const archB = soleBodies[0]!.colliders.filter((c) => (c as unknown as { _label?: string })._label?.includes('内侧弓'));
    if (col && archB.length) {
      const colOut = col.offsetZ + col.hz;          // 外侧柱靠外侧缘（−z）
      const archIn = Math.min(...archB.map((c) => c.offsetZ - c.hz));
      log(`   足弓区：外侧柱外缘 z=${(colOut * 1000).toFixed(0)}mm（着地）  内侧弓内缘 z=${(archIn * 1000).toFixed(0)}mm（离地）`);
      check('★ 足弓区内侧（弓）与外侧（柱）在 z 上分开 ⇒ 两条独立载荷路径',
        colOut < archIn - 1e-6, `柱外缘 ${(colOut * 1000).toFixed(0)}mm < 弓内缘 ${(archIn * 1000).toFixed(0)}mm`);
    } else {
      warn('找不到"外侧柱"/"内侧弓"块（块名变了？）', JSON.stringify(soleBodies[0]!.colliders.map((c) => (c as unknown as { _label?: string })._label)));
    }
  }
  const aj = sk.joints[ANK_L]!;
  check('踝是 revolute（矢状轴 2；额状轴被引擎锁死）', !!aj.revoluteAxis,
    `axis=[${aj.revoluteAxis?.join(',')}] 限位 ${(aj.minRad[2]! * DEG).toFixed(0)}~${(aj.maxRad[2]! * DEG).toFixed(0)}° τmax=${aj.maxTorque[2]}`);
  check('★ 已无 `forefoot_*` 刚体 / `midfoot_*` 关节（改为弓形几何给权限）',
    !sk.bodies.some((b) => b.key.startsWith('forefoot_')) && !sk.joints.some((j) => j.name.startsWith('midfoot_')),
    `${sk.bodies.length} 刚体 / ${sk.joints.length} 关节`);
}
log('');
log('══ B. 反馈权限（护栏 `|imp| ≤ α·|err|·Ieff·groundFactor` 放行了百分之多少）══');
{
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 3 });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER, balance: DEFAULT_CONTROLLER.balance });
  const d = sim.doll;
  log('   关节            I_eff(自由)  groundFactor  反馈权限');
  const rows: [string, number, number][] = [
    ['踝 foot_l', ANK_L, 2], ['膝 knee_l', jointIndexByName(sk, 'knee_l'), 2], ['髋 hip_l', HIP_L, 2],
  ];
  let ankAuth = 0;
  for (const [nm, idx, ax] of rows) {
    const gf = d.ankleGroundFactorUsed[idx]!;
    const auth = d.motorAuthority[idx * 3 + ax]!;
    if (idx === ANK_L) ankAuth = auth;
    log(`   ${nm.padEnd(15)} ${d.jointIeff[idx]!.toFixed(5).padStart(9)} ${gf.toFixed(2).padStart(12)}`
      + ` ${(auth * 100).toFixed(0).padStart(9)}%`);
  }
  check('★ 踝的反馈权限不再是 1%（真实脚形状让脚掌重 7 倍 ⇒ Ieff 0.00153→0.0106）',
    ankAuth > 0.05, `${(ankAuth * 100).toFixed(1)}%`);
  log(`   · 注：脚掌质量 0.51→1.02 kg、Ieff 0.00153→0.0106（×6.9）⇒ 踝权限 1%→${(ankAuth * 100).toFixed(0)}%`);
}

log('');
log('══ C. CoP 读回的接触面筛选（尺子本身对不对）══');
log('   判据：接触法线必须与该鞋底块**自己的底面**对齐（|n·bottom| ≥ 0.7）');
log('   修之前只按 |n·y| ≥ 0.5 ⇒ 倾倒时鞋底**侧面**也被算成接触面，');
log('   读出 CoP_z = 391mm 而整只脚只有 100mm 宽（Millard 参考脚）—— 物理不可能。');
{
  // 造一个必然侧翻的构型：把左脚踝 commanded到 +18°（跖屈极限）并持续推，
  // 侧翻后侧面会贴地；此时 CoP_z 必须仍落在鞋底宽度内。
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 1.2 });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER, balance: DEFAULT_CONTROLLER.balance });
  const cop = new Float64Array(4);
  const bb = new Float64Array(4);
  sim.doll.footSoleBounds(0, bb);
  let n = 0, tiltMax = 0, worstOut = 0, worstTiltAt = 0;
  const sole = new Float64Array(3);
  for (let i = 0; i < 144 && !sim.finished; i++) {
    if (i % 2 === 0) {
      const out = ctrl.step(1 / 60);
      out[ANK_L * 3 + 2] = 1.0;                 // 踝跖屈打满
      sim.doll.setMotorTargets(out);
    }
    sim.advance(1);
    sim.doll.readCoP(0, cop);
    sim.doll.footSoleBounds(0, bb);
    const tilt = Math.abs(ctrl.snapshot.tiltDeg);
    tiltMax = Math.max(tiltMax, tilt);
    if (cop[3]! > 0) {
      n++;
      // ★ 判据：CoP 必须落在**世界系鞋底包围盒**内。
      //   不能拿"世界 z vs 刚体轴"比 —— 外八偏航（~25°）会把局部 x 混进世界 z，
      //   实测让局部 z=0 的跟块接触点看起来偏了 59mm，那是坐标换算假象不是错读。
      const outX = Math.max(bb[0]! - cop[0]!, 0, cop[0]! - bb[1]!);
      const outZ = Math.max(bb[2]! - cop[2]!, 0, cop[2]! - bb[3]!);
      const outM = Math.max(outX, outZ);
      if (outM > worstOut) { worstOut = outM; worstTiltAt = tilt; }
    }
  }
  log(`   鞋底世界包围盒：x∈[${(bb[0]! * 1000).toFixed(0)},${(bb[1]! * 1000).toFixed(0)}]mm  z∈[${(bb[2]! * 1000).toFixed(0)},${(bb[3]! * 1000).toFixed(0)}]mm`);
  const halfW = 0.05;    // SOLE_WIDTH_TARGET/2 = 50mm
  log(`   强制跖屈到极限（终倾角 ${tiltMax.toFixed(0)}°）：接触采样 ${n}，CoP 超出鞋底包围盒最大 ${(worstOut * 1000).toFixed(1)}mm（当时倾角 ${worstTiltAt.toFixed(0)}°）`);
  // ★ 用**相对脚掌**的偏移判：接触点必然落在鞋底某一块的面上，
  //   而所有块的 z 跨度都在 ±50mm 内 ⇒ |CoP_z − 脚掌中心 z| ≤ 50mm 是硬上限。
  check('★ CoP 始终落在**世界系鞋底包围盒**内（侧面没被当成底面）',
    worstOut <= 1e-3, `最大超出 ${(worstOut * 1000).toFixed(1)}mm / 上限 0mm`);
}

log('');
log('══ D. 鞋底六块的质量配比（volume → mass 归一是否合理）══');
{
  const f = sk.bodies.find((b) => b.key === 'foot_l')!;
  const rows = f.colliders.map((c) => ({
    lb: (c as unknown as { _label?: string })._label ?? '?',
    m: c.mass, x: c.offsetX, y: c.offsetY - c.hy,
  }));
  const tot = rows.reduce((a, b) => a + b.m, 0);
  for (const r of rows) {
    log(`   ${r.lb.padEnd(12)} ${(r.m * 1000).toFixed(0).padStart(5)}g  ${((r.m / tot) * 100).toFixed(0).padStart(3)}%  底面 y=${(r.y * 1000).toFixed(1)}mm`);
  }
  const heel = rows.find((r) => r.lb === '足跟')!.m;
  const arch = rows.filter((r) => r.lb.includes('内侧弓')).reduce((a, b) => a + b.m, 0);
  const meta = rows.filter((r) => r.lb.startsWith('跖') || r.lb === '趾').reduce((a, b) => a + b.m, 0);
  check('★ 跖骨+趾的质量 > 足跟（真实人脚前足承重更多）', meta > heel,
    `前足 ${(meta * 1000).toFixed(0)}g vs 足跟 ${(heel * 1000).toFixed(0)}g`);
  void arch;
}

log('══ E. ★ 侧向载荷走哪条路（按你的序列：重心压到左腿 → 维持平衡）══');
log('   设计依据（skeleton 鞋底注释）：内侧弓两块**天生离地 22mm**');
log('   ⇒ 重心压到支撑腿内侧时内侧弓本来就不承压，载荷直接转外侧缘/跖骨');
log('   ⇒ 侧向 CoP 权限是弓形几何**白送**的，不需要中足关节。');
log('   判据：单支撑相里，内侧弓载荷应 ≈ 0（它离地），载荷落在外侧柱+跖骨。');
{
  const run = (bearer: 'l' | 'r', dur = 4.0) => {
    const s2 = buildSkeleton(DEFAULT_CONFIG);
    const sim = new Sim(s2, shapeForJoints(s2.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: dur });
    sim.begin(new Float32Array(sim.paramCount));
    const ctrl = new Controller(s2, sim, {
      ...DEFAULT_CONTROLLER,
      gait: { ...DEFAULT_CONTROLLER.gait, startBearer: bearer, liftHold: 0 },
      balance: DEFAULT_CONTROLLER.balance,
    });
    const side = bearer === 'l' ? 0 : 1;
    const d = sim.doll;
    const labels = d.soleBlockLabels(side);
    const blk = new Float64Array(labels.length);
    const cop = new Float64Array(4);
    const bb = new Float64Array(4);
    let n = 0;
    const sum = new Float64Array(labels.length);
    let loadMin = 1e9, loadMax = -1e9, sumLoad = 0, singleTicks = 0;
    const phaseCount: Record<string, number> = {};
    for (let i = 0; i < dur * 120 && !sim.finished; i++) {
      if (i % 2 === 0) d.setMotorTargets(ctrl.step(1 / 60));
      sim.advance(1);
      const ph = ctrl.snapshot.phase;
      phaseCount[ph] = (phaseCount[ph] ?? 0) + 1;
      if (ctrl.snapshot.stanceSingle) {
        singleTicks++;
        d.soleBlockLoad(side, blk);
        d.readCoP(side, cop);
        let tot = 0;
        for (let k = 0; k < blk.length; k++) { sum[k] += blk[k]!; tot += blk[k]!; }
        const totN = tot * 120;
        sumLoad += totN;
        loadMin = Math.min(loadMin, totN); loadMax = Math.max(loadMax, totN);
        n++;
      }
    }
    d.footSoleBounds(side, bb);
    return {
      labels, blocks: Array.from(sum).map((v) => (v * 120) / Math.max(1, n)), n, phaseCount,
      meanLoad: sumLoad / Math.max(1, n),
      loadMin: n ? loadMin / 120 : 0, loadMax: n ? loadMax / 120 : 0,
      soleZ: (bb[2]! + bb[3]!) / 2, secs: sim.ticksDone / 60, singleSecs: singleTicks / 120,
    };
  };

  const results: Record<string, ReturnType<typeof run>> = {};
  for (const bearer of ['l', 'r'] as const) {
    const r = run(bearer); results[bearer] = r;
    const ph = Object.entries(r.phaseCount).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${(v / 120).toFixed(2)}s`).join('  ');
    log(`   ── 承重腿 = ${bearer === 'l' ? '左' : '右'}：单支撑 ${r.singleSecs.toFixed(2)}s（采样 ${r.n} 拍），存活 ${r.secs.toFixed(2)}s`);
    log(`      相位：${ph}`);
    log(`      该腿载荷 ${r.meanLoad.toFixed(0)}N（范围 ${r.loadMin.toFixed(0)}~${r.loadMax.toFixed(0)}N）`);
    const isArch = (l: string) => l.includes('内侧弓');
    for (let k = 0; k < r.labels.length; k++) {
      const share = r.meanLoad > 1 ? (r.blocks[k]! / r.meanLoad) * 100 : 0;
      log(`        ${r.labels[k]!.padEnd(14)}${r.blocks[k]!.toFixed(0).padStart(5)}N ${share.toFixed(0).padStart(4)}%`
        + `${isArch(r.labels[k]!) ? '   ← 离地 22mm' : ''}`);
    }
    const arch = r.labels.reduce((a, l, k) => a + (isArch(l) ? r.blocks[k]! : 0), 0);
    log(`      内侧弓合计 ${arch.toFixed(0)}N = 总载荷的 ${(arch / Math.max(1, r.meanLoad) * 100).toFixed(0)}%`);
  }
  const rL = results['l']!;
  const isArch = (l: string) => l.includes('内侧弓');
  const arch = rL.labels.reduce((a, l, k) => a + (isArch(l) ? rL.blocks[k]! : 0), 0);
  check('★ 内侧弓（离地 22mm）在单支撑下基本不承压（< 总载荷 15%）',
    arch / Math.max(1, rL.meanLoad) < 0.15,
    `${arch.toFixed(0)}N / ${rL.meanLoad.toFixed(0)}N = ${(arch / Math.max(1, rL.meanLoad) * 100).toFixed(0)}%`);
  check('★ 承重腿有实际载荷（>100N，说明单支撑真的建立了）',
    rL.meanLoad > 100, `${rL.meanLoad.toFixed(0)}N`);
  check('★ 存在单支撑相（状态机能走到 SINGLE）', rL.singleSecs > 0.05, `${rL.singleSecs.toFixed(2)}s`);
}

log('══ E2. ★ 为什么进不了单支撑（用户 2026-10-04：「刻意让重心转移到左腿上，');
log('        并且维持平衡，然后才能实现迈腿」—— 实测相位全程 DOUBLE）══');
{
  const s2 = buildSkeleton(DEFAULT_CONFIG);
  const sim = new Sim(s2, shapeForJoints(s2.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 4 });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(s2, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
    balance: DEFAULT_CONTROLLER.balance,
  });
  log('    t     相位     L载荷  R载荷  主导   承重腿  CoM.z   qVip    τ踝    踝角   倾角  前腿');
  const rv = new Float64Array(3);
  for (let i = 0; i < 480 && !sim.finished; i++) {
    if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
    sim.advance(1);
    if (i % 20 !== 0) continue;
    const s = ctrl.snapshot;
    sim.doll.jointRot(ANK_L, rv);
    const L = s.legs.l.loadFrac, R = s.legs.r.loadFrac;
    log(`   ${(i / 120).toFixed(2).padStart(5)}s ${s.phase.padEnd(8)}`
      + ` ${(L * 100).toFixed(0).padStart(4)}% ${(R * 100).toFixed(0).padStart(4)}%`
      + `  ${L > R ? 'L' : 'R'}     ${String(s.loadBearer ?? '—').padEnd(6)}`
      + ` ${(s.com.z * 1000).toFixed(0).padStart(5)}mm`
      + ` ${(s.qVip ?? 0).toFixed(3).padStart(6)} ${(s.ankleTauVip ?? 0).toFixed(1).padStart(6)}`
      + ` ${(rv[2]! * DEG).toFixed(1).padStart(6)}° ${s.tiltDeg.toFixed(0).padStart(5)}°`
      + `  ${String(s.frontLegSide ?? '—')}`);
  }
  log('');
  log('   判读：');
  log('     · L/R 载荷一直 50/50 ⇒ 重心没转移 ⇒ B4「主导腿持续 80ms」永不满足');
  log('       （`bearerLoadHyst = 0.45`，`bearerHoldSec = 0.08`；门禁是 gailState 的 X1..X8）');
  log('     · 要转移侧向重心，靠的是髋外展 + 踝/腰的额状通道 —— 这些都在被消融或权限不足');
  log('     · 承重腿一旦建立，后续 SHIFT→SINGLE→PUSH→STEP 才会按序列推进');
}

log('══ E3. ★ 侧向权重转移权限（= 单支撑的第一道门）══');
log('   站距 326mm ⇒ 完全把重心压到一条腿上需要 CoM.z 偏移 ≈ ±160mm。');
log('   实测目前只能到 ~28mm ⇒ 差 5~6 倍，这就是"进不了 SINGLE"的直接原因。');
{
  const run = (dollOv: Record<string, unknown>, balOv: Record<string, unknown>, dur = 3.0) => {
    const s2 = buildSkeleton(DEFAULT_CONFIG);
    const sim = new Sim(s2, shapeForJoints(s2.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: dur, doll: dollOv as never });
    sim.begin(new Float32Array(sim.paramCount));
    const ctrl = new Controller(s2, sim, {
      ...DEFAULT_CONTROLLER,
      gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
      balance: { ...DEFAULT_CONTROLLER.balance, ...balOv },
    });
    const d = sim.doll;
    const sole = new Float64Array(3), cop = new Float64Array(4);
    const wPk = new Float64Array(s2.joints.length);
    const rv = new Float64Array(3);
    let maxCom = 0, single = 0, slip = 0, px = 0, pz = 0, have = false;
    for (let i = 0; i < dur * 120 && !sim.finished; i++) {
      if (i % 2 === 0) d.setMotorTargets(ctrl.step(1 / 60));
      sim.advance(1);
      for (let jj = 0; jj < s2.joints.length; jj++) { d.jointRelVel(jj, rv); wPk[jj] = Math.max(wPk[jj], Math.abs(rv[2] ?? 0)); }
      if (i > 40) {
        const sn = ctrl.snapshot;
        maxCom = Math.max(maxCom, Math.abs(sn.com.z));
        if (sn.stanceSingle) single++;
        d.soleXZ('l', sole); d.readCoP(0, cop);
        if (cop[3]! > 1) { if (have) slip += Math.hypot(sole[0]! - px, sole[2]! - pz); px = sole[0]!; pz = sole[2]!; have = true; }
      }
    }
    const maxW = Math.max(...Array.from(wPk).map((v) => v * DEG));
    return { comMm: maxCom * 1000, singleSecs: single / 120, secs: sim.ticksDone / 60, slipMm: slip * 1000, maxW };
  };
  const NEED = 160;
  log('     配置                          |CoM.z|max   主导腿载荷   单支撑   存活');
  const CASES: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['全身12/脚12（当前）', {}, {}],
    ['全身0.04/脚12', { angularDamping: 0.04 }, {}],
    ['全身0.5/脚12', { angularDamping: 0.5 }, {}],
    ['全身2/脚12', { angularDamping: 2 }, {}],
    ['全身0.04/脚4', { angularDamping: 0.04, footAngularDamping: 4 }, {}],
    ['全身0.04/脚30', { angularDamping: 0.04, footAngularDamping: 30 }, {}],
  ];
  let best = 0;
  for (const [tag, dop, bop] of CASES) {
    const r = run(dop, bop);
    best = Math.max(best, r.comMm);
    log(`     ${tag.padEnd(18)} |CoM.z|${r.comMm.toFixed(0).padStart(5)}mm  滑移${r.slipMm.toFixed(0).padStart(4)}mm`
      + `  角速${r.maxW.toFixed(0).padStart(5)}°/s  单支撑${r.singleSecs.toFixed(2).padStart(5)}s  存活${r.secs.toFixed(2)}s`);
  }
  log(`   ⇒ 最好情况 |CoM.z| = ${best.toFixed(0)}mm，需要 ±${NEED}mm 才能压到一条腿上 ⇒ 差 ${(NEED / Math.max(1, best)).toFixed(1)} 倍`);
  check('★ 侧向权重转移权限足够（|CoM.z| > 120mm）', best > 120, `${best.toFixed(0)}mm / 需要 ${NEED}mm`);
}

log('══ E4. 内侧到底能不能承载（弓只抬了中足区，跖骨/足跟是全宽接地的）══');
{
  const s2 = buildSkeleton(DEFAULT_CONFIG);
  const sim = new Sim(s2, shapeForJoints(s2.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 2.5 });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(s2, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
    balance: DEFAULT_CONTROLLER.balance,
  });
  const d = sim.doll;
  const labels = d.soleBlockLabels(0);
  const blk = new Float64Array(labels.length);
  const cop = new Float64Array(4);
  const bb = new Float64Array(4);
  d.footSoleBounds(0, bb);
  const zMid = (bb[2]! + bb[3]!) / 2;
  const halfZ = (bb[3]! - bb[2]!) / 2;
  let n = 0;
  const sum = new Float64Array(labels.length);
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < 300 && !sim.finished; i++) {
    if (i % 2 === 0) d.setMotorTargets(ctrl.step(1 / 60));
    sim.advance(1);
    if (i < 60) continue;
    d.soleBlockLoad(0, blk);
    d.readCoP(0, cop);
    let tot = 0;
    for (let k = 0; k < blk.length; k++) { sum[k] += blk[k]!; tot += blk[k]!; }
    if (tot > 0) {
      n++;
      d.footSoleBounds(0, bb);
      if (cop[3]! > 0) { zMin = Math.min(zMin, cop[2]!); zMax = Math.max(zMax, cop[2]!); }
    }
  }
  log(`   鞋底世界 z 跨度 ${(bb[2]! * 1000).toFixed(0)}~${(bb[3]! * 1000).toFixed(0)}mm（半宽 ${(halfZ * 1000).toFixed(0)}mm，中点 ${(zMid * 1000).toFixed(0)}mm）`);
  log('   静立时逐块载荷（左脚，承重采样 ' + n + ' 拍）：');
  const totN = Array.from(sum).reduce((a, b) => a + b, 0) * 120 / Math.max(1, n);
  for (let k = 0; k < labels.length; k++) {
    const N = sum[k]! * 120 / Math.max(1, n);
    log(`     ${labels[k]!.padEnd(14)}${N.toFixed(0).padStart(5)}N  ${(N / Math.max(1, totN) * 100).toFixed(0).padStart(3)}%`);
  }
  const relMin = (zMin - zMid) * 1000, relMax = (zMax - zMid) * 1000;
  log(`   CoP_z 相对足中心：${relMin.toFixed(0)} ~ ${relMax.toFixed(0)}mm（半宽 ±${(halfZ * 1000).toFixed(0)}mm）`);
  const needHalf = 163;   // 完全压到单腿需要的 CoM 偏移
  log(`   ⇒ 足能提供的侧向 CoP 半程 ≈ ±${Math.max(Math.abs(relMin), Math.abs(relMax)).toFixed(0)}mm，单腿需要 ${needHalf}mm`);
  check('★ 足能提供的侧向 CoP 半程 > 40mm（够不够把载荷集中到一条腿）',
    Math.max(Math.abs(relMin), Math.abs(relMax)) > 40,
    `±${Math.max(Math.abs(relMin), Math.abs(relMax)).toFixed(0)}mm`);
}

log('══ E5. 真正的堵点：矢状面发散（"维持平衡"是第一道门 laterally 之前）══');
{
  for (const [tag, ov] of [['开踝 15体', {}], ['关踝 13体', { ankleEnabled: false }]] as [string, Record<string, unknown>][]) {
    const s2 = buildSkeleton({ ...DEFAULT_CONFIG, ...ov } as never);
    const sim = new Sim(s2, shapeForJoints(s2.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 4 });
    sim.begin(new Float32Array(sim.paramCount));
    const ctrl = new Controller(s2, sim, {
      ...DEFAULT_CONTROLLER,
      gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
      balance: DEFAULT_CONTROLLER.balance,
    });
    const ankI = jointIndexByName(s2, 'foot_l');
    const rv = new Float64Array(3);
    log(`   ── ${tag}`);
    log('      t     qVip    τ踝    踝角    躯干y   倾角   CoM.x   碰地');
    for (let i = 0; i < 480 && !sim.finished; i++) {
      if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
      sim.advance(1);
      if (i % 24) continue;
      const sn = ctrl.snapshot;
      sim.doll.jointRot(ankI, rv);
      log(`      ${(i / 120).toFixed(2).padStart(5)}s ${(sn.qVip ?? 0).toFixed(3).padStart(6)}`
        + ` ${(sn.ankleTauVip ?? 0).toFixed(0).padStart(6)} ${(rv[2]! * DEG).toFixed(1).padStart(6)}°`
        + ` ${sim.doll.torso().translation().y.toFixed(3).padStart(6)}`
        + ` ${sn.tiltDeg.toFixed(0).padStart(5)}° ${(sn.com.x * 1000).toFixed(0).padStart(6)}mm`
        + `   ${sim.finished ? sim.fallReason : ''}`);
    }
    log(`      ⇒ 存活 ${(sim.ticksDone / 60).toFixed(2)}s  死因=${sim.fallReason || '（未倒）'}  碰地刚体=${sim.doll.lastHitKey || '无'}`);
  }
}

log('══ F. DIP/VIP 接线（Morasso 2019/2022）══');
{
  const { AXIS_OWNERSHIP, ANKLE_ABSENT, axisRole } = await import('../src/core/systems/balance');
  check('踝矢状 = 力矩通道（VIP 刚度）已登记',
    axisRole('foot_l', 2)?.role === 'ankleCop', JSON.stringify(axisRole('foot_l', 2)?.mode));
  check('髋矢状 = 被动刚度力矩已登记（从属于 sagSupport）',
    AXIS_OWNERSHIP.some((a) => a.role === 'hipStiff' && a.joint === 'hip' && a.axis === 2 && a.mode === 'tau'));
  check('★ 侧向 CoP 不再挂在任何关节上（靠内侧弓几何，踝额状轴被引擎锁死）',
    !sk.joints.some((j) => j.name.startsWith('midfoot_')),
    '关节表里没有 midfoot_* ⇒ balance.ts 的 jMid = −1，额状通道不会被误认为在工作');
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