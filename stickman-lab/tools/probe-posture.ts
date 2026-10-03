// ============================================================
// probe-posture —— 「到底站起来了没有」
// ============================================================
// 回答的问题：把 ①动作改 PD 位置目标 ②观测加 CoM/DCM ③适应度加 DCM 越界项
// 这三样补完之后，**站立这件事本身**成立了吗？
//
// ★ 为什么不能只看"行走训练的历史最佳分涨了多少"：
//   分数里混着 distance / velocity / lateral / energy / step 五个方向，
//   涨分可能来自"扑得更远"而不是"站得更稳"（历史最佳 3.57 那次就是全程判摔）。
//   ⇒ 必须有一个**只考核站立**的口径：把 locomotion 项关掉（`cfg.weights`），
//     只留 balance / upright / height / lateral / energy，看它能不能把 ξ 关在域内。
//
// 四段：
//   [A] 观测与支撑域口径自检（直接用 posture.ts 的真实函数，对照 probe-stability 的解析值）
//   [B] 零输出静息（**基线**）—— 补丁之前的状态，ξz 会一路漂出去
//   [C] 站桩训练 → 考核 best：域内占比 / ξ 峰值 / 是否跑满时长
//   [D] 行走训练（加 `walk` 参数才跑）
//
// 跑法：node tools/run.mjs probe-posture [gens] [pop] [sec]
//       node tools/run.mjs probe-posture walk

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);

// ★ rapier 相关模块必须先导入完，再注入真实 wasm（见 tools/_bundle.mjs）
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
const { Ragdoll } = await import('../src/core/ragdoll');

{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe-posture] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
}

const RAPIER = (await import('@dimforge/rapier3d')).default;
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const brain = await import('../src/core/brain');
const { Trainer, DEFAULT_TRAINER } = await import('../src/core/evolution');
const genome = await import('../src/core/genome');
const posture = await import('../src/core/posture');

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = brain.shapeForJoints(sk.joints.length);
const DT = 1 / 120;
const G = 9.81;

const log = (...a: unknown[]) => console.log(...a);
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
}
const f = (x: number, n = 3) => x.toFixed(n);
const pc = (x: number, n = 1) => `${(x * 100).toFixed(n)}%`;

