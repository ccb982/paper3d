// ============================================================
// probe-fight —— 战斗通道实测：手到底有没有靠近假人 / 有没有到过速度阈值
// ============================================================
// 症状：手工造的"双臂前挥"基因组在 verify-core 5a' 里 hits=0。
// 不猜 —— 逐控制周期打印手的位置、速度、到假人中心的距离，看是
//   (a) 手压根没伸出去，还是 (b) 伸到了但速度不够 / 阈值不对 / 身体先倒了。
//
// 跑法：node tools/run.mjs probe-fight

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);

// ★ 顺序很关键：必须先把用到 rapier 的模块全部导入 —— 这一步会让
//   rapier_wasm3d.js 执行 `__wbg_set_wasm(wasm)`，把 wasm 设成打包器喂的占位对象；
//   随后我们再实例化真正的 wasm 覆盖它。反过来写就会被占位对象盖掉（
//   症状：TypeError: wasm.rawintegrationparameters_new is not a function）。
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { BRAIN_SHAPE, brainParamCount, brainLayout } = await import('../src/core/brain');

{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
}

const sk = buildSkeleton(DEFAULT_CONFIG);
const L = brainLayout(BRAIN_SHAPE);
const b2 = L.b2;

/** 造一个基因组：只写输出层偏置，让指定 (关节,轴) 恒为给定输出值 */
function biasGenome(map: Record<string, number>): Float32Array {
  const g = new Float32Array(brainParamCount(BRAIN_SHAPE));
  for (const [k, v] of Object.entries(map)) {
    const [j, ax] = k.split(':').map(Number);
    g[b2 + j * 3 + ax] = v;
  }
  return g;
}

// 关节索引：0 neck, 1 shoulder_l, 2 shoulder_r, 3 elbow_l, 4 elbow_r,
//           5 hip_l, 6 hip_r, 7 knee_l, 8 knee_r

function analyse(tag: string, g: Float32Array, duration = 4): void {
  const sim = new Sim(sk, BRAIN_SHAPE, { ...DEFAULT_SIM, mode: 'fight', duration });
  sim.begin(g);
  let minHand = Infinity, minAt = 0, maxHandSpeed = 0;
  let nearWhileFast = 0;
  let lastTick = -1;
  const rows: string[] = [];
  while (!sim.finished) {
    sim.advance(1);
    if (sim.tick === lastTick) continue;
    lastTick = sim.tick;
    const d = sim.doll;
    const pp = (sim as unknown as { puppet: { translation(): { x: number; y: number; z: number } } }).puppet.translation();
    let best = Infinity, bestSide = 'l', bestSpeed = 0;
    for (const side of ['l', 'r'] as const) {
      const b = d.bodyByKey(side === 'l' ? 'hand_l' : 'hand_r');
      const p = b.translation();
      const v = b.linvel();
      const dist = Math.hypot(p.x - pp.x, p.y - pp.y, p.z - pp.z);
      const sp = Math.hypot(v.x, v.y, v.z);
      if (dist < best) { best = dist; bestSide = side; bestSpeed = sp; }
    }
    if (best < minHand) { minHand = best; minAt = sim.tick; }
    if (bestSpeed > maxHandSpeed) maxHandSpeed = bestSpeed;
    if (best < 0.68 && bestSpeed > 1.0) nearWhileFast++;
    if (sim.tick % 30 === 0) {
      const t = d.torso().translation();
      const hl = d.bodyByKey('hand_l').translation();
      const hr = d.bodyByKey('hand_r').translation();
      rows.push(
        `t=${(sim.tick / 60).toFixed(2)} 躯干(${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)}) ` +
        `倾${((d.tiltOf(d.torso()) * 180) / Math.PI).toFixed(0).padStart(3)}° ` +
        `手L(${hl.x.toFixed(2)},${hl.y.toFixed(2)},${hl.z.toFixed(2)}) ` +
        `手R(${hr.x.toFixed(2)},${hr.y.toFixed(2)},${hr.z.toFixed(2)}) ` +
        `最近${best.toFixed(2)}(${bestSide}) 速${bestSpeed.toFixed(2)}`,
      );
    }
  }
  console.log(`\n--- ${tag} ---`);
  for (const r of rows) console.log('  ' + r);
  const tp = sim.doll.torso().translation();
  const hp = sim.doll.head().translation();
  console.log(`  假人中心 = (0.72, 0.95, 0.00)   判定阈值: 距离<0.68 且 手速>1.00`);
  console.log(`  最近手距 ${minHand.toFixed(3)} m @ t=${(minAt / 60).toFixed(2)}s   ` +
    `手最大速度 ${maxHandSpeed.toFixed(2)} m/s   同时满足阈值的周期数 ${nearWhileFast}`);
  console.log(`  命中 ${sim.hits}  被击中 ${sim.hurts}  净前进 ${sim.distance.toFixed(2)}m  ` +
    `末躯干y=${tp.y.toFixed(3)} 末头y=${hp.y.toFixed(3)} ` +
    `末倾${((sim.doll.tiltOf(sim.doll.torso()) * 180) / Math.PI).toFixed(0)}° ` +
    `跑到 tick=${sim.tick}/${sim.ticksTotal} 摔倒=${sim.fallen}`);
}

console.log('=== 战斗通道实测 ===');
analyse('基线：全零（站桩）', new Float32Array(brainParamCount(BRAIN_SHAPE)));
analyse('只挥肩（关节1/2 绕Z 拉满）', biasGenome({ '1:2': 6, '2:2': 6 }));
analyse('肩+肘前挥', biasGenome({ '1:2': 6, '2:2': 6, '3:2': 3, '4:2': 3 }));
analyse('肩前挥 + 髋前摆（试图迈步）', biasGenome({ '1:2': 6, '2:2': 6, '5:2': -3, '6:2': -3 }));
console.log('');
