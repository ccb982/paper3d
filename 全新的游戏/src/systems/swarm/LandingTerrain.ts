// ============================================================
// LandingTerrain —— 舰船落地周边地形检测（战术布置输入；《蜂群架构.md》§16.8）
// ============================================================
// 扫描落地周围（默认 80m、步长 4m）→ DefensePlan：
//   来向 / 高地 / 三环掩体位 / 隘口（v1 空）/ 战壕线（v1 空）。
// 数据源：RasterMap 高度场 + genRole（排除坑/水/陡坡）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';

/** ★ 防守布置（地形检测输出；阶段机 S0~S6 消费） */
export interface DefensePlan {
  cx: number;
  cz: number;
  /** 主要来向（单位向量；玩家最可能从这来） */
  approachX: number;
  approachZ: number;
  /** 高地（视野优势点；远程/观察） */
  highGround: { x: number; z: number; h: number }[];
  /** 掩体位（三环：0 外 / 1 中 / 2 内；工程兵按环序建造） */
  coverSlots: { x: number; z: number; ring: 0 | 1 | 2 }[];
  /** 隘口（盾兵守点；v1 空，后续 portal 分析） */
  chokepoints: { x: number; z: number }[];
  /** 战壕线（每环一条弧；每 4m 一个战壕块中心，3 块 ≈ 12m 宽工事） */
  trenchLines: { x: number; z: number }[][];
}

/** 可站性（排除坑/水/过低/过陡） */
function walkable(raster: RasterMap, x: number, z: number): { ok: boolean; h: number } {
  const role = raster.tileDefAt(x, z).genRole;
  if (role === 'pit' || role === 'liquid') return { ok: false, h: 0 };
  const h = raster.surfaceHeightAt(x, z);
  if (h < -1.2) return { ok: false, h };
  // 过陡：与 2m 邻域高差 > 1.2 → 不可站（墙/悬崖）
  const h2 = raster.surfaceHeightAt(x + 2, z);
  const h3 = raster.surfaceHeightAt(x, z + 2);
  if (Math.abs(h2 - h) > 1.2 || Math.abs(h3 - h) > 1.2) return { ok: false, h };
  return { ok: true, h };
}

/** ★ 舰船落地周边地形检测（v1） */
export function analyzeLandingTerrain(raster: RasterMap, cx: number, cz: number, radius = 80): DefensePlan {
  const step = 4;
  const h0 = raster.surfaceHeightAt(cx, cz);

  // ---- ① 来向：16 方向射线，可走比例最高 × 平均爬升最低 ----
  let bestScore = -Infinity, bestDirX = 1, bestDirZ = 0;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    let ok = 0, n = 0, rise = 0;
    for (let d = 12; d <= radius; d += step) {
      n++;
      const w = walkable(raster, cx + dx * d, cz + dz * d);
      if (w.ok) ok++;
      rise += Math.max(0, w.h - h0);
    }
    const score = (ok / Math.max(1, n)) * 2 - (rise / Math.max(1, n)) * 0.15;
    if (score > bestScore) { bestScore = score; bestDirX = dx; bestDirZ = dz; }
  }

  // ---- ② 高地：12m 窗口局部最高且突出 ≥2m ----
  const highGround: { x: number; z: number; h: number }[] = [];
  for (let gx = -radius; gx <= radius; gx += step * 2) {
    for (let gz = -radius; gz <= radius; gz += step * 2) {
      const x = cx + gx, z = cz + gz;
      const w = walkable(raster, x, z);
      if (!w.ok) continue;
      let isMax = true, minH = Infinity;
      for (let ox = -6; ox <= 6; ox += 6) {
        for (let oz = -6; oz <= 6; oz += 6) {
          const hh = raster.surfaceHeightAt(x + ox, z + oz);
          if (hh > w.h + 0.01) isMax = false;
          if (hh < minH) minH = hh;
        }
      }
      if (isMax && w.h - minH >= 2) highGround.push({ x, z, h: w.h });
    }
  }

  // ---- ③ 掩体位：三环（24/40/56m）× 来向 ±60°，15° 步进；同环间距 ≥3m ----
  const rings = [24, 40, 56];
  const coverSlots: { x: number; z: number; ring: 0 | 1 | 2 }[] = [];
  const baseA = Math.atan2(bestDirZ, bestDirX);
  for (let r = 0; r < rings.length; r++) {
    for (let k = -4; k <= 4; k++) {
      const a = baseA + (k * 15 * Math.PI) / 180;
      const x = cx + Math.cos(a) * rings[r];
      const z = cz + Math.sin(a) * rings[r];
      const w = walkable(raster, x, z);
      if (!w.ok) continue;
      let tooClose = false;
      for (const c of coverSlots) {
        if (c.ring !== r) continue;
        if ((c.x - x) ** 2 + (c.z - z) ** 2 < 9) { tooClose = true; break; }
      }
      if (tooClose) continue;
      coverSlots.push({ x, z, ring: r as 0 | 1 | 2 });
    }
  }

  // ---- ④ 战壕线：每环一条弧（来向 ±60°，7.5° 步进 ≈ 每 4m 一块）----
  const trenchLines: { x: number; z: number }[][] = [];
  for (const r of rings) {
    const line: { x: number; z: number }[] = [];
    for (let k = -8; k <= 8; k++) {
      const a = baseA + (k * 7.5 * Math.PI) / 180;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!walkable(raster, x, z).ok) continue;
      line.push({ x, z });
    }
    trenchLines.push(line);
  }

  return {
    cx, cz,
    approachX: bestDirX, approachZ: bestDirZ,
    highGround,
    coverSlots,
    chokepoints: [],
    trenchLines,
  };
}