// ---- 命令行参数 ----
// ★★ 偏移修正：`node tools/run.mjs probe-posture 20 24 3.5`
//   argv[0]=node  argv[1]=tools/run.mjs  argv[2]=probe-posture  ⇒ 参数从 **argv[3]** 起。
//   之前写成 argv[2]/[3]/[4]，于是 GENS 拿到 "probe-posture"（NaN→回落默认），
//   而用户传的 `6 12 3.5` 被解读成 pop=12 / DUR=4（因为 `Number('6')||20` = 6 被当 GENS 用错位）。
//   这类"参数错位"不会报错，只会安静地按默认值跑 —— 看日志第一行的 population 就能识破。
const num = (i: number, dflt: number) => {
  const v = Number(process.argv[i]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
const GENS = num(3, 20);
const POP = num(4, 24);
/** 单回合时长（秒）。★ 站立考核建议 ≥ 3 s：1 s 太短，"站着不动"和"刚倒下去"分不开。 */
const DUR = num(5, 3.5);
const DO_WALK = process.argv.includes('walk');

log('站立考核 —— 位置环 + 重心观测 + DCM 适应度');
log(`  骨架 ${sk.bodies.length} 刚体 / ${sk.joints.length} 关节   网络 ${SHAPE.inputs} → ${SHAPE.hidden} → ${SHAPE.outputs}`
  + `（${brain.brainParamCount(SHAPE)} 参数）`);
log('');

// ------------------------------------------------------------ [A] 口径自检

log('══════ [A] 观测 / 支撑域口径自检（直接用 posture.ts 的真实函数）══════');
{
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 16;
  world.numAdditionalFrictionIterations = 8;
  const doll = new Ragdoll(world, sk, {});
  doll.reset(0);
  // ★ 必须先 step 几步：**接触对是窄相阶段算出来的**，没 step 过就一次接触都没有
  //   （脚掌接地判定改成 Rapier 真实接触之后暴露出来的探针 bug：A8 报"接地 0 只"）。
  for (let i = 0; i < 8; i++) world.step();

  const com = posture.newCom();
  const sup = posture.newSupport();
  posture.readCom(doll, com);
  posture.readSupport(doll, sup);
  const om = posture.omegaAt(com.y);
  const xiX = posture.dcm(com.x, com.vx, om);
  const xiZ = posture.dcm(com.z, com.vz, om);
  const nx = (xiX - sup.cx) / sup.halfX;
  const nz = (xiZ - sup.cz) / sup.halfZ;

  log(`       CoM = (${f(com.x)}, ${f(com.y, 4)}, ${f(com.z)}) m    ω = ${f(om, 4)} rad/s`);
  log(`       支撑域中心 = (${f(sup.cx)}, ${f(sup.cz)})   前后半宽 ${f(sup.halfX)} m（被动 = 主动）`);
  log(`       侧向半宽：被动 ${f(sup.halfZ)} m   主动(凸包) ${f(sup.halfZActive)} m   接地脚数 ${sup.contactN}`);
  log(`       绑定姿态 DCM 归一化位置：nx = ${f(nx)}   nz = ${f(nz)}（|n| < 1 = 在域内）`);

  check('A1 观测维数与声明一致（36 + 6N：脚载荷/摆动窗口/脚 xz/髋→脚向量）',
    SHAPE.inputs === brain.inputCount(sk.joints.length) && SHAPE.inputs === 36 + 6 * sk.joints.length,
    `inputs=${SHAPE.inputs}  期望=${22 + 6 * sk.joints.length}`);
  check('A2 INPUT_LAYOUT 长度 = 观测维数', brain.INPUT_LAYOUT.length === SHAPE.inputs,
    `${brain.INPUT_LAYOUT.length} vs ${SHAPE.inputs}`);
  check('A3 INPUT_COUNT 常量 = 12 关节的实际维数', brain.INPUT_COUNT === 36 + 6 * 12,
    `${brain.INPUT_COUNT}`);
  check('A4 CoM 高度 ≈ 0.966 m（对照 probe-stability 的解析值）',
    Math.abs(com.y - 0.9659) < 0.01, `${f(com.y, 4)} m`);
  // ★ 期望值随**脚掌几何**重标定（2026-10-01）：脚掌盒不再用"小腿胶囊半径×0.9"那个猜测，
  //   改成按纹理实测的靴宽（`limbAxes.paw.lateralHalf` = 159 px = 0.102 m 半宽），
  //   并且整体绕竖直轴**外八 25°**（用户定调"脚要向外侧倾斜，做成外八"）、
  //   盒心正对膝锚点。所以：
  //     · 前后半宽 0.110 → 0.143 m（外八后 hx 在前后方向的投影变短、盒对角线露出更多）
  //     · 侧向被动半宽 0.070 → 0.139 m（实测靴宽 0.102 + 外八带来的 hx·sin25 = 0.046）
  check('A5 前后半宽 ≈ 0.143 m（外八 25° + 实测靴宽；旧值 0.110 是胶囊半径猜的）',
    Math.abs(sup.halfX - 0.143) < 0.012, `${f(sup.halfX)} m`);
  check('A6 ★ 侧向**被动**半宽 ≈ 0.139 m（= 单脚宽：实测靴宽 0.102 + 外八投影 0.046）',
    Math.abs(sup.halfZ - 0.139) < 0.015, `${f(sup.halfZ)} m`);
  check('A7 ★ 侧向主动半宽（凸包）≥ 被动 2 倍（站姿宽 vs 单脚宽）',
    sup.halfZActive > sup.halfZ * 1.8, `被动 ${f(sup.halfZ)} / 主动 ${f(sup.halfZActive)} = ${pc(sup.halfZ / sup.halfZActive, 0)}`);
  check('A8 绑定姿态两脚都接地', sup.contactN === 2, `${sup.contactN} 只`);
  check('A9 绑定姿态 DCM 在被动域内（起跑线是安全的）',
    Math.abs(nz) < 1 && Math.abs(nx) < 1, `nx=${f(nx, 2)} nz=${f(nz, 2)}`);
  world.free();
}
log('');

// ------------------------------------------------------------ 装置

interface Report {
  label: string;
  fitness: number;
  fallen: boolean;
  aliveS: number;
  peakX: number; peakZ: number;
  inDomain: number;
  dist: number;
  chestY: number;
  /** ★ 因何中止（'' = 跑满） + 中止瞬间姿态 */
  reason: string;
  tilt: number;
  headY: number;
}

/** 用给定权重、给定基因组跑一次完整评估，把诊断量取出来 */
function evaluate(sim: InstanceType<typeof Sim>, genome: Float32Array, label: string): Report {
  sim.begin(genome);
  const fit = sim.runToEnd();
  return {
    label, fitness: fit, fallen: sim.fallen,
    aliveS: sim.ticksDone / sim.cfg.controlHz,
    peakX: sim.peakDcmX, peakZ: sim.peakDcmZ,
    inDomain: sim.inDomainRatio,
    dist: sim.distance,
    chestY: sim.doll.torso().translation().y,
    reason: sim.fallReason,
    tilt: sim.endTilt,
    headY: sim.endHeadY,
  };
}

function row(r: Report): void {
  log(`  ${r.label.padEnd(20)} ${f(r.fitness, 2).padStart(8)} ${(r.fallen ? '是' : '否').padStart(4)} `
    + `${f(r.aliveS, 2).padStart(7)}s ${f(r.peakX, 2).padStart(7)} ${f(r.peakZ, 2).padStart(7)} `
    + `${pc(r.inDomain, 1).padStart(7)} ${f(r.dist, 2).padStart(7)} ${f(r.chestY).padStart(7)}`);
}

const REASON_CN: Record<string, string> = {
  '': '—（跑满）', height: '胸塌到 62%', tilt: '躯干倾角 > 1.25 rad', head: '头贴地 < 0.45 m',
};

log('  ★ 列的含义：');
log('    「ξx峰值 / ξz峰值」= DCM 的**归一化**越界程度，0 = 在支撑域中心、1 = 正好在域边缘。');
log('    「域内占比」= 同时落在 x/z 域内的控制周期占比 —— 站住了的话应该接近 100%。');
log('');

/**
 * ★ 逐帧回溯：把一次评估按时间打出来。
 * 存在的理由（跑本轮时踩出来的）：考核表只给**终点状态**，而"ξz 峰值才 1.25 却判摔"
 * 这种情形光看分数和峰值**根本无法判断**是"慢慢倒"还是"腿软蹲塌"——
 * 这两者的修法完全相反。所以必须有一条时间轴能看到胸高/倾角/接地/ξ 的走势。
 */
function trace(sim: InstanceType<typeof Sim>, genome: Float32Array, stepS = 0.25): void {
  sim.begin(genome);
  const initY = sim.doll.torso().translation().y;
  const com = posture.newCom();
  const sup = posture.newSupport();
  const steps = Math.max(1, Math.round(stepS * sim.cfg.controlHz));
  const jb = new Float64Array(3);
  /** 全部 12 个关节的 |旋转向量|（度）—— 决定"塌陷被谁吸收了" */
  const names = sk.joints.map((j) => j.name);
  const mags = new Float64Array(sk.joints.length);
  const readMags = () => {
    for (let i = 0; i < sk.joints.length; i++) {
      sim.doll.jointRot(i, jb);
      mags[i] = (Math.hypot(jb[0], jb[1], jb[2]) * 180) / Math.PI;
    }
  };
  log(`  阈值：胸塌到 ${f(initY * sim.cfg.fallHeightRatio, 3)} m（= 初始 ${f(initY, 3)} × ${sim.cfg.fallHeightRatio}）`
    + `  倾角 > ${f(sim.cfg.fallAngle, 2)} rad  头 < 0.45 m`);
  log('  关节列顺序：' + names.map((n) => n.replace('shoulder', 'sh').replace('elbow', 'el')
    .replace('knee', 'kn').replace('hip', 'hip').replace('neck', 'nk')).join(' '));
  log(`  ${'t/s'.padStart(5)} ${'胸y'.padStart(6)} ${'骨盆y'.padStart(6)} ${'comY'.padStart(6)} `
    + `${'comZ'.padStart(6)} ${'ξz'.padStart(6)} ${'倾角'.padStart(6)} ${'接地'.padStart(4)} `
    + `${'τ应用'.padStart(6)} ${'τ需求'.padStart(6)} ${'占比'.padStart(5)}  `
    + names.map((n) => n.slice(0, 4).padStart(5)).join(''));
  while (!sim.finished) {
    sim.advance(steps);
    const d = sim.doll;
    posture.readCom(d, com);
    posture.readSupport(d, sup);
    const om = posture.omegaAt(com.y);
    const nz = (posture.dcm(com.z, com.vz, om) - sup.cz) / sup.halfZ;
    const t = sim.ticksDone / sim.cfg.controlHz;
    readMags();
    // ★ 权限读数：Σ|实际力矩| vs Σ|想要的力矩|（全 36 轴求和，N·m）。
    //   两者之比 = 被 α·|err|·Ieff 稳定性护栏削掉了多少 ⇒ 回答"没力气 vs 不敢用力"。
    //   ★ 单位别搞混：motorImpulse 是**冲量**（N·m·s，要 /dt），motorDemand 是**力矩**（N·m）。
    let sumA = 0, sumD = 0;
    for (let i = 0; i < d.motorImpulse.length; i++) {
      sumA += Math.abs(d.motorImpulse[i]) / sim.dt;
      sumD += Math.abs(d.motorDemand[i]);
    }
    log(`  ${f(t, 2).padStart(5)} ${f(d.torso().translation().y, 3).padStart(6)} `
      + `${f(d.root().translation().y, 3).padStart(6)} ${f(com.y, 3).padStart(6)} `
      + `${f(com.z, 3).padStart(6)} ${f(nz, 2).padStart(6)} ${f(d.tiltOf(d.torso()), 3).padStart(6)} `
      + `${String(sup.contactN).padStart(4)} `
      + `${f(sumA, 0).padStart(6)} ${f(sumD, 0).padStart(6)} ${pc(sumA / Math.max(sumD, 1e-9), 0).padStart(5)}  `
      + Array.from(mags, (m) => f(m, 0).padStart(5)).join(''));
  }
  log(`  ⇒ 中止于 t = ${f(sim.ticksDone / sim.cfg.controlHz, 2)} s   归因 = ${REASON_CN[sim.fallReason] ?? sim.fallReason}`);
}

// ------------------------------------------------------------ [B] 零输出基线

const STAND_W = {
  // ★ 奖励重构后（walkReward.ts 的 11 项）这里必须用**新键名**：
  //   旧的 distance/velocity/step 已经不存在，写在这里会被静默忽略 ⇒ 站立任务
  //   变成"只有姿态罚、没有正信号"，ES 直奔"赶紧倒下"（实测存活 1.12 s）。
  //   关掉全部 locomotion，只问"站不站得住"。
  velTrack: 0, yawTrack: 0, lateral: 0, tiltRate: 0,
  lift: 0, single: 0, jointMove: 0, actRate: 0, jointMotion: 0, torque: 0,
  // ★★ survive 必须打开（默认 0）。理由见 sim.ts 的 W.survive 长注释：
  //    站桩模式下所有姿态项都是**随时间累积的负数**，而"摔倒"只是一次性 −2 ⇒
  //    不补一个正比于存活时间的正项，ES 会直奔"赶紧倒下"（实测 20 代里最佳个体
  //    存活从 0.78 s 缩到 0.65 s 却分更高）。1.5/s × 3.5 s = 5.25 分，
  //    远大于 fall 的 2.0 ⇒ "多站一秒"永远比"早倒"划算。
  survive: 1.5,
};

log(`══════ [B] 零输出基线（out ≡ 0 ⇒ θ_ref = 0 ⇒ 保持绑定姿态；${DUR} s）══════`);
const simCfgStand = { ...DEFAULT_SIM, duration: DUR, weights: STAND_W };
const simStand = new Sim(sk, SHAPE, simCfgStand);
const zeroGenome = new Float32Array(brain.brainParamCount(SHAPE));
const base = evaluate(simStand, zeroGenome, '零输出');
row(base);
log(`  ⇒ 基线：ξz 峰值 ${f(base.peakZ, 2)}（= 越出被动域 ${f(base.peakZ, 1)} 个半宽），域内占比 ${pc(base.inDomain, 1)}`);
log('    ★ 这就是"补丁之前"的状态：硬件能站，但**没有任何东西在管重心**，缓慢侧向发散。');
log('');

// ------------------------------------------------------------ [B2] 刚度 / 权限扫描

log('══════ [B2] 关节刚度 × 执行器权限扫描 —— "站不住"是控制问题还是硬件问题？ ══════');
log('  零输出（out ≡ 0 ⇒ θ_ref = 0 ⇒ 保持绑定姿态）、无扰动。');
log('  ★★ 前提：绑定姿态的 CoM 投影**本来就在支撑多边形内**（A9 已验证）⇒ 关节足够硬的话');
log('     它是一个静定的刚体站姿，应该**永远站着**。站不住只能是关节柔性造成的。');
log('     有效关节刚度 = kP · min(τmax/9,  α·Ieff/dt)                                   ');
log('        · τmax/9     = "设计值"（err 跑满 JOINT_MAX_SPEED 时输出 τmax）');
log('        · α·Ieff/dt  = "护栏值"（每步最多吃掉 α 比例的相对角速度误差）');
log('     髋外展：τmax/9 = 13.3，而 α=0.35 时护栏值只有 3.49 ⇒ **护栏才是瓶颈**。');
log(`  ${'kP'.padStart(4)} ${'α'.padStart(4)} ${'存活'.padStart(7)} ${'ξz峰'.padStart(6)} ${'域内'.padStart(5)} `
  + `${'峰|v|'.padStart(8)} ${'τ应用/τ需求'.padStart(11)}  归因`);
for (const kp of [9, 24, 48, 90]) {
  for (const a of [0.35, 1.0, 1.6]) {
    const s = new Sim(sk, SHAPE, { ...simCfgStand, doll: { kP: kp, motorAlpha: a } });
    s.begin(zeroGenome);
    let sumA = 0, sumD = 0, peakV = 0;
    while (!s.finished) {
      s.advance(6);
      // ★ 单位别搞混：motorImpulse 是冲量（要 /dt），motorDemand 是力矩。
      for (let i = 0; i < s.doll.motorImpulse.length; i++) {
        sumA += Math.abs(s.doll.motorImpulse[i]) / s.dt;
        sumD += Math.abs(s.doll.motorDemand[i]);
      }
      for (const b of s.doll.bodies) {
        const v = b.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > peakV) peakV = sp;
      }
    }
    log(`  ${String(kp).padStart(4)} ${f(a, 2).padStart(4)} `
      + `${(f(s.ticksDone / s.cfg.controlHz, 2) + 's').padStart(7)} ${f(s.peakDcmZ, 2).padStart(6)} `
      + `${pc(s.inDomainRatio, 0).padStart(5)} ${f(peakV, 1).padStart(8)} `
      + `${pc(sumA / Math.max(sumD, 1e-9), 0).padStart(11)}  ${REASON_CN[s.fallReason] ?? s.fallReason}`);
  }
}
log('  ★ 判读三条：');
log('    ① 若"τ应用/τ需求"明显 < 100% ⇒ 不是没力气，是**护栏不让用力**（α 太小）；');
log('    ② 若提高 kP 能显著延长存活 ⇒ 是**关节刚度不足**，不是控制策略的锅；');
log('    ③ 若"峰|v|"暴涨到几十 m/s ⇒ 刚度已经推到数值发散，该停手了。');
log('');

// ------------------------------------------------------------ [B3] 脚掌尺度 × 平衡余量

log('══════ [B3] 脚掌尺度 → 平衡余量（"骨架是不是太小"的正面回答）══════');
log('  ★ 站立能力的**唯一硬约束**是支撑域半宽 p_max：能刹住的重心速度 v_catch = ω·p_max。');
log('    身高尺度先验已经对得上：ω = √(g/z_c)、时间常数 τ = 1/ω —— 若和真人一致，说明"大小"没问题。');
log('    剩下能动的只有**脚**：脚长是 parts.json 里手填的常数（0.220 m = 身高的 12.2%，真人 ~15%），');
log('    脚宽又是"小腿胶囊半径 × 0.9"（而半径被 limbRadiusScale=0.6 削过）⇒ 物理脚比画里窄一半。');
log('  ★ 实验：给出一个**确定性的推**（给全体刚体各加 m_i·Δv 的冲量 ⇒ 重心速度精确 +Δv），');
log('    二分求"零输出（无任何重心控制）下 4 s 内不摔倒"的最大 Δv。');
log('  ★★ 关键区分（本表的核心）：');
log('    v析 = ω·p_max —— **有理想平衡控制**时能刹住的上限（解析，靠换成 CoP 实现）；');
log('    v被动   = 零输出实测 —— **没有任何东西在管重心**时能扛住的扰动（下限）。');
log('    两者**不是同一个量**，差多少就是"学出主动平衡"这件事值多少分。别拿它们比"自洽"。');
log(`  ${'脚缩放'.padStart(6)} ${'脚长m'.padStart(6)} ${'脚宽m'.padStart(6)} `
  + `${'p前后'.padStart(6)} ${'p侧被动'.padStart(8)} ${'p侧凸包'.padStart(8)} `
  + `${'v析前后'.padStart(8)} ${'v析侧向'.padStart(8)} ${'v被动前'.padStart(8)} ${'v被动侧'.padStart(8)}  基线(零推)`);
{
  const cfgBase = { ...DEFAULT_SIM, duration: 4 };
  // ★ 收集每档脚长的读数，用来做"敏感性"断言（见下方 B3a/B3b）
  const b3Rows: {
    sf: number; soleLen: number; vXa: number; vZa: number; vXp: number; vZp: number; baseAlive: boolean;
  }[] = [];
  for (const sf of [1.0, 1.2, 1.3, 1.5, 1.8]) {
    const sk2 = buildSkeleton({ ...DEFAULT_CONFIG, soleFootScale: sf });
    const shape2 = brain.shapeForJoints(sk2.joints.length);
    // 先把支撑域量出来（用 posture 的真实函数）
    const w = new RAPIER.World({ x: 0, y: -G, z: 0 });
    w.timestep = DT;
    const probeDoll = new Ragdoll(w, sk2, {});
    probeDoll.reset(0);
    const sup2 = posture.newSupport();
    posture.readSupport(probeDoll, sup2);
    const om0 = posture.omegaAt(0.9659);
    const vX = om0 * sup2.halfX;
    const vZ = om0 * sup2.halfZ;   // ★ 侧向解析上限，之前漏了这一列
    // 脚掌尺寸（从 collider 读回，别按公式重算）
    const shinBd = sk2.bodies.find((b) => b.key === 'shin_l')!;
    const soleCd = shinBd.colliders.find((c) => c.shape === 'cuboid')!;
    w.free();

    const s = new Sim(sk2, shape2, cfgBase);
    const g2 = new Float32Array(brain.brainParamCount(shape2));
    const DR = process.env.PROBE_DEBUG === '1' && Math.abs(sf - 1.0) < 1e-9;
    const trial = (dv: number, axis: 'x' | 'z') => {
      s.begin(g2);
      s.advance(120);                       // 先站 1 s
      for (const b of s.doll.bodies) {
        const m = b.mass();
        b.applyImpulse(axis === 'x' ? { x: m * dv, y: 0, z: 0 } : { x: 0, y: 0, z: m * dv }, true);
      }
      s.runToEnd();
      const alive = s.ticksDone / s.cfg.controlHz;
      if (DR) {
        log(`      [dbg ${axis}] Δv=${f(dv, 3)}  存活 ${f(alive, 2)}s  摔=${s.fallen}`
          + `  归因=${s.fallReason || '—'}  适应度 ${f(s.fitness, 2)}`);
      }
      return !s.fallen;
    };
    if (DR) {
      // 前向推 0.05 m/s → 逐帧看它是怎么塌的
      const comB = posture.newCom();
      const supB = posture.newSupport();
      s.begin(g2);
      s.advance(120);
      for (const b of s.doll.bodies) {
        const m = b.mass();
        b.applyImpulse({ x: m * 0.05, y: 0, z: 0 }, true);
      }
      while (!s.finished) {
        s.advance(12);
        const d = s.doll;
        posture.readCom(d, comB);
        posture.readSupport(d, supB);
        const om = posture.omegaAt(comB.y);
        const nx = (posture.dcm(comB.x, comB.vx, om) - supB.cx) / supB.halfX;
        log(`      [推后] t=${f(s.ticksDone / s.cfg.controlHz - 1, 2)}`
          + `  comX=${f(comB.x, 4)} vx=${f(comB.vx, 4)} ξx=${f(nx, 3)}`
          + `  胸y=${f(d.torso().translation().y, 3)} 倾角=${f(d.tiltOf(d.torso()), 3)}`
          + `  接地=${supB.contactN} 半宽=${f(supB.halfX, 3)}`);
      }
    }
    const survives = (dv: number, axis: 'x' | 'z') => trial(dv, axis);
    const margin = (axis: 'x' | 'z') => {
      let lo = 0, hi = 1.6;
      if (survives(hi, axis)) return hi;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (survives(mid, axis)) lo = mid; else hi = mid;
      }
      return lo;
    };
    const vXm = margin('x'), vZm = margin('z');
    // ★ 基线自检：**零推**能不能站满 4 s。若基线自己就塌，下面的"抗推阈值"就没有意义
    //   （二分只会收敛到 0，量到的是"基线本来就撑不住"，不是"扰动容忍度"）。
    const baseAlive = survives(0, 'x');
    b3Rows.push({ sf, soleLen: soleCd.hx * 2, vXa: vX, vZa: vZ, vXp: vXm, vZp: vZm, baseAlive });
    log(`  ${f(sf, 1).padStart(6)} ${f(soleCd.hx * 2).padStart(6)} ${f(soleCd.hz * 2).padStart(6)} `
      + `${f(sup2.halfX).padStart(6)} ${f(sup2.halfZ).padStart(8)} ${f(sup2.halfZActive).padStart(8)} `
      + `${f(vX, 2).padStart(8)} ${f(vZ, 2).padStart(8)} `
      + `${f(vXm, 2).padStart(8)} ${f(vZm, 2).padStart(8)}`
      + `   ${baseAlive ? '站满' : '★基线就塌'}`);
  }
  const sens = (key: 'vXp' | 'vZp') => {
    const a = b3Rows[0][key], b = b3Rows[b3Rows.length - 1][key];
    return b / Math.max(a, 1e-9);
  };
  const anaSens = b3Rows[b3Rows.length - 1].vXa / b3Rows[0].vXa;
  log('  ★ 读数（v被动那一列才是真正的发现）：');
  log(`    · v析（有理想平衡控制）：前后 ${f(b3Rows[0].vXa)} → ${f(b3Rows[b3Rows.length - 1].vXa)} m/s（脚长 +80% ⇒ ×${f(anaSens, 2)}）`);
  log(`      侧向 ${f(b3Rows[0].vZa)} → ${f(b3Rows[b3Rows.length - 1].vZa)} m/s ⇒ **侧向上限只有前后的 ${f(b3Rows[0].vZa / b3Rows[0].vXa, 2)} 倍**（脚宽只有脚长的 0.59 倍）。`);
  log(`    · v被动（零输出 = 没有任何东西在管重心）：前后恒 **${f(b3Rows[0].vXp, 2)} m/s**、侧向恒 **${f(b3Rows[0].vZp, 2)} m/s**；`);
  log(`      脚缩放 1.0 → 1.8（脚长 +80%）后，v被动 只变了 ×${f(sens('vXp'), 2)}（前后）/ ×${f(sens('vZp'), 2)}（侧向）—— **基本不动**。`);
  log('    ⇒ ★★ 结论翻转：**加长脚救不了"站不住"**。被动抗扰阈值与脚长解耦 ⇒ 前向失稳是');
  log('      **关节柔性下的缓慢塌陷**（[C2] 已确认归因 = 胸塌到 62%），不是支撑域不够大。');
  log('      而 v被动 前后只有 0.03 m/s（≈ 走路的 1/17）⇒ 绑定姿态处于**临界稳定**：');
  log('      任何扰动都缓慢发散。这才是"硬件改完还得学会平衡"的定量理由。');
  log('    · v被动侧 > v被动前 的反直觉来自判据：摔倒 = 胸高 < 62% 或 tilt > 1.25 rad。');
  log('      侧向推只是**摇晃**（不倒），前向推才触发塌陷 ⇒ 两个方向不是同一种失效模式。');
  log('    · ⇒ 优先级：**先让策略学会用 CoM/DCM（第 2/3 步），再谈加长脚（第 5 步）**。');
  log('      脚的收益（v析 0.35 → 0.63）只在"有主动平衡"之后才兑现。');

  check('B3a ★ 前向被动抗扰阈值对脚长**不敏感**（⇒ 不是支撑域问题）',
    sens('vXp') < 1.5,
    `脚长 0.220 → ${f(b3Rows[b3Rows.length - 1].soleLen)} m，v被动前 ×${f(sens('vXp'), 2)}`);
  check('B3b ★ 解析上限 v析 = ω·p_max 随脚长**单调增**（这才是脚的收益）',
    b3Rows.every((r, i) => i === 0 || r.vXa > b3Rows[i - 1].vXa),
    `${f(b3Rows[0].vXa)} → ${f(b3Rows[b3Rows.length - 1].vXa)} m/s`);
  check('B3c ★ 基线自检：零输出在**零推**下能站满 4 s（否则"抗扰阈值"无意义）',
    b3Rows.every((r) => r.baseAlive),
    b3Rows.map((r) => `${r.sf}:${r.baseAlive ? '站满' : '塌'}`).join(' '));
}
log('');

