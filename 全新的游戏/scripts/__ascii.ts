/**
 * 回读自检：seed12345 chunk(0,0) 顶面高度 ASCII 图（地面区域看平不平 + 凹凸定位）。
 * 每字符 = 1m 角点高度量化：0=., 1-3='、小升 >0.5=+、降<-0.5=-、平台级差用字母。
 */
import { buildFaceTable } from "../src/services/map/FaceTable";
import { topYAt } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
import { tileById } from "../src/services/map/Tiles";

const CH = 60;
const raster = new RasterMap(12345);
raster.updateChunks(30, 30, 2);
const src = raster.chunkSource(0, 0);
const table = buildFaceTable(src, 0, 0);

// 采样世界区域 x∈[8,48], z∈[8,48]（40×40 角点），每 1m
const X0 = 8, Z0 = 8, S = 40;
const g = (ch: string) => ch;
console.log("图例: . = 0±0.05 平 | ' = 0.05~0.5 | + = 0.5~1.5 | # = 1.5~3 | @ = >3 | - = 低于-0.05 | w = weld角点标记(邻块weld造成抬升?)");
// 先按角色分带行
const rows: string[] = [];
for (let lz = 0; lz < S; lz++) {
  let line = "";
  for (let lx = 0; lx < S; lx++) {
    const wx = X0 + lx, wz = Z0 + lz;
    const y = topYAt(table, src, wx, wz);
    const bx = Math.floor(wx / 4), bz = Math.floor(wz / 4);
    const cell = table.cells[(bz % 15) * 15 + (bx % 15)];
    const role = cell.role === "ground" ? "" : cell.role === "platform" ? "P" : cell.role === "liquid" ? "W" : cell.role === "pit" ? "K" : "?";
    let ch: string;
    if (y < -0.05) ch = "-";
    else if (y <= 0.05) ch = ".";
    else if (y < 0.5) ch = "'";
    else if (y < 1.5) ch = "+";
    else if (y < 3) ch = "#";
    else ch = "@";
    // 平台/水/坑角色叠加字母覆盖量化
    if (role) ch = role;
    line += ch;
  }
  rows.push(line);
}
// 顶部打印 z 坐标刻度不必要；直接按行输出（z 增向）
for (let i = 0; i < rows.length; i++) {
  const zz = Z0 + i;
  const roleRow = "";
  void roleRow;
  console.log(`${String(zz).padStart(2)} ${rows[i]}`);
}
void g; void tileById;
console.log("weld边位置（表格外的提示）: 看行间 ' + 字母过渡带即跨界坡");
console.log("done");
