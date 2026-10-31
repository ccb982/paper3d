// 临时离屏探针：真实 seed + 真实坐标复现 body34787088 的"初始高度不一致" —— 跑完即删
import * as THREE from 'three';
import { generateChunk } from './src/services/map/ChunkGenerator';
import { computeWaterOnly } from './src/services/map/PatchCompute';
import { WaterStore } from './src/services/map/water/WaterStore';
import { chunkKeyOf } from './src/services/map/RasterMap';
import { tileById } from './src/services/map/Tiles';
import type { ChunkDataLite } from './src/services/map/Refinements';

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { fails++; console.log('  FAIL  ' + msg); }
  else console.log('  PASS  ' + msg);
}

const SEED = 219627832;          // ★ 用户实机的世界 seed
const CHUNK = 60, BLOCKS = 15, CELLS = 60;

// 用户实机位置 x 659.6 / z -904.7 ⇒ chunk (10,-16)
const CX = 10, CZ = -16;
// 该 body 的 8 个成员（用户 HUD 给的）
const MEMBERS: [number, number][] = [
  [10, -16], [11, -16], [10, -15], [11, -15], [12, -15], [12, -16], [13, -15], [13, -16],
];

console.log('=== ① 用真实 seed 生成这 8 个 chunk 的真实地形 ===');
const world = new Map<string, ChunkDataLite>();
for (const [cx, cz] of MEMBERS) {
  const d = generateChunk(SEED, cx, cz);
  world.set(`${cx},${cz}`, { heights: d.heights, blockTypes: d.blockTypes });
}
const readChunk = (ccx: number, ccz: number) => world.get(`${ccx},${ccz}`);

// 各 chunk 的水块数与归属
const store = new WaterStore(new THREE.Scene());
for (const [cx, cz] of MEMBERS) {
  const d = world.get(`${cx},${cz}`)!;
  const bl: number[] = [];
  for (let bz = 0; bz < BLOCKS; bz++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      if (tileById(d.blockTypes[bz * BLOCKS + bx]).genRole !== 'liquid') continue;
      bl.push(((cx * BLOCKS + bx) + 4096) * 8192 + ((cz * BLOCKS + bz) + 4096));
    }
  }
  console.log(`  chunk(${cx},${cz}) 水块 = ${bl.length}`);
  store.registerChunkWater(chunkKeyOf(cx, cz), bl);
}
console.log(`  ⇒ body 数 = ${store.bodyCount}`);
const bodyIds = new Set<number>();
for (const [cx, cz] of MEMBERS) {
  const d = world.get(`${cx},${cz}`)!;
  for (let bz = 0; bz < BLOCKS; bz++) for (let bx = 0; bx < BLOCKS; bx++) {
    if (tileById(d.blockTypes[bz * BLOCKS + bx]).genRole !== 'liquid') continue;
    const id = store.bodyIdOf(((cx * BLOCKS + bx) + 4096) * 8192 + ((cz * BLOCKS + bz) + 4096));
    if (id >= 0) bodyIds.add(id);
  }
}
console.log(`  ⇒ 这些 chunk 的水共属 ${bodyIds.size} 个 body：${[...bodyIds].join(', ')}`);

console.log('=== ② 各 chunk 自算唇（真实地形）===');
const levels0 = new Uint8Array(CELLS * CELLS);
const lips = new Map<string, number>();
for (const [cx, cz] of MEMBERS) {
  const raw = computeWaterOnly(readChunk, SEED, cx, cz, levels0, null, undefined);
  lips.set(`${cx},${cz}`, raw.level);
  console.log(`  chunk(${cx},${cz}) 自算唇 = ${raw.level.toFixed(3)}，quads=${raw.quads}`);
}

console.log('=== ③ 模拟真实装配时序：逐个 chunk 上报唇 → body.L 演化 ===');
{
  const s2 = new WaterStore(new THREE.Scene());
  // 复用上面的归属
  for (const [cx, cz] of MEMBERS) {
    const d = world.get(`${cx},${cz}`)!;
    const bl: number[] = [];
    for (let bz = 0; bz < BLOCKS; bz++) for (let bx = 0; bx < BLOCKS; bx++) {
      if (tileById(d.blockTypes[bz * BLOCKS + bx]).genRole !== 'liquid') continue;
      bl.push(((cx * BLOCKS + bx) + 4096) * 8192 + ((cz * BLOCKS + bz) + 4096));
    }
    s2.registerChunkWater(chunkKeyOf(cx, cz), bl);
  }
  const bodyId = [...bodyIds][0];
  let prevLvl: number | undefined;
  for (const [cx, cz] of MEMBERS) {
    const lip = lips.get(`${cx},${cz}`)!;
    s2.setChunkLip(chunkKeyOf(cx, cz), lip);
    const lvl = s2.bodyLevelOf(bodyId);
    const changed = lvl !== prevLvl;
    console.log(`  chunk(${cx},${cz}) 唇=${lip.toFixed(3)} ⇒ body.L = ${lvl?.toFixed(3)}${changed ? ' ★变了' : ''}`);
    prevLvl = lvl;
  }
  console.log(`  ⇒ 最终 body.L = ${s2.bodyLevelOf(bodyId)}`);
}

