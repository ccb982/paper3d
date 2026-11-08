// 临时离屏探针：body.L 按**自己覆盖的块**取 min ⇒ 不同水体不混 ⇒ 无「两层水」—— 跑完即删
import * as THREE from 'three';
import { WaterStore } from './src/services/map/water/WaterStore';

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { fails++; console.log('  FAIL  ' + msg); }
  else console.log('  PASS  ' + msg);
}
const bk = (bx: number, bz: number) => (bx + 4096) * 8192 + (bz + 4096);

console.log('=== ① 同一 chunk 内两个水体 ⇒ body.L 各自独立 ===');
{
  const store = new WaterStore(new THREE.Scene());
  // chunk(0,0) 里两块不相邻的水：块(0,0) 与 块(5,5)
  store.registerChunkWater(0, [bk(0, 0), bk(5, 5)], undefined, undefined);
  // 逐块水位：块(0,0) 水位 -0.5；块(5,5) 水位 -0.2
  store.setBlockLevels(new Map([[bk(0, 0), -0.5], [bk(5, 5), -0.2]]));
  const idA = store.bodyIdOf(bk(0, 0));
  const idB = store.bodyIdOf(bk(5, 5));
  console.log(`  bodyA=${idA} bodyB=${idB}`);
  assert(idA !== idB, '★ 两块不相邻 ⇒ 两个 body');
  const la = store.bodyLevelOf(idA), lb = store.bodyLevelOf(idB);
  console.log(`  bodyA.L=${la?.toFixed(3)}  bodyB.L=${lb?.toFixed(3)}`);
  assert(Math.abs((la ?? 0) - (-0.5)) < 1e-5, 'bodyA.L = -0.5（自己块的水位）');
  assert(Math.abs((lb ?? 0) - (-0.2)) < 1e-5, '★ bodyB.L = -0.2（不被 A 拖累！）');
}

console.log('=== ② 同一 body 内多块 ⇒ 取 min（统一到最低）===');
{
  const store = new WaterStore(new THREE.Scene());
  store.registerChunkWater(0, [bk(0, 0), bk(1, 0)], undefined, undefined);   // 相邻 ⇒ 同一 body
  store.setBlockLevels(new Map([[bk(0, 0), -0.5], [bk(1, 0), -0.2]]));
  const id = store.bodyIdOf(bk(0, 0));
  assert(store.bodyIdOf(bk(1, 0)) === id, '相邻两块 = 同一 body');
  const l = store.bodyLevelOf(id);
  console.log(`  body.L = ${l?.toFixed(3)}（应 = -0.5）`);
  assert(Math.abs((l ?? 0) - (-0.5)) < 1e-5, 'body 内统一到最低水位');
}

console.log('=== ③ 无块级数据 ⇒ fallback 到 chunk 级唇 ===');
{
  const store = new WaterStore(new THREE.Scene());
  store.registerChunkWater(0, [bk(0, 0)], [-0.3], undefined);
  const id = store.bodyIdOf(bk(0, 0));
  const l = store.bodyLevelOf(id);
  console.log(`  body.L = ${l?.toFixed(3)}（fallback = chunk 唇 -0.3）`);
  assert(Math.abs((l ?? 0) - (-0.3)) < 1e-5, 'fallback 生效');
}

console.log('=== ④ 块级水位优先于 chunk 唇 ===');
{
  const store = new WaterStore(new THREE.Scene());
  store.registerChunkWater(0, [bk(0, 0)], [-0.9], undefined);   // chunk 唇（脏）
  store.setBlockLevels(new Map([[bk(0, 0), -0.25]]));           // 块级（准）
  const id = store.bodyIdOf(bk(0, 0));
  const l = store.bodyLevelOf(id);
  console.log(`  body.L = ${l?.toFixed(3)}（应 = -0.25 用块级，不是 -0.9）`);
  assert(Math.abs((l ?? 0) - (-0.25)) < 1e-5, '★ 块级优先');
}

console.log(fails === 0 ? '\n全部 PASS' : `\n${fails} 项 FAIL`);
process.exit(fails === 0 ? 0 : 1);
