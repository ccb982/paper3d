// ============================================================
// WaterFFT —— 预计算 FFT 海况场（纯 CPU，无 three 依赖）
// ============================================================
// 思路：启动时一次性烘焙若干"层"的海面场（每层 = 一种尺度），
// 每层用 Phillips 风谱 + 2D IFFT 得到：
//   h  高度场（实部）           → R
//   d  水平位移场（choppy，x/z） → G/B
//   n  世界空间法线（坡度归一化） → RGB
// 每层烘焙两个相位变体（A/B），运行时沿风向滚动采样 + 三角波交叠，
// 即得到连续 FFT 波动动画；之后每帧零 FFT 开销（预计算）。
// 确定性：全部由 seed 派生（multiplicative RNG），同一 seed 字节一致。
// ============================================================

/** mulberry32：确定性轻量 RNG */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 单位高斯（Box–Muller） */
function makeGauss(rng: () => number): () => number {
  const base = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
  return base;
}

/** 复数对（re, im）离散 FFT。sign=+1 正变换，sign=-1 逆变换（不加缩放）。N 须为 2 的幂。 */
function complexFFT(re: Float32Array, im: Float32Array, N: number, sign: number): void {
  for (let i = 0, j = 0; i < N - 1; i++) {
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
    let m = N >> 1;
    while (m >= 1 && j >= m) { j -= m; m >>= 1; }
    j += m;
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = sign * (2 * Math.PI / len);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k + half], ai = im[i + k + half];
        const tr = cr * ar - ci * ai;
        const ti = cr * ai + ci * ar;
        re[i + k + half] = re[i + k] - tr;
        im[i + k + half] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** 每层烘焙结果（h 高度场，d 水平位移，n 世界法线；长度 N*N） */
export interface OceanTile {
  h: Float32Array;
  d: Float32Array; // N*N*2
  n: Float32Array; // N*N*3
}

export interface OceanLayerCfg {
  tileSize: number; // 该层世界尺寸（m）——采样 uv = worldPos/tileSize
  N: number;        // 网格分辨率（2 的幂）
  amp: number;      // 高度幅度（着色器乘）
  chop: number;     // choppy 位移幅度（着色器乘）
}

export interface OceanBakeParams {
  seed: number;
  windX: number;
  windZ: number;
  windSpeed: number; // Phillips 尺度 L=w²/g
  layers: OceanLayerCfg[];
  variants: number;  // 相位变体数（默认 2：A/B）
}

export const OCEAN_WIND = { x: 0.35, z: 0.94 }; // 默认风向（世界）
// ★ 幅度/波长标定：游戏水体是"小池/坑/湖"（数米~数十米），不是大海。
//   参考 natural-disasters：位移幅度自洽物理标定（这里的 RMS→米），但波长必须与
//   水体尺度可比——否则 L0(96m)/L1(40m) 在小水池内连一个完整波长都没有，
//   水面读作"平面+抖动"而非"起伏"。故层尺度压缩到水池尺度：
//     L0 涌浪 16m：一个 8m 池正好半个波长 → 缓坡可见的"面起伏"
//     L1 主波  6m：波峰波谷骨架
//     L2 细节 1.5m：法线/焦散/泡沫微结构（几何贡献极小）
//   顶点起伏 = L0+L1（hRms≈0.112m 可见）；tile 平移慢速滚动 → 涌浪感；
//   高频细节主要活在片元，防抖动（几何权重 uAmpScale/uChopScale 可再压）。
export const DEFAULT_OCEAN_LAYERS: OceanLayerCfg[] = [
  { tileSize: 16, N: 64, amp: 0.10, chop: 0.09 },  // L0 涌浪：水池内半个波长
  { tileSize: 6, N: 128, amp: 0.05, chop: 0.12 },  // L1 主波
  { tileSize: 1.5, N: 128, amp: 0.015, chop: 0.10 }, // L2 细节（片元为主）
];

export function defaultOceanParams(seed: number): OceanBakeParams {
  return {
    seed,
    windX: OCEAN_WIND.x,
    windZ: OCEAN_WIND.z,
    windSpeed: 9,
    layers: DEFAULT_OCEAN_LAYERS,
    variants: 2,
  };
}

/**
 * 烘焙单层单元场。
 * 返回 { h, d, n }，行情按 (z,y) 而非 (y,x)：d 数组为 [N*N 的 dx, N*N 的 dz] 两个段，
 * n 数组为 [N*N*3]。
 */
function bakeLayer(
  N: number,
  tileSize: number,
  windX: number,
  windZ: number,
  L: number,
  seed: number,
  amp: number,
  chop: number,
): OceanTile {
  const invG = 1 / 9.81;
  const wLen = Math.hypot(windX, windZ) || 1;
  const wx = windX / wLen, wz = windZ / wLen;

  // 频谱阵（re/im 分开；索引 fy*N+fx，fx/fy∈[0,N)）
  const n2 = N * N;
  const SpR = new Float32Array(n2);
  const SpI = new Float32Array(n2);

  const gauss = makeGauss(mulberry32(seed & 0xffffffff));

  const k0 = (2 * Math.PI) / tileSize;
  const filled = new Uint8Array(n2);

  for (let fx = 0; fx < N; fx++) {
    // 居中波数：自然序 → 中心序
    const kx = (fx < N / 2 ? fx : fx - N) * k0;
    for (let fy = 0; fy < N; fy++) {
      const idx = fy * N + fx;
      if (filled[idx]) continue;
      const ky = (fy < N / 2 ? fy : fy - N) * k0;
      const k = Math.hypot(kx, ky);
      let A = 0;
      if (k > 1e-6) {
        // Phillips 风谱（方向性 ppm 钳制）：幅值仅谱形，绝对量级稍后 RMS 标定
        const kL = k * L;
        const dir = wx * (kx / k) + wz * (ky / k);
        const d2 = Math.max(dir, 0);
        A = Math.sqrt(Math.exp(-1 / (kL * kL)) / (k * k * k * k) * d2 * d2);
      }
      // 随机相位由真实/虚部高斯携带（复数白谱）
      SpR[idx] = A * gauss();
      SpI[idx] = A * gauss();
      filled[idx] = 1;
      // 共轭对称：保证 IFFT 结果为实场
      const mx = (N - fx) % N, my = (N - fy) % N;
      const mid = my * N + mx;
      if (mid !== idx) { // 自镜像（凹角/奈奎斯特轴）不能再复制
        SpR[mid] = SpR[idx];
        SpI[mid] = -SpI[idx];
        filled[mid] = 1;
      }
    }
  }

  // 2D IFFT（每层 h、dx、dz 三次；共用频谱乘法）
  const scale = 1 / (N * N);
  const ifftInt = (srcR: Float32Array, srcI: Float32Array): Float32Array => {
    const r = new Float32Array(srcR);
    const c = new Float32Array(srcI);
    for (let fy = 0; fy < N; fy++) {
      complexFFT(r.subarray(fy * N, fy * N + N), c.subarray(fy * N, fy * N + N), N, -1);
    }
    const cr = new Float32Array(N * N), ci = new Float32Array(N * N);
    for (let fy = 0; fy < N; fy++) {
      for (let fx = 0; fx < N; fx++) { cr[fy * N + fx] = r[fx * N + fy]; ci[fy * N + fx] = c[fx * N + fy]; }
    }
    for (let fx = 0; fx < N; fx++) {
      const segR = cr.subarray(fx * N, fx * N + N);
      const segI = ci.subarray(fx * N, fx * N + N);
      complexFFT(segR, segI, N, -1);
      for (let fy = 0; fy < N; fy++) cr[fy * N + fx] = segR[fy] * scale;
    }
    return cr;
  };

  const hRaw = ifftInt(SpR, SpI);

  // 水平位移谱：D̂ = −i·(K̂)·ĥ（k̂ = (kx,ky)/|k|）
  const dxR = new Float32Array(n2), dxI = new Float32Array(n2);
  const dzR = new Float32Array(n2), dzI = new Float32Array(n2);
  for (let fx = 0; fx < N; fx++) {
    const kx = (fx < N / 2 ? fx : fx - N) * k0;
    for (let fy = 0; fy < N; fy++) {
      const idx = fy * N + fx;
      const ky = (fy < N / 2 ? fy : fy - N) * k0;
      const k = Math.hypot(kx, ky);
      if (k > 1e-6) {
        const s = SpI[idx], c_ = SpR[idx];
        dxR[idx] = (kx / k) * s;
        dxI[idx] = -(kx / k) * c_;
        dzR[idx] = (ky / k) * s;
        dzI[idx] = -(ky / k) * c_;
      }
    }
  }
  const d1 = ifftInt(dxR, dxI);
  const d2 = ifftInt(dzR, dzI);

  // RMS 标定：h → amp（物理米数），d → chop × texel × 4（choppy 位移量级）
  const rmsH = (() => { let s = 0; for (let i = 0; i < n2; i++) s += hRaw[i] * hRaw[i]; return Math.sqrt(s / n2 + 1e-12); })();
  const h = new Float32Array(n2);
  const hGain = amp / rmsH;
  for (let i = 0; i < n2; i++) h[i] = hRaw[i] * hGain;
  const dArr = new Float32Array(n2 * 2);
  {
    let s = 0;
    for (let i = 0; i < n2; i++) s += d1[i] * d1[i] + d2[i] * d2[i];
    const rmsD = Math.sqrt(s / (n2 * 2) + 1e-12);
    const dGain = (chop * (tileSize / N) * 4) / rmsD;
    for (let i = 0; i < n2; i++) { dArr[i] = d1[i] * dGain; dArr[n2 + i] = d2[i] * dGain; }
  }

  // 法线：h 的有限差分（周期包边）
  const dx = tileSize / N;
  const n = new Float32Array(n2 * 3);
  const slopeK = 1 / dx; // 坡度 → 法线
  for (let y = 0; y < N; y++) {
    const ym = (y - 1 + N) % N, yp = (y + 1) % N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N, xp = (x + 1) % N;
      const sx = (h[y * N + xp] - h[y * N + xm]) * slopeK * 0.5;
      const sz = (h[yp * N + x] - h[ym * N + x]) * slopeK * 0.5;
      const inv = 1 / Math.sqrt(sx * sx + sz * sz + 1);
      n[(y * N + x) * 3] = -sx * inv;
      n[(y * N + x) * 3 + 1] = inv;
      n[(y * N + x) * 3 + 2] = -sz * inv;
    }
  }

  return { h, d: dArr, n };
}

/** 全量烘焙：layers × variants 共 tiles.length 层场 */
export function bakeOceanField(p: OceanBakeParams): OceanTile[][] {
  const L = p.windSpeed * p.windSpeed / 9.81;
  const tiles: OceanTile[][] = [];
  for (const lc of p.layers) {
    const vs: OceanTile[] = [];
    for (let v = 0; v < p.variants; v++) {
      const seed = (p.seed ^ 0x9e3779b9) + v * 2654435761 + lc.N * 31;
      vs.push(bakeLayer(lc.N, lc.tileSize, p.windX, p.windZ, L, seed >>> 0, lc.amp, lc.chop));
    }
    tiles.push(vs);
  }
  return tiles;
}