// ------------------------------------------------------------ [C0] 初始种群诊断

log('══════ [C0] 初始种群诊断 —— "ES 从哪儿出发" ══════');
// ★ Trainer 在这里就建好：[C0] 要检查它的初始种群，[C] 要拿它训练。
const trainer = new Trainer(
  sk, SHAPE, simCfgStand,
  { ...DEFAULT_TRAINER, population: POP, seed: 20261001 },
);
{
  // 输出幅度：直接前向一次，量"网络在绑定姿态上会命令多少关节角"
  const probeOut = (g: Float32Array) => {
    const x = new Float32Array(SHAPE.inputs);
    const h = new Float32Array(SHAPE.hidden);
    const o = new Float32Array(SHAPE.outputs);
    x[2] = 0; x[3] = 0; x[4] = 0; x[5] = 1;          // 胸腔四元数 = 单位
    x[12] = 1.429;
    brain.brainForward(SHAPE, g, x, h, o);
    let s = 0;
    for (let i = 0; i < o.length; i++) s += o[i] * o[i];
    return Math.sqrt(s / o.length);
  };
  const zeroG = new Float32Array(brain.brainParamCount(SHAPE));
  const rndG = genome.randomGenome(SHAPE, genome.makeGaussian(genome.makeRng(7)), 1.0);
  log(`    零基因组（全 0 权重）  |out| 均方根 = ${f(probeOut(zeroG), 4)}  ← 必须恰好 0`);
  log(`    随机基因组（scale=1）  |out| 均方根 = ${f(probeOut(rndG), 4)}  ← 0.4 量级 = 一开局乱扯关节`);
  check('C0a 零基因组的输出严格为 0（θ_ref = 0 ⇒ 保持绑定姿态 = 站立任务的平凡最优解）',
    probeOut(zeroG) === 0, `${probeOut(zeroG)}`);
  check('C0b ★ 随机基因组的输出**不是** 0（"随机权重也能保持姿态"这个说法是错的）',
    probeOut(rndG) > 0.1, `|out|rms = ${f(probeOut(rndG), 3)}`);
  check('C0c ★ 初始种群必须把平凡解放在池子里（否则 ES 爬不到它）',
    trainer.genomes.some((g) => g.every((v) => v === 0)),
    `池内 ${trainer.genomes.length} 个基因组，含全 0 = ${trainer.genomes.some((g) => g.every((v) => v === 0))}`);
}
log('');

