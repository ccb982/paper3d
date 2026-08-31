import {
  buildChunkWallBuffers,
  cornerCell,
  type BlockSource,
  type BlockInfo,
} from "../src/services/map/SurfaceRules";

const isHigh = (bx: number, bz: number) => bx >= 8 && bz === 0;
const src: BlockSource = {
  blockAt: (bx, bz): BlockInfo | undefined => ({
    id: isHigh(bx, bz) ? 92 : 0,
    h: isHigh(bx, bz) ? 4 : 0,
  }),
  edgeFinal: (bx, bz, dir) =>
    bz === 0 && ((bx === 7 && dir === 0) || (bx === 8 && dir === 1))
      ? "weld"
      : undefined,
};

// block (7,0) spans x∈[28,32], z∈[0,4]; block 7,1 spans z∈[4,8]
// The ramp on block 7,0 toward (8,0) elevates near x=31-32.
// At the z-seam z≈4, compare surfaces.
for (const x of [28.5, 29.5, 30.5, 31.2, 31.8, 31.99]) {
  const b70 = cornerCell(src, 7, 0, x, 4);
  const b71 = cornerCell(src, 7, 1, x, 4);
  console.log(`x=${x}: block(7,0)@z=4 = ${b70.toFixed(3)}  block(7,1)@z=4 = ${b71.toFixed(3)}  diff=${(b70 - b71).toFixed(3)}`);
}

// Now actually build walls and count skirt + backing
const wallCtx = () => ({
  seed: 1,
  heightAt: () => 0,
  tileDefAt: () => ({ visual: { baseHsl: { h: 0, s: 0, l: 0.5 } }, isDepression: false }),
});
const buf = buildChunkWallBuffers(src, 0, 0, 60, wallCtx());
const idx = buf.indices, verts = buf.vertices;
let skirt = 0, backing = 0, all = 0;
for (let t = 0; t < idx.length; t += 6) {
  const i0 = idx[t], i1 = idx[t+1];
  const x0 = verts[i0*3], x1 = verts[i1*3];
  const z0 = verts[i0*3+2], z1 = verts[i1*3+2];
  const top0 = verts[i0*3+1];
  all++;
  if (Math.abs(z0-z1) < 0.01 && top0 > 3.9) backing++;
  if (Math.abs(x0-x1) < 0.01 && top0 > 0.01 && top0 <= 3.9) skirt++;
}
console.log(`total quads=${all}, backing=${backing}, skirt=${skirt}`);
