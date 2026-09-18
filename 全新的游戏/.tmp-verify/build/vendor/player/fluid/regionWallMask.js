"use strict";
// ============================================================
// 色块分界自动加墙 —— 基于 FTX 调色板 ID 的精确区域分割
// ============================================================
//
// 用途：FTX 帧导入后，在"较大基础色块"的交界处生成障碍物墙，
//       让流体只在各色块内部流动 —— 数值扩散无法跨墙搬运颜色，
//       从物理层面消灭跨色块的色彩污染（比任何后处理滤波都干净）。
//
// 精确性来源：FTX 格式自带逐像素调色板 ID（rawRegionIdTex），
// 同 ID = 同一平涂色块，分割零启发式、零颜色距离阈值。
//
// 小色块策略：面积低于阈值的色块视为"可通行区"（语义上并入周围的
// 大色块）—— 描边/高光点等小细节不会产生墙，流体自由穿过。
// 因此墙的判定条件是：两侧属于【不同的两个大色块】。
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRegionWallMask = buildRegionWallMask;
exports.packToBits = packToBits;
/**
 * 按调色板 ID 分割色块并生成边界墙掩码。
 *
 * @param regionIdTex 逐像素调色板 ID（bbox 局部，row 0 = 顶）
 * @param width  bbox 宽
 * @param height bbox 高
 */
function buildRegionWallMask(regionIdTex, width, height, opts = {}) {
    const { minAreaRatio = 0.004, minAreaPx = 64, dilate = 1 } = opts;
    const total = width * height;
    // ── 1. 各色块面积统计 ──
    const area = new Map();
    for (let i = 0; i < total; i++) {
        const id = regionIdTex[i];
        area.set(id, (area.get(id) ?? 0) + 1);
    }
    // ── 2. 大色块判定 ──
    const threshold = Math.max(minAreaPx, minAreaRatio * total);
    const isLarge = (id) => (area.get(id) ?? 0) >= threshold;
    let largeRegions = 0;
    for (const [, a] of area)
        if (a >= threshold)
            largeRegions++;
    // ── 3. 边界标记：两侧是【不同的大色块】才算墙 ──
    //    （小色块一侧不触发 → 小细节天然可通行，等价于并入邻域）
    const mask = new Uint8Array(total);
    let wallPixels = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const id = regionIdTex[i];
            if (!isLarge(id))
                continue; // 自身不是大色块 → 不产生墙
            const L = x > 0 ? regionIdTex[i - 1] : id;
            const R = x < width - 1 ? regionIdTex[i + 1] : id;
            const U = y > 0 ? regionIdTex[i - width] : id;
            const D = y < height - 1 ? regionIdTex[i + width] : id;
            if ((L !== id && isLarge(L)) ||
                (R !== id && isLarge(R)) ||
                (U !== id && isLarge(U)) ||
                (D !== id && isLarge(D))) {
                mask[i] = 255;
                wallPixels++;
            }
        }
    }
    // ── 4. 膨胀（8 邻域）：单像素墙存在对角泄漏缝，至少膨胀 1 次 ──
    for (let k = 0; k < dilate; k++) {
        const src = mask.slice();
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                if (src[i])
                    continue;
                if ((x > 0 && src[i - 1]) || (x < width - 1 && src[i + 1]) ||
                    (y > 0 && src[i - width]) || (y < height - 1 && src[i + width]) ||
                    (x > 0 && y > 0 && src[i - width - 1]) ||
                    (x < width - 1 && y > 0 && src[i - width + 1]) ||
                    (x > 0 && y < height - 1 && src[i + width - 1]) ||
                    (x < width - 1 && y < height - 1 && src[i + width + 1])) {
                    mask[i] = 255;
                    wallPixels++;
                }
            }
        }
    }
    return { mask, width, height, largeRegions, wallPixels };
}
/** 字节掩码 → 位打包（setObstacleBitmap 输入格式：bit=1 为墙） */
function packToBits(mask) {
    const out = new Uint8Array(Math.ceil(mask.length / 8));
    for (let i = 0; i < mask.length; i++) {
        if (mask[i])
            out[i >> 3] |= 1 << (i & 7);
    }
    return out;
}
