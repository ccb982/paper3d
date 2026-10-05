/**
 * probe-archwork.ts —— 柔性足**是否真在工作** + 脚能否**不均匀发力**
 *
 * 判据（三条都必须是量，不是"看起来在动"）：
 *   ① CoP 行程：Winter 有效足刚度 K_eff = m·g·ΔCoP/Δθ。刚性足 ⇒ CoP 被钉在接触
 *      面形心、ΔCoP≈0；柔性足 ⇒ CoP 随踝力矩**连续移动**。
 *   ② 弓是否真的转：arch_l 角度范围。0° = 弓是死的（只是多了两块碰撞体的刚体足）。
 *   ③ 弓块承重：arch collider 的法向冲量。恒 0 = 弓完全没参与承重。
 *   ④ 分块载荷是否**不均匀**且**随时间变化**（真发力 vs 静态压死）。
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
const RAPIER = await import('@dimforge/rapier3d');
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const log = console.log;

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand' });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
const d = sim.doll;
const world = (d as any).world as InstanceType<typeof RAPIER.World>;
const ja = jointIndexByName(sk, 'arch_l');
const jf = jointIndexByName(sk, 'foot_l');
const ROT2 = new Float64Array(3);
const COP = new Float64Array(8), BB = new Float64Array(4), LD = new Float64Array(8);
const ROT = new Float64Array(3);

const iF = sk.bodies.findIndex((b) => b.key === 'foot_l');
const iA = sk.bodies.findIndex((b) => b.key === 'arch_l');
const footB = d.bodies[iF]!, archB = d.bodies[iA]!;
const archCols = archB.numColliders();

const N = Math.round((DEFAULT_SIM.physicsHz ?? 120) * 3);
const skip = Math.round((DEFAULT_SIM.physicsHz ?? 120) * 1.0);
const cop: number[] = [], archAng: number[] = [], footAng: number[] = [];
const archLam: number[] = [], blk: number[][] = [], tilt: number[] = [];

for (let f = 0; f < N; f++) {
  sim.motor.set(ctrl.step(1 / (DEFAULT_SIM.controlHz ?? 120)));
  sim.advance(1);
  if (f < skip) continue;
  d.readCoP(0, COP); d.footSoleBounds(0, BB); d.soleBlockLoad(0, LD);
  cop.push(COP[2]!);
  // ★ 弓的自由轴是 **X**（旋前/旋后），而 `jointAngle()` 返回的是 **buf[2]**（丸伸）。
  //   弓只有 X 一个自由度 ⇒ Z 结构性恒为 0 ，以前测的「弓角 0.00°」是废话。
  d.jointRot(ja, ROT);
  archAng.push(ROT[0]);
  d.jointRot(jf, ROT2);
  footAng.push(ROT2[2]);
  tilt.push(d.tiltOf(footB));
  blk.push([...LD.slice(0, 6)]);
  let lam = 0;
  for (let c = 0; c < archCols; c++) {
    const col = archB.collider(c);
    world.contactPairsWith(col, (other: any) => {
      world.contactPair(col, other, (mf: any) => {
        if (mf.numContacts() === 0) return;
        for (let k = 0; k < mf.numContacts(); k++) lam += Math.abs(mf.contactImpulse(k));
      });
    });
  }
  archLam.push(lam);
}
const rng = (a: number[]) => Math.max(...a) - Math.min(...a);
const mm = (v: number) => (v * 1000);

log('══ 柔性足工作验收（240Hz，站立 2s 窗口）══');
log('');
log(`   ① CoP 行程       ${mm(rng(cop)).toFixed(1)} mm`
  + `   [z ${mm(Math.min(...cop)).toFixed(0)} … ${mm(Math.max(...cop)).toFixed(0)}]`
  + `   ${mm(rng(cop)) > 5 ? '✓ 连续移动（柔性足在工作）' : '✗ 被钉住（等同刚性足）'}`);
log(`      支撑面 z 范围   ${mm(BB[2]!).toFixed(0)} … ${mm(BB[3]!).toFixed(0)} mm`
  + `  ⇒ CoP 占行程 ${(mm(rng(cop)) / Math.max(1, mm(BB[3]! - BB[2]!)) * 100).toFixed(0)}%`);
log('');
log(`   ② 弓角           ${mm(Math.min(...archAng)).toFixed(2)}° … ${mm(Math.max(...archAng)).toFixed(2)}°`
  + `   行程 ${mm(rng(archAng)).toFixed(2)}°`
  + `   ${mm(rng(archAng)) > 0.3 ? '✓ 弓在转' : '✗ 弓是死的'}`);
log(`      踝角（对照）   ${mm(rng(footAng)).toFixed(2)}° 行程`
  + `   ${mm(rng(footAng)) > 0.3 ? '✓ 踝在动' : '✗ 踝没动'}`);
log('');
log(`   ③ 弓块法向冲量   均值 ${(archLam.reduce((a, b) => a + b, 0) / archLam.length).toFixed(4)}`
  + `  峰值 ${archLam.reduce((a, b) => Math.max(a, b), 0).toFixed(4)}`
  + `  接触帧 ${archLam.filter((v) => v > 1e-9).length}/${archLam.length}`
  + `   ${archLam.some((v) => v > 1e-6) ? '✓ 弓参与承重' : '✗ 弓完全没承重（悬空）'}`);
log('');
log('   ④ 分块载荷（占总载荷 %）与时间变化');
const names = ['足跟', '外侧柱', '跖骨头', '趾', '弓后', '弓前'];
const tot = blk.map((r) => r.reduce((a, b) => a + b, 0) || 1);
for (let i = 0; i < 6; i++) {
  const share = blk.map((r, k) => r[i]! / tot[k]! * 100);
  const m0 = share.reduce((a, b) => a + b, 0) / share.length;
  let sw = 0;
  for (let k = 1; k < share.length; k++) sw = Math.max(sw, Math.abs(share[k]! - share[k - 1]!));
  log(`      ${names[i]!.padEnd(8)} 均 ${m0.toFixed(1).padStart(5)}%`
    + `   帧间最大变化 ${sw.toFixed(1).padStart(5)}%`
    + `   范围 ${Math.min(...share).toFixed(1)}…${Math.max(...share).toFixed(1)}%`);
}
const uniq = blk.map((r) => r.map((v) => Math.round(v / Math.max(1e-9, tot[blk.indexOf(r)]!) * 20)).join(',')).length;
log(`      ⇒ 载荷分布${uniq > 20 ? '随帧明显变化 = 真在调节发力' : '基本不变 = 静态压死'}`);
log('');
log(`   足倾角          ${mm(Math.min(...tilt)).toFixed(2)}° … ${mm(Math.max(...tilt)).toFixed(2)}°`);
