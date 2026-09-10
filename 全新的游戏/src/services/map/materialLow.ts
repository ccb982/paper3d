// ============================================================
// materialLow —— 材质低频层 CPU 烘焙（bakeCompute Worker 可用）
// ============================================================
// 目的（性能 Step 1）：地形材质 shader 原来每像素现算「低频颜色/明暗」
// （shadeField 的 patch/mid + 各材质 vnoise/fbm 低频项 + 逐地块 jitter），
// 属于大面积冗余 ALU。把这些项按 chunk 烘进一张低频纹理（matLow，128²）：
//   · 顶面 shader 只再跑「高频层」（线条/裂纹/颗粒/装饰），低频直接采样；
//   · 低频特征尺度 >0.5m，128²（60m → 47cm/texel）足够，mip 自动丢弃远景细节；
//   · 侧壁（WallMaterial）坐标空间不同（vTex），本期保持原全量路径，不受影响。
//
// 本文件是 TerrainMaterial GLSL 对应低频项的「逐式 TS 移植」：
//   噪声（h21/vnoise2/fbm2）、OKLab→线性、各材质低频项、逐地块 jitter。
// GLSL 与 JS 浮点宽度不同（float32 vs double），图案逐位不保证一致，
// 但公式同构、统计同貌（烘焙一次即定稿，不再回 GPU 计算）。
//
// 输出约定（matLow，MAT_LOW_RES²）：
//   RGB = sRGB 编码的线性低频色（three 端按 SRGBColorSpace 解码回线性）
//   A   = 255（预留）
// ============================================================

import { CHUNK_SIZE } from "./ChunkGenerator";
import { applyGroupTintHsl } from "./TileGroups";
import {
  srgbHslToOklch,
  srgbHslJitterAmp,
  type Oklch,
} from "./colorLab";
import { tileMaterialByKey } from "./TileMaterials";
import type { TileDef } from "./Tiles";
import type { BakeQuery } from "./bakeCompute";

/** matLow 纹理分辨率（低频；60m → 47cm/texel） */
export const MAT_LOW_RES = 128;

// ============================================================
// 噪声基座（GLSL 同式移植）
// ============================================================

const fract = (x: number): number => x - Math.floor(x);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9)));
  return t * t * (3 - 2 * t);
};

/** GLSL h21(vec2 p) 同式（float32 vs double 差异仅影响图案微观分布） */
function h21(px: number, py: number): number {
  const x = fract(px * 0.1031);
  const y = fract(py * 0.1031);
  const z = x; // p.xyx → p3.z = fract(p.x*0.1031)
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  const cx = fract((x + d + (y + d)) * (z + d));
  return cx;
}

function vnoise2(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy);
  const b = h21(ix + 1, iy);
  const c = h21(ix, iy + 1);
  const d = h21(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(px: number, py: number): number {
  return (
    vnoise2(px, py) * 0.6 +
    vnoise2(px * 2.3, py * 2.3) * 0.3 +
    vnoise2(px * 5.1, py * 5.1) * 0.1
  );
}

/** shadeField 的大世界折返周期（与 GLSL 同值） */
const SHADE_FIELD = 2048;
const wrapField = (v: number): number => v - Math.floor(v / SHADE_FIELD) * SHADE_FIELD;

/** 全局空间场：patch（大尺度斑块）与 mid（中频渐变）——低频层消费 */
export function shadeFieldPatchMid(wx: number, wz: number): { px: number; py: number } {
  const x = wrapField(wx);
  const z = wrapField(wz);
  return {
    px: (fbm2(x * 0.04, z * 0.04) - 0.5) * 2.0,
    py: (fbm2(x * 0.18, z * 0.18) - 0.5) * 2.0,
  };
}

/** 伪 AO（顶面 shader 原 field.x 路径 → 烘进 lightmap B）：0~1 */
export function pseudoAoFromPatch(wx: number, wz: number): number {
  const { px } = shadeFieldPatchMid(wx, wz);
  return smoothstep(-0.3, 0.3, px);
}

// ============================================================
// OKLab → 线性 / 线性 → sRGB8
// ============================================================

function oklab2linear(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416613 * l - 3.3077115904 * m + 0.2309699287 * s,
    -1.2684380041 * l + 2.6097574007 * m - 0.3413193963 * s,
    -0.0041960865 * l - 0.7034186145 * m + 1.7076147009 * s,
  ];
}

