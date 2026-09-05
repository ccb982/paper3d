import { RasterMap } from "../src/services/map/RasterMap";
const MARGIN = 4;
for (const seed of [12345, 42, 7, 999]) {
  const raster = new RasterMap(seed);
  let total = 0, chunks = 0;
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      raster.ensureData(cx, cz);
      const lv = raster.levelsOf(cx, cz);
      let n = 0, edgeBad = 0, walkBad = 0, maxL = 0;
      for (let lz = 0; lz < 60; lz++) {
        for (let lx = 0; lx < 60; lx++) {
          const v = lv[lz * 60 + lx];
          if (v > 0) {
            n++; maxL = Math.max(maxL, v);
            if (lx < MARGIN || lx >= 60 - MARGIN || lz < MARGIN || lz >= 60 - MARGIN) edgeBad++;
            if (raster.getChunkData(cx, cz)!.walkable[lz * 60 + lx] !== 1) walkBad++;
          }
        }
      }
      if (n > 0) { chunks++; total += n; }
      if (n > 0) console.log(`seed=${seed} chunk(${cx},${cz}) 痕格=${n} maxL=${maxL} 越界=${edgeBad} 不可通行=${walkBad}`);
    }
  }
  console.log(`seed=${seed} 有痕 chunk=${chunks}/25 总格=${total}`);
  process.exitCode = (() => {
    let bad = 0;
    for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
      raster.ensureData(cx, cz);
      const lv = raster.levelsOf(cx, cz);
      for (let lz = 0; lz < 60; lz++) for (let lx = 0; lx < 60; lx++) {
        const v = lv[lz * 60 + lx];
        if (v > 0 && (lx < MARGIN || lx >= 60 - MARGIN || lz < MARGIN || lz >= 60 - MARGIN)) bad++;
        if (v > 0 && raster.getChunkData(cx, cz)!.walkable[lz * 60 + lx] !== 1) bad++;
      }
    }
    return bad;
  })();
  if (process.exitCode) break;
}
console.log(process.exitCode === 0 ? "\n=== 预置伤痕冒烟通过 ===" : `\n=== 越界/不可通行格 ${process.exitCode} ===`);
