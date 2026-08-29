import { setTestGroup } from '../src/services/map/TileGroups';
import { generateChunk } from '../src/services/map/ChunkGenerator';
import { tileById, tileTypeName, TILE_TYPE_ORDER } from '../src/services/map/Tiles';
import { groupByKey } from '../src/services/map/TileGroups';
import { tileByKey } from '../src/services/map/Tiles';

setTestGroup('crystal');
const chunk = generateChunk(12345, 0, 0);
const group = groupByKey(chunk.groupKey)!;
console.log('组:', group.key, group.label);

const byType = new Map<string, string[]>();
for (const mk of Object.keys(group.members)) {
  const td = tileByKey(mk)!;
  const t = tileTypeName(td);
  (byType.get(t) ?? byType.set(t, []).get(t)!).push(td.label);
}
for (const t of TILE_TYPE_ORDER) {
  const l = byType.get(t);
  if (l) console.log('  ', t, '→', l.join(', '));
}

const counts = new Map<string, number>();
for (const id of chunk.blockTypes) {
  const k = tileById(id).key;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
console.log('实际块数:', [...counts.entries()].map(([k, v]) => `${k}×${v}`).join(' '));

// 面板数据侧全量演练：每个成员都能解析出类型与颜色键
let ok = true;
for (const mk of Object.keys(group.members)) {
  const td = tileByKey(mk)!;
  if (!TILE_TYPE_ORDER.includes(tileTypeName(td) as never)) ok = false;
}
console.log('面板数据侧完整性:', ok ? '✓' : '✗');
setTestGroup(null);
