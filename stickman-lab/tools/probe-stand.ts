/**
 * 「站不起来」的正面回答：零输出到底能站多久？
 *
 * `probe-posture [B]` 只跑 3.5 s，而 3.5 s 恰好等于默认回合长度
 * ⇒ 有可能"零输出站满"只是**还没倒**。这里把窗口拉到 30 s，每 2 s 打一行，
 * 看倾角 / ξ / 脚触地 / τ需求 是不是单调发散。
 *
 * 判据（预先登记，避免事后编故事）：
 *   · 若倾角与 τ需求单调发散且永不回落 ⇒ 绑定姿态是**鞍点**，零输出不是"站着"，是"倒得很慢"
 *   · 若某处收敛 ⇒ 存在一个真实的稳定平衡点
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);

const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');

{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe-stand] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { randomGenome, makeRng, makeGaussian } = await import('../src/core/genome');
const { newCom, readCom, readSupport, omegaAt, dcm } = await import('../src/core/posture');

// ★ 消融对照：灵性足开 / 关。用环境变量选择，不改探针源码。
// ⚠ 不能用 process.env：打包后不透传（已实测，CTL/ARCH 都是占位的）。
//   而且每个工具进程隔离，环境变量传不过去。改用模块内常量。
const ARCH_ON = !((globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? []).includes('noarch');
const sk = buildSkeleton({ ...DEFAULT_CONFIG, flexibleArch: ARCH_ON });
console.log(`══ 灵性足 flexibleArch = ${ARCH_ON} ══`);
const SHAPE = shapeForJoints(sk.joints.length);
// ★ 与其它探针一致：参数从 argv[3] 起（argv[2] 是探针名）
const DUR = Number(((globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [])[0] ?? 30) || 30;
const DT = 1 / 120;
const log = console.log;

function run(label: string, seed: number | null): void {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, duration: DUR, mode: 'stand' });
  sim.begin(seed === null ? new Float32Array(sim.paramCount) : randomGenome(SHAPE, makeGaussian(makeRng(seed))));
  const com = newCom();
  const sup = sim.sup;
  log(`\n── ${label} ──`);
  log('  t/s    胸y    骨盆y   comY   comX    ξx     ξz    倾角°  接地  τ应用 τ需求 占比');
  const steps = Math.round(DUR / DT);
  const n = sim.doll.motorImpulse.length;
  let nextReport = 2;
  for (let i = 0; i < steps && !sim.finished; i++) {
    sim.advance(1);
    const t = i * DT;
    if (t >= nextReport - 1e-9) {
      nextReport += 2;
      const d = sim.doll;
      readCom(d, com);
      readSupport(d, sup);
      const torsoBody = d.torso();
      const torso = torsoBody.translation();
      const root = d.root().translation();
      const w = omegaAt(com.y);
      const xi = dcm(com.x, com.vx, w), zi = dcm(com.z, com.vz, w);
      let ta = 0, td = 0;
      for (let k = 0; k < n; k++) { ta += Math.abs(d.motorImpulse[k]); td += Math.abs(d.motorDemand[k]); }
      ta /= DT; td /= DT;
      const ng = (d.footGrounded(0) ? 1 : 0) + (d.footGrounded(1) ? 1 : 0);
      log(
        `  ${t.toFixed(1).padStart(4)}  ${torso.y.toFixed(3)}  ${root.y.toFixed(3)}  ` +
        `${com.y.toFixed(3)}  ${com.x.toFixed(3)}  ${xi.toFixed(3)}  ${zi.toFixed(3)}  ` +
        `${(d.tiltOf(torsoBody) * 57.2958).toFixed(1).padStart(5)}   ${ng}    ` +
        `${ta.toFixed(0).padStart(5)}  ${td.toFixed(0).padStart(5)}  ${((ta / Math.max(1, td)) * 100).toFixed(0).padStart(3)}%`,
      );
    }
  }
  const alive = sim.ticksDone / sim.cfg.controlHz;
  log(alive >= DUR - 0.05
    ? `  ✓ 站满 ${DUR}s`
    : `  ✗ 倒于 t = ${alive.toFixed(2)}s · 死因[${sim.fallReason}] · 终倾角 ${(sim.endTilt * 57.2958).toFixed(1)}°`);
  // ★ 死因三判据的比值 + 触地刚体名 + 双脚接地情况。
  //   「误判摔倒」几乎总是其中一条：arch/forefoot 合法着地被判 crash、
  //   或 60Hz 弹跳让倾角/头高瞬时超线。
  if (sim.fallReason) {
    const d = sim.fallDiag ?? {};
    const g = sim.doll.groundTouching();
    log(`     ├ 判据比值 rH=${d.rH} rT=${d.rT} rD=${d.rD}  （>1 即触发）`);
    log(`     ├ 触发瞬间 触地非脚刚体 = ${d.hit || '（无 ⇒ 不是 crash 触发）'}`);
    log(`     ├ 当前触地刚体 = ${g.join(',') || '（无）'}`);
    log(`     └ 双脚接地 = ${(sim.doll.footGrounded(0) ? 1 : 0) + (sim.doll.footGrounded(1) ? 1 : 0)} / 2`
      + `   ${(sim.doll.footGrounded(0) ? 1 : 0) + (sim.doll.footGrounded(1) ? 1 : 0) === 0 ? '  ★ 两脚腾空' : ''}`);
  }
}

run('零输出（θ_ref ≡ 0，保持绑定姿态）', null);
run('随机基因组（对照）', 20261003);