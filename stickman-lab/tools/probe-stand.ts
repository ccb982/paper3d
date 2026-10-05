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
const { assessStanding, formatStandVerdict, printStandCurve, STAND_THRESH } = await import('../src/core/standing');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { DEFAULT_BALANCE_PARAMS } = await import('../src/core/systems/balance');

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

/**
 * 站立的**唯一**入口。
 *
 * ★ 参数是 `ablate`（消融通道名），**不是基因组种子** ——
 *   `begin(params)` 的 `params` 在「删除 driver 开关与 ES/brain 路径」之后
 *   **已无消费者**，传随机基因组进去两组输出逐位相同（实测），
 *   拿它当"对照组"是假的。消融（关掉某个平衡通道）才是真对照。
 */
function run(label: string, ablate: string): void {
  log(`
── ${label}──`);
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, duration: DUR, mode: 'stand' });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    balance: { ...DEFAULT_BALANCE_PARAMS, ...(ablate ? { ablate } : {}) },
  });
  // ★ 判据独占推进模拟；`Controller.step()` 内部已把仲裁结果写进 doll
  const v = assessStanding(sim, sim.doll, DUR, STAND_THRESH, 25,
    () => { ctrl.step(1 / (DEFAULT_SIM.controlHz ?? 60)); });
  printStandCurve(v, DUR / 12);
  log(formatStandVerdict(v));
}

run('完整平衡', '');
run('关掉踝 VIP 刚度', 'ankleCop');
run('关掉载荷依赖张力', 'postureLoad');
run('关掉腰额状精调', 'latwaist');