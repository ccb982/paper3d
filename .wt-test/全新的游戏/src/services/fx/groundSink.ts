// ============================================================
// groundSink —— 自动接地补偿（2026-09-19）
// ============================================================
// 贴片纹理底部常有透明余量（脚不在纹理底边）→ 不补偿就会"浮空"。
// 从帧底向上扫描首个非透明行，把透明余量折算成世界单位的下沉量。
// 实体（FTXQuad.setGroundSink）与代理（SwarmBatch sink）共用同一口径。
// ============================================================

/** 帧像素（FTX base：alpha 为 0~1 Float32；RGBA8：0~255） */
interface FramePixels {
  data?: Float32Array | Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** 资产级缓存：帧数据对象 → 透明余量比例（每个兵种只扫描一次） */
const fracCache = new WeakMap<object, number>();

/**
 * 帧底透明余量比例（0~0.45；按帧数据对象缓存 → **每个兵种只算一次**）。
 */
export function autoGroundSinkFrac(img: FramePixels): number {
  const { data, width, height } = img;
  if (!data || width <= 0 || height <= 0) return 0;
  const key = data as unknown as object;
  const hit = fracCache.get(key);
  if (hit !== undefined) return hit;
  const stride = 4;
  const opaque = (v: number): boolean => (v > 1.5 ? v > 8 : v > 0.03);
  let frac = 0;
  outer:
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width * stride;
    for (let x = 0; x < width; x++) {
      if (opaque(data[row + x * stride + 3])) {
        frac = Math.min(0.45, (height - 1 - y) / height);
        break outer;
      }
    }
  }
  fracCache.set(key, frac);
  return frac;
}

/**
 * 从帧底透明余量计算接地下沉量（世界单位；frac 走资产级缓存）。
 * @param img 帧像素（带 alpha 通道）
 * @param worldHeight 该贴片在世界中的高度（scale × 高宽比）
 * @returns 下沉量（0 = 无需补偿；上限 45% 高度，防异常资产）
 */
export function autoGroundSinkFromFrame(img: FramePixels, worldHeight: number): number {
  return autoGroundSinkFrac(img) * worldHeight;
}
