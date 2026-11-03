// 临时离屏探针：WaterAtlas 图集（分配/形状/uv 变换）验收 —— 跑完即删
import * as THREE from 'three';
import { WaterAtlas } from './src/services/map/water/atlas';

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { fails++; console.log('  FAIL  ' + msg); }
  else console.log('  PASS  ' + msg);
}

console.log('=== ① tile 分配：不重叠 + 记录世界矩形 ===');
{
  const atlas = new WaterAtlas({ size: 512, maxTile: 64 });
  const t1 = atlas.alloc(1, 0, 0, 20, 10)!;
  const t2 = atlas.alloc(2, 100, 0, 140, 30)!;
  assert(t1 !== null && t2 !== null, '两个 tile 分配成功');
  const overlap = t1.ox < t2.ox + t2.sw && t2.ox < t1.ox + t1.sw
                && t1.oy < t2.oy + t2.sh && t2.oy < t1.oy + t1.sh;
  assert(!overlap, '两个 tile 不重叠');
  assert(t1.wx0 === 0 && t1.wx1 === 20, 'tile 记录了世界矩形');
  console.log(`  t1 = ox${t1.ox} oy${t1.oy} ${t1.sw}x${t1.sh}；t2 = ox${t2.ox} oy${t2.oy} ${t2.sw}x${t2.sh}`);
}

console.log('=== ② 像素尺寸受 maxTile 限制（形状精度下限）===');
{
  const atlas = new WaterAtlas({ size: 512, maxTile: 64 });
  const small = atlas.alloc(1, 0, 0, 8, 8)!;
  const big = atlas.alloc(2, 0, 0, 600, 400)!;
  console.log(`  小 body tile = ${small.sw}x${small.sh}；大 body tile = ${big.sw}x${big.sh}`);
  assert(big.sw <= 64 && big.sh <= 64, `大 body 的 tile 也不超 maxTile（${big.sw}x${big.sh}）`);
}

console.log('=== ③ 形状写入：mask + 水深 ===');
{
  const atlas = new WaterAtlas({ size: 256, maxTile: 32 });
  const tile = atlas.alloc(1, 0, 0, 10, 10)!;
  // 水 = 圆内（半径 4，中心 5,5）；深 = 5 - 距中心
  atlas.writeShape(1,
    (x, z) => Math.hypot(x - 5, z - 5) <= 4,
    (x, z) => Math.max(0, 5 - Math.hypot(x - 5, z - 5)),
    () => ({ px: 0, py: 0 }));
  const d = atlas.texture.image.data as Uint8Array;
  let on = 0, off = 0, maxDepth = 0;
  for (let py = 0; py < tile.sh; py++) {
    for (let px = 0; px < tile.sw; px++) {
      const i = ((tile.oy + py) * 256 + (tile.ox + px)) * 4;
      if (d[i + 1] > 0) { on++; maxDepth = Math.max(maxDepth, d[i]); }
      else off++;
    }
  }
  console.log(`  形状内 ${on} px，形状外 ${off} px，最大水深字节 ${maxDepth}`);
  assert(on > 0 && off > 0, '形状内/外都有像素（圆形被画出来了）');
  assert(maxDepth > 0, '水深通道有值');
}

console.log('=== ④ uv 变换：顶点用它去 atlas 里取自己的那一份 ===');
{
  const atlas = new WaterAtlas({ size: 256, maxTile: 32 });
  const t = atlas.alloc(1, 100, 200, 140, 260)!;
  const uv = atlas.uvTransformOf(1)!;
  console.log(`  tile = ox${t.ox} oy${t.oy} ${t.sw}x${t.sh} ⇒ uv off(${uv.offX.toFixed(4)},${uv.offY.toFixed(4)}) scale(${uv.scaleX.toFixed(4)},${uv.scaleY.toFixed(4)})`);
  assert(uv.scaleX === t.sw / 256 && uv.scaleY === t.sh / 256, '缩放 = tile 尺寸 / atlas 尺寸');
  assert(uv.offY + uv.scaleY <= 1.0001, 'uv 不越界（上边界）');
  assert(uv.offX + uv.scaleX <= 1.0001, 'uv 不越界（右边界）');
}

console.log('=== ⑤ atlas 满了 ⇒ 分配失败（不静默错位）===');
{
  const atlas = new WaterAtlas({ size: 64, maxTile: 64 });
  const a = atlas.alloc(1, 0, 0, 10, 10)!;
  const b = atlas.alloc(2, 0, 0, 10, 10)!;
  const c = atlas.alloc(3, 0, 0, 10, 10)!;
  const d = atlas.alloc(4, 0, 0, 10, 10)!;
  const e = atlas.alloc(5, 0, 0, 10, 10)!;
  const f = atlas.alloc(6, 0, 0, 10, 10)!;
  const g = atlas.alloc(7, 0, 0, 10, 10)!;
  console.log(`  64px atlas 分配 7 个 64px tile：${[a,b,c,d,e,f].filter(Boolean).length} 成功，${g === null ? '第7个失败' : '第7个也成功'}`);
  assert(g === null, 'atlas 满 ⇒ 返回 null（调用方需降级）');
}

console.log(fails === 0 ? '\n全部 PASS' : `\n${fails} 项 FAIL`);
process.exit(fails === 0 ? 0 : 1);
