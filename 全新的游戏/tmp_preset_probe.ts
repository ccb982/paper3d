import { generateChunk } from './src/services/map/ChunkGenerator';

const seeds = [12345, 777, 987654321];
for (const seed of seeds) {
  const counts: Record<string, number> = {};
  let n = 0;
  for (let cz = -20; cz < 20; cz++) {
    for (let cx = -20; cx < 20; cx++) {
      const d = generateChunk(seed, cx, cz);
      counts[d.presetKey] = (counts[d.presetKey] ?? 0) + 1;
      n++;
    }
  }
  console.log('seed', seed, JSON.stringify(counts));
}

const d0 = generateChunk(12345, 0, 0);
console.log('chunk(0,0):', d0.presetKey, d0.groupKey);
const seen = new Set<string>();
for (let cz = -6; cz <= 6; cz++) {
  let row = '';
  for (let cx = -6; cx <= 6; cx++) {
    const d = generateChunk(12345, cx, cz);
    row += d.presetKey.padEnd(9).slice(0, 8) + ' ';
    seen.add(d.presetKey);
  }
  console.log(row);
}
console.log('seen near origin:', [...seen].join(','));