console.log('=== ④ 核心验证：重发（forcedLevel）后，再被 chunk 重建覆盖 ⇒ 回到不齐？===');
{
  const s3 = new WaterStore(new THREE.Scene());
  for (const [cx, cz] of MEMBERS) {
    const d = world.get(`${cx},${cz}`)!;
    const bl: number[] = [];
    for (let bz = 0; bz < BLOCKS; bz++) for (let bx = 0; bx < BLOCKS; bx++) {
      if (tileById(d.blockTypes[bz * BLOCKS + bx]).genRole !== 'liquid') continue;
      bl.push(((cx * BLOCKS + bx) + 4096) * 8192 + ((cz * BLOCKS + bz) + 4096));
    }
    s3.registerChunkWater(chunkKeyOf(cx, cz), bl);
  }
  const bodyId = [...bodyIds][0];
  // ① 模拟真实装配：逐 chunk 自算 → 上报唇 → setBodyLevel（= ChunkManager.onWaterSolved）
  for (const [cx, cz] of MEMBERS) {
    const raw = computeWaterOnly(readChunk, SEED, cx, cz, levels0, null, undefined);
    s3.set(chunkKeyOf(cx, cz), raw);
    const l = s3.bodyLevelOf(bodyId)!;
    s3.setBodyLevel(bodyId, l);
  }
  console.log(`  body.L = ${s3.bodyLevel(bodyId).toFixed(4)}`);
  console.log(`  ① 自算装配后 不齐数 = ${s3.misalignedCount(bodyId)}`);
  // ② 重发：全部 forcedLevel = body.L
  const lvl = s3.bodyLevel(bodyId);
  for (const [cx, cz] of MEMBERS) {
    const raw = computeWaterOnly(readChunk, SEED, cx, cz, levels0, null, undefined, lvl);
    s3.set(chunkKeyOf(cx, cz), raw);
  }
  const afterResend = s3.misalignedCount(bodyId);
  console.log(`  ② 重发后 不齐数 = ${afterResend}（期望 0 = 齐平）`);
  assert(afterResend === 0, '★ forcedLevel 重发后应齐平');
  // ③ ★ 关键：chunk 被重建（自算解覆盖）⇒ 是否又变参差？
  for (const [cx, cz] of MEMBERS) {
    const raw = computeWaterOnly(readChunk, SEED, cx, cz, levels0, null, undefined);
    s3.set(chunkKeyOf(cx, cz), raw);
  }
  const after = s3.misalignedCount(bodyId);
  console.log(`  ③ 被 chunk 重建覆盖后 不齐数 = ${after}`);
  assert(after > 0, '★★ 证实：chunk 重建（自算解）会把统一水位覆盖掉 ⇒ 又参差！');
}

console.log('=== ⑤ ★ 自愈：重建覆盖 ⇒ onMisaligned ⇒ 自动重发 ⇒ 齐平 ===');
{
  const s4 = new WaterStore(new THREE.Scene());
  for (const [cx, cz] of MEMBERS) {
    const d = world.get(`${cx},${cz}`)!;
    const bl: number[] = [];
    for (let bz = 0; bz < BLOCKS; bz++) for (let bx = 0; bx < BLOCKS; bx++) {
      if (tileById(d.blockTypes[bz * BLOCKS + bx]).genRole !== 'liquid') continue;
      bl.push(((cx * BLOCKS + bx) + 4096) * 8192 + ((cz * BLOCKS + bz) + 4096));
    }
    s4.registerChunkWater(chunkKeyOf(cx, cz), bl);
  }
  const bodyId = [...bodyIds][0];
  let misalignedHits = 0;
  s4.onMisaligned = (ck, bid, lvl) => {
    misalignedHits++;
    // ★ 模拟 ChunkManager.resendChunkWithLevel：用 body.L 重发
    const cx = Math.floor(ck / 8192) - 4096, cz = (ck % 8192) - 4096;
    const raw = computeWaterOnly(readChunk, SEED, cx, cz, levels0, null, undefined, lvl);
    s4.set(chunkKeyOf(cx, cz), raw);
  };
  // 初始装配（自算）+ 协调
  for (const [cx, cz] of MEMBERS) {
    const raw = computeWaterOnly(readChunk, SEED, cx, cz, levels0, null, undefined);
    s4.set(chunkKeyOf(cx, cz), raw);
    s4.setBodyLevel(bodyId, s4.bodyLevelOf(bodyId)!);
  }
  console.log(`  初始 不齐数 = ${s4.misalignedCount(bodyId)}`);
  // ★ 模拟 chunk 重建：自算解落地（会盖掉统一水位）
  for (const [cx, cz] of MEMBERS) {
    const raw = computeWaterOnly(readChunk, SEED, cx, cz, levels0, null, undefined);
    s4.set(chunkKeyOf(cx, cz), raw);
  }
  console.log(`  重建后 不齐数 = ${s4.misalignedCount(bodyId)}；onMisaligned 触发 ${misalignedHits} 次`);
  assert(misalignedHits > 0, '★ 重建覆盖触发了 onMisaligned');
  assert(s4.misalignedCount(bodyId) === 0, '★★ 自愈后齐平（不齐数 = 0）');
}

console.log(fails === 0 ? '\n全部 PASS' : `\n${fails} 项 FAIL`);
process.exit(fails === 0 ? 0 : 1);
