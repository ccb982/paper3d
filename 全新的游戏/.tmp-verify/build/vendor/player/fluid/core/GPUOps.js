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
exports.GPUOps = void 0;
const THREE = __importStar(require("three"));
/** ★ 模块级 scratch（热路径零分配）：clear 前保存/恢复全局清屏色 */
const _prevClearColor = new THREE.Color();
/**
 * 统一的全屏 GPU 渲染辅助类。
 *
 * 持有一个全屏四边形 + 正交相机 + 场景，材质按 key 缓存。
 * 所有 GPU Pass（copy、gravity、injection、boundary、pressure 等）
 * 共用这一套基础设施，避免每帧创建/销毁 ShaderMaterial/Scene/Quad 的巨额开销。
 */
class GPUOps {
    constructor() {
        this.materials = new Map();
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quadGeom = new THREE.PlaneGeometry(2, 2);
        this.quad = new THREE.Mesh(this.quadGeom);
        this.scene.add(this.quad);
    }
    /**
     * 获取或创建材质（按 key 缓存）。
     * 如果材质已存在则只更新 uniforms，避免重新编译着色器。
     */
    getMaterial(key, uniforms, fragmentShader) {
        let mat = this.materials.get(key);
        if (mat) {
            for (const [name, u] of Object.entries(uniforms)) {
                if (mat.uniforms[name])
                    mat.uniforms[name].value = u.value;
            }
            return mat;
        }
        mat = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: GPUOps.VS,
            fragmentShader,
            depthTest: false,
            depthWrite: false,
        });
        this.materials.set(key, mat);
        return mat;
    }
    /**
     * 全屏渲染到 RenderTarget。
     */
    render(renderer, target, material) {
        const prevMat = this.quad.material;
        this.quad.material = material;
        const prevTarget = renderer.getRenderTarget();
        // ★ 数据纹理禁止让全局清屏色泄漏：强制黑/透明清屏后立即恢复
        //   （事故记录 #001：浅色清屏色把场初始化成假数据）
        renderer.getClearColor(_prevClearColor);
        const prevAlpha = renderer.getClearAlpha();
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.setClearColor(_prevClearColor, prevAlpha);
        renderer.render(this.scene, this.camera);
        renderer.setRenderTarget(prevTarget);
        this.quad.material = prevMat;
    }
    dispose() {
        for (const mat of this.materials.values())
            mat.dispose();
        this.materials.clear();
        this.quadGeom.dispose();
    }
}
exports.GPUOps = GPUOps;
GPUOps.VS = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
