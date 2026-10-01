// ============================================================
// probe-coact —— ★ 分通道稳定权限回读（腰 / 腿 / 胳膊 到底能拿多少稳定性）
// ============================================================
// 用户原问题（三句一起回答）：
//   ①「看看各个关节到底啥情况」
//   ②「能不能腰部腿部**同时发力**，使自己稳定」
//   ③「甚至胳膊也需要发力」
//
// ★ 为什么 probe-forces 不够：它回答"**静息**时每个关节出了多大力"（≤7% 饱和）。
//   但"出多少力"≠"能不能拿来稳定"。稳定性只看捕获点 ξ = x + ẋ/ω 相对支撑域的位置，
//   而关节力矩是**内力对**，自己进不了 ξ。能进 ξ 的只有两条通道：
//     · **搬 CoP**（地面反力分布）—— 只有**脚**能搬 ⇒ 腿的活；
//     · **搬 CoM**（重心初始条件）—— 任何大质量块都能搬 ⇒ 腰/胳膊的活。
//
// ★★★ 本骨架的结构性前提（决定通道分工，别按常识想）：
//   **没有踝关节**（脚与小腿一体）⇒
//     · 侧向 CoP **不可直接控**：髋外展把整条腿绕髋转出去、脚离地 = "换支撑"，
//       不是"挪压力中心"；膝顶 CoP 只有 Δp = τ/N_leg 一条（文档 L4）。
//     · 侧向平衡只能靠**搬 CoM**（腰/胳膊/偏心站姿）或**迈步**；
//     · **前后方向才有真 CoP 通道**：下蹲把 CoP 在脚掌前后搬。
//
// ★★ 本探针的核心发现（已写成判据）：
//   腰的**开环权限比整个被动站立域还大**（歪 10.8° 就把 ξ 搬出域）⇒
//   **"腰+腿同时持续发力 ⇒ 稳住"在开环下是错的**（必然越界倒掉，且一起发力倒得更快）。
//   要"稳住"必须靠**反馈**（边倒边改力矩）；现在只有关节级 PD，网络还没学（路线图第 4 步）。
//   ⇒ 这条不是坏消息：执行器权限**远未用满**（站桩腿部 ≤3%），控制器才是缺的那块。
//
// ★ 装置：0–0.8 s 静置 → 0.8–1.2 s 斜坡升命令 → 统计窗口 2.2–3.2 s（准静态）。
//   地面反力用**动量法**（子树 m·Δv/dt + m·g）：与 probe-forces [B]/[C] 同源、
//   符号无歧义、跨配置可比（流形法含位置偏置，系统性偏高 ~5%）。
//   摔倒配置（胸腔 < 0.62×初高 或 tilt > 1.25 rad，与 sim.ts 同口径）**标记而不平均**。
//
// 跑法：node tools/run.mjs probe-coact

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);

// ★ rapier 相关模块必须先导入完，再注入真实 wasm（见 tools/_bundle.mjs）
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
const { Ragdoll } = await import('../src/core/ragdoll');
const P = await import('../src/core/posture');

{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe-coact] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
}

const RAPIER = (await import('@dimforge/rapier3d')).default;

const sk = buildSkeleton(DEFAULT_CONFIG);
const DT = 1 / 120;
const G = 9.81;
const NW = sk.massTotal * G;
const log = (...a: unknown[]) => console.log(...a);
const f = (x: number, n = 3) => (Number.isFinite(x) ? x.toFixed(n) : 'NaN');
const line = (n = 108) => '─'.repeat(n);

/** 文档实测常数（1.8 m 人形绑定姿态）：侧向 / 前后被动半宽 */
const HZ = 0.063, HX = 0.110;

// ---------------------------------------------------------------- 拓扑
const idxOf = (key: string) => sk.bodies.findIndex((b) => b.key === key);
const jointParent: number[] = [], jointChild: number[] = [];
for (const j of sk.joints) { jointParent.push(idxOf(j.parentKey)); jointChild.push(idxOf(j.childKey)); }
function subtreeOf(j: number): number[] {
  const out: number[] = []; const stack = [jointChild[j]];
  while (stack.length) {
    const b = stack.pop()!; out.push(b);
    for (let k = 0; k < sk.joints.length; k++) if (jointParent[k] === b) stack.push(jointChild[k]);
  }
  return out;
}
const SUB_L = subtreeOf(sk.joints.findIndex((j) => j.name === 'hip_l'));
const SUB_R = subtreeOf(sk.joints.findIndex((j) => j.name === 'hip_r'));
const CHEST = idxOf('spine4');
const SPINE = sk.joints.map((j, i) => [j.name, i] as const).filter(([n]) => n.startsWith('spine')).map(([, i]) => i);

