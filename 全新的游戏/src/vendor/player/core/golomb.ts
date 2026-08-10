// ============================================================
// Golomb-Rice 熵编码（ftx3 v4 残差专用）
// ============================================================
//
// 适用数据：拉普拉斯分布（大量小整数集中在 0 附近）——
// 量化残差（0-63 级别）做空间预测后的差值正是这种分布。
//
// 原理：
//   divisor = 2^k
//   u（无符号）= zigzag(v)   # 有符号 → 无符号：负数变奇数，正数变偶数
//   q = u >> k（商）→ 写 q 个 0 + 1 分隔位
//   r = u & (2^k - 1)（余数）→ 写 k 位
//
// 解码是纯位运算，无查表无窗口；k 越小，小数值越短。

/** 有符号 → 无符号（zigzag，v 可为负数） */
export function zigzagEncode(v: number): number {
  return (v << 1) ^ (v >> 31);
}

/** 无符号 → 有符号（zigzag 逆） */
export function zigzagDecode(u: number): number {
  return (u >>> 1) ^ -(u & 1);
}

// ---------------- 编码 ----------------

export class BitWriter {
  private _bytes: number[] = [];
  private _bitBuf = 0;
  private _bitCount = 0;

  /** 写 value 的低 bitCount 位（LSB-first 字节序） */
  write(value: number, bitCount: number): void {
    for (let i = 0; i < bitCount; i++) {
      this._bitBuf |= ((value >> i) & 1) << this._bitCount;
      this._bitCount++;
      if (this._bitCount === 8) {
        this._bytes.push(this._bitBuf);
        this._bitBuf = 0;
        this._bitCount = 0;
      }
    }
  }

  /** 写 Golomb-Rice 码（无符号值） */
  writeRice(u: number, k: number): void {
    const q = u >> k;
    const r = u & ((1 << k) - 1);
    // 商：q 个 0 + 1 分隔
    for (let i = 0; i < q; i++) this.write(0, 1);
    this.write(1, 1);
    // 余数：k 位
    this.write(r, k);
  }

  /** 写有符号残差（内部 zigzag） */
  writeSigned(v: number, k: number): void {
    this.writeRice(zigzagEncode(v), k);
  }

  finish(): Uint8Array {
    if (this._bitCount > 0) {
      this._bytes.push(this._bitBuf);
      this._bitBuf = 0;
      this._bitCount = 0;
    }
    return new Uint8Array(this._bytes);
  }

  get bitCount(): number {
    return this._bytes.length * 8 + this._bitCount;
  }
}

// ---------------- 解码 ----------------

export class BitReader {
  private _data: Uint8Array;
  private _bytePos = 0;
  private _bitPos = 0;

  constructor(data: Uint8Array) {
    this._data = data;
  }

  readBit(): number {
    const b = (this._data[this._bytePos] >> this._bitPos) & 1;
    this._bitPos++;
    if (this._bitPos === 8) {
      this._bitPos = 0;
      this._bytePos++;
    }
    return b;
  }

  readBits(count: number): number {
    let v = 0;
    for (let i = 0; i < count; i++) v |= this.readBit() << i;
    return v;
  }

  /** 解 Golomb-Rice 码（无符号值） */
  readRice(k: number): number {
    // 数分隔位之前的 0
    let q = 0;
    while (this.readBit() === 0) q++;
    const r = this.readBits(k);
    return (q << k) | r;
  }

  /** 解有符号残差 */
  readSigned(k: number): number {
    return zigzagDecode(this.readRice(k));
  }

  get bitPos(): number {
    return this._bytePos * 8 + this._bitPos;
  }
}

// ---------------- 实用封装 ----------------

/**
 * 对一维残差数组做 Golomb-Rice 编码。
 * @param values 有符号整数残差（已做空间预测的差值）
 * @param k      Rice 参数（建议 2~4，视分布而定）
 */
export function encodeResiduals(values: ArrayLike<number>, k: number): Uint8Array {
  const w = new BitWriter();
  for (let i = 0; i < values.length; i++) {
    w.writeSigned(values[i], k);
  }
  return w.finish();
}

/**
 * 解码为有符号残差数组。
 * @param bytes   GR 字节流
 * @param count   需要解出的数值个数
 * @param k       Rice 参数（与编码一致）
 */
export function decodeResiduals(bytes: Uint8Array, count: number, k: number): Int32Array {
  const r = new BitReader(bytes);
  const out = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = r.readSigned(k);
  }
  return out;
}

/** 理论位长（不实际写入，用于快速评估 k 的优劣） */
export function estimateRiceBits(values: ArrayLike<number>, k: number): number {
  let bits = 0;
  for (let i = 0; i < values.length; i++) {
    const u = zigzagEncode(values[i]);
    bits += (u >> k) + 1 + k;
  }
  return bits;
}

/** 在 k ∈ [kMin, kMax] 中选最优参数（最小总位数） */
export function pickBestK(values: ArrayLike<number>, kMin = 1, kMax = 8): number {
  let bestK = kMin;
  let bestBits = Infinity;
  for (let k = kMin; k <= kMax; k++) {
    const bits = estimateRiceBits(values, k);
    if (bits < bestBits) {
      bestBits = bits;
      bestK = k;
    }
  }
  return bestK;
}
