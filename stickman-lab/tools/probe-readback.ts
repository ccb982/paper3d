/** probe-readback.ts —— 回读实际站距/脚位/髋位（确认配置真的生效） */
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
const log = console.log;
const sk0 = buildSkeleton(DEFAULT_CONFIG);
const { assertColliderMass, assertJointAnchors } = await import('../src/core/skeleton');
log('══ 启动门禁（main.ts:boot 调的就是这两个）══');
try { assertColliderMass(sk0); log('   ✓ assertColliderMass 通过'); }
catch (e) { log(`   ✗ ${(e as Error).message}`); }
try { assertJointAnchors(sk0); log('   ✓ assertJointAnchors 通过'); }
catch (e) { log(`   ✗ ${(e as Error).message}`); }
const sk = sk0;
const SHAPE = shapeForJoints(sk.joints.length);
log(`   DEFAULT_CONFIG.stance = ${DEFAULT_CONFIG.stance}`);
const hips = ['hip_l', 'hip_r'].map((n) => jointIndexByName(sk, n));
log(`══ 静态回读（t=0.3s）══`);
log('   量                左        右      差/合计');
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand' });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
const { jointIndexByName: jin } = await import('../src/core/skeleton');
for (const nm of ['hip_l', 'knee_l', 'foot_l', 'spine1']) {
  const j = jin(sk, nm); const d = sk.joints[j];
  log(`   ${nm.padEnd(8)} τmax = [${d!.maxTorque.map((v) => v.toFixed(0)).join(', ')}] N·m`
    + `   限位 ${d!.minRad.map((v) => (v * 180 / Math.PI).toFixed(0)).join('/')}°`);
}
log('══ 脚内部自由度检查（"柔性足"是否真的有柔性）══');
log(`   刚体数 ${sk.bodies.length} / 关节数 ${sk.joints.length}   （柔性足前是15 / 14）`);
for (const fn of ['foot_l', 'foot_r'] as const) {
  const fi = sk.bodies.findIndex((b: any) => b.key === fn);
  const ai = sk.bodies.findIndex((b: any) => b.key === fn.replace('foot', 'arch'));
  const foot = sk.bodies[fi]!;
  const arch = ai >= 0 ? sk.bodies[ai]! : null;
  const childJoints = sk.joints.filter((j: any) => j.parentKey === fn || j.childKey === fn);
  log(`   刚体 ${fn}: idx=${fi} colliders=${foot.colliders?.length ?? 0}`
    + `  弓刚体 ${arch ? `idx=${ai} colliders=${arch.colliders?.length ?? 0} m=${arch.mass.toFixed(3)}kg` : '★无'}`);
  log(`      挂在 ${fn} 上的关节: ${childJoints.map((j: any) => j.name).join(', ')}`);
  for (const j of childJoints) {
    if (j.name.startsWith('arch_')) {
      log(`      ${j.name}: 自由轴=${JSON.stringify(j.revoluteAxis)}`
        + ` 限位=[${(j.minRad![0]! * 180 / Math.PI).toFixed(0)}°,${(j.maxRad![0]! * 180 / Math.PI).toFixed(0)}°]`
        + ` τmax=${j.maxTorque![0]!.toFixed(0)}N·m`
        + ` 锚点世界=(${j.wx?.toFixed(3)},${j.wy?.toFixed(3)},${j.wz?.toFixed(3)})`);
    }
  }
  if (arch) log(`      弓 collider: ${arch.colliders?.map((c: any) => `${c.offsetX?.toFixed(3)},${c.offsetY?.toFixed(3)},${c.offsetZ?.toFixed(3)}`).join('  ')}`);
}
log(`══ 关节表（共 ${sk.joints.length} 个，按真实索引）══`);
sk.joints.forEach((d, i) => {
  log(`   [${String(i).padStart(2)}] ${d.name.padEnd(11)} parent=${String(d.parentKey).padEnd(8)}`
    + ` child=${String(d.childKey).padEnd(9)} τmax=[${d.maxTorque.map((v) => v.toFixed(0)).join(',')}]`);
});
const jw = new Float64Array(3);
for (let i = 0; i < 36; i++) {
  if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
  sim.advance(1);
}
const s = ctrl.snapshot;
sim.doll.jointWorld(hips[0]!, jw); const hl = jw[2]!;
sim.doll.jointWorld(hips[1]!, jw); const hr = jw[2]!;
const row = (nm: string, a: number, b: number, sum = false): void => {
  log(`   ${nm.padEnd(16)} ${(a * 1000).toFixed(0).padStart(6)}mm ${(b * 1000).toFixed(0).padStart(7)}mm`
    + `  ${(sum ? a + b : Math.abs(a - b)) === 0 ? '' : ((sum ? a + b : Math.abs(a - b)) * 1000).toFixed(0).padStart(6)}mm`);
};
row('髋 z', hl, hr, true);
row('踝 z', s.legs.l.footZ, s.legs.r.footZ, true);
row('CoP z', s.cop?.l?.z ?? 0, s.cop?.r?.z ?? 0, true);
row('足外八/外张', 0, 0);
// ★ 总质量 = Σ刚体主质量 + Σ collider 质量（**两者都要算**：脚掌的 soleMass
//   挂在 collider 上，不在 BodyDef.mass 里）
const mBody = sk.bodies.reduce((a, b) => a + (b.mass ?? 0), 0);
const mCol = sk.bodies.reduce((a, b) =>
  a + (b.colliders ?? []).reduce((x, c: any) => x + (c.mass ?? 0), 0), 0);
log(`   ★ 总质量 = 刚体 ${mBody.toFixed(2)} + collider ${mCol.toFixed(2)} = ${(mBody + mCol).toFixed(2)} kg（应为 70.00）`);
log(`   com.z = ${(s.com.z * 1000).toFixed(0)}mm   站距/髋间距 = ${s.strideRatio.toFixed(2)}×`);
log(`   进支撑面需横移 = ${(s.supportEntryZ * 1000).toFixed(0)}mm`);
const BB = new Float64Array(4);
for (const [nm, i] of [['左', 0], ['右', 1]] as const) {
  sim.doll.footSoleBounds(i as 0 | 1, BB);
  log(`   ${nm}脚鞋底 z 范围 [${(BB[2]! * 1000).toFixed(0)}, ${(BB[3]! * 1000).toFixed(0)}]mm  半宽 ${((BB[3]! - BB[2]!) / 2 * 1000).toFixed(0)}mm`);
}