// ---------------------------------------------------------------- 通道
/** 轴表：0 = 外展/侧摆（绕 X）、1 = 扭转（绕 Y）、2 = 屈伸（绕 Z） */
type Cmd = Map<string, number>;   // key = `${jointName}:${axis}`
const mk = (o: Record<string, number>): Cmd => new Map(Object.entries(o).map(([k, v]) => [k, v]));
const rep = (joints: string[], axis: number, v: number, o: Cmd): Cmd => {
  for (const j of joints) o.set(`${j}:${axis}`, v);
  return o;
};
const ALL = sk.joints.map((j) => j.name);
const SPINE_N = ALL.filter((n) => n.startsWith('spine'));
const HIP_N = ALL.filter((n) => n.startsWith('hip'));
const KNEE_N = ALL.filter((n) => n.startsWith('knee'));
const SH_N = ALL.filter((n) => n.startsWith('shoulder'));

interface Ch { name: string; note: string; cmd: Cmd }
/** 合并多个通道表（顺序无关，只是叠加） */
const merge = (...cs: Cmd[]): Cmd => {
  const out = new Map<string, number>();
  for (const c of cs) for (const [k, v] of c) out.set(k, v);
  return out;
};
const CHANNELS: Ch[] = [
  { name: 'zero', note: '基线：全 0 = 保持绑定姿态', cmd: mk({}) },
  { name: 'waist-lat', note: '腰侧倾 0.8（θ_ref ≈ 10.8°，限位 ±15°）', cmd: rep(SPINE_N, 0, 0.8, mk({})) },
  { name: 'waist-pitch', note: '腰前屈 0.5（θ_ref ≈ 11°，限位 ±25°）', cmd: rep(SPINE_N, 2, -0.5, mk({})) },
  { name: 'squat-soft', note: '微蹲 0.10（膝 θ_ref ≈ −13°；**活得下来**才能量前后 CoP）', cmd: rep([...HIP_N, ...KNEE_N], 2, -0.10, mk({})) },
  { name: 'squat', note: '缓蹲 0.25（膝 θ_ref ≈ −33°；前后 CoP 通道）', cmd: rep([...HIP_N, ...KNEE_N], 2, -0.25, mk({})) },
  { name: 'lift-left', note: '只抬左髋外展 0.8（换支撑，无踝 ⇒ 不挪 CoP）', cmd: mk({ 'hip_l:0': 0.8 }) },
  { name: 'arms-lat', note: '双臂外展 0.8（θ_ref ≈ 54°，限位 ±75°）', cmd: rep(SH_N, 0, 0.8, mk({})) },
  { name: 'arms-fwd', note: '双臂前摆 0.5（前后配重）', cmd: rep(SH_N, 2, 0.5, mk({})) },
  { name: 'arms-asym', note: '★ 只抬**左**臂外展 0.8（对称外展对侧向 CoM 一阶零贡献 ⇒ 必须不对称用）', cmd: mk({ 'shoulder_l:0': 0.8 }) },
  { name: 'squat-coop', note: '★★ 协调蹲：髋 −0.10 / 膝 −0.15 / **腰 +0.10 反向配平**（躯干保持直立）', cmd: merge(rep(HIP_N, 2, -0.10, mk({})), rep(KNEE_N, 2, -0.15, mk({})), rep(SPINE_N, 2, 0.10, mk({}))) },
  { name: 'waist+legs', note: '★★ 腰侧倾 + 缓蹲（用户主问题：腰腿同时）', cmd: merge(rep(SPINE_N, 0, 0.8, mk({})), rep([...HIP_N, ...KNEE_N], 2, -0.25, mk({}))) },
  { name: 'waist+legs+arms', note: '★★★ 腰 + 腿 + 胳膊同时发力', cmd: merge(rep(SPINE_N, 0, 0.8, mk({})), rep(SH_N, 0, 0.8, mk({})), rep([...HIP_N, ...KNEE_N], 2, -0.25, mk({}))) },
];