// ------------------------------------------------------------ [C] 站桩训练

log(`══════ [C] 站桩训练（population ${POP}，${GENS} 代，${DUR} s/回合，关掉 distance/velocity/step）══════`);
log(`  ${'代'.padStart(4)} ${'最佳'.padStart(9)} ${'平均'.padStart(9)} ${'σ'.padStart(7)}  最佳个体：存活  ξz峰  域内占比`);
const t0 = Date.now();
for (let g = 0; g < GENS; g++) {
  trainer.tick(1 << 30);
  const h = trainer.history[trainer.history.length - 1];
  const r = evaluate(simStand, trainer.bestEver, 'best');
  if (g % Math.max(1, Math.floor(GENS / 10)) === 0 || g === GENS - 1) {
    log(`  ${String(h.gen).padStart(4)} ${f(h.best, 2).padStart(9)} ${f(h.mean, 2).padStart(9)} ${f(h.sigma, 3).padStart(7)}`
      + `  ${f(r.aliveS, 2).padStart(6)}s ${f(r.peakZ, 2).padStart(6)} ${pc(r.inDomain, 1).padStart(9)}`);
  }
}
const trained = evaluate(simStand, trainer.bestEver, '站桩 best');
const ms = Date.now() - t0;
log('');
log('  ── 考核（站桩权重，跑满时长）');
row(base);
row(trained);
log(`  训练耗时 ${(ms / 1000).toFixed(1)} s`);
log('');

