import { refine, cornerCell, finalRuling, interpEdge, type BlockSource, type BlockInfo } from "../src/services/map/SurfaceRules";

const isHigh = (bx: number, bz: number) => bx >= 8 && bz === 0;
const src0: BlockSource = {
  blockAt: (bx, bz): BlockInfo | undefined => ({
    id: isHigh(bx, bz) ? 92 : 0,
    h: isHigh(bx, bz) ? 4 : 0,
  }),
};
const src = refine(src0, {
  edgeOverrides: new Map([
    ["7,0,0", { bx: 7, bz: 0, dir: 0, ruling: "weld" }],
    ["8,0,1", { bx: 8, bz: 0, dir: 1, ruling: "weld" }],
  ]),
  heights: new Map(),
});

console.log("finalRuling(7,0,+x) =", finalRuling(src, 7, 0, 0));
console.log("finalRuling(8,0,-x) =", finalRuling(src, 8, 0, 1));
console.log("interpEdge(7,0,+x)@x=31.8 =", interpEdge(src, 7, 0, 0, 31.8, 2));
console.log("interpEdge(7,0,+x)@x=31.99 =", interpEdge(src, 7, 0, 0, 31.99, 2));
console.log("cornerCell(7,0)@x=31.8,z=2 =", cornerCell(src, 7, 0, 31.8, 2));
console.log("cornerCell(7,0)@x=31.8,z=4 =", cornerCell(src, 7, 0, 31.8, 4));
console.log("cornerCell(7,0)@x=31.8,z=3.9 =", cornerCell(src, 7, 0, 31.8, 3.9));