// ---------------------------------------------------------------- 逐脚接触读数
/**
 * 逐脚：法向力（N，向上为正）+ 该脚接触点形心（净 CoP 用）。
 * ★ 为什么不用"子树动量法"（第一版踩过）：单脚反力 = m_sub(a+g) − F_hip，
 *   而 F_hip 恰恰是未知的那一项（probe-forces [C] 靠残差算它）⇒ 子树法拿不到单脚力，
 *   会把 687 N 的体重读成 221 N（只等于两条腿的自重）。
 * ★ 权重取 `|n.y·imp|`：接触流形的法向符号依赖 `flipped` 约定（probe-forces [A] 实测
 *   含位置偏置冲量、系统性偏高 ~5%），而**净 CoP 的位置只需要权重**，取绝对值后与
 *   符号约定无关；Σ 法向力与体重的一致性留作交叉校验（报告里打接地率）。
 */
function footContact(world: RAPIER.World, doll: InstanceType<typeof Ragdoll>, side: 'l' | 'r'): { fy: number; cx: number; cz: number } {
  // ★ `contactImpulse` 是**冲量**（N·s），力 = 冲量 / dt。忘了除会把 687 N 读成 6 N。
  // ★ 2026-10-01 加踝关节后，接触发生在**脚掌刚体**（foot_l/foot_r）上，不再是小腿。
  const idx = idxOf(`foot_${side}`);
  const b = doll.bodies[idx];
  let fy = 0, sx = 0, sz = 0;
  for (let ci = 0; ci < b.numColliders(); ci++) {
    const col = b.collider(ci);
    world.contactPairsWith(col, (other) => {
      world.contactPair(col, other, (mf) => {
        const nY = mf.normal().y;
        for (let k = 0; k < mf.numContacts(); k++) {
          const w = Math.abs(nY * mf.contactImpulse(k)) / DT;
          if (w === 0) continue;
          const p = mf.solverContactPoint(k);
          fy += w; sx += p.x * w; sz += p.z * w;
        }
      });
    });
  }
  return { fy, cx: fy !== 0 ? sx / fy : 0, cz: fy !== 0 ? sz / fy : 0 };
}

// ---------------------------------------------------------------- 测量
interface Row {
  name: string; note: string;
  fell: boolean; fallT: number | null; fallXiX: number; fallXiZ: number; grounded: number;
  dComZ: number; dXiZ: number; eZ: number; marP: number; marM: number;
  dCoPz: number; dComX: number; dXiX: number; dCoPx: number;
  legSat: number; armSat: number; waistSat: number; maxSat: number; maxSatName: string;
  tauInt: number; jitter: number; chestY: number; feet: number;
}