function linearToSrgb8(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

// ============================================================
// 材质低频项（GLSL mat_<fn> 的低频部分；返回 dL,dC,dH,dRef）
//   dRef = 反光层乘数 - 1（与 GLSL 拆分后的 _lo/_hi 约定一致）
// ============================================================

type LowOffset = { dL: number; dC: number; dH: number; dRef: number };

const ZERO: LowOffset = { dL: 0, dC: 0, dH: 0, dRef: 0 };

/** 参数按模板声明顺序取值（与 buildTileRenderConfig 的打包顺序一致） */
function makeParamReader(mat: ReturnType<typeof tileMaterialByKey>, td: TileDef): (i: number) => number {
  const keys = mat ? Object.keys(mat.params) : [];
  const merged: Record<string, number> = mat ? { ...mat.params, ...(td.visual.material?.params ?? {}) } : {};
  return (i: number) => merged[keys[i]] ?? 0;
}

function lowOffsets(fnId: string, P: (i: number) => number, f: { px: number; py: number }, wx: number, wz: number): LowOffset {
  switch (fnId) {
    case "dirt": {
      // patchv = f.x*P3*0.5；dC = f.y*0.004；dRef = patchv*0.40
      const patchv = f.px * P(3) * 0.5;
      return { dL: patchv, dC: f.py * 0.004, dH: 0, dRef: patchv * 0.4 };
    }
    case "brick": {
      // dL = f.y*0.015；dC = f.y*0.002；dRef = f.y*0.08
      return { dL: f.py * 0.015, dC: f.py * 0.002, dH: 0, dRef: f.py * 0.08 };
    }
    case "grass": {
      const patchv = (vnoise2(wx * 0.2, wz * 0.2) - 0.5) * 2 * P(0) * 0.28;
      const tuft = (vnoise2(wx * 0.55 + 13, wz * 0.55 + 13) - 0.5) * 2 * P(1) * 0.12;
      const dry = vnoise2(wx * 0.1 + 71, wz * 0.1 + 71);
      return {
        dL: patchv + tuft,
        dC: f.py * 0.003 - patchv * 0.012,
        dH: patchv * 0.006 + dry * 0.008,
        dRef: patchv * 0.12,
      };
    }
    case "wood": {
      return { dL: 0, dC: f.py * 0.002, dH: 0, dRef: 0 };
    }
    case "rock": {
      const base = (fbm2(wx * 0.35 + 3, wz * 0.35 + 3) - 0.5) * 0.16;
      return { dL: base, dC: 0, dH: 0, dRef: 0 };
    }
    case "moss": {
      // 全量低频：cover/fuzz/drip/stone 全为低频/微小项（fuzz/stone 用 f.z，烘焙即定稿）
      const fz = h21(Math.floor(wx * 30), Math.floor(wz * 30)) - 0.5;
      const covIn = f.px * 0.5 + 0.5 + f.py * 0.1;
      const cover = smoothstep(P(0), P(0) + Math.max(P(1), 0.02) + 0.15, covIn);
      const fuzz = fz * 0.03 * cover;
      const drip = (vnoise2(wx * 1.5, wz * 0.2) - 0.5) * P(2) * 0.16;
      const stone = (1 - cover) * fz * P(3) * 0.05;
      return {
        dL: -cover * 0.06 + fuzz + drip + stone,
        dC: cover * 0.025,
        dH: cover * 0.01,
        dRef: cover * 0.12 + fuzz * 0.06 + drip * 0.08,
      };
    }
    case "ice": {
      const depthv = (vnoise2(wx * 0.3, wz * 0.3) - 0.5) * P(3) * 0.2;
      const frost = smoothstep(0.65, 0.88, vnoise2(wx * 0.35 + 37, wz * 0.35 + 37)) * P(2) * 0.06;
      const shimmer = smoothstep(0.72, 0.95, vnoise2(wx * 0.9, wz * 0.9)) * P(1) * 0.05;
      return {
        dL: depthv + frost + shimmer,
        dC: -frost * 0.12,
        dH: 0,
        dRef: frost * 0.22 + depthv * 0.1 + shimmer * 0.14,
      };
    }
    case "ash": {
      const drift = (vnoise2(wx * 0.22, wz * 0.9) - 0.5) * P(3) * 0.35;
      const clump = (vnoise2(wx * 0.5 + 17, wz * 0.5 + 17) - 0.5) * P(1) * 0.3;
      return { dL: drift + clump, dC: 0, dH: 0, dRef: clump * 0.12 + drift * 0.06 };
    }
    case "mud": {
      const pn = vnoise2(wx * 0.45 + 11, wz * 0.45 + 11);
      const puddle = smoothstep(1 - P(0), 1.05 - P(0) * 0.5, pn + 0.5);
      const wet = (vnoise2(wx * 0.28, wz * 0.28) - 0.5) * P(2) * 0.1;
      return { dL: -puddle * 0.05 + wet, dC: puddle * 0.01, dH: 0, dRef: puddle * 0.25 + wet * 0.1 };
    }
    case "pit": {
      const cx = fract(wx * 0.25) - 0.5;
      const cz = fract(wz * 0.25) - 0.5;
      const r = Math.hypot(cx, cz) * 2;
      const depthv = (1 - smoothstep(0, 1.4, r)) * P(2) * -0.12;
      return { dL: depthv, dC: 0, dH: 0, dRef: depthv * 0.5 };
    }
    case "sand": {
      const macro = (vnoise2(wx * 0.18, wz * 0.18) - 0.5) * 2 * P(2) * 0.5;
      const meso = (vnoise2(wx * 0.75, wz * 0.75) - 0.5) * 2 * P(1) * 0.46;
      const shade = macro * 0.6 + meso * 0.4;
      const hueDrift = (vnoise2(wx * 0.22 + 31, wz * 0.22 + 31) - 0.5) * 2 * P(3) * 0.015;
      return {
        dL: macro + meso,
        dC: -shade * 0.028 * P(3),
        dH: shade * 0.016 * P(3) + hueDrift,
        dRef: (macro + meso) * 0.18,
      };
    }
    case "cement": {
      const macro = (vnoise2(wx * 0.18, wz * 0.18) - 0.5) * 2 * P(2) * 0.25;
      const meso = (vnoise2(wx * 0.75, wz * 0.75) - 0.5) * 2 * P(1) * 0.35;
      const shade = macro * 0.6 + meso * 0.4;
      const hueDrift = (vnoise2(wx * 0.22 + 31, wz * 0.22 + 31) - 0.5) * 2 * P(3) * 0.008;
      return {
        dL: macro + meso,
        dC: -shade * 0.02 * P(3),
        dH: shade * 0.01 * P(3) + hueDrift,
        dRef: 0,
      };
    }
    // water（动画，全量 shader）/ pebble（全高频）→ 低频为空，只烘基色
    default:
      return ZERO;
  }
}

// ============================================================
// 主入口：烘焙一张 chunk 的材质低频图
// ============================================================

interface TileLowInfo {
  fnId: string;
  baseLch: Oklch;
  jitter: Oklch;
  P: (i: number) => number;
}

export function computeMaterialLowRGBA(q: BakeQuery, cx: number, cz: number): Uint8ClampedArray {
  const S = MAT_LOW_RES;
  const out = new Uint8ClampedArray(S * S * 4);

  const step = CHUNK_SIZE / S;
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  const infoCache = new Map<number, TileLowInfo>();
  const tileInfo = (td: TileDef): TileLowInfo => {
    const cached = infoCache.get(td.id);
    if (cached) return cached;
    const mat = td.visual.material ? tileMaterialByKey(td.visual.material.fnId) : undefined;
    const tintHsl = td.visual.material
      ? applyGroupTintHsl(td.visual.baseHsl, q.palette)
      : td.visual.baseHsl;
    const j = td.visual.jitter ?? { h: 0, s: 0, l: 0 };
    const info: TileLowInfo = mat
      ? {
          fnId: td.visual.material!.fnId,
          baseLch: srgbHslToOklch(tintHsl.h, tintHsl.s, tintHsl.l),
          jitter: srgbHslJitterAmp(tintHsl.h, tintHsl.s, tintHsl.l, j.h, j.s, j.l),
          P: makeParamReader(mat, td),
        }
      : { fnId: "", baseLch: { L: 1, C: 0, H: 0 }, jitter: { L: 0, C: 0, H: 0 }, P: () => 0 };
    infoCache.set(td.id, info);
    return info;
  };

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const wx = originX + (px + 0.5) * step;
      const wz = originZ + (py + 0.5) * step;
      const i = (py * S + px) * 4;
      const td = q.tileDefAt(wx, wz);

      if (!td.visual.material) {
        // 无材质地块：颜色由 albedo 承载 → matLow 置白（shader 端线性 1.0）
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
        out[i + 3] = 255;
        continue;
      }

      const info = tileInfo(td);
      const f = shadeFieldPatchMid(wx, wz);
      const lo = lowOffsets(info.fnId, info.P, f, wx, wz);

      // 逐地块 jitter（GLSL：uMatJitter[id].xyz * ((h21(floor(w/4))-0.5)*2)）
      const jt = (h21(Math.floor(wx / 4), Math.floor(wz / 4)) - 0.5) * 2;
      const L = Math.min(1, Math.max(0, info.baseLch.L + lo.dL + info.jitter.L * jt));
      const C = Math.min(0.4, Math.max(0, info.baseLch.C + lo.dC + info.jitter.C * jt));
      const H = fract(info.baseLch.H + lo.dH + info.jitter.H * jt);

      const [r, g, b] = oklab2linear(L, C * Math.cos(H * Math.PI * 2), C * Math.sin(H * Math.PI * 2));
      const ref = 1 + lo.dRef;
      out[i] = linearToSrgb8(r * ref);
      out[i + 1] = linearToSrgb8(g * ref);
      out[i + 2] = linearToSrgb8(b * ref);
      out[i + 3] = 255;
    }
  }

  return out;
}
