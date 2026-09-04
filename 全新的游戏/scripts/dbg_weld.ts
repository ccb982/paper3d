/**
 * 回读 seed12345 (68.8,183.3) 处：块表属性 + x=70 竖切片 ASCII
 * 切片画法：水平轴 = z，纵 = 高度；顶面曲线 = 低侧块视角（坡）；壁 = 竖线
 */
import { buildFaceTable } from "../src/services/map/FaceTable";
import { buildWallGeometry, topYView } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
import { tileById } from "../src/services/map/Tiles";

const CH = 60;
const raster = new RasterMap(12345);
raster.updateChunks(68.8, 183.3, 2);
const cx = 1, cz = 3;
const src = raster.chunkSource(cx, cz);
const t = buildFaceTable(src, cx, cz);

const D = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const dName = ["+x", "-x", "+z", "-z"];
const D2 = (bx: number, bz: number, dir: number) => `${D[dir][0] ? (D[dir][0] > 0 ? "+x" : "-x") : D[dir][1] > 0 ? "+z" : "-z"}`;

// ---- 1) 目标块与邻块表属性 ----
const bx0 = 17, bz0 = 45;
for (let dz2 = -1; dz2 <= 1; dz2++) {
  for (let dx2 = -1; dx2 <= 1; dx2++) {
    const bx = bx0 + dx2, bz = bz0 + dz2;
    const info = src.blockAt(bx, bz);
    if (!info) continue;
    const role = tileById(info.id).genRole;
    const lbx = bx - cx * 15, lbz = bz - cz * 15;
    const cell = lbx >= 0 && lbx < 15 && lbz >= 0 && lbz < 15 ? t.cells[lbz * 15 + lbx] : null;
    const sides = cell
      ? "[" + [0, 1, 2, 3].map((d) => {
        const s = cell.sides[d as 0 | 1 | 2 | 3];
        return `${dName[d]}:${s.kind}${s.kind === "weld" || s.oppKind === "weld" || s.kind === "bevel" ? "!" : ""}(opp=${s.oppKind})`;
      }).join(" ") + "]"
      : "(不在本表)";
    console.log(`块(${bx},${bz}) role=${role} id=${info.id} h=${info.h.toFixed(2)} hBase=${info.hBase?.toFixed(2) ?? info.h.toFixed(2)} 本表cell=${!!cell} ${sides}`);
  }
}
console.log("");

// ---- 2) 本块内每向 topEdgeY/depth ----
const lbx2 = bx0 - cx * 15, lbz2 = bz0 - cz * 15;
const c0 = t.cells[lbz2 * 15 + lbx2];
console.log(`目标块(${bx0},${bz0}) 本表idx=${c0.idx}`);
for (let d = 0; d < 4; d++) {
  const s = c0.sides[d as 0 | 1 | 2 | 3];
  console.log(`  d${d}(${dName[d]}/${D2(bx0, bz0, d)}) kind=${s.kind} ruling=${s.ruling} oppKind=${s.oppKind} topEdgeY=${s.topEdgeY.toFixed(3)} calc=${s.calcDepth.toFixed(3)} depth=${s.depth.toFixed(3)} arcN=${s.arcNeighbor}`);
}

// ---- 3) 沿 z=184 边界（块17,45 的 +z 边）每 0.5m 墙几何采样（来自 buildWallGeometry 输出）----
const wall = buildWallGeometry(t, src);
const V = wall.vertices;
const oz = cz * CH, ox2 = cx * CH;
const HALF = CH / 2;
console.log("\n沿 z=184 边（块(17,45) +z 边 = 块(17,46) -z 边）墙几何：");
const seam = new Map<number, { top: number[]; bot: number[] }>();
for (let i = 0; i < V.length; i += 3) {
  const lx = V[i] + HALF + ox2, lz = V[i + 2] + HALF + oz;
  if (Math.abs(lz - 184) > 0.02 || lx < 68 || lx > 72) continue;
  const seg = Math.floor((lx - 68) * 2); // 0.5m
  if (!seam.has(seg)) seam.set(seg, { top: [], bot: [] });
  seam.get(seg)!.top.push(V[i + 1]);
}
for (const [seg, v] of [...seam.entries()].sort((a, b) => a[0] - b[0])) {
  const lo = 68 + seg * 0.5;
  console.log(`  x=${lo.toFixed(1)}..${(lo + 0.5).toFixed(1)} 顶y∈[${Math.min(...v.top).toFixed(2)},${Math.max(...v.top).toFixed(2)}] (顶点数${v.top.length})`);
}

// ---- 4) 竖切片 ASCII：z 168..192 每 0.25m，x=70，显示各块视角顶面高度 ----
console.log("\nx=70 顶面（本块视角=所属块 floor(z/4)）曲线 + 1m 网格点：");
const Z0 = 168, Z1 = 192;
const heights: number[] = [];
for (let z = Z0; z <= Z1; z += 0.25) heights.push(z);
const yMin = 0, yMax = 8, STEP = 0.25;
// 收集:每 z 采样点顶部高度值（以点所在块视角）
for (const z of heights) {
  const vbz = Math.floor(z / 4);
  const y = topYView(t, src, 17, vbz, 70, z);
  const ch = " #".includes("") ? "" : "";
  void ch;
  const quant = Math.min(yMax - 1, Math.max(yMin, Math.floor(y / STEP)));
  void quant;
}
// 打印两行式: 每 0.25 z 一列太多; 改每 0.5m 一列, 高度行 y=0..8 每 0.5 一行
console.log("行 = 高度(米, 0~8 每行 0.5m)，列 = z(168..192 每 0.5m)；字符：所属块 h（#=低块坡面位置示意）");
{
  const cols: { z: number; yA: number; yB: number; blockRow: number }[] = [];
  for (let z = Z0; z <= Z1; z += 0.5) {
    const vbz = Math.floor(z / 4);
    const info = src.blockAt(17, vbz);
    cols.push({ z, yA: topYView(t, src, 17, vbz, 70, z), yB: topYView(t, src, 17, Math.max(0, vbz), 70, z), blockRow: vbz });
  }
  for (let y = yMax; y >= yMin; y -= STEP * 2) {
    let line = "";
    for (const c of cols) {
      const hitA = c.yA >= y - STEP && c.yA <= y + STEP;
      const hitB = c.yB >= y - STEP && c.yB <= y + STEP;
      void hitB;
      line += hitA ? "#" : ".";
    }
    console.log(`${String(y).padStart(3)} ${line}`);
  }
}
// 边界 z 刻度行
{
  let l = "    ";
  for (let z = Z0; z <= Z1; z += 0.5) l += Math.abs(z % 4) < 0.01 ? "|" : " ";
  console.log(l);
  l = "    ";
  for (let z = Z0; z <= Z1; z += 0.5) l += z % 8 === 0 ? String(Math.floor(z)).padStart(1) : " ";
  console.log(l);
}
console.log("done");
