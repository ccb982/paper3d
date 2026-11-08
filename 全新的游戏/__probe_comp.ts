// 临时离屏探针：chunk 内连通分量（不同水体不混）—— 跑完即删
import { connectedComponents } from './src/services/map/water/WaterStore';

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { fails++; console.log('  FAIL  ' + msg); }
  else console.log('  PASS  ' + msg);
}
const bk = (bx: number, bz: number) => (bx + 4096) * 8192 + (bz + 4096);

console.log('=== ① 两个隔陆地的湖 ⇒ 两个分量（不能混！）===');
{
  // 湖 A: (0..2, 0..2)；湖 B: (10..12, 0..2) —— 隔着陆地
  const blocks: number[] = [];
  for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) blocks.push(bk(x, z));
  for (let x = 10; x <= 12; x++) for (let z = 0; z <= 2; z++) blocks.push(bk(x, z));
  const comps = connectedComponents(blocks);
  console.log(`  18 块 ⇒ ${comps.length} 个分量`);
  assert(comps.length === 2, '★ 两个湖 = 两个分量（不再混成一体）');
  assert(comps.every((c) => c.length === 9), '每个分量 9 块');
}

console.log('=== ② 一个湖 ⇒ 一个分量 ===');
{
  const blocks: number[] = [];
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) blocks.push(bk(x, z));
  const comps = connectedComponents(blocks);
  assert(comps.length === 1, `25 块 ⇒ 1 个分量（得 ${comps.length}）`);
}

console.log('=== ③ 带岛的湖（岛在中间）⇒ 仍是 1 个分量（4 邻域绕岛连通）===');
{
  const blocks: number[] = [];
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) {
    if (x === 2 && z === 2) continue;   // 岛
    blocks.push(bk(x, z));
  }
  const comps = connectedComponents(blocks);
  console.log(`  24 块（带岛）⇒ ${comps.length} 个分量`);
  assert(comps.length === 1, '★ 带岛的湖仍是 1 个分量（岛不分裂水体）');
}

console.log('=== ④ 对角相邻 ⇒ 不连通（4 邻域，不是 8 邻域）===');
{
  const comps = connectedComponents([bk(0, 0), bk(1, 1)]);
  assert(comps.length === 2, `对角两块 ⇒ 2 个分量（得 ${comps.length}）`);
}

console.log('=== ⑤ L 形 / 边界块 ===');
{
  const comps = connectedComponents([bk(0, 0), bk(1, 0), bk(1, 1), bk(-1, 0)]);
  assert(comps.length === 1, 'L 形（含负坐标）⇒ 1 个分量');
}

console.log('=== ⑥ 空输入 ===');
{
  assert(connectedComponents([]).length === 0, '空 ⇒ 0 个分量');
}

console.log(fails === 0 ? '\n全部 PASS' : `\n${fails} 项 FAIL`);
process.exit(fails === 0 ? 0 : 1);