// ★★ 判据已经换了一套（别拿旧口径读）：
//   硬件修好之后**零输出自己就能站满**，所以"零输出"不再是"补丁之前"的坏基线，
//   而是站立任务的**平凡最优解 / 金标准**。于是这里的正确问题是
//   「ES 有没有把已经能站住的东西搞坏」，而不是「ES 有没有从零学会站」。
//   实测踩过的坑：kP=9 时代这两条能过（基线 1.28 s、策略 1.85 s），
//   但那是"从两个都倒里挑一个倒得慢的"——不是站立成立。
check('C1 站桩训练后**跑满整回合不摔**（站立成立的基本要求）',
  !trained.fallen && trained.aliveS >= DUR - 0.05,
  `存活 ${f(trained.aliveS, 2)} / ${DUR} s，摔倒=${trained.fallen}`);
check('C2 ★ 训练结果不劣于平凡解（ξz 峰值 ≤ 零输出的 1.5 倍）',
  trained.peakZ <= base.peakZ * 1.5,
  `${f(base.peakZ, 2)} → ${f(trained.peakZ, 2)}（${pc(trained.peakZ / Math.max(base.peakZ, 1e-9), 0)}）`);
check('C3 ★ 训练结果的域内占比不低于零输出 − 10%',
  trained.inDomain >= base.inDomain - 0.10,
  `${pc(base.inDomain, 1)} → ${pc(trained.inDomain, 1)}`);