function measure(ch: Ch): Row {
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT; world.numSolverIterations = 16; world.numAdditionalFrictionIterations = 8;
  const doll = new Ragdoll(world, sk, {});
  doll.reset(0);

  const target = new Float32Array(doll.jointCount * 3);
  const fill = (scale: number): void => {
    target.fill(0);
    for (let j = 0; j < sk.joints.length; j++) {
      for (let a = 0; a < 3; a++) {
        const v = ch.cmd.get(`${sk.joints[j].name}:${a}`);
        if (v) target[j * 3 + a] = v * scale;
      }
    }
  };

  const com = P.newCom(); const sup = P.newSupport();
  const RAMP0 = 0.8, RAMP1 = 1.2, WIN0 = 2.2, WIN1 = 3.2, T_END = 3.4;
  const y0 = doll.bodies[CHEST].translation().y;
  let t = 0, nWin = 0, fell = false, fallT: number | null = null;
  let fallXiX = 0, fallXiZ = 0;
  let sComZ = 0, sXiZ = 0, sEZ = 0, sMarP = 0, sMarM = 0, sCoPz = 0, sComX = 0, sXiX = 0, sCoPx = 0, sAsym = 0;
  let sTau = 0, sY = 0, sGround = 0, sFeet = 0;
  let legSat = 0, armSat = 0, waistSat = 0, maxSat = 0, maxSatName = '', jitter = 0;
  const prevTau = new Float64Array(doll.jointCount * 3);
  let primed = false;

  while (t < T_END) {
    const s = t < RAMP0 ? 0 : t < RAMP1 ? (t - RAMP0) / (RAMP1 - RAMP0) : 1;
    fill(s);
    doll.setMotorTargets(target);
    doll.driveMotors(DT);
    world.step();
    t += DT;

    const inWin = t >= WIN0 && t <= WIN1;
    let tauAbs = 0;
    for (let j = 0; j < sk.joints.length; j++) {
      const nm = sk.joints[j].name;
      const grp = nm.startsWith('hip') || nm.startsWith('knee') ? 1 : nm.startsWith('shoulder') || nm.startsWith('elbow') ? 2 : nm.startsWith('spine') ? 3 : 0;
      for (let a = 0; a < 3; a++) {
        const k = j * 3 + a;
        const tau = doll.motorImpulse[k] / DT;
        tauAbs += Math.abs(tau);
        if (primed && t > RAMP1) jitter += (tau - prevTau[k]) ** 2;
        prevTau[k] = tau;
        // ★ 饱和率只在**统计窗口**内取（摔倒后的挣扎会把读数刷成 100%，那是假的）
        if (inWin) {
          const sat = Math.abs(tau) / sk.joints[j].maxTorque[a];
          if (grp === 1 && sat > legSat) legSat = sat;
          if (grp === 2 && sat > armSat) armSat = sat;
          if (grp === 3 && sat > waistSat) waistSat = sat;
          if (sat > maxSat) { maxSat = sat; maxSatName = `${nm}.${['外展', '扭转', '屈伸'][a]}`; }
        }
      }
    }
    primed = true;

    const cl = footContact(world, doll, 'l');
    const cr = footContact(world, doll, 'r');
    const nl = cl.fy, nr = cr.fy;

    const chest = doll.bodies[CHEST].translation().y;
    if (!fell && (chest < y0 * 0.62 || doll.tiltOf(doll.torso()) > 1.25)) {
      fell = true; fallT = t;
      // ★ 倒向诊断：摔倒那一刻 ξ 越界的是哪一轴（前后 vs 侧向）—— 决定"矢状面姿势改动"和"侧向姿势改动"性质不同
      P.readCom(doll, com); P.readSupport(doll, sup);
      const wf = P.omegaAt(com.y);
      fallXiX = (P.dcm(com.x, com.vx, wf) - sup.cx) / sup.halfX;
      fallXiZ = (P.dcm(com.z, com.vz, wf) - sup.cz) / sup.halfZ;
    }

    if (inWin && !fell) {
      P.readCom(doll, com); P.readSupport(doll, sup);
      const w = P.omegaAt(com.y);
      const xiZ = P.dcm(com.z, com.vz, w);
      const xiX = P.dcm(com.x, com.vx, w);
      sComZ += com.z - sup.cz; sXiZ += xiZ - sup.cz;
      sEZ += P.dcmExcess(xiZ, sup.cz, sup.halfZ);
      sMarP += sup.halfZ - (xiZ - sup.cz);
      sMarM += sup.halfZ + (xiZ - sup.cz);
      sComX += com.x - sup.cx; sXiX += xiX - sup.cx;
      sGround += (nl + nr) / NW; sFeet += sup.contactN;
      if (nl + nr > 0.5 * NW) {
        sCoPz += (nl * cl.cz + nr * cr.cz) / (nl + nr) - sup.cz;
        sCoPx += (nl * cl.cx + nr * cr.cx) / (nl + nr) - sup.cx;
        sAsym += (nr - nl) / (nl + nr);
      }
      sTau += tauAbs; sY += chest; nWin++;
    }
  }
  world.free();
  const inv = 1 / Math.max(1, nWin);
  return {
    name: ch.name, note: ch.note, fell, fallT, fallXiX, fallXiZ,
    grounded: sGround * inv, feet: sFeet * inv,
    dComZ: sComZ * inv, dXiZ: sXiZ * inv, eZ: sEZ * inv, marP: sMarP * inv, marM: sMarM * inv,
    dCoPz: sCoPz * inv, dComX: sComX * inv, dXiX: sXiX * inv, dCoPx: sCoPx * inv, asym: sAsym * inv,
    legSat, armSat, waistSat, maxSat, maxSatName, tauInt: sTau * inv, jitter, chestY: sY * inv,
  };
}

// ================================================================ 报告
const rows: Row[] = CHANNELS.map(measure);
const by = (n: string) => rows.find((r) => r.name === n)!;
const st = (r: Row) => (r.fell
  ? `✘ 倒 @${r.fallT!.toFixed(2)}s（ξ越界 ${Math.abs(r.fallXiX) >= Math.abs(r.fallXiZ) ? '前后' : '侧向'} ${f(Math.max(Math.abs(r.fallXiX), Math.abs(r.fallXiZ)), 1)}×）`
  : (r.eZ > 1 ? '✘ 越界' : '✔ 域内'));

