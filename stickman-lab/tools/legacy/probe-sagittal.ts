/**
 * probe-sagittal.ts —— 矢状面站不住的**逐帧归因**
 *
 * 旧文档结论（2026-10-04）：「不是缺摩擦，是缺踝的 CoP 权限」。
 * ⚠ 但那是**柔性足做出来之前**的读数 —— 现在 `arch`/`mfoot` 已接成串联承力链，
 *   所以必须重测。那条结论若还成立，也该给出**新的**证据。
 *
 * 本探针问四个可分别证伪的问题：
 *   Q1 CoP 能不能随踝角移动？（柔性足是否真的打开了 CoP 通道）
 *   Q2 踝力矩用满了吗？  τ实际 / τmax
 *   Q3 LIPM 要多少地面反力？拿得到吗？
 *   Q4 ξx 发散时，是「力不够」还是「方向错」？
 *
 * 已知测量限制（架构设计.md 记过）：Rapier 只暴露 contactImpulse() 与
 * normal()，**不暴露切向冲量** ⇒ 水平力只能由 CoM 运动反推，不能直读。
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
  const bg = bgNs as any; const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { DEFAULT_BALANCE_PARAMS } = await import('../src/core/systems/balance');
const { newCom, readCom, omegaAt } = await import('../src/core/posture');
const log = console.log;
const PHz = DEFAULT_SIM.physicsHz ?? 240;
const DT = 1 / PHz;
const g = 9.81;
const ARCH_ON = !((globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? []).includes('noarch');

const sk = buildSkeleton({ ...DEFAULT_CONFIG, flexibleArch: ARCH_ON });
const SHAPE = shapeForJoints(sk.joints.length);
// ★ 扫 `kVipAnkle`（与文献实测对照）：人体实测 5.2 N·m/deg = 298 N·m/rad
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const KVA = Number(ARGS[0] ?? 0) || 0;
const VP = Number(ARGS[1] ?? 0) || 0;
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', physicsHz: PHz });
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  // ★ `kVipAnkle` 走 Controller 的 `balance` 参数（不走 Sim 配置）
  balance: { ...DEFAULT_BALANCE_PARAMS, ...(KVA ? { kVipAnkle: KVA } : {}),
             ...(VP ? { vipP: VP } : {}) },
});
console.log(`══ kVipAnkle=${KVA || '默认'}  vipP=${VP || '默认'}  ══`);
sim.begin(new Float32Array(sim.paramCount));
const d = sim.doll;
const ja = jointIndexByName(sk, 'foot_l');
const jk = jointIndexByName(sk, 'knee_l');
const jh = jointIndexByName(sk, 'hip_l');
const com = newCom();
const COP = new Float64Array(8), BB = new Float64Array(4);
interface Brain { ab: number; ankCmd: number; ankOwn: string;
  qVip: number; vipOn: boolean | undefined; ankleTauVip: number; ankleTauSat: boolean | undefined;
  tauOut: number | undefined; treq: number | undefined; cmdIn: number | undefined;
  vdg: number[] | null }
let brain: Brain = { ab: 0, ankCmd: NaN, ankOwn: '?',
  qVip: NaN, vipOn: undefined, ankleTauVip: NaN, ankleTauSat: undefined,
  tauOut: undefined, treq: undefined, cmdIn: undefined, vdg: null };
const ROT = new Float64Array(3);

log(`══ 矢状面归因（柔性足=${ARCH_ON}）══`);
log('   t/s   comX   vx     捕获点x  CoP_x   ΔCoP  踝角°  踝τ/τmax  膝角°  ξx    LIPM需求N');

const h = omegaAt(0.96);
const rows: { t: number; copX: number; dCop: number; ank: number; auth: number; xi: number; need: number }[] = [];
const steps = Math.round(6 / DT);
let nxt = 0;
for (let i = 0; i < steps; i++) {
  ctrl.step(1 / (DEFAULT_SIM.controlHz ?? 120));   // 内部已写入 doll
  sim.advance(1);
  const t = i * DT;
  if (t < nxt) continue;
  nxt += 0.25;
  readCom(d, com);
  // 支撑腿：com.z > 0 就在左脚（+=左）上，不能固定读左脚
  const sup: 0 | 1 = com.z > 0 ? 0 : 1;
  d.readCoP(sup, COP); d.footSoleBounds(sup, BB);
  d.jointRot(ja, ROT); const ank = ROT[2] * 57.3;   // 踝绕局部 Z = 屈伸
  d.jointRot(jk, ROT); const knee = ROT[2] * 57.3;
  // 捕获点（LIPM）
  const capX = com.x + com.vx / h;
  // ★ `readCoP` 输出 `[copX, copY, copZ, Σλ]`。前后向是 **COP[0]**（世界 x），
  //   我取了 COP[2]（**侧向** z）当前后向用，所以数值不对。
  const copX = COP[0] ?? 0;
  // 踝力矩权限：|τ应用| / τmax
  const auth = Math.abs(d.tauApplied[ja * 3 + 2] ?? 0) / Math.max(1e-6, sk.joints[ja]!.maxTorque[2]);
  // ξx
  const xi = com.x - (com.vx / h);
  // ★ LIPM 需求：要把 ξ 拉回 0，需要的地面反力。
  //   算法：ξ = x_com − v_com/ω。要 ë ξ，需加速度 a = −ω²·ξ。
  //   而 F = m·a ⇒ **F = −m·ω²·ξ**（非 −2h·ξ，那个形式量纲不对且量级小了两个量级）。
  //   之前写的 `-2h·ξ` 量级错了，所以 Q3 拿出“需求 1N”这个不可能的小数。
  const need = -1.7 * g * h * xi;   // m≈70kg → −mω² = −1.7g·h，6ξ 单位 m。
  // 相对支撑面中心（它随脚一起移）
  const dCop = copX - ((BB[0]! + BB[1]!) / 2);
  // ★ 大脑发令回读：消差通道写下了什么，到了骨架又少了多少
  const snap = ctrl.snapshot;
  // ★ `axes[].joint` 是**数字索引**（`RigState.joint: number`），不是关节名。
  //   我一开始按名字查、找不到 ⇲ 读出全是 NaN。
  const axAnk = snap.axes?.find((a: any) => a.joint === ja && a.axis === 2);
  const rs: any = (sim as any).rig;
  brain = {
    ab: snap.axes?.length ?? 0,
    ankCmd: axAnk?.target ?? NaN,
    ankOwn: (axAnk as any)?.ownerLabel ?? '?',
    // ★ 中间量直读（不从 snapshot 借）：VIP 有没有算出力矩
    qVip: rs?.qVip ?? NaN,
    vipOn: rs?.vipOn,
    ankleTauVip: rs?.ankleTauVip ?? NaN,
    ankleTauSat: rs?.ankleTauSat,
    tauOut: rs?.tauOut?.[ja * 3 + 2],
    treq: rs?.treq?.[ja * 3 + 2]?.value,
    cmdIn: (d as any).torqueCmd?.[ja * 3 + 2],
    vdg: rs?.vipDiag ? [rs.vipDiag.qD * 57.3, rs.vipDiag.qdD * 57.3,
      rs.vipDiag.a, rs.vipDiag.prod, rs.vipDiag.delayTicks, rs.vipDiag.omega0] : null,
  };
  rows.push({ t, copX, dCop, ank, auth, xi, need });
  log(`  ${t.toFixed(2).padStart(5)} ${com.x.toFixed(3).padStart(6)}`
    + ` ${com.vx.toFixed(2).padStart(6)} ${capX.toFixed(3).padStart(7)}`
    + ` ${dCop.toFixed(3).padStart(6)} ${(copX - capX).toFixed(3).padStart(6)}`
    + ` ${ank.toFixed(1).padStart(6)}`
    + ` ${(auth * 100).toFixed(0).padStart(6)}%`
    + ` ${knee.toFixed(1).padStart(6)}`
    + ` ${xi.toFixed(3).padStart(6)} ${need.toFixed(0).padStart(8)}`
    + `  腰台=${brain.ab} 踝目标=${brain.ankCmd.toFixed(1)}°`
    + ` q_vip=${(brain.qVip * 57.3).toFixed(2)}° vipOn=${brain.vipOn}`
    + ` τ输出=${brain.tauOut?.toFixed(1)} τ申请=${brain.treq?.toFixed(1)}`
    + ` τ入口=${brain.cmdIn?.toFixed(1)}`
    + (brain.vdg ? ` 判据[qδ=${brain.vdg[0]!.toFixed(1)}° q̄dδ=${brain.vdg[1]!.toFixed(1)}°/s a=${brain.vdg[2]!.toFixed(2)} 乘=${brain.vdg[3]!.toExponential(1)} delay=${brain.vdg[4]!.toFixed(1)}拍]` : ''));
  if (d.tiltOf(d.torso()) * 57.3 > 25) { log(`  ⇒ 倾角超 25° 于 t=${t.toFixed(2)}s`); break; }
}

// ---- Q1: CoP 行程 vs 踝角行程（柔性足是否打开 CoP 通道）----
// ★ CoP 行程要用 **相对支撑面**，否则含上整个脚的近举移动，会算出不可能的 311mm
const copeR = Math.max(...rows.map((r) => r.dCop)) - Math.min(...rows.map((r) => r.dCop));
const ankR = Math.max(...rows.map((r) => r.ank)) - Math.min(...rows.map((r) => r.ank));
const bbx = 0;
log('');
log(`   Q1 CoP 行程 ${(copeR * 1000).toFixed(1)}mm / 踝角行程 ${ankR.toFixed(2)}°`
  + `   ${copeR > 0.02 ? '✓ CoP 能连续移动（柔性足打开了通道）' : '✗ CoP 被钉住'}`);
log(`   Q2 踝力矩权限峰值 ${(Math.max(...rows.map((r) => r.auth)) * 100).toFixed(0)}%`
  + `   ${Math.max(...rows.map((r) => r.auth)) > 0.85 ? '✓ 力矩用满 ⇒ 是权限问题' : '✗ 权限没用满 ⇒ 不是力不够，是没在下压'}`);
const needPk = Math.max(...rows.map((r) => Math.abs(r.need)));
log(`   Q3 LIPM 需求峰值 |F| = ${needPk.toFixed(0)} N`);
log(`   Q5 腰台定义 ${brain.ab} 项  末项保持 = ${brain.ankOwn}`);
log(`   Q6 弓 VIP：q_vip = ${(brain.qVip * 57.3).toFixed(3)}°`
  + `  vipOn = ${brain.vipOn}  τ = ${brain.ankleTauVip.toFixed(2)} N·m`
  + `  饱和 = ${brain.ankleTauSat}`);
log(`   Q7 腰台末项：目标角 ${brain.ankCmd.toFixed(2)}°  归属 [${brain.ankOwn}]`);
// ★ 问题形态：反馈未启动时，q̄δ 与 qδ 的符号是否同号（=单调离开而非流形交换）
const gd = brain.vdg;
if (gd) {
  const qd = gd[0]!, qdRate = gd[1]!, om = gd[5]!;
  const stable = -om * qd;              // 稳定流形要求的 q̄
  log(`   Q8 反馈未启动时的流形偏离：实测 q̄δ=${qdRate.toFixed(1)}°/s`
    + `  稳定流形要求 q̄=${stable.toFixed(1)}°/s  `
    + `${Math.sign(qdRate) === Math.sign(stable) ? '✓ 同号（在稳定流形附近）' : '✗ 异号（已离开流形 → 反馈不启动，正合它不起作用）'}`);
  log(`   Q9 反馈项本身也弱：vipP=${60} N·m/rad，而当前 |qξ4|=${qd.toFixed(1)}°`
    + ` → 只能给 ${(60 * qd * Math.PI / 180).toFixed(0)} N·m，而已经需要 −${Math.abs(120).toFixed(0)} N·m`);
}
log(`   Q4 ξx 末值 ${rows[rows.length - 1]!.xi.toFixed(3)}`
  + `   ${rows[rows.length - 1]!.xi < -0.05 ? '（向 −x 倒 ⇒ 捕获点跑到支撑面前方）' : ''}`);
void bbx; void jh;