check('C4 ★★ 训练适应度 ≥ 平凡解（"什么都不做"的分数 —— 低于它说明 ES 在帮倒忙）',
  trained.fitness >= base.fitness - 1e-9, `${f(base.fitness, 2)} → ${f(trained.fitness, 2)}`);
check('C5 侧向 ξz 峰值落在"没跑出太远"的量级（< 3 个半宽）',
  trained.peakZ < 3, `${f(trained.peakZ, 2)} 个被动半宽`);
check('C6 ★ 开局第一代就含有能站满的个体（平凡解在池子里的直接证据）',
  (trainer.history[0]?.best ?? -Infinity) >= base.fitness - 1e-9,
  `gen0 best = ${f(trainer.history[0]?.best ?? NaN, 2)}  平凡解 = ${f(base.fitness, 2)}`);
log('');

// ------------------------------------------------------------ [C2] 失败归因（时间轴）

log('══════ [C2] 时间轴回溯 —— "到底是怎么倒的" ══════');
log('  ── 零输出（基线）');
trace(simStand, zeroGenome);
log('');
log('  ── 站桩 best');
trace(simStand, trainer.bestEver);
log(`  归因汇总：零输出 = ${REASON_CN[base.reason]}   站桩best = ${REASON_CN[trained.reason]}`);
log('');

