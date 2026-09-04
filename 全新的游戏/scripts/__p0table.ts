/**
 * P0 校验（薄表版）：FaceTable kind / wallQuads vs 现 BlockFaceIndex 对照。
 * 对照项：
 *   A. id/role/h/hBase/topTileId —— 应 0
 *   B. sides.kind —— vs index(ruling+isBevel) 组合，应 0
 *   C. wallQuads —— 由旧 index.wallRef 提供同源填充，抽查非空一致性
 */
import { buildFaceTable, attachWallQuads, type SideKind } from "../src/services/map/FaceTable";
import { buildBlockFaceIndex } from "../src/services/map/BlockFaceIndex";
import { buildChunkFinal, buildChunkWallBuffers } from "../src/services/map/Refinements";
import { RasterMap } from "../src/services/map/RasterMap";

const CH = 60;

function run(seed: number, cx: number, cz: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(cx * CH + CH / 2, cz * CH + CH / 2, 2);
  const src = raster.chunkSource(cx, cz);
  const palette = undefined as any;
  const ctx = { seed, palette, heightAt: (x: number, z: number) => raster.heightAt(x, z), tileDefAt: (x: number, z: number) => raster.tileDefAt(x, z) } as any;
  const wallBuffers = buildChunkWallBuffers(src, cx, cz, CH, ctx);
  const cornerH = buildChunkFinal(src, cx, cz, CH).cornerH;
  const idx = buildBlockFaceIndex(src, cx, cz, cornerH, wallBuffers);

  const kindOf = (r: string, b: boolean): SideKind =>
    r === "weld" ? "weld" : b ? "bevel" : "hard";

  const ft = buildFaceTable(src, cx, cz);
  attachWallQuads(ft, (bx, bz, dir) => {
    const lbx = bx - cx * 15, lbz = bz - cz * 15;
    if (lbx < 0 || lbz < 0 || lbx >= 15 || lbz >= 15) return null;
    const e = idx.at(lbx, lbz);
    return e ? e.sides[dir as 0 | 1 | 2 | 3].wallRef?.quads ?? null : null;
  });

  let dKind = 0, dWq = 0, dId = 0, dRole = 0, dH = 0, dTop = 0;
  const samples: string[] = [];
  const note = (s: string) => { if (samples.length < 10) samples.push(s); };

  for (let lbz = 0; lbz < 15; lbz++) {
    for (let lbx = 0; lbx < 15; lbx++) {
      const e = idx.at(lbx, lbz)!;
      const f = ft.cells[lbz * 15 + lbx];
      if (e.id !== f.id) dId++;
      if (e.role !== f.role) dRole++;
      if (Math.abs(e.h - f.h) > 1e-9) dH++;
      if (e.topTileId !== f.topTileId) dTop++;
      for (let dir = 0; dir < 4; dir++) {
        const se = e.sides[dir as 0 | 1 | 2 | 3];
        const sf = f.sides[dir as 0 | 1 | 2 | 3];
        if (kindOf(se.ruling, se.isBevel) !== sf.kind) {
          dKind++;
          note(`kind 块(${lbx},${lbz}) d${dir} idx=${kindOf(se.ruling, se.isBevel)} ft=${sf.kind}`);
        }
        const a = se.wallRef?.quads ?? null;
        const b2 = sf.wallQuads;
        const eq = a && b2 && a.length === b2.length ? [...a].every((v, i) => v === b2[i]) : a === b2;
        if (!eq) {
          dWq++;
          if (!samples.some((x) => x.includes(`wq 块(${lbx},${lbz}) d${dir}`)))
            note(`wq 块(${lbx},${lbz}) d${dir} idx=${a ? a.length : "0"} ft=${b2 ? b2.length : "0"}`);
        }
      }
    }
  }
  console.log(`seed=${seed} chunk(${cx},${cz}): id=${dId} role=${dRole} h=${dH} top=${dTop} kind=${dKind} wallQuads=${dWq}`);
  for (const s of samples) console.log(`  ${s}`);
}

run(12345, 0, 0);
run(12345, 0, 1);
run(42, 0, 0);
console.log("done");
