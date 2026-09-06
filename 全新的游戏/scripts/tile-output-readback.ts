// ============================================================================
// tile-output-readback —— 回读任意位置地块的最终绘制颜色（材质收口 + 装饰实体）
// ============================================================================
// 用途：给定 seed + 世界坐标，输出：
//   A. 该位置所在 4m 地块的 oklchShade 材质收口（基色+材质偏移+贴画/条带+抖动）
//   B. 烘焙 albedo 该位置像素色（含贴图印章的乘性变暗）
//   C. 最终绘制色 = 材质收口 × albedo 印章（不含光照/ACES）
//   D. 覆盖该位置的装饰实体（贴图印章声明 / 装饰实体 props 及其声明颜色）
//
// 用法：
//   npx tsx scripts/tile-output-readback.ts [seed] [x] [z]
//   例：npx tsx scripts/tile-output-readback.ts 12345 29.2 84.0
// ============================================================================
import { RasterMap } from '../src/services/map/RasterMap';
import { tileById, TILE_FLAT_SAND } from '../src/services/map/Tiles';
import { tileMaterialByKey } from '../src/services/map/TileMaterials';
import { groupByKey, applyGroupTintHsl } from '../src/services/map/TileGroups';
import { srgbHslToOklch, srgbHslJitterAmp, linearToSrgb } from '../src/services/map/colorLab';
import { planChunkDecals, type PlannedDecal } from '../src/services/map/decor/TileDecalBase';
import { planChunkProps, mapDecorByKey } from '../src/services/map/decor/MapEntityDecorBase';
import { buildSnapshotFromChunks, makeSnapshotSource, computeChunkMapsRGBA } from '../src/services/map/bakeCompute';
import { CHUNK_SIZE } from '../src/services/map/ChunkGenerator';

// ---------- 命令行参数 ----------
const [aSeed, aX, aZ] = process.argv.slice(2).map(Number);
const seed = Number.isFinite(aSeed) ? aSeed : 12345;
const WX = Number.isFinite(aX) ? aX : 29.2;
const WZ = Number.isFinite(aZ) ? aZ : 84.0;