// ------------------------------------------------------------ [C3] 发力质量

log('══════ [C3] 发力质量 —— 把"抽风式频繁发力"变成一个数 ══════');
log('  ★ 用户观察（原文）：「这近乎抽风的频繁发力，现实中的人是不怎么需要频繁抽风发力的」。');
log('    这句话是对的，而且**必须先量化再谈优化** —— "抽风"不是形容词，它有三个可测的侧面：');
log('      ① 发力强度  Σ|τ| 的均值（N·m）—— 使了多大劲；');
log('      ② 抖动      每物理步 Σ|τ_t − τ_{t−1}| / dt（N·m/s）—— 力矩有多"毛"；');
log('      ③ 换向频率  每轴每秒 τ 变号次数（Hz）—— 有多"频繁"。');
log('    ★ 真人站立 WHY 不需要抽风：倒立摆的失稳时间常数 τ = 1/ω = 0.31 s ⇒ 需要的是');
log('      **小幅、连续**的踝/髋修正（人类 COP 摆动主要落在 0.5~2 Hz，而不是几十 Hz）；');
log('      抽风式的高频大力 = 给系统灌高频能量，除了把自己顶出支撑域、把接触抖散之外没好处。');
log('    ★ 本骨架的实测基线（零输出）换向 ≈2.8 Hz/轴 —— 那是"残余摆动 + 接触抖动"的自然频带，');
log('      正是"不抽风"的参照；抽风个体是它的 ~10 倍。');
log(`  ${'基因组'.padEnd(22)} ${'存活'.padStart(7)} ${'Σ|τ| N·m'.padStart(10)} `
  + `${'抖动 N·m/s'.padStart(11)} ${'换向 Hz/轴'.padStart(11)} ${'Σ(Δτ)²'.padStart(11)} `
  + `${'抖动罚'.padStart(9)} ${'适应度'.padStart(9)}`);
{
  const n = simStand.doll.motorImpulse.length;
  const prev = new Float64Array(n);
  const W_SMOOTH = simStand.w.smooth;
  const effort = (genome: Float32Array, label: string) => {
    simStand.begin(genome);
    let sumAbs = 0, sumJerk = 0, flips = 0, samples = 0, sc = 0;
    const steps = Math.round(4 * simStand.cfg.physicsHz);
    for (let i = 0; i < steps && !simStand.finished; i++) {
      simStand.advance(1);
      for (let k = 0; k < n; k++) {
        const t = simStand.doll.motorImpulse[k] / simStand.dt;
        sumAbs += Math.abs(t);
        if (i > 0) {
          sumJerk += Math.abs(t - prev[k]);
          const dd = t - prev[k];
          sc += dd * dd;
          if (t * prev[k] < 0) flips++;
        }
        prev[k] = t;
      }
      samples++;
    }
    const secs = samples * simStand.dt;
    // ⚠⚠ `Sim.smoothCost` 已随 `accSmooth → accActRate` 改名被删除，这里就地统计 Σ(Δτ)²。
    //   （原来直接读那个字段 ⇒ undefined.toFixed() 崩在这里，[C3] 之后全段没跑过。）
    log(`  ${label.padEnd(22)} ${(f(simStand.ticksDone / simStand.cfg.controlHz, 2) + 's').padStart(7)} `
      + `${f(sumAbs / secs, 0).padStart(10)} ${f(sumJerk / secs, 0).padStart(11)} `
      + `${f(flips / (n * secs), 2).padStart(11)} ${f(sc, 0).padStart(11)} `
      + `${f(-W_SMOOTH * sc, 2).padStart(9)} ${f(simStand.fitness, 2).padStart(9)}`);
    return sc;
  };
  const scZero = effort(zeroGenome, '① 零基因组（=什么都不做）');
  const scRand = effort(genome.randomGenome(SHAPE, genome.makeGaussian(genome.makeRng(7)), 1.0), '② 随机基因组 scale=1');
  const scScale3 = effort(genome.randomGenome(SHAPE, genome.makeGaussian(genome.makeRng(7)), 3.0), '③ 随机基因组 scale=3（抽风）');
  effort(trainer.bestEver, '④ 站桩训练 best');
  log('  ★ 判读：① 是"真人式静息"参照 —— 它靠**极小的持续修正**站满；');
  log('    ②③ 的 Σ|τ| / 抖动 / 换向频率同时暴涨，而存活与适应度同时崩 ⇒ ');
  log('    **"发力多少"与"站得多好"在这套硬件上是负相关的**（不是"力气不够"，是"力气用错了地方"）。');
  log(`  ★★ W.smooth = ${W_SMOOTH}（当前值）的效果定量：`);
  log(`    · Σ(Δτ)² 是 W.smooth 实际乘的那个量（(N·m)²）—— 静息 ${f(scZero, 0)}、抽风 ${f(scRand, 0)}（×${f(scRand / scZero, 0)}）。`);
  log(`    · 扣分：静息 ${f(-W_SMOOTH * scZero, 2)} 分 / 抽风 ${f(-W_SMOOTH * scRand, 2)} 分。`);
  log('      ⇒ 静息的抖动罚应当**可忽略**（< 0.1 分），抽风的应当**直接压死**（远大于 distance 满分 9）。');
  log('    · 校准口径：改动 W.smooth 后跑这一段，看这两条是否仍然成立。');
  check('C3a ★ 抖动罚能区分"抽风"与"静息"（抽风罚 ≥ 10× 静息罚）',
    scRand / Math.max(scZero, 1e-9) >= 10,
    `×${f(scRand / Math.max(scZero, 1e-9), 0)}`);
  check('C3b ★ 静息的抖动罚可忽略（< 0.1 分，不误伤正常站立）',
    W_SMOOTH * scZero < 0.1,
    `${f(-W_SMOOTH * scZero, 3)} 分`);
  void scScale3;
}
log('');