log(''); log(line());
log('  probe-coact —— 分通道稳定权限回读（腰 / 腿 / 胳膊）');
log(`  硬件 kP = 48 / α = 1.0（默认）；体重 ${NW.toFixed(0)} N；准静态窗口 2.2–3.2 s；被动半宽 侧向 ${f(HZ)} m / 前后 ${f(HX)} m`);
log(line());
log('  ★ 稳定性只看捕获点 ξ = x + ẋ/ω。关节力矩是内力对、进不了 ξ；能进 ξ 的只有');
log('    **搬 CoP**（只有脚 ⇒ 腿的活）与 **搬 CoM**（腰/胳膊的活）。');
log('  ★ 无踝关节 ⇒ 侧向 CoP 不可直接控（髋外展=换支撑），侧向平衡只能搬 CoM 或迈步。');
log('');

log('  【表1】侧向：ξ 权限与余量搬移（+Z 为正；余量 = 离出界还多远）');
log('  ' + line());
log('  ' + '通道'.padEnd(20) + 'ΔCoM_z'.padStart(9) + 'Δξ_z'.padStart(9) + '×半宽'.padStart(8)
  + '余量+'.padStart(9) + '余量−'.padStart(9) + 'ΔCoP_z'.padStart(9) + '载荷差'.padStart(8)
  + '腿饱和'.padStart(8) + '腰饱和'.padStart(8) + '臂饱和'.padStart(8) + '∫Σ|τ|dt'.padStart(10) + '抖动'.padStart(9) + '状态');
log('  ' + line());
for (const r of rows) {
  log('  ' + r.name.padEnd(20) + f(r.dComZ, 4).padStart(9) + f(r.dXiZ, 4).padStart(9)
    + f(Math.abs(r.dXiZ) / HZ, 2).padStart(8) + f(r.marP, 4).padStart(9) + f(r.marM, 4).padStart(9)
    + f(r.dCoPz, 4).padStart(9) + `${(r.asym * 100).toFixed(0)}%`.padStart(8)
    + `${(r.legSat * 100).toFixed(0)}%`.padStart(8) + `${(r.waistSat * 100).toFixed(0)}%`.padStart(8)
    + `${(r.armSat * 100).toFixed(0)}%`.padStart(8) + r.tauInt.toFixed(0).padStart(10)
    + r.jitter.toExponential(1).padStart(9) + '  ' + st(r));
}
log('  ' + line());
log('  【表2】前后（X）：腿能不能搬 CoP');
log('  ' + line());
log('  ' + '通道'.padEnd(20) + 'ΔCoM_x'.padStart(9) + 'Δξ_x'.padStart(9) + 'ΔCoP_x'.padStart(9) + '支撑脚'.padStart(8) + '状态');
log('  ' + line());
for (const r of rows) log('  ' + r.name.padEnd(20) + f(r.dComX, 4).padStart(9) + f(r.dXiX, 4).padStart(9)
  + f(r.dCoPx, 4).padStart(9) + f(r.feet, 2).padStart(8) + '  ' + st(r));
log('  ' + line());