// ---------- GLSL h21 / vnoise2 精确复现 ----------
const frac = (x: number) => x - Math.floor(x);
function h21(px: number, py: number): number {
  const dx = frac(px * 0.1031), dy = frac(py * 0.1031), dz = frac(px * 0.1031);
  const dot = dx * (dy + 33.33) + dy * (dz + 33.33) + dz * (dx + 33.33);
  return frac(frac(dx + dot) + frac(dy + dot)) * frac(dz + dot);
}
const vnoise2 = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = frac(x), fy = frac(y);
  fx = fx * fx * (3.0 - 2.0 * fx);
  fy = fy * fy * (3.0 - 2.0 * fy);
  const a = h21(xi, yi), b = h21(xi + 1, yi), c = h21(xi, yi + 1), d = h21(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
const smoothstep = (a: number, b: number, x: number): number => {
  if (x <= a) return 0; if (x >= b) return 1;
  const t = (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// ---------- RasterMap：定位 chunk + 真实 group 色调 ----------
const raster = new RasterMap(seed);
const cx = Math.floor(WX / 60), cz = Math.floor(WZ / 60); // CHUNK_SIZE=60
raster.ensureData(cx, cz);
const chunk = raster.getChunkData(cx, cz)!;
const groupDef = groupByKey(chunk.groupKey!);
const palette = groupDef?.palette;

const td = raster.tileDefAt(WX, WZ);
const tintHsl = applyGroupTintHsl(td.visual.baseHsl, palette);
const lch = srgbHslToOklch(tintHsl.h, tintHsl.s, tintHsl.l);
const j = td.visual.jitter ?? { h: 0, s: 0, l: 0 };
const jlch = srgbHslJitterAmp(tintHsl.h, tintHsl.s, tintHsl.l, j.h, j.s, j.l);
const mat = td.visual.material ? tileMaterialByKey(td.visual.material.fnId) : undefined;
const merged = { ...mat?.params, ...(td.visual.material?.params ?? {}) };

console.log(`seed=${seed} chunk(${cx},${cz}) group=${chunk.groupKey} palette=${palette ? `${palette.length}色` : null}`);
console.log(`站点 (${WX},${WZ}) tile=id${td.id} ${td.key ?? ''} mat=${td.visual.material?.fnId ?? 'none'}`);
console.log(`  baseOKLCH=(${lch.L.toFixed(4)},${lch.C.toFixed(4)},${lch.H.toFixed(4)}) jitterOKLCH=(${jlch.L.toFixed(4)},${jlch.C.toFixed(4)},${jlch.H.toFixed(4)})`);
console.log(`  hazard=${merged.hazard ?? 0} stripes=${merged.stripes ?? 0}`);

// ---------- tile 判定 ----------
const wt = { x: WX - Math.floor(WX / 4096) * 4096, y: WZ - Math.floor(WZ / 4096) * 4096 };
const tc = { x: Math.floor(wt.x / 4), y: Math.floor(wt.y / 4) };
const lp0 = { x: wt.x - tc.x * 4, y: wt.y - tc.y * 4 };
const tileH = h21(tc.x + 7.31, tc.y + 7.31);
const hasHazard = tileH <= 0.1;
const k = Math.floor(h21(tc.x + 3.17, tc.y + 3.17) * 2);
console.log(`\n[tile 判定] tc=(${tc.x},${tc.y}) 站点lp=(${lp0.x.toFixed(2)},${lp0.y.toFixed(2)}) tileH=${tileH.toFixed(4)} ${hasHazard ? '★ 命中贴画' : '无贴画'} k=${k}`);

// ---------- okLab2linear（GLSL 同式） ----------
function oklab2linear(L: number, C: number, Hn: number): [number, number, number] {
  const a = C * Math.cos(Hn * 6.28318530718);
  const b = C * Math.sin(Hn * 6.28318530718);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416613 * l - 3.3077115904 * m + 0.2309699287 * s,
    -1.2684380041 * l + 2.6097574007 * m - 0.3413193963 * s,
    -0.0041960865 * l - 0.7034186145 * m + 1.7076147009 * s,
  ];
}

// ---------- 复算 mat_sand + 贴画 + 抖动 → oklchShade 收口 ----------
function shadeAt(pl: { x: number; y: number }): { L: number; C: number; Hn: number; linear: [number, number, number] } {
  const sx = tc.x * 4 + pl.x, sz = tc.y * 4 + pl.y;
  // 材质图案（sand/cement 共用三尺度连续明暗结构，仅幅度不同——对应 mat_sand/mat_cement）
  const isCement = td.visual.material?.fnId === 'cement';
  const ag = merged.grain ?? 0.045, am = merged.meso ?? 0.05, aM = merged.macro ?? 0.09, ac = merged.chroma ?? 1.0;
  const macro = (vnoise2(sx * 0.18, sz * 0.18) - 0.5) * 2 * aM * (isCement ? 0.25 : 0.50);
  const meso = (vnoise2(sx * 0.75, sz * 0.75) - 0.5) * 2 * am * (isCement ? 0.35 : 0.46);
  const grain = (h21(Math.floor(sx * 110), Math.floor(sz * 110)) - 0.5) * ag * (isCement ? 1.2 : 1.6);
  const dL = macro + meso + grain;
  const shade = macro * 0.6 + meso * 0.4;
  const dC = -shade * (isCement ? 0.020 : 0.028) * ac;
  const hueDrift = (vnoise2(sx * 0.22 + 31.0, sz * 0.22 + 31.0) - 0.5) * 2 * ac * (isCement ? 0.008 : 0.015);
  const dH = shade * (isCement ? 0.010 : 0.016) * ac + hueDrift;

  // hazardDeco（仅贴画；模板色见 TerrainMaterial）
  let dd: [number, number, number] = [0, 0, 0];
  const amt = merged.hazard ?? 0;
  if (hasHazard && amt > 0.001) {
    const d = { x: pl.x - 2, y: pl.y - 2 };
    const q = Math.max(Math.abs(d.x), Math.abs(d.y));
    const OS = 1.55, IS = 1.25, P = 0.32;
    const wear = Math.abs(vnoise2(pl.x * 5.0 + k * 17.0, pl.y * 5.0 + k * 17.0) - 0.5) * 0.04;
    const mOut = 1 - smoothstep(OS - 0.005 - wear, OS + 0.005 - wear, q);
    const mOutline = mOut * smoothstep(OS - 0.032, OS - 0.008, q);
    const mStripe = mOut * smoothstep(IS - 0.02, IS + 0.02, q) * (1 - smoothstep(OS - 0.034, OS - 0.010, q));
    const mIn = mOut * (1 - smoothstep(IS - 0.02, IS + 0.02, q));
    const u = k < 0.5 ? d.x + d.y : d.x - d.y;
    const fr = frac(u / P);
    const yellowF = 1 - smoothstep(0.44, 0.56, fr);
    const mottle = 0.92 + vnoise2(pl.x * 9.0 + k * 29.0, pl.y * 9.0 + k * 29.0) * 0.08;
    const blackJit = (vnoise2(pl.x * 7.0 + k * 41.0, pl.y * 7.0 + k * 41.0) - 0.5) * 0.04;
    const inWear = 0.94 + vnoise2(pl.x * 9.0 + k * 31.0, pl.y * 9.0 + k * 31.0) * 0.06;
    const scPresence = h21(tc.x + 19.7, tc.y + 19.7) < 0.5 ? 1 : 0;
    const scU = d.x * 1.4 + d.y * 1.4 + (vnoise2(pl.x * 2.0 + k * 7.0, pl.y * 2.0 + k * 7.0) - 0.5) * 0.8;
    const scW = smoothstep(0.980, 0.988, frac(scU)) * scPresence * 0.30;
    const yellow: [number, number, number] = [0.85, 0.175, 0.24];
    const black: [number, number, number] = [0.015, 0, 0];
    const interior: [number, number, number] = [0.6626, 0.1348, 0.2500]; // JSON #b38e03
    const worn = 1 + (mottle - 1) * yellowF + blackJit;
    const target: [number, number, number] = [
      (black[0] + (yellow[0] - black[0]) * yellowF) * worn,
      (black[1] + (yellow[1] - black[1]) * yellowF) * worn,
      (black[2] + (yellow[2] - black[2]) * yellowF) * worn,
    ];
    const baseL = [lch.L, lch.C, lch.H];
    dd = [
      (target[0] - baseL[0]) * mStripe + (interior[0] - baseL[0]) * mIn + (black[0] * 0.85 - baseL[0]) * mOutline + (lch.L * 0.9 - baseL[0]) * scW,
      (target[1] - baseL[1]) * mStripe + (interior[1] - baseL[1]) * mIn + (black[1] * 0.85 - baseL[1]) * mOutline + (lch.C * 0.9 - baseL[1]) * scW,
      (target[2] - baseL[2]) * mStripe + (interior[2] - baseL[2]) * mIn + (black[2] * 0.85 - baseL[2]) * mOutline + (lch.H * 0.9 - baseL[2]) * scW,
    ];
  }

  // oklchShade 收口（jitter 由地块坐标驱动）
  const jf = (h21(Math.floor(sx / 4), Math.floor(sz / 4)) - 0.5) * 2;
  const L = lch.L + dL + dd[0] * amt + jlch.L * jf;
  const C = lch.C + dC + dd[1] * amt + jlch.C * jf;
  const Hn = lch.H + dH + dd[2] * amt + jlch.H * jf;
  const LX = Math.max(0, Math.min(1, L));
  const LY = Math.max(0, Math.min(0.4, C));
  const LZ = frac(Hn);
  const linear = oklab2linear(LX, LY, LZ);
  return { L: LX, C: LY, Hn: LZ, linear };
}

const fmt = (r: { L: number; C: number; Hn: number; linear: [number, number, number] }) => {
  const srgb = r.linear.map((v) => Math.round(Math.max(0, Math.min(1, linearToSrgb(v))) * 255));
  return `OKLCH(${r.L.toFixed(3)},${r.C.toFixed(3)},${r.Hn.toFixed(3)}) lin[${r.linear[0].toFixed(2)},${r.linear[1].toFixed(2)},${r.linear[2].toFixed(2)}] sRGB(${srgb.join(',')})`;
};

// ---------- 烘焙 albedo（含贴图印章；一次烘焙，按世界坐标读像素） ----------
const decalCtx = {
  seed: raster.worldSeed, cx, cz,
  groupKey: chunk.groupKey, blockTypes: chunk.blockTypes,
};
const decals = planChunkDecals(decalCtx);
const props = planChunkProps({ ...decalCtx, surfaceHeightAt: (x, z) => raster.surfaceHeightAt(x, z) });

const snap = buildSnapshotFromChunks(
  raster.worldSeed, cx, cz,
  (a, b) => { raster.ensureData(a, b); return raster.getChunkData(a, b); },
  { decals },
);
const baked = computeChunkMapsRGBA(makeSnapshotSource(snap), cx, cz, { decals });

const ALBEDO_S = 256;
const step = CHUNK_SIZE / ALBEDO_S;
function albedoPixelAt(wx: number, wz: number): [number, number, number] {
  const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
  const px = Math.max(0, Math.min(ALBEDO_S - 1, Math.floor(lx / step)));
  const py = Math.max(0, Math.min(ALBEDO_S - 1, Math.floor(lz / step)));
  const o = (py * ALBEDO_S + px) * 4;
  return [baked.albedo[o], baked.albedo[o + 1], baked.albedo[o + 2]];
}

// ---------- 装饰实体：该位置覆盖了什么（印章 cell 判定 + props） ----------
function decalAt(wx: number, wz: number): PlannedDecal | undefined {
  // 印章中心 = cell*3 + ox*3（世界 = chunk 原点 +）；影响半径 ≈ scale/2
  for (const d of decals) {
    const dcx = cx * CHUNK_SIZE + (d.cellX + d.ox) * 3;
    const dcz = cz * CHUNK_SIZE + (d.cellY + d.oy) * 3;
    const dx = wx - dcx, dz = wz - dcz;
    if (dx * dx + dz * dz <= Math.pow(d.scale / 2 + 0.5, 2)) return d;
  }
  return undefined;
}
function propsNear(wx: number, wz: number, radius: number): string[] {
  const hits: string[] = [];
  for (const p of props) {
    const dx = (p.x + cx * CHUNK_SIZE) - wx, dz = (p.z + cz * CHUNK_SIZE) - wz;
    if (dx * dx + dz * dz <= radius * radius) {
      const def = mapDecorByKey(p.propKey);
      const color = def?.geometry?.params?.color;
      const hex = color !== undefined ? `0x${(color >>> 0).toString(16).padStart(6, '0')}` : 'none';
      hits.push(`${p.propKey}(scale=${p.scale.toFixed(2)},color=${hex}${p.propKey === 'foundation_pebble' ? ' 浅灰石' : ''})`);
    }
  }
  return hits;
}

console.log(`\n[装饰实体] 本 chunk 贴图印章=${decals.length} 装饰物=${props.length}`);
const stDecal = decalAt(WX, WZ);
if (stDecal) console.log(`  站点印章命中: ${stDecal.decalKey} scale=${stDecal.scale.toFixed(2)} cell=(${stDecal.cellX},${stDecal.cellY})`);
const stProps = propsNear(WX, WZ, 1.2);
if (stProps.length) console.log(`  站点 1.2m 内装饰物: ${stProps.join(' | ')}`);

const samples: Array<[string, number, number]> = [
  ['内部中心', 2.0, 2.0],
  ['内部偏移', 1.55, 1.55],
  ['新内边', 1.28, 2.0],
  ['环上外', 1.48, 2.0],
  ['环上内', 1.26, 2.0],
  ['描边带', 1.53, 1.53],
  ['外缘外', 1.95, 2.0],
  ['站点', lp0.x, lp0.y],
];
console.log(`\n[tile 内抽样] （材质收口 × 印章后 = 最终绘制色，仍不含光照/ACES）`);
for (const [name, px, py] of samples) {
  const wx = tc.x * 4 + px, wz = tc.y * 4 + py;
  const matOut = shadeAt({ x: px, y: py });
  const [ar, ag, ab] = albedoPixelAt(wx, wz);
  const m = ar / 255;
  const finalLin = matOut.linear.map((v) => v * m) as [number, number, number];
  const finalSrgb = finalLin.map((v) => Math.round(Math.max(0, Math.min(1, linearToSrgb(v))) * 255));
  console.log(`  ${name.padEnd(5)} lp=(${px.toFixed(2)},${py.toFixed(2)}) 材质 ${fmt(matOut)}`);
  console.log(`${' '.repeat(20)} 印章=${ar===255&&ag===255&&ab===255?'无':`(${ar},${ag},${ab})`} 最终 sRGB(${finalSrgb.join(',')})`);
}