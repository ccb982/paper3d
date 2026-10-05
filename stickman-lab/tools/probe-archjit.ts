/** probe-archjit.ts —— 弓关节伺服**数值稳定性**验收（不是看稳不稳，是看会不会抖） */
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
const { DEFAULT_RAGDOLL } = await import('../src/core/ragdoll');
const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const ja = jointIndexByName(sk, 'arch_l');
const dt = 1 / (DEFAULT_SIM.physicsHz ?? 120);

log(`\u2550\u2550 \u5f13\u5173\u8282\u670d\u52a1\u6570\u503c\u7a33\u5b9a\u6027 \u2550\u2550`);
log(`   dt = 1/${DEFAULT_SIM.physicsHz} = ${(dt * 1000).toFixed(2)} ms`);
log(`   \u5f13\u9650\u4f4d [\u2212${Math.abs(sk.joints[ja].minRad[0] * 57.3).toFixed(0)},`
  + `${(sk.joints[ja].maxRad[0] * 57.3).toFixed(0)}]\u00b0`
  + `  \u03c4max = ${sk.joints[ja].maxTorque[0]} N\u00b7m`);
log(`   \u5f13\u521a\u4f53\u521d\u59cb\u8f74\u8d1d\u60ef\u91cf (Ragdoll \u5b9e\u6d4b\u540e\u56de\u8bfb)`);

for (const [K, B] of [[100, 15], [6, 0.025], [4, 0.015], [7, 0.03]] as const) {
  const SHAPE = shapeForJoints(sk.joints.length);
  // Ragdoll 由 Sim 内部按 `cfg.doll` 建（`new Ragdoll(w, sk, cfg.doll)`），
  // 所以弓参数要走 SimConfig，不能在外面另建一个 Ragdoll。
  const sim = new Sim(sk, SHAPE, {
    ...DEFAULT_SIM, mode: 'stand',
    doll: { ...(DEFAULT_SIM.doll ?? {}), archStiffness: K, archDamping: B },
  });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
  const rag = sim.doll;
  // ★ 实测弓刚体绕自由轴的**有效惯量** —— 数值稳定上限全靠它算，不能估。
  //   自由轴 = [1,0,0] ⇒ 取 Rapier 惯量张量的 x 行（principal inertia，返回行主序）。
  const Ieff = rag.jointAxisInertia(ja, sk.joints[ja].revoluteAxis ?? [1, 0, 0]);
  const N = 240;                       // 2 秒
  const ang: number[] = [];
  for (let f = 0; f < N; f++) {
    sim.motor.set(ctrl.step(1 / (DEFAULT_SIM.controlHz ?? 60)));
    sim.advance(1);
    const q = rag.jointAngle(ja);
    ang.push(q);
  }
  // \u60ac\u8106\u5e45\u5ea6\uff1a\u76f8\u90bb\u5e27\u5dee\u5206\u7684\u7edd\u5bf9\u503c\u6700\u5927\u503c
  let swing = 0;
  for (let f = 1; f < ang.length; f++) swing = Math.max(swing, Math.abs(ang[f] - ang[f - 1]));
  // \u9ad8\u9891\u6296\u52a8\u80fd\u91cf\uff1a\u53bb\u8d70\u7f13\u53d8\u540e\u7684\u6b8b\u5dee
  const mean = ang.reduce((a, x) => a + x, 0) / ang.length;
  const sd = Math.sqrt(ang.reduce((a, x) => a + (x - mean) ** 2, 0) / ang.length);
  const kMax = 4 * Ieff / (dt * dt);       // ω·dt < 2
  const bMax = 2 * Ieff / dt;             // |1 − B·dt/I| ≤ 1
  const cl = rag.archGainClamp;
  log(`   请求 K=${String(K).padStart(4)} B=${String(B).padStart(6)}`
    + `  夹紧后 K=${cl ? cl.kNm.toFixed(2) : '—'} B=${cl ? cl.bNm.toFixed(4) : '—'}`
    + `  数值上限 K<${kMax.toFixed(2)} B<${bMax.toFixed(4)}`
    + `  最终 ${(ang[ang.length - 1] * 57.3).toFixed(2)}°`
    + `  \u6700\u7ec8 ${(ang[ang.length - 1] * 57.3).toFixed(2)}\u00b0`
    + `  \u5e27\u95f4\u60ac\u8106 ${(swing * 57.3).toFixed(3)}\u00b0/frame`
    + `  \u6807\u51c6\u5dee ${(sd * 57.3).toFixed(3)}\u00b0`
    + `  ${swing * 57.3 > 1.5 ? '\u2717 \u6253\u9707\uff08\u8fd9\u5c31\u662f\u811a\u4e0d\u65ad\u6296\u7684\u6765\u6e90\uff09' : '\u2713'}`);
}
