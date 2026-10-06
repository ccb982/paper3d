/**
 * ══════════════════════════════════════════════════════════════════
 * probe-fall.ts —— **摔倒方向预测**的逐帧回读（§22.19.4 第①步的验收）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06：「**想后倒的时候脚后跟是需要发更大的力的**」
 *   「应该是还需要一个**预测摔倒方向从而在对应方向发力**的模块？」
 *
 * 验收（§22.19.4）：
 *   ① 能逐帧打出 `dir` / `urgency`，且与 `mos` 的符号一致；
 *   ② 后向用例应比前向更早"吃紧"（象限可回读）;
 *   ③ 站位时间窗门禁在后向扰动下不劣化。
 *
 * 用法：`node tools/run.mjs probe-fall [秒数] [ABL]`
 *   `ABL` 里可加 `push=front|back|left|right`：在 t=0.8s 给骨盆一个恒定水平推力
 *   （用 `doll.bodyByKey('torso').applyImpulseAtPoint` 的等价——这里用外力，
 *     因为本探针只验证**预测**，不验证响应）
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
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
const SECS = Number(ARGS[0] ?? 3);
const REST = ARGS.slice(1).join(',');
const ABL = REST.split(',').filter((x) => x && !x.startsWith('push=')).join(',');
const PUSH = (REST.match(/push=(\w+)/) ?? [])[1] ?? '';
const HZ = 60, DT = 1 / HZ, PER = 2;

log(`══ probe-fall 时长=${SECS}s ${ABL ? `消融[${ABL}]` : ''}${PUSH ? ` 推力[${PUSH}]` : ''} ══`);
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: { ...DEFAULT_CONTROLLER.balance, ablate: ABL || undefined },
});
const d = sim.doll;
const torso = d.bodyByKey('torso');

log('  t(s)  区域   方位°  紧迫度  余量mm 前/后/左/右(mm)  权限  模式       on     s   应急pitch/roll  CoM.x/z(mm)  捕获点x/z(mm)  判读');
const rows: string[] = [];
let n = 0;
for (let i = 0; i < SECS * 120 && !sim.finished; i++) {
  const t = i / 120;
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  // ★ 恒定水平推力（验证"预测"用；t=0.8s 起，1 拍给一次冲量）
  if (PUSH && t >= 0.8 && t < 0.81 && torso) {
    const F = 120;   // N·s 量级的冲量
    const m = PUSH === 'front' ? [1, 0, 0] : PUSH === 'back' ? [-1, 0, 0]
      : PUSH === 'left' ? [0, 0, 1] : [0, 0, -1];
    torso.applyImpulse({ x: m[0]! * F * 0.1, y: 0, z: m[2]! * F * 0.1 }, true);
  }
  sim.advance(1);
  if (i % PER !== 0) continue;
  const rs = ctrl.rs;
  const f = rs.fall;
  n++;
  if (i % (PER * 6) !== 0) continue;
  rows.push(
    `${t.toFixed(2).padStart(6)}  ${f.region.padEnd(6)}`
    + `${f.dirDeg.toFixed(0).padStart(6)}`
    + `${f.urgency.toFixed(2).padStart(8)}`
    + `${(f.margin * 1000).toFixed(0).padStart(8)}`
    + `${(f.mFront * 1000).toFixed(0)}/${(f.mBack * 1000).toFixed(0)}/${(f.mLeft * 1000).toFixed(0)}/${(f.mRight * 1000).toFixed(0)}`.padStart(20)
    + `${(f.authorityScale * 100).toFixed(0).padStart(6)}`
    + `${(rs.mos * 1000).toFixed(0).padStart(9)}`
    + `${(rs.com.x * 1000).toFixed(0)}/${(rs.com.z * 1000).toFixed(0)}`.padStart(14)
    + `${(f.px * 1000).toFixed(0)}/${(f.pz * 1000).toFixed(0)}`.padStart(15)
    + `${String(rs.fallResp.mode).padEnd(10)}`
    + `${rs.fallResp.on}`
    + `${rs.fallResp.s.toFixed(2).padStart(6)}`
    + `${rs.fallResp.addPitchDeg.toFixed(1)}/${rs.fallResp.addRollDeg.toFixed(1)}`.padStart(12)
    + `  ${f.note}`,
  );
}
log(rows.join('\n'));
log(`\n  跑了 ${n} 拍（${(n * DT).toFixed(2)}s）${sim.finished ? '（倒了）' : ''}`);
