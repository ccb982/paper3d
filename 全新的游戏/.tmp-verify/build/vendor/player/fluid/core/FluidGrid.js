"use strict";
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
exports.FluidGrid = void 0;
const THREE = __importStar(require("three"));
const THREE_TYPE_MAP = {
    'uint8': THREE.UnsignedByteType,
    'half-float': THREE.HalfFloatType,
    'float': THREE.FloatType,
};
/**
 * FluidGrid —— 双缓冲纹理管理器。
 *
 * 职责：
 * - 持有两个 WebGLRenderTarget（Ping-Pong A/B）
 * - 提供 read（当前可读纹理）和 write（当前可写目标）的引用
 * - swap() 交换读/写引用
 * - 不关心数据语义（HSLA 还是速度场），只负责搬运纹理
 *
 * 使用方式：
 *   const grid = new FluidGrid({ w: 256, h: 256 }, 4, 'uint8');
 *   solver.advect(grid, velocityTex, dt, mask);
 *   // 求解器内部写入 grid.write，调用 grid.swap() 完成翻转
 */
class FluidGrid {
    constructor(resolution, channels = 4, dataType = 'uint8') {
        this.current = 'A';
        this.resolution = { w: resolution.w, h: resolution.h };
        this.channelCount = channels;
        this.dataType = dataType;
        const formatMap = {
            1: THREE.RedFormat,
            2: THREE.RGFormat,
            3: THREE.RGBAFormat, // 3 通道也分配 RGBA，GPU 按四通道对齐
            4: THREE.RGBAFormat,
        };
        const threeType = THREE_TYPE_MAP[dataType];
        const format = formatMap[channels];
        this.texA = new THREE.WebGLRenderTarget(resolution.w, resolution.h, {
            format,
            type: threeType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            depthBuffer: false,
            stencilBuffer: false,
        });
        this.texB = new THREE.WebGLRenderTarget(resolution.w, resolution.h, {
            format,
            type: threeType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            depthBuffer: false,
            stencilBuffer: false,
        });
        // ★ 注意：WebGLRenderTarget 的 colorSpace 默认为 NoColorSpace，
        //   ShaderMaterial 不会基于 texture.colorSpace 注入颜色空间转换，
        //   因此此处无需设置 colorSpace，保持默认行为即可。
    }
    /** 当前可读纹理 */
    get read() {
        const tex = this.current === 'A' ? this.texA.texture : this.texB.texture;
        return tex;
    }
    /** 当前可读 RenderTarget（用于 readRenderTargetPixels 回读） */
    get readTarget() {
        const target = this.current === 'A' ? this.texA : this.texB;
        return target;
    }
    /** 当前可写入目标 */
    get write() {
        const target = this.current === 'A' ? this.texB : this.texA;
        return target;
    }
    /**
     * 交换读/写引用（Ping-Pong）。
     * 调用后 read 返回刚写入的数据，write 指向即将被覆盖的旧数据。
     */
    swap() {
        this.current = this.current === 'A' ? 'B' : 'A';
    }
    setRenderTargetSize(w, h) {
        this.resolution.w = w;
        this.resolution.h = h;
        this.texA.setSize(w, h);
        this.texB.setSize(w, h);
    }
    dispose() {
        this.texA.dispose();
        this.texB.dispose();
    }
}
exports.FluidGrid = FluidGrid;