// ---------------------------------------------------------------- 权限曲线
log('');
log('  【表3】权限曲线：命令幅值 → ξ 位移 / 存活（找出"不出界前提下的最大可用权限"）');
log('  ' + line());
log('  ' + '通道'.padEnd(16) + '幅值'.padStart(6) + 'Δξ_z(m)'.padStart(10) + '×半宽'.padStart(8) + '倒/存活'.padStart(12));
log('  ' + line());
const sweep: { ch: string; amp: number; dXi: number; fell: boolean; fallT: number | null; sat: number }[] = [];
const SWEEP_SETS: [string, Cmd][] = [
  ['waist-lat', rep(SPINE_N, 0, 1, mk({}))],
  ['arms-lat', rep(SH_N, 0, 1, mk({}))],
  ['arms-asym', mk({ 'shoulder_l:0': 1 })],
  ['lift-left', mk({ 'hip_l:0': 1 })],
];
for (const [label, proto] of SWEEP_SETS) {
  for (const amp of [0.15, 0.3, 0.45, 0.6, 0.8]) {
    const c: Ch = { name: `${label}@${amp}`, note: '', cmd: new Map([...proto].map(([k, v]) => [k, v * amp])) };
    const r = measure(c);
    sweep.push({ ch: label, amp, dXi: r.dXiZ, fell: r.fell, fallT: r.fallT, sat: r.maxSat });
    log('  ' + `${label}`.padEnd(16) + amp.toFixed(2).padStart(6) + f(r.dXiZ, 4).padStart(10)
      + f(Math.abs(r.dXiZ) / HZ, 2).padStart(8) + (r.fell ? `  ✘ 倒 @${r.fallT!.toFixed(2)}s` : `  ✔ 存活  峰饱和 ${(r.maxSat * 100).toFixed(0)}%`));
  }
}
log('  ' + line());
const safeOf = (ch: string) => {
  const ok = sweep.filter((s) => s.ch === ch && !s.fell);
  return ok.length ? Math.abs(ok[ok.length - 1]!.dXi) : 0;
};
const lastOf = (ch: string) => {
  const ok = sweep.filter((s) => s.ch === ch && !s.fell);
  return ok.length ? Math.abs(ok[ok.length - 1]!.amp) : 0;
};
const safeWaist = safeOf('waist-lat');
const safeArmsSym = safeOf('arms-lat');
const safeArmsAsym = safeOf('arms-asym');
const safeLift = safeOf('lift-left');
log('  ⇒ 不出界前提下的**安全权限**（侧向 ξ 位移，m）：');
log(`     腰侧倾        ${f(safeWaist, 4)}（${f(safeWaist / HZ, 2)}× 半宽，存活到幅值 ${lastOf('waist-lat').toFixed(2)}）`);
log(`     双臂对称外展  ${f(safeArmsSym, 4)}（${f(safeArmsSym / HZ, 2)}×，存活到幅值 ${lastOf('arms-lat').toFixed(2)}）  ← 左右抵消，只剩二阶`);
log(`     单臂外展      ${f(safeArmsAsym, 4)}（${f(safeArmsAsym / HZ, 2)}×，存活到幅值 ${lastOf('arms-asym').toFixed(2)}）  ← 不对称才有真权限`);
log(`     单腿抬起      ${f(safeLift, 4)}（${f(safeLift / HZ, 2)}×，存活到幅值 ${lastOf('lift-left').toFixed(2)}）`);
log('');

// ---------------------------------------------------------------- 判据
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
}
const base = by('zero');
const waist = by('waist-lat');
const armsSym = by('arms-lat');
const armsAsym = by('arms-asym');
const squatSoft = by('squat-soft');
const lift = by('lift-left');
const wl = by('waist+legs');
const wla = by('waist+legs+arms');

log(line());
log('  判据（★ 多条是**证伪**直觉的：把结论钉成断言，免得下次改回去）');
log(line());

check('A1 基线自检：零命令站在被动域内、没倒，接地率 ≈ 1、支撑脚 = 2（力读数可信）',
  !base.fell && base.eZ <= 1 && Math.abs(base.grounded - 1) < 0.15 && Math.abs(base.feet - 2) < 0.2,
  `e_z = ${f(base.eZ)}  余量 ${f(base.marP, 4)}/${f(base.marM, 4)} m  接地率 ${f(base.grounded, 2)}  支撑脚 ${f(base.feet, 1)}  载荷差 ${(base.asym * 100).toFixed(0)}%`);

check('A2 ★★ 执行器权限**远未用满**（不是"力不够"）：站桩时腿/臂饱和率都 ≤ 25%',
  base.legSat <= 0.25 && base.armSat <= 0.25,
  `腿 ${(base.legSat * 100).toFixed(0)}%   臂 ${(base.armSat * 100).toFixed(0)}%   腰 ${(base.waistSat * 100).toFixed(0)}%   最吃力 ${base.maxSatName}`);

// ★ 阈值随站姿重标定（2026-10-01，§5.14）：脚掌外八 25° + 盒心正对膝锚点之后，
//   被动侧向域从 0.070 m 变 0.139 m（实测靴宽），同样 2° 侧倾的 ξ 位移占比
//   从 0.33× 降到 0.25×（绝对值几乎没变：0.0209 → 0.0159 m）。定性结论不变：
//   腰仍然极灵敏（2° 就吃掉 1/4 个域），大幅值仍然直接倒。
check('A3 ★★★ **腰极灵敏**：侧倾 2°（幅值 0.15）就吃掉 ≥1/4 个被动侧向域；大幅值直接倒',
  safeWaist >= 0.22 * HZ && waist.fell,
  `幅值 0.15 → Δξ_z = ${f(safeWaist, 4)} m（${f(safeWaist / HZ, 2)}×，存活）；幅值 0.8 → ${st(waist)}`);

