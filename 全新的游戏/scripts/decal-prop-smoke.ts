// 贴图/装饰物库规划层冒烟测试（基类化架构验证）
import { generateChunk } from '../src/services/map/ChunkGenerator';
import { planChunkDecals, registerDecal, decalsForGroup, TileDecalBase } from '../src/services/map/decor/TileDecalBase';
import { planChunkProps, registerMapDecor, propsForGroup, MapEntityDecorBase } from '../src/services/map/decor/MapEntityDecorBase';

let dTotal = 0, pTotal = 0;
const groups = new Set<string>();
for (let seed = 1; seed <= 3; seed++) {
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      const c = generateChunk(seed, cx, cz);
      groups.add(c.groupKey);
      dTotal += planChunkDecals({ seed, cx, cz, groupKey: c.groupKey, blockTypes: c.blockTypes }).length;
      pTotal += planChunkProps({
        seed, cx, cz, groupKey: c.groupKey, blockTypes: c.blockTypes,
        surfaceHeightAt: (x, z) => Math.sin(x) * 0.5,
      }).length;
    }
  }
}
console.log(`空库规划输出：贴图 ${dTotal} 装饰物 ${pTotal}（应为 0）`);
console.log(`groupKey 采样：${[...groups].join(',')}`);

// 组过滤可用性（空库下注册一个贴图+一个装饰物，验证过滤/散布路径可跑）
registerDecal(new TileDecalBase({
  key: 'test_decal', label: '测试贴图', groups: ['crystal'],
  placement: { hostRole: ['ground'], density: 0.3, scaleRange: [1, 2] },
  pattern: { fnId: 'crack', params: { depth: 0.5 } },
}));
registerMapDecor(new MapEntityDecorBase({
  key: 'test_prop', label: '测试装饰物', groups: ['ashen'],
  placement: { hostRole: ['ground', 'platform'], perCellProb: 0.2, scaleRange: [0.5, 1.2], sinkIntoGround: 0.1 },
  render: 'instanced', shadow: 'disc',
}));
const c = generateChunk(1, 0, 0);
const decals = planChunkDecals({ seed: 1, cx: 0, cz: 0, groupKey: c.groupKey, blockTypes: c.blockTypes });
const props = planChunkProps({
  seed: 1, cx: 0, cz: 0, groupKey: c.groupKey, blockTypes: c.blockTypes,
  surfaceHeightAt: (x, z) => Math.sin(x) * 0.5,
});
console.log(`注册后 (0,0) chunk(group=${c.groupKey})：贴图 ${decals.length} 装饰物 ${props.length}`);
console.log(`组过滤正确性：decalsForGroup('crystal')=${decalsForGroup('crystal').map(d => d.key).join()}`);
console.log(`              propsForGroup('ashen')=${propsForGroup('ashen').map(p => p.key).join()}`);
console.log(`确定性：${JSON.stringify(planChunkDecals({ seed: 1, cx: 0, cz: 0, groupKey: c.groupKey, blockTypes: c.blockTypes })) === JSON.stringify(decals)}`);