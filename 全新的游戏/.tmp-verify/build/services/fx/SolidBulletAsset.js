"use strict";
// ============================================================
// SolidBulletAsset —— 程序生成的子弹贴片资产（FrameAssetSource）
// ============================================================
// 用途：子弹系统落地前的测试资产（发光圆点）+ 敌方远程弹道（程序化箭矢）。
// 实现最小接口：1 帧 + mock 播放控制器（子弹无动画，帧恒 0）。
// 正式资产就绪后替换为 .ftx3/.scene.zip，管线不变。
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIREBALL_BASE_WIDTH = exports.ARROW_BASE_WIDTH = void 0;
exports.createSolidBulletAsset = createSolidBulletAsset;
exports.createArrowAsset = createArrowAsset;
exports.createFireballAsset = createFireballAsset;
const THREE = __importStar(require("three"));
/** ★ 子弹无动画：mock 控制器（帧恒 0）—— 两种程序化资产共用 */
function mockBulletController() {
    return {
        callbacks: {},
        frameIndex: 0,
        state: 'playing',
        reset: () => undefined,
        goto: () => undefined,
        gotoTime: () => undefined,
        stepForward: () => undefined,
        stepBackward: () => undefined,
        hold: () => undefined,
        release: () => undefined,
        play: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        stop: () => undefined,
        advance: () => undefined,
        dispose: () => undefined,
    };
}
/** ★ 单帧程序化资产封装（width/height 由调用方决定；residual 恒 128 = 无残差） */
function makeSingleFrameAsset(baseData, resData, width, height) {
    const base = new THREE.DataTexture(baseData, width, height, THREE.RGBAFormat, THREE.FloatType);
    const residual = new THREE.DataTexture(resData, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    base.needsUpdate = true;
    residual.needsUpdate = true;
    return {
        frameCount: 1,
        getFramePair: (i) => (i === 0 ? { base, residual } : null),
        createController: (_config, _callbacks) => mockBulletController(),
        resolveFrame: () => 0,
        hasFrame: () => false,
        frameNames: () => [],
    };
}
/** 生成发光圆点子弹资产（size=纹理边长像素；h/s/l=HSL 颜色） */
function createSolidBulletAsset(size = 64, h = 0.0, s = 0.9, l = 0.6) {
    const n = size * size;
    // base：HSL float（r=H, g=S, b=L, a=Alpha）；residual：8bit（128=无残差）
    const baseData = new Float32Array(n * 4);
    const resData = new Uint8Array(n * 4);
    const r = size * 0.45;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - size / 2 + 0.5;
            const dy = y - size / 2 + 0.5;
            const i = (y * size + x) * 4;
            const inCircle = dx * dx + dy * dy <= r * r;
            baseData[i] = h;
            baseData[i + 1] = inCircle ? s : 0;
            baseData[i + 2] = inCircle ? l : 0;
            baseData[i + 3] = inCircle ? 1 : 0;
            resData[i] = 128;
            resData[i + 1] = 128;
            resData[i + 2] = 128;
            resData[i + 3] = 255;
        }
    }
    return makeSingleFrameAsset(baseData, resData, size, size);
}
// ------------------------------------------------------------
// ★ 程序化箭矢（敌方远程弹道：弩手）
// ------------------------------------------------------------
// 纵向 = 弹道方向：**row 0 = 尖端**（与 BulletEntity「row0=顶部=弹头」约定一致），
// 末行 = 尾羽。宽高比 1:4 ⇒ 世界尺寸 = baseWidth 宽 × baseWidth×4 长（见
// BulletEntity.computeWorldSize）。
// 三段式：箭头（钢灰三角）→ 箭杆（木棕细条）→ 尾羽（红，双侧叶片 + 中间细杆）。
// 纯程序化，无资产文件 —— 与项目"无资产手搓特效"口径一致。
/** HSL 三段配色（与 base 通道语义一致：h∈[0,1), s∈[0,1], l∈[0,1]） */
const ARROW_STEEL = [0.60, 0.08, 0.78]; // 箭头：冷钢灰
const ARROW_WOOD = [0.07, 0.55, 0.34]; // 箭杆：木棕
const ARROW_FLETCH = [0.98, 0.72, 0.48]; // 尾羽：暗红
/** 生成程序化箭矢资产（size=纹理宽像素，length=纹理高像素） */
function createArrowAsset(size = 24, length = 96) {
    const n = size * length;
    const baseData = new Float32Array(n * 4);
    const resData = new Uint8Array(n * 4);
    const HEAD_END = 0.20; // 箭头段占比（row 0 → HEAD_END）
    const FLETCH_START = 0.82; // 尾羽起始占比
    const SHAFT_HW = 0.075; // 箭杆半宽（归一化到纹理宽）
    const HEAD_HW = 0.45; // 箭头底部半宽
    const FLETCH_HW = 0.40; // 尾羽末端半宽
    const FLETCH_GAP = 0.14; // 尾羽与中线之间的缝（做出"两片羽"；> SHAFT_HW 才有可见缝）
    const cx = (size - 1) / 2;
    for (let y = 0; y < length; y++) {
        const ny = y / length;
        for (let x = 0; x < size; x++) {
            const ax = Math.abs((x - cx) / size);
            let col = null;
            if (ny < HEAD_END) {
                // 箭头：尖端在 row 0，线性张开到 HEAD_HW
                if (ax <= HEAD_HW * (ny / HEAD_END))
                    col = ARROW_STEEL;
            }
            else if (ny < FLETCH_START) {
                // 箭杆
                if (ax <= SHAFT_HW)
                    col = ARROW_WOOD;
            }
            else {
                // 尾羽：中线细杆 + 两侧叶片
                const k = (ny - FLETCH_START) / (1 - FLETCH_START);
                const bladeHw = SHAFT_HW + (FLETCH_HW - SHAFT_HW) * k;
                if (ax <= SHAFT_HW)
                    col = ARROW_WOOD;
                else if (ax >= FLETCH_GAP && ax <= bladeHw)
                    col = ARROW_FLETCH;
            }
            const i = (y * size + x) * 4;
            baseData[i] = col ? col[0] : 0;
            baseData[i + 1] = col ? col[1] : 0;
            baseData[i + 2] = col ? col[2] : 0;
            baseData[i + 3] = col ? 1 : 0;
            resData[i] = 128;
            resData[i + 1] = 128;
            resData[i + 2] = 128;
            resData[i + 3] = 255;
        }
    }
    return makeSingleFrameAsset(baseData, resData, size, length);
}
/** ★ 箭矢世界宽度（米）。长度 = 本值 × 4（纹理 1:4） */
exports.ARROW_BASE_WIDTH = 0.28;
// ------------------------------------------------------------
// ★ 程序化法球（敌方术士弹道：扩音术士 / 战争术士）
// ------------------------------------------------------------
// 正方形纹理 → 世界尺寸 = baseWidth × baseWidth（球）。
// 径向四段：白热核 → 橙焰 → 暗红边 → 熄。半径再叠 **角度扰动**（3/5 次谐波）
// ⇒ 边缘不是正圆而是"火舌"轮廓（纯程序化、确定性，不用随机数）。
// 采样点取像素中心（+0.5）避免半像素偏移导致的一侧缺口。
/** 法球 HSL 四段（由内到外） */
const BOLT_CORE = [0.13, 1.00, 0.86]; // 白热黄
const BOLT_MID = [0.07, 1.00, 0.60]; // 橙焰
const BOLT_OUT = [0.02, 0.95, 0.42]; // 暗红橙
const BOLT_RIM = [0.00, 0.90, 0.26]; // 焦红
/** HSL 线性插值（h 走最短弧） */
function mixHsl(a, b, t) {
    let dh = b[0] - a[0];
    if (dh > 0.5)
        dh -= 1;
    else if (dh < -0.5)
        dh += 1;
    const h = a[0] + dh * t;
    return [h < 0 ? h + 1 : h, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
/** 生成程序化法球资产（size=纹理边长像素） */
function createFireballAsset(size = 64) {
    const n = size * size;
    const baseData = new Float32Array(n * 4);
    const resData = new Uint8Array(n * 4);
    const c = size / 2;
    // ★ 火舌轮廓：半径按角度起伏（确定性谐波，非随机）
    const LOBE_A3 = 0.13, LOBE_A5 = 0.08;
    /** 谐波最大幅值（两峰同相时的上界）——必须归一化，否则波峰侧会**越出纹理被裁掉** */
    const LOBE_MAX = 1 + LOBE_A3 + LOBE_A5;
    /** 轮廓最大半径（占纹理半宽的比例）；留 5% 余量防像素中心越界 */
    const OUTER = 0.95;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x - c + 0.5) / c;
            const dy = (y - c + 0.5) / c;
            const r = Math.hypot(dx, dy);
            const th = Math.atan2(dy, dx);
            const lobe = 1 + LOBE_A3 * Math.sin(th * 3) + LOBE_A5 * Math.sin(th * 5 + 1.7);
            // rr = 1 的等值线 = 半径 OUTER × (lobe / LOBE_MAX)：波峰 0.95、波谷 ≈0.62
            const rr = (r * LOBE_MAX) / (OUTER * lobe);
            // ★ alpha 不能做软边：合成材质与子弹片元着色器都 `if (a < 0.5) discard`
            //   ⇒ 只能"形状 + 颜色"做衰减（外圈压到焦红 = 视觉上的收口）
            let col = null;
            if (rr <= 0.22) {
                col = BOLT_CORE;
            }
            else if (rr <= 0.55) {
                col = mixHsl(BOLT_CORE, BOLT_MID, (rr - 0.22) / 0.33);
            }
            else if (rr <= 0.82) {
                col = mixHsl(BOLT_MID, BOLT_OUT, (rr - 0.55) / 0.27);
            }
            else if (rr <= 1.0) {
                col = mixHsl(BOLT_OUT, BOLT_RIM, (rr - 0.82) / 0.18);
            }
            const i = (y * size + x) * 4;
            baseData[i] = col ? col[0] : 0;
            baseData[i + 1] = col ? col[1] : 0;
            baseData[i + 2] = col ? col[2] : 0;
            baseData[i + 3] = col ? 1 : 0;
            resData[i] = 128;
            resData[i + 1] = 128;
            resData[i + 2] = 128;
            resData[i + 3] = 255;
        }
    }
    return makeSingleFrameAsset(baseData, resData, size, size);
}
/** ★ 法球世界直径（米）。正方形纹理 ⇒ 宽高同值 */
exports.FIREBALL_BASE_WIDTH = 0.8;
