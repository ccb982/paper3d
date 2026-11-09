// 临时离屏探针：body 一体水位 + **剔除露底块**（「可以被允许的最低水位」）—— 跑完即删
import { buildBodyWater } from './src/services/map/water/bodyWater';
import { blockKeyToXZ } from './src/services/map/water/bodyWater';

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { fails++; console.log('  FAIL  ' + msg); }
  else console.log('  PASS  ' + msg);
}
const bk = (bx: number, bz: number) => (bx + 4096) * 8192 + (bz + 4096);

console.log('=== ① body 一个水位；池底高于水位的块被剔除 ===');
{
  // 三块：深(-1.0) / 中(-0.5) / 浅滩(-0.02)
  const beds = new Map<number, number>([
    [bk(0, 0), -1.0],
    [bk(1, 0), -0.5],
    [bk(2, 0), -0.02],
  ]);
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0), bk(2, 0)],
    level: -0.5,                       // ★ body 唯一水位
    bedAt: (bx, bz) => beds.get(bk(bx, bz)) ?? -1.0,
    isEdge: () => false,
    step: 4,
  });
  // 每块 1 张 quad ⇒ 3 块 = 12 顶点 / 6 三角；剔除浅滩 ⇒ 2 块 = 8 顶点 / 4 三角
  console.log(`  顶点 ${raw.vertices.length / 3}、三角 ${raw.indices.length / 3}（3 块全留应是 12/6）`);
  assert(raw.vertices.length / 3 === 8, '★ 浅滩块被剔除（8 顶点 = 2 块）');
  assert(raw.indices.length / 3 === 4, '三角数对应（4）');
}

console.log('=== ② 全部块都有水 ⇒ 全部保留 ===');
{
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0), bk(2, 0)],
    level: -0.5,
    bedAt: () => -1.0,
    isEdge: () => false,
    step: 4,
  });
  console.log(`  顶点 ${raw.vertices.length / 3}、三角 ${raw.indices.length / 3}`);
  assert(raw.vertices.length / 3 === 12, '3 块全留（12 顶点）');
}

console.log('=== ③ 全部块都露底 ⇒ 空几何（不画）===');
{
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0)],
    level: -0.5,
    bedAt: () => 0.5,                 // 池底高于水位
    isEdge: () => false,
    step: 4,
  });
  console.log(`  顶点 ${raw.vertices.length / 3}`);
  assert(raw.vertices.length / 3 === 0, '空几何');
  assert(raw.indices.length === 0, '无索引');
}

console.log('=== ④ 水位统一（一体）：所有顶点 y 相同 ===');
{
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0)],
    level: -0.37,
    bedAt: () => -1.0,
    isEdge: () => false,
    step: 4,
  });
  const ys = new Set<number>();
  for (let i = 1; i < raw.vertices.length; i += 3) ys.add(Math.round(raw.vertices[i] * 1e6) / 1e6);
  console.log(`  不同的 y 值个数 = ${ys.size}（应为 1）`);
  assert(ys.size === 1, '★ body 一体：所有顶点同高');
}

console.log('=== ⑤ near 档（1m 网格）同样剔除 ===');
{
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0)],
    level: -0.5,
    bedAt: (bx) => (bx === 0 ? -1.0 : -0.02),   // 第二块是浅滩
    isEdge: () => false,
    step: 1,
  });
  // 每块 1m 网格 = 16 quad = 64 顶点 ⇒ 只留 1 块 = 64 顶点
  console.log(`  顶点 ${raw.vertices.length / 3}（1m 网格每块 64 顶点）`);
  assert(raw.vertices.length / 3 === 64, '★ 近景档也剔除了浅滩块');
}

console.log(fails === 0 ? '\n全部 PASS' : `\n${fails} 项 FAIL`);
process.exit(fails === 0 ? 0 : 1);
