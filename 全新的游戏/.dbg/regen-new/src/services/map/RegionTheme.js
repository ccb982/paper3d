"use strict";
// ============================================================
// RegionTheme —— 世界区域主题层（纯函数，确定性，零 three 依赖）
// ============================================================
// 治"地图单调"的核心药：把世界划成大片主题区，调色板/生成参数
// 随区域变化，玩家获得"我在穿越"的空间感。
//
// 实现：低频控制栅格 + 参数双线性插值。
//   - 世界按 REGION_GRID 米划分控制格，每格节点 hash 决定一个主题
//   - 任意点的主题参数 = 周围 4 节点参数的双线性插值
//     → 不同主题交界处自然形成混色过渡带（无硬切边）
//   - 全数值参数 → 插值天然平滑；主题 id 仅用于命名/调试（取最近节点）
//
// 消费方：
//   - bakeCompute.computeAlbedoRGBA  调色板调制（烘进 albedo，零运行时成本）
//   - ChunkWalls                     墙顶点色同步调制（与地面同源）
//   - ChunkGenerator                 迷宫密度/水体/坑洞比例偏置
//
// ⚠️ 语义色保读性：水/坑(isDepression)只吃部分调制——警示红与深蓝
//    是玩法可读性的一部分，不能被主题洗掉。
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEMANTIC_THEME_MIX = void 0;
exports.regionParamsAt = regionParamsAt;
exports.regionNameAt = regionNameAt;
const TerrainNoise_1 = require("./TerrainNoise");
const THEMES = [
    // 沃绿台地：基准微暖绿移；标准密度；水多坑少（生命区）
    { id: 0, name: '沃绿台地', hueShift: 0.33, satMul: 1.05, lightMul: 0.98, densityBias: 0.00, waterMul: 1.4, pitMul: 0.7 },
    // 锈阳荒漠：保持暖棕拉高饱和亮度；开阔少水多坑（险途区）
    { id: 1, name: '锈阳荒漠', hueShift: 0.02, satMul: 1.12, lightMul: 1.05, densityBias: 0.08, waterMul: 0.25, pitMul: 1.4 },
    // 霜蓝结晶：大幅冷移降饱和；空旷多冰湖（异境区）
    { id: 2, name: '霜蓝结晶', hueShift: 0.47, satMul: 0.85, lightMul: 1.02, densityBias: 0.10, waterMul: 1.7, pitMul: 0.6 },
    // 灰烬废土：去饱和压暗；密度偏墙密（压抑区）
    { id: 3, name: '灰烬废土', hueShift: 0.00, satMul: 0.45, lightMul: 0.82, densityBias: -0.06, waterMul: 0.6, pitMul: 1.2 },
];
/** 控制格尺寸（米）。~2.7 chunk 一个主题斑块；越大区域越辽阔 */
const REGION_GRID = 160;
/** 水/坑等语义色吃主题的强度（保玩法可读性） */
exports.SEMANTIC_THEME_MIX = 0.45;
function nodeParams(seed, nx, ny) {
    const t = THEMES[Math.floor((0, TerrainNoise_1.hash2)(nx, ny, seed + 777) * THEMES.length) % THEMES.length];
    return t;
}
/**
 * 任意世界点的区域参数（周围 4 控制节点双线性插值）。
 * 纯函数：同 (seed,x,z) 输出恒定；空间 C0 连续（过渡带平滑）。
 */
function regionParamsAt(seed, x, z) {
    const gx = Math.floor(x / REGION_GRID);
    const gz = Math.floor(z / REGION_GRID);
    let fx = x / REGION_GRID - gx;
    let fz = z / REGION_GRID - gz;
    // smoothstep 让过渡带集中在格边界附近、格内部更"纯"
    fx = fx * fx * (3 - 2 * fx);
    fz = fz * fz * (3 - 2 * fz);
    const a = nodeParams(seed, gx, gz); // (0,0)
    const b = nodeParams(seed, gx + 1, gz); // (1,0)
    const c = nodeParams(seed, gx, gz + 1); // (0,1)
    const d = nodeParams(seed, gx + 1, gz + 1); // (1,1)
    const mix = ((a.hueShift * (1 - fx) + b.hueShift * fx) * (1 - fz) +
        (c.hueShift * (1 - fx) + d.hueShift * fx) * fz);
    const lerpN = (p, q, r, s) => (p * (1 - fx) + q * fx) * (1 - fz) + (r * (1 - fx) + s * fx) * fz;
    return {
        hueShift: mix,
        satMul: lerpN(a.satMul, b.satMul, c.satMul, d.satMul),
        lightMul: lerpN(a.lightMul, b.lightMul, c.lightMul, d.lightMul),
        densityBias: lerpN(a.densityBias, b.densityBias, c.densityBias, d.densityBias),
        waterMul: lerpN(a.waterMul, b.waterMul, c.waterMul, d.waterMul),
        pitMul: lerpN(a.pitMul, b.pitMul, c.pitMul, d.pitMul),
    };
}
/** 主导主题名（最近控制节点；调试/HUD/小地图图例用） */
function regionNameAt(seed, x, z) {
    const gx = Math.round(x / REGION_GRID);
    const gz = Math.round(z / REGION_GRID);
    return nodeParams(seed, gx, gz).name;
}
