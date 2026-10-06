/**
 * ══════════════════════════════════════════════════════════════════
 * probe-pelvis.ts —— **腰怎么发力的：力从盆骨发起、往上传播**
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06：
 *   「逐帧回读，看腰咋发力的，**腰感觉就是从下往上发力，力必须从盆骨部位发起**」
 *
 * 物理主张（本探针要验证的）：
 *   腰**不是**自己产生力矩，而是把**盆骨收到的力**往上传。
 *   ⇒ 若成立，逐帧应看到：
 *     ① 髋关节子树力（腿递给盆骨的力）≈ `m_下·(a−g)`，方向由腿决定；
 *     ② `spine1` 的子树力（盆骨往上传的力）≈ `m_上·(a−g)`；
 *     ③ 两者之差 = **盆骨自身**的惯性项 `m_pelvis·(a_pelvis − g)`：
 *          `F_spine1 = F_hips + m_pelvis·(a_pelvis − g)`
 *        ⇒ 这就是"力从盆骨发起"的**定量形式**（盆骨是力的加和点）。
 *     ④ 上身的脊柱矢状轴力矩若由 `τ=JᵀF` 给出，应满足
 *          `τ_i = û_i·[(a_i − p_upperCoM) × F_upper]`
 *        （本探针把 `F_upper`、`p_upperCoM`、每个 `τ_i` 都打出来对账）
 *
 * 逐帧列：
 *   骨盆：y / vy / |ω| / 收到的力(Σ髋) / 传上去的力(spine1) / 差值(应 = m_p·(a−g))
 *   脊柱：spine1..3 的 角度 / 角速度 / 实际τ / 归属 / 让位
 *   上身：提案 / balance 修正 / final / 力
 *
 * 用法：node tools/run.mjs probe-pelvis [secs]
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
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const log = (s: string) => console.log(s);
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECS = Number(ARGS[0] ?? 0.6);
const EVERY = Number(ARGS[1] ?? 5);          // 每几拍打一行（默认 5 拍 ≈ 83ms）
const DEG = 57.2958;

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: DEFAULT_CONTROLLER.balance,
});
const d = sim.doll;
const rv = new Float64Array(3);

const JHIP = { l: jointIndexByName(sk, 'hip_l'), r: jointIndexByName(sk, 'hip_r') };
const JSP = [1, 2, 3].map((n) => jointIndexByName(sk, `spine${n}`));
const pelvis = d.bodyByKey('torso');       // ★ 树根 = 骨盆（key 恒为 'torso'）

log('══ 力的传播：骨盆是加和点（`F_spine1 = F_hips + m_pelvis·(a−g)`）══');
log('   骨盆列：y / vy / |ω| / 收到(Σ髋子树力) / 传上(spine1子树力) / 差值');
log('   脊柱列：角度° / 角速度°/s / 实际τ / 归属(让位)');
log('');
log('   t(s)  骨盆y  v_y    |ω|    收到F(下)        传上F(上)         差值     '
  + '| 胸腔pitch° | spine1 [轴0 轴1 轴2]           spine2 [轴0 轴1 轴2]           spine3 [轴0 轴1 轴2]');
for (let i = 0; i < SECS * 120 && !sim.finished; i++) {
  if (i % 2 === 0) d.setMotorTargets(ctrl.step(1 / 60));
  sim.advance(1);
  if (i % (EVERY * 2) !== 0) continue;
  const rs = ctrl.rs;
  void rs.pitchDeg;
  const fc = rs.forceChain();
  if (!fc.ready) continue;
  const fl = fc.joints[JHIP.l]!, fr = fc.joints[JHIP.r]!;
  const downFx = fl.fx + fr.fx, downFy = fl.fy + fr.fy, downFz = fl.fz + fr.fz;
  const s1 = fc.joints[JSP[0]!]!;
  const pv = pelvis.linvel(); const pw = pelvis.angvel();
  const cells: string[] = [];
  for (const ji of JSP) {
    d.jointRot(ji!, rv);
    const ang = -rv[2]! * DEG;
    const w = Math.abs(rv[2]!) * DEG;
    const tau = d.tauApplied[ji! * 3 + 2] ?? 0;
    const own = rs.axisOwner(ji! * 3 + 2);
    const hold = rs.holdMask[ji! * 3 + 2] ?? 0;
    const ts = rs.tauSrc[ji! * 3 + 2];
    // ★ 三轴全打（疑点：`driveMotors` 内部读的 `a` 可能是**别的轴** ⇒ 软限位误触发）
    d.jointRot(ji!, rv);
    const a0 = -rv[0]! * DEG, a1 = rv[1]! * DEG, a2 = -rv[2]! * DEG;
    const t0 = d.tauApplied[ji! * 3] ?? 0, t1 = d.tauApplied[ji! * 3 + 1] ?? 0;
    cells.push(`[0:${a0.toFixed(0)}°/${t0.toFixed(0)} 1:${a1.toFixed(0)}°/${t1.toFixed(0)}`
      + ` 2:${a2.toFixed(1)}°/${tau.toFixed(0)}]`
      + `{${own}${hold ? '/让' + hold : ''}|τ:${(ts?.label ?? '—').slice(0, 10)}}`);
  }
  log(`   ${(i / 120).toFixed(3)} ${pv.y.toFixed(3)} ${(pv.y * 1000).toFixed(0).padStart(5)} `
    + `${(Math.hypot(pw.x, pw.y, pw.z) * DEG).toFixed(0).padStart(4)}° `
    + `(${downFx.toFixed(0).padStart(5)},${downFy.toFixed(0).padStart(5)},${downFz.toFixed(0).padStart(5)})`
    + ` (${s1.fx.toFixed(0).padStart(5)},${s1.fy.toFixed(0).padStart(5)},${s1.fz.toFixed(0).padStart(5)})`
    + ` (${(s1.fx - downFx).toFixed(0).padStart(4)},${(s1.fy - downFy).toFixed(0).padStart(4)},${(s1.fz - downFz).toFixed(0).padStart(4)})`
    + ` | ${rs.pitchDeg.toFixed(1).padStart(6)} | ${cells.join('  ')}`);
}
log('');
{
  const rs = ctrl.rs;
  const ub = rs.upperBody;
  log(`上身状态：质量 ${ub.mass.toFixed(1)}kg　作用点 (${ub.comX.toFixed(3)}, ${ub.comY.toFixed(3)}, ${ub.comZ.toFixed(3)})`);
  log(`  提案 pitch=${(ub.step.pitch * DEG).toFixed(1)}° roll=${(ub.step.roll * DEG).toFixed(1)}°`
    + `　修正 pitch=${(ub.corrPitch * DEG).toFixed(1)}° roll=${(ub.corrRoll * DEG).toFixed(1)}°`
    + `　final pitch=${(ub.final.pitch * DEG).toFixed(1)}° roll=${(ub.final.roll * DEG).toFixed(1)}° (${ub.decidedBy})`);
  log(`  力 (${ub.force.fx.toFixed(0)}, ${ub.force.fy.toFixed(0)}, ${ub.force.fz.toFixed(0)})N`);
}
{
  // ★ 刚度上限诊断：夹之前的 kP 峰值 → 反推原始有效刚度 K = kP·τmax/ωmax
  const JSP2 = [1, 2, 3].map((n) => jointIndexByName(sk, `spine${n}`));
  log('');
  log('══ 刚度上限诊断 ══');
  log(`   夹住次数 ${d.stiffCapHits}　（0 = 上限没生效）`);
  for (const ji of JSP2) {
    if (ji === undefined || ji < 0) continue;
    const jdef = sk.joints[ji]!;
    for (const ax of [0, 2]) {
      const idx = ji * 3 + ax;
      const kpRaw = d.kpRawPeak[idx] ?? 0;
      const tmax = jdef.maxTorque[ax] ?? 0;
      const kRaw = kpRaw * tmax / 9;
      const cap = d.stiffCap[idx] ?? 0;
      log(`   ${jdef.name}/轴${ax}  原始 kP=${kpRaw.toFixed(0)}（⇒ K≈${kRaw.toFixed(0)} N·m/rad）`
        + `　上限 ${cap > 0 ? cap.toFixed(0) : '无'}`);
    }
  }
}
log(`存活 ${(sim.ticksDone / 60).toFixed(2)}s  死因 ${sim.fallReason || '未倒'}`);