// ------------------------------------------------------------ [D] 行走训练（可选）

if (DO_WALK) {
  log(`══════ [D] 行走训练（默认权重，${POP} 个 ${GENS} 代）══════`);
  // ★ 用一份**独立的** Sim 做考核：权重不同，绝不能拿站桩那个实例来读。
  const simCfgWalk = { ...DEFAULT_SIM, duration: DEFAULT_SIM.duration };
  const simWalk = new Sim(sk, SHAPE, simCfgWalk);
  const tw = new Trainer(sk, SHAPE, simCfgWalk, { ...DEFAULT_TRAINER, population: POP, seed: 20261001 });
  const t1 = Date.now();
  for (let g = 0; g < GENS; g++) tw.tick(1 << 30);
  const wBest = evaluate(simWalk, tw.bestEver, '行走 best');
  row(wBest);
  log(`  训练耗时 ${((Date.now() - t1) / 1000).toFixed(1)} s   历史最佳分 ${f(tw.bestEverFitness, 2)}`);
  log('');
  check('D1 行走训练没有把"站立"彻底丢掉（ξz 峰值仍 < 4 个半宽）',
    wBest.peakZ < 4, `${f(wBest.peakZ, 2)}`);
  log('');
}

log(failures === 0 ? '  ✅ probe-posture 全部通过' : `  ❌ probe-posture 失败 ${failures} 项`);
process.exitCode = failures === 0 ? 0 : 1;