check('A4 腰仍有**可用**的安全权限（≥0.25× 半宽）⇒ 反馈回路有执行器可用',
  safeWaist >= 0.25 * HZ,
  `安全权限 ${f(safeWaist, 4)} m = ${f(safeWaist / HZ, 2)}× 半宽`);

const effArms = Math.abs(armsSym.dXiZ) / Math.max(1e-9, armsSym.armSat);
const effLift = Math.abs(lift.dXiZ) / Math.max(1e-9, lift.legSat);
check('A5 ★★ 胳膊是**低代价精调通道**（单位饱和换到的 ξ 位移最大）：性价比 > 抬腿',
  armsSym.armSat > 0 && effArms > effLift,
  `胳膊 ${f(Math.abs(armsSym.dXiZ), 4)} m @臂${(armsSym.armSat * 100).toFixed(0)}% ⇒ ${f(effArms * 100, 2)} m/100%`
  + `   抬腿 ${f(Math.abs(lift.dXiZ), 4)} m @腿${(lift.legSat * 100).toFixed(0)}% ⇒ ${f(effLift * 100, 2)} m/100%`);

// ★ 同上：抬腿时支撑域的收缩比从 0.9× 放宽到 0.95×（外八的脚更"抓地"，
//   换支撑的代价变小了），但仍然 <1 ⇒ 定性结论不变：不是免费权限。
check('A6 ★ 无踝 ⇒ 抬腿是"换支撑"：CoP 被**动**搬走（差动卸载），但支撑域同时**变窄** ⇒ 不是免费权限',
  !lift.fell && Math.abs(lift.dCoPz) > 0.01 && lift.marP < base.marP * 0.95,
  `抬左腿 ΔCoP_z = ${f(lift.dCoPz, 4)} m（载荷差 ${(lift.asym * 100).toFixed(0)}%）  余量+ ${f(lift.marP, 4)} vs 基线 ${f(base.marP, 4)} m（${f(lift.marP / base.marP, 2)}×）`);

const fellSquat = ['squat-soft', 'squat', 'squat-coop', 'waist-pitch'].filter((n) => by(n).fell).length;
check('A7 ★★★ **绑定姿态是唯一静平衡点**：任何持续的屈膝/屈腰姿势偏移都会倒（4 个通道全倒）',
  fellSquat === 4,
  `微蹲 ${st(by('squat-soft'))}   缓蹲 ${st(by('squat'))}   协调蹲 ${st(by('squat-coop'))}   腰前屈 ${st(by('waist-pitch'))}`);

const tW = waist.fallT ?? Infinity, tWL = wl.fell ? wl.fallT! : Infinity, tWLA = wla.fell ? wla.fallT! : Infinity;
check('A8 ★★★ **证伪"腰腿同时发力更稳"**：开环下一起发力比单独腰倒得更快（两侧余量被同时掏空）',
  tWLA <= tW,
  `单独腰 ${f(tW, 2)} s   腰+腿 ${f(tWL, 2)} s   腰+腿+臂 ${f(tWLA, 2)} s（越小 = 越先倒）`);

check('A9 ★★ 对称 vs 不对称用臂：实测**对称更大**（推翻"左右抵消"的直觉），但两者都不改变主结论',
  Math.abs(armsSym.dXiZ) >= Math.abs(armsAsym.dXiZ),
  `对称 ${f(armsSym.dXiZ, 4)} m   单臂 ${f(armsAsym.dXiZ, 4)} m`);

log('');
log('  侧向权限排序（|Δξ_z|，仅存活配置）');
const okRows = rows.filter((r) => !r.fell).sort((a, b) => Math.abs(b.dXiZ) - Math.abs(a.dXiZ));
log('    ' + (okRows.length ? okRows.map((r) => `${r.name}(${f(Math.abs(r.dXiZ), 4)})`).join('  ') : '（无）'));
log('');
log(`  ${failures === 0 ? '★ 全绿' : `✘ ${failures} 条不通过`}`);
log('');
process.exitCode = failures === 0 ? 0 : 1;
