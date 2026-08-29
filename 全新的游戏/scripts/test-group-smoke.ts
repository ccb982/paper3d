import { setTestGroup, pickChunkGroup } from '../src/services/map/TileGroups';
import { generateChunk } from '../src/services/map/ChunkGenerator';

// ① 覆盖 crystal：9 chunk 组选择全 crystal
setTestGroup('crystal');
const groups1 = new Set<string>();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) groups1.add(pickChunkGroup(1, cx, cz).key);
console.log('① 覆盖后组集合:', [...groups1].join(','), groups1.size === 1 ? '✓' : '✗');

// ② 全链路验证：generateChunk 产出的 blockTypes 只含 crystal 组成员（0平地/10冰/14冰台/4水/2坑）
setTestGroup('crystal');
const c = generateChunk(6, 3, -4);
const allowed = new Set([0, 10, 14, 4, 2]);
const bad = [...c.blockTypes].filter((id) => !allowed.has(id));
console.log('② crystal 世界 blockTypes 越界成员:', bad.length === 0 ? '无 ✓' : `✗ ${[...new Set(bad)].join(',')}`);
console.log('   groupKey:', c.groupKey);

// ③ 关闭恢复加权抽取（多组多样性）
setTestGroup(null);
const groups2 = new Set<string>();
for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) groups2.add(pickChunkGroup(6, cx, cz).key);
console.log('③ 关闭后组多样性:', [...groups2].join(','), groups2.size > 1 ? '✓' : '✗');

// ④ 未知 key 抛错（fail-fast）
try { setTestGroup('不存在'); console.log('④ 未知 key: ✗ 未抛错'); } catch { console.log('④ 未知 key 抛错: ✓'); }

// ⑤ foundation 也可作为测试组（含 brick/grass/wood/rock_platform 的陈列馆）
setTestGroup('foundation');
const cf = generateChunk(1, 0, 0);
console.log('⑤ foundation 世界 groupKey:', cf.groupKey, cf.groupKey === 'foundation' ? '✓' : '✗');
setTestGroup(null);
