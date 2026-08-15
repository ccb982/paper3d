// 诊断脚本：复现主页面"导入流体参数 → 首帧 composite"链路
// 目标：确认 composite 首帧输出是否 = 烘焙帧（若不等，找出差异像素与成因）
import * as THREE from 'three';
import { FluidSolver, defaultFluidConfig, type FluidSolverConfig } from './src/fluid/FluidSolver';
import { unpackMultiFrameFromBinary } from './src/utils/binaryCompression';
import { adjustResidualForUniformRange } from './src/utils/colorCompressor';
import { parseImportedFluidConfig } from './src/fluid/fluidConfigIO';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };

async function main() {
  // ---------- 1. 解码子弹 ftx3 ----------
  const gz = await fetch('/bullet.ftx3.gz').then(r => r.arrayBuffer());
  const { palette, frames } = unpackMultiFrameFromBinary(gz);
  const frame = frames[0];
  const { bbox } = frame;
  log(`帧 "${frame.name}" ${frame.width}x${frame.height} bbox=(${bbox.x},${bbox.y}) ${bbox.w}x${bbox.h}`);

  // ---------- 2. 构建 bbox 局部残差（模拟 bindFrameToLayer residBase，含 0.25 转换） ----------
  const residBase = new ImageData(bbox.w, bbox.h);
  const d = residBase.data;
  d.fill(128);
  const colorMap = new Map<number, { h: number; s: number; l: number }>();
  for (const c of palette) colorMap.set(c.id, c);
  for (let pi = 0; pi < frame.regionIdTex.length; pi++) {
    const cid = frame.regionIdTex[pi];
    if (cid === 0 || !colorMap.has(cid)) continue;
    const packed = frame.deltaPacked[pi];
    const { s: qS, h: qH, l: qL } = unpackRGB565(packed);
    const di = pi * 4;
    d[di] = Math.round((qH / 63) * 255);
    d[di + 1] = Math.round((qS / 31) * 255);
    d[di + 2] = Math.round((qL / 31) * 255);
    d[di + 3] = 128;
  }
  adjustResidualForUniformRange(residBase, bbox, frame.blockFlags);

  // ---------- 3. CPU 烘焙帧（decodeFrameToTextures 逻辑：base + dequantize(q, blockRange)） ----------
  const bakeW = bbox.w, bakeH = bbox.h;
  const baked = new Uint8ClampedArray(bakeW * bakeH * 4); // RGBA
  baked.fill(0);
  for (let i = 0; i < frame.regionIdTex.length; i++) {
    const cid = frame.regionIdTex[i];
    const bc = colorMap.get(cid);
    if (!bc) continue;
    const px = i % bakeW, py = Math.floor(i / bakeW);
    const blockIdx = getBlockIdx(px, py, bakeW, bakeH);
    const range = (frame.blockFlags & (1n << BigInt(blockIdx))) ? 0.25 : 0.5;
    const packed = frame.deltaPacked[i];
    const { s: qS, h: qH, l: qL } = unpackRGB565(packed);
    const dH = ((qH / 63) * 2 * range) - range;
    const dS = ((qS / 31) * 2 * range) - range;
    const dL = ((qL / 31) * 2 * range) - range;
    const finH = ((bc.h + dH) % 1 + 1) % 1;
    const finS = Math.max(0, Math.min(1, bc.s + dS));
    const finL = Math.max(0, Math.min(1, bc.l + dL));
    const [r, g, b] = hslToRgb(finH, finS, finL);
    const idx = i * 4;
    baked[idx] = r; baked[idx + 1] = g; baked[idx + 2] = b; baked[idx + 3] = 255;
  }
  log(`CPU 烘焙帧 ${bakeW}x${bakeH} 构建完成`);

  // ---------- 4. baseHsl 反推（buildBaseHslFromFrame 简化版，区域=全 bbox） ----------
  const baseHsl = new Float32Array(bakeW * bakeH * 4);
  for (let i = 0; i < bakeW * bakeH; i++) {
    const r = baked[i * 4], g = baked[i * 4 + 1], b = baked[i * 4 + 2], a = baked[i * 4 + 3];
    const fh = rgbToHsl(r, g, b);
    const rr = d[i * 4] / 255, rg = d[i * 4 + 1] / 255, rb = d[i * 4 + 2] / 255;
    const dH = (rr * 2 - 1) * 0.5, dS = (rg * 2 - 1) * 0.5, dL = (rb * 2 - 1) * 0.5;
    baseHsl[i * 4] = ((fh.h - dH) % 1 + 1) % 1;
    baseHsl[i * 4 + 1] = Math.max(0, Math.min(1, fh.s - dS));
    baseHsl[i * 4 + 2] = Math.max(0, Math.min(1, fh.l - dL));
    baseHsl[i * 4 + 3] = a / 255;
  }

  // ---------- 5. 创建 FluidSolver（主页面 useFluidSolver 等价） ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  const res = { w: bakeW, h: bakeH };
  const cfg: FluidSolverConfig = {
    ...defaultFluidConfig,
    ...parseImportedFluidConfig({
      coreSwitches: {},
      advectionAndComposite: {},
      globalForce: {},
      continuousSources: [],
    }, res),
    resolution: { ...res },
  };
  const solver = new FluidSolver(renderer, cfg, res);
  const residImg = new ImageData(new Uint8ClampedArray(residBase.data), bakeW, bakeH);
  solver.loadResidual(residImg);
  solver.setBaseHsl(baseHsl, bakeW, bakeH);
  solver.composite();

  // ---------- 6. 读取 composite 输出，与烘焙帧对比 ----------
  const target = (solver as any).compositeTarget as THREE.WebGLRenderTarget;
  const pixels = new Uint8Array(bakeW * bakeH * 4);
  renderer.readRenderTargetPixels(target, 0, 0, bakeW, bakeH, pixels);
  let diffCount = 0, maxDiff = 0, total = 0;
  // 同位置对比（无翻转）——composite 与烘焙帧坐标系一致
  for (let y = 0; y < bakeH; y++) {
    for (let x = 0; x < bakeW; x++) {
      const si = (y * bakeW + x) * 4;
      const ci = (y * bakeW + x) * 4;
      const br = baked[ci], bg = baked[ci + 1], bb = baked[ci + 2];
      if (br === 0 && bg === 0 && bb === 0) continue; // 未着色像素
      total++;
      const cr = pixels[si], cg = pixels[si + 1], cb = pixels[si + 2];
      const diff = Math.abs(br - cr) + Math.abs(bg - cg) + Math.abs(bb - cb);
      if (diff > 2) { diffCount++; maxDiff = Math.max(maxDiff, diff); }
    }
  }
  log(`\n========== 结果 ==========`);
  log(`solver 分辨率: ${cfg.resolution.w}x${cfg.resolution.h}`);
  log(`composite 像素数: ${total}`);
  log(`与烘焙帧差异>2 的像素: ${diffCount} (${(diffCount / Math.max(1, total) * 100).toFixed(1)}%)`);
  log(`最大色差: ${maxDiff.toFixed(1)} RGB`);
  log(`channels: ${JSON.stringify(cfg.channels)}`);

  // ---------- 7. 方向诊断：检查是否只是行翻转 ----------
  let flipDiff = 0, flipMax = 0;
  for (let y = 0; y < bakeH; y++) {
    for (let x = 0; x < bakeW; x++) {
      const br = baked[(y * bakeW + x) * 4], bg = baked[(y * bakeW + x) * 4 + 1], bb = baked[(y * bakeW + x) * 4 + 2];
      if (br === 0 && bg === 0 && bb === 0) continue;
      const srcY = bakeH - 1 - y;
      const si = (srcY * bakeW + x) * 4;
      const diff = Math.abs(br - pixels[si]) + Math.abs(bg - pixels[si + 1]) + Math.abs(bb - pixels[si + 2]);
      if (diff > 2) { flipDiff++; flipMax = Math.max(flipMax, diff); }
    }
  }
  log(`\n[方向测试] Y 翻转后差异>2: ${flipDiff} (${(flipDiff / Math.max(1, total) * 100).toFixed(1)}%), 最大: ${flipMax.toFixed(1)}`);
  log(`（若同位置差异≈0 且翻转差异大 → composite 方向与烘焙帧一致，无翻转问题）`);

  // ---------- 8. levelSet 开启场景（water.phys.json 自带） ----------
  const solverLS = new FluidSolver(renderer, {
    ...defaultFluidConfig,
    ...parseImportedFluidConfig({
      coreSwitches: {},
      advectionAndComposite: {},
      globalForce: {},
      levelSet: { enabled: true, reinitIterations: 8, surfaceTension: 0.1, smoothingRadius: 1.5 },
      continuousSources: [],
    }, res),
    resolution: { ...res },
  }, res);
  solverLS.loadResidual(residImg);
  solverLS.setBaseHsl(baseHsl, bakeW, bakeH);
  solverLS.composite();
  const targetLS = (solverLS as any).compositeTarget as THREE.WebGLRenderTarget;
  const pxLS = new Uint8Array(bakeW * bakeH * 4);
  renderer.readRenderTargetPixels(targetLS, 0, 0, bakeW, bakeH, pxLS);
  let lsDiff = 0, lsMax = 0;
  for (let i = 0; i < bakeW * bakeH; i++) {
    const br = baked[i * 4], bg = baked[i * 4 + 1], bb = baked[i * 4 + 2];
    if (br === 0 && bg === 0 && bb === 0) continue;
    const diff = Math.abs(br - pxLS[i * 4]) + Math.abs(bg - pxLS[i * 4 + 1]) + Math.abs(bb - pxLS[i * 4 + 2]);
    if (diff > 2) { lsDiff++; lsMax = Math.max(lsMax, diff); }
  }
  log(`\n[levelSet 开启] 差异>2: ${lsDiff} (${(lsDiff / Math.max(1, total) * 100).toFixed(1)}%), 最大: ${lsMax.toFixed(1)}`);

  // ---------- 9. 模拟导入 .phys.json + 播放一帧（fire: gravity 120） ----------
  const cfgFire = parseImportedFluidConfig({
    enableAdvection: true, enablePressure: true, pressureIterations: 12,
    pressureOmega: 1.7, pressureBoundaryMode: "dirichlet", enableWarmStart: true,
    advectionMode: "vector", combineMode: "add",
    channels: { r: true, g: true, b: true, a: true, h: true, s: true, l: true },
    scalarConfig: { hMultiplier: 0.4, sMultiplier: 0.6, lMultiplier: 0.9, aMultiplier: 0.3, baselineDensity: 0, decayRate: 0.1 },
    gravity: { x: 0, y: 120 }, velocityScale: 1.0, maxVelocity: 500,
    colorBoundaryMode: "clamp",
    continuousSources: [{ enabled: true, position: { x: 0.5, y: 0.85 }, radius: 0.12, velocity: { x: 0, y: -180 }, color: [0.9, 0.35, 0.1], density: 0.9, rate: 0.9 }],
  }, res);
  cfgFire.resolution = { ...res };
  const solverFire = new FluidSolver(renderer, { ...defaultFluidConfig, ...cfgFire, resolution: { ...res } }, res);
  solverFire.loadResidual(residImg);
  solverFire.setBaseHsl(baseHsl, bakeW, bakeH);
  // 导入后立即播放（修复前的行为：isPlaying=true 自动播放）
  for (let f = 0; f < 10; f++) solverFire.step(1 / 60);
  solverFire.composite();
  const targetF = (solverFire as any).compositeTarget as THREE.WebGLRenderTarget;
  const pxF = new Uint8Array(bakeW * bakeH * 4);
  renderer.readRenderTargetPixels(targetF, 0, 0, bakeW, bakeH, pxF);
  let fDiff = 0, fMax = 0;
  for (let i = 0; i < bakeW * bakeH; i++) {
    const br = baked[i * 4], bg = baked[i * 4 + 1], bb = baked[i * 4 + 2];
    if (br === 0 && bg === 0 && bb === 0) continue;
    const diff = Math.abs(br - pxF[i * 4]) + Math.abs(bg - pxF[i * 4 + 1]) + Math.abs(bb - pxF[i * 4 + 2]);
    if (diff > 2) { fDiff++; fMax = Math.max(fMax, diff); }
  }
  log(`\n[导入 fire + 自动播放 10 帧] 差异>2: ${fDiff} (${(fDiff / Math.max(1, total) * 100).toFixed(1)}%), 最大: ${fMax.toFixed(1)}`);
  log(`（若此值大 → 用户看到的突变 = 导入后自动播放所致，与"是否手动点播放"无关）`);
  const samples = [[10, 10], [67, 100], [67, 400], [100, 254], [50, 254]];
  log(`\n[样本像素] (composite vs baked 同位置 vs baked 行翻转 vs baked 对角翻转)`);
  for (const [x, y] of samples) {
    const ci = (y * bakeW + x) * 4;
    const si = ((bakeH - 1 - y) * bakeW + x) * 4;
    const diagI = ((bakeH - 1 - y) * bakeW + (bakeW - 1 - x)) * 4;
    const show = (a: Uint8ClampedArray | Uint8Array, i: number) => `${a[i]},${a[i + 1]},${a[i + 2]}`;
    log(`(${x},${y}) comp=${show(pixels, ci)} baked=${show(baked, ci)} flipY=${show(pixels, si)} diag=${show(baked, diagI)}`);
  }
}

function unpackRGB565(packed: number) { return { s: (packed >> 11) & 0x1F, h: (packed >> 5) & 0x3F, l: packed & 0x1F }; }
function getBlockIdx(x: number, y: number, w: number, h: number): number {
  const col = Math.min(Math.floor((x / w) * 8), 7);
  const row = Math.min(Math.floor((y / h) * 8), 7);
  return row * 8 + col;
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const dd = max - min;
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
    if (max === r) h = (g - b) / dd + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / dd + 2;
    else h = (r - g) / dd + 4;
    h /= 6;
  }
  return { h, s, l };
}

main().catch(e => { log('诊断失败: ' + (e as Error).message + '\n' + (e as Error).stack); });
