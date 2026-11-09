// 临时离屏探针：两阶段水体划分（标记 → 全量合并）—— 跑完即删
import * as THREE from 'three';
import { WaterStore, LEVEL_MERGE_TOLERANCE } from './src/services/map/water/WaterStore';

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { fails++; console.log('  FAIL  ' + msg); }
  else console.log('  PASS  ' + msg);
}
const bk = (bx: number, bz: number) => (bx + 4096) * 8192 + (bz + 4096);

console.log('=== ① 标记 → 全量合并：相邻同水位 ⇒ 一个 body ===');
{
  const store = new WaterStore(new THREE.Scene());
  store.registerChunkWater(0, [bk(0, 0), bk(1, 0), bk(2, 0)]);
  store.setBlockLevels(new Map([[bk(0, 0), -0.3], [bk(1, 0), -0.3], [bk(2, 0), -0.3]]));
  store.rebuildBodyPartition();
  const id0 = store.bodyIdOf(bk(0, 0));
  assert(store.bodyIdOf(bk(2, 0)) === id0, '★ 三块同一 body');
  assert(Math.abs((store.bodyLevelOf(id0) ?? 0) + 0.3) < 1e-5, 'body.L = -0.300');
}

console.log('=== ② ★ 相邻但水位差大 ⇒ 不合并（两层水的根治点）===');
{
  const store = new WaterStore(new THREE.Scene());
  store.registerChunkWater(0, [bk(0, 0), bk(1, 0)]);
  store.setBlockLevels(new Map([[bk(0, 0), 0.0], [bk(1, 0), -0.25]]));
  store.rebuildBodyPartition();
  const idA = store.bodyIdOf(bk(0, 0));
  const idB = store.bodyIdOf(bk(1, 0));
  console.log(`  bodyA=${idA} L=${store.bodyLevelOf(idA)?.toFixed(3)}；bodyB=${idB} L=${store.bodyLevelOf(idB)?.toFixed(3)}`);
  assert(idA !== idB, '★ 两个水体不合并（各归各）');
  assert(Math.abs((store.bodyLevelOf(idA) ?? 0) - 0.0) < 1e-5, 'bodyA.L = 0.000');
  assert(Math.abs((store.bodyLevelOf(idB) ?? 0) + 0.25) < 1e-5, 'bodyB.L = -0.250');
}

console.log('=== ③ ★ 与加载顺序无关（先标 A 再标 B vs 先标 B 再标 A）===');
{
  const run = (order: number[][]): string => {
    const store = new WaterStore(new THREE.Scene());
    for (const chunk of order) {
      store.registerChunkWater(0, chunk);
      store.setBlockLevels(new Map(chunk.map((k) => [k, -0.25])));
      store.rebuildBodyPartition();
    }
    return `${store.bodyIdOf(bk(0, 0))}|${store.bodyIdOf(bk(1, 0))}`;
  };
  const r1 = run([[bk(0, 0)], [bk(1, 0)]]);
  const r2 = run([[bk(1, 0)], [bk(0, 0)]]);
  console.log(`  顺序 A→B: ${r1}`);
  console.log(`  顺序 B→A: ${r2}`);
  assert(r1 === r2, '★ 两种顺序结果一致（可复现）');
}

console.log('=== ④ 跨 chunk 相邻 ⇒ 合并（body 脱离 chunk）===');
{
  const store = new WaterStore(new THREE.Scene());
  store.registerChunkWater(0, [bk(0, 0)]);
  store.registerChunkWater(1, [bk(1, 0)]);
  store.setBlockLevels(new Map([[bk(0, 0), -0.2], [bk(1, 0), -0.2]]));
  store.rebuildBodyPartition();
  assert(store.bodyIdOf(bk(0, 0)) === store.bodyIdOf(bk(1, 0)), '★ 跨 chunk 的相邻水合并成一个 body');
}

console.log('=== ⑤ 水位未知 ⇒ 先连（后续重算会修正）===');
{
  const store = new WaterStore(new THREE.Scene());
  store.registerChunkWater(0, [bk(0, 0), bk(1, 0)]);
  store.rebuildBodyPartition();     // 无块级水位
  assert(store.bodyIdOf(bk(0, 0)) === store.bodyIdOf(bk(1, 0)), '水位未知时先合并');
  // 水位到齐且相差大 ⇒ 重算后拆开
  store.setBlockLevels(new Map([[bk(0, 0), 0.0], [bk(1, 0), -0.25]]));
  store.rebuildBodyPartition();
  assert(store.bodyIdOf(bk(0, 0)) !== store.bodyIdOf(bk(1, 0)), '★ 水位到齐后自动拆开');
}

console.log('=== ⑥ 容差内视为同一水体 ===');
{
  const store = new WaterStore(new THREE.Scene());
  store.registerChunkWater(0, [bk(0, 0), bk(1, 0)]);
  const d = LEVEL_MERGE_TOLERANCE * 0.5;
  store.setBlockLevels(new Map([[bk(0, 0), -0.3], [bk(1, 0), -0.3 + d]]));
  store.rebuildBodyPartition();
  assert(store.bodyIdOf(bk(0, 0)) === store.bodyIdOf(bk(1, 0)), `差 ${d.toFixed(3)} < 容差 ⇒ 同一 body`);
}

console.log(fails === 0 ? '\n全部 PASS' : `\n${fails} 项 FAIL`);
process.exit(fails === 0 ? 0 : 1);
