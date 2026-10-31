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
exports.Asset = exports.variantDuration = exports.tickVariant = exports.generateVariant = exports.shapeSeed = exports.randomSeed = exports.HitEffectView = exports.FtxAsset = exports.MoonEffect = exports.FluidEffect = exports.FramePlaybackController = exports.renderFrameData = void 0;
const THREE = __importStar(require("three"));
const bundle_1 = require("./core/bundle");
const ftx_1 = require("./core/ftx");
const entity_1 = require("./core/entity");
const renderer_1 = require("./gl/renderer");
const controller_1 = require("./core/controller");
Object.defineProperty(exports, "FramePlaybackController", { enumerable: true, get: function () { return controller_1.FramePlaybackController; } });
const frameResolver_1 = require("./core/frameResolver");
const FluidEffect_1 = require("./fluid/FluidEffect");
var renderer_2 = require("./gl/renderer");
Object.defineProperty(exports, "renderFrameData", { enumerable: true, get: function () { return renderer_2.renderFrameData; } });
var FluidEffect_2 = require("./fluid/FluidEffect");
Object.defineProperty(exports, "FluidEffect", { enumerable: true, get: function () { return FluidEffect_2.FluidEffect; } });
var MoonEffect_1 = require("./MoonEffect");
Object.defineProperty(exports, "MoonEffect", { enumerable: true, get: function () { return MoonEffect_1.MoonEffect; } });
var FtxAsset_1 = require("./FtxAsset");
Object.defineProperty(exports, "FtxAsset", { enumerable: true, get: function () { return FtxAsset_1.FtxAsset; } });
var HitEffectView_1 = require("./hitEffect/HitEffectView");
Object.defineProperty(exports, "HitEffectView", { enumerable: true, get: function () { return HitEffectView_1.HitEffectView; } });
var variantGenerator_1 = require("./hitEffect/variantGenerator");
Object.defineProperty(exports, "randomSeed", { enumerable: true, get: function () { return variantGenerator_1.randomSeed; } });
Object.defineProperty(exports, "shapeSeed", { enumerable: true, get: function () { return variantGenerator_1.shapeSeed; } });
Object.defineProperty(exports, "generateVariant", { enumerable: true, get: function () { return variantGenerator_1.generateVariant; } });
Object.defineProperty(exports, "tickVariant", { enumerable: true, get: function () { return variantGenerator_1.tickVariant; } });
Object.defineProperty(exports, "variantDuration", { enumerable: true, get: function () { return variantGenerator_1.variantDuration; } });
/**
 * Asset —— 无头播放器核心（无 UI，纯资源加载 + 播放控制 + 渲染输出）
 * 游戏通过 getFrameRenderData / getFluidEffect 驱动特效挂接。
 */
class Asset {
    /** ★ 调色板（图标合成/流体构建共享；未解码时为空数组） */
    get palette() {
        return this._ftx?.palette ?? [];
    }
    constructor(raw, options) {
        /** FTX 解码数据（构建流体效果用） */
        this._ftx = null;
        this._entityMeshMap = new Map();
        this._controllers = new Set();
        this._fluidEffects = new Map();
        const resolution = options.resolution ?? 512;
        const multiFrame = (0, ftx_1.decodeMultiFrame)(raw.ftxBinary.buffer);
        const { palette, frames: ftxFrames } = multiFrame;
        this._ftx = multiFrame;
        this.resolver = new frameResolver_1.FrameResolver(raw.frames.map((f) => f.name));
        // ★ 帧参数继承：第一帧的扭曲/变换参数用于所有帧。
        //   用户通常只做第一帧（前后参数一致），后序帧即使导出了
        //   distortEnabled=false（导出默认值）也统一沿用第一帧的开启状态。
        const f0 = raw.frames[0];
        const f0Enabled = f0?.distortEnabled ?? false;
        for (const fd of raw.frames) {
            if (f0Enabled) {
                // 第一帧开启扭曲 → 所有帧统一开启 + 缺失参数沿用第一帧
                if (!fd.distortEnabled)
                    fd.distortEnabled = true;
                if (fd.distortAmplitude === undefined)
                    fd.distortAmplitude = f0?.distortAmplitude ?? 0.06;
                if (fd.distortFrequency === undefined)
                    fd.distortFrequency = f0?.distortFrequency ?? 5.0;
                if (fd.distortSpeed === undefined)
                    fd.distortSpeed = f0?.distortSpeed ?? 1.2;
                if (fd.distortRotation === undefined)
                    fd.distortRotation = f0?.distortRotation ?? 0;
            }
            else {
                if (fd.distortEnabled === undefined)
                    fd.distortEnabled = false;
            }
            if (fd.textureOffset === undefined)
                fd.textureOffset = f0?.textureOffset;
            if (fd.textureScale === undefined)
                fd.textureScale = f0?.textureScale;
            if (fd.textureRotation === undefined)
                fd.textureRotation = f0?.textureRotation;
        }
        const baseTextures = [];
        const residualTextures = [];
        for (const ftxFrame of ftxFrames) {
            const { base, residual } = (0, ftx_1.buildFrameTexture)(ftxFrame, palette);
            baseTextures.push(base);
            residualTextures.push(residual);
        }
        for (let frameIdx = 0; frameIdx < raw.frames.length; frameIdx++) {
            const frameData = raw.frames[frameIdx];
            const hasFtx = frameData.textureIndex >= 0 && frameData.textureIndex < ftxFrames.length;
            const ftxBbox = hasFtx
                ? ftxFrames[frameData.textureIndex].bbox
                : { x: 0, y: 0, w: resolution, h: resolution };
            const frameWidth = hasFtx
                ? ftxFrames[frameData.textureIndex].width
                : resolution;
            const frameHeight = hasFtx
                ? ftxFrames[frameData.textureIndex].height
                : resolution;
            for (const entityData of frameData.regionEntities) {
                const dispResult = (0, entity_1.buildDisplacementTextureData)(entityData.boundary, entityData.maskEffect || null, resolution, resolution, entityData.fixedVertices || [], 30);
                if (!dispResult)
                    continue;
                const dispTex = new THREE.DataTexture(dispResult.data, dispResult.width, dispResult.height, THREE.RGFormat, THREE.FloatType);
                dispTex.needsUpdate = true;
                // ★ Nearest：RG Float32 在 WebGL2 不可线性过滤（采样未定义），
                //   且 VAT 按顶点索引/帧精确取点，最近邻即正确
                dispTex.minFilter = THREE.NearestFilter;
                dispTex.magFilter = THREE.NearestFilter;
                dispTex.wrapS = THREE.ClampToEdgeWrapping;
                dispTex.wrapT = THREE.ClampToEdgeWrapping;
                dispTex.flipY = false;
                const meshData = (0, renderer_1.buildEntityMesh)(entityData, ftxBbox, dispTex, dispResult.width, dispResult.height, frameWidth, frameHeight);
                if (!meshData)
                    continue;
                this._entityMeshMap.set(`${frameIdx}:${entityData.id}`, meshData);
            }
        }
        this.manifest = raw.manifest;
        this.frames = raw.frames;
        this.baseTextures = baseTextures;
        this.residualTextures = residualTextures;
        this.annotations = raw.annotations?.annotations ?? [];
        this.resolution = resolution;
        this.frameCount = raw.manifest.totalFrames;
        this.hitEffects = raw.hitEffects?.shapes ?? [];
    }
    static async load(input, options = {}) {
        const buf = typeof input === 'string' ? await (await fetch(input)).arrayBuffer() : input;
        const raw = await (0, bundle_1.loadBundle)(buf, options.verifyHashes);
        return new Asset(raw, { resolution: options.resolution ?? 512 });
    }
    createController(config, callbacks) {
        const ctrl = new controller_1.FramePlaybackController(this, this.frameCount, config, callbacks);
        this._controllers.add(ctrl);
        return ctrl;
    }
    getFrameRenderData(index) {
        if (index < 0 || index >= this.frames.length)
            return null;
        const fd = this.frames[index];
        const baseTex = fd.textureIndex >= 0 && fd.textureIndex < this.baseTextures.length
            ? this.baseTextures[fd.textureIndex] : this.baseTextures[0];
        const resTex = fd.textureIndex >= 0 && fd.textureIndex < this.residualTextures.length
            ? this.residualTextures[fd.textureIndex] : this.residualTextures[0];
        const entities = [];
        for (const ed of fd.regionEntities) {
            const m = this._entityMeshMap.get(`${index}:${ed.id}`);
            if (m)
                entities.push(m);
        }
        return {
            baseTexture: baseTex,
            residualTexture: resTex,
            entities,
            textureOffset: fd.textureOffset ?? { x: 0, y: 0 },
            textureScale: fd.textureScale ?? { x: 1, y: 1 },
            textureRotation: fd.textureRotation ?? 0,
            distortEnabled: fd.distortEnabled ?? false,
            distortAmplitude: fd.distortAmplitude ?? 0.06,
            distortFrequency: fd.distortFrequency ?? 5.0,
            distortSpeed: fd.distortSpeed ?? 1.2,
            distortRotation: fd.distortRotation ?? 0,
        };
    }
    disposeController(ctrl) { ctrl.dispose(); this._controllers.delete(ctrl); }
    // ============ 帧名解析（FrameResolver） ============
    /** 全部帧清单（名字 + 索引） */
    getFrameNames() {
        return this.resolver.list();
    }
    /** 全部帧名（按顺序） */
    frameNames() {
        return this.resolver.names();
    }
    /** 名字 → 帧索引；不存在返回 null */
    resolveFrame(name) {
        return this.resolver.resolve(name);
    }
    /** 第 index 帧的纹理对（统一资产接口 FrameAssetSource 用） */
    getFramePair(index) {
        const d = this.getFrameRenderData(index);
        if (!d)
            return null;
        return { base: d.baseTexture, residual: d.residualTexture };
    }
    /** 是否存在该帧名 */
    hasFrame(name) {
        return this.resolver.contains(name);
    }
    /** 按名字跳帧（驱动所有已创建的播放控制器） */
    gotoFrame(name) {
        const idx = this.resolver.resolve(name);
        if (idx === null)
            return false;
        for (const ctrl of this._controllers)
            ctrl.goto(idx);
        return true;
    }
    /** 该帧是否有流体物理配置 */
    hasPhysics(index) {
        const fd = this.frames[index];
        return !!fd && !!fd.physics;
    }
    /** 获取该帧流体配置（无则 null） */
    getPhysicsConfig(index) {
        const fd = this.frames[index];
        return fd?.physics ?? null;
    }
    /** 获取该帧 FTX 原始数据（构建流体效果用），无则 null */
    getFtxFrame(index) {
        if (!this._ftx)
            return null;
        const fd = this.frames[index];
        if (!fd)
            return null;
        const ftxIdx = fd.textureIndex;
        if (ftxIdx < 0 || ftxIdx >= this._ftx.frames.length)
            return null;
        return this._ftx.frames[ftxIdx];
    }
    /**
     * ★ 物理参数注入（解耦）：用公共物理参数（.phys.json）覆盖某帧的内嵌参数。
     * 同一份参数可注入任意特效/纹理；注入后已创建的流体效果自动失效重建。
     */
    injectPhysics(frameIndex, config) {
        const fd = this.frames[frameIndex];
        if (!fd)
            return;
        fd.physics = config;
        this._fluidEffects.delete(frameIndex);
    }
    /**
     * ★ 从 URL 加载编辑器导出的 .phys.json 并注入（配方闭环）：
     *   - frameIndex 省略 → 注入到全部帧
     *   - 原始 JSON 直传（保留 regionWalls / obstacle 等扩展键，不经 parsePhysicsConfig 剥离）
     *   返回是否成功。
     */
    async loadPhysicsFromUrl(url, frameIndex) {
        try {
            const res = await fetch(url);
            if (!res.ok)
                return false;
            const rawJson = (await res.json());
            // ★ 格式归一化：编辑器"导出配置"是五块结构（coreSwitches/globalForce/levelSet…），
            //   解析器只吃扁平结构 —— 此处转换，同时保留 regionWalls/obstacle 等扩展键
            const raw = normalizePhysJson(rawJson);
            const idxs = frameIndex !== undefined ? [frameIndex] : this.frames.map((_, i) => i);
            for (const i of idxs)
                this.injectPhysics(i, raw);
            return true;
        }
        catch {
            return false;
        }
    }
    /** 获取或惰性创建该帧的流体效果（需要渲染器）。返回 null 表示该帧无流体配置。 */
    getFluidEffect(index, renderer) {
        if (index < 0 || index >= this.frames.length)
            return null;
        const cached = this._fluidEffects.get(index);
        if (cached)
            return cached;
        const physics = this.frames[index].physics;
        if (!physics)
            return null;
        const ftxFrame = this.getFtxFrame(index);
        if (!ftxFrame)
            return null;
        const palette = this._ftx.palette;
        const entities = [];
        for (const ed of this.frames[index].regionEntities) {
            entities.push(ed);
        }
        const effect = new FluidEffect_1.FluidEffect(renderer, physics, ftxFrame, palette, entities);
        this._fluidEffects.set(index, effect);
        return effect;
    }
    /**
     * ★ 创建独立"环境流体"（图标动效等）：不缓存，直接使用该帧自带的流体参数。
     * 与 getFluidEffect（共享缓存）隔离——图标动画不会影响世界实体同一实例的求解节奏。
     */
    createAmbientFluidEffect(renderer, frameIndex) {
        if (frameIndex < 0 || frameIndex >= this.frames.length)
            return null;
        const physics = this.frames[frameIndex].physics;
        if (!physics)
            return null;
        const ftxFrame = this.getFtxFrame(frameIndex);
        if (!ftxFrame)
            return null;
        const palette = this._ftx.palette;
        const entities = [];
        for (const ed of this.frames[frameIndex].regionEntities) {
            entities.push(ed);
        }
        return new FluidEffect_1.FluidEffect(renderer, physics, ftxFrame, palette, entities);
    }
    /** 释放所有流体效果（重新加载或 dispose 时调用） */
    clearFluidEffects() {
        for (const [, eff] of this._fluidEffects)
            eff.dispose();
        this._fluidEffects.clear();
    }
    /**
     * ★ 创建独立流体效果（死亡动画用）：不缓存、与共享实例隔离。
     * 若该帧有 physics 配置则用之，否则用默认矢量配置（死亡动画强制矢量模式）。
     * 返回 null 表示无法构建（无 FTX 帧数据）。
     */
    createDeathFluidEffect(renderer, frameIndex) {
        const ftxFrame = this.getFtxFrame(frameIndex);
        if (!ftxFrame)
            return null;
        const palette = this._ftx.palette;
        const entities = [];
        for (const ed of this.frames[frameIndex].regionEntities) {
            entities.push(ed);
        }
        // ★ 死亡动画强制矢量模式。
        // ★★ 速度上限（2026-09-18 定稿 = **200 px/s**）：原 20000 → 50 → 200。
        //   20000 太猛（冲量 800~2000 直接飞散）／ 50 太温（散度爆炸被限死）⇒ 200 正好。
        //   ⚠ 同时决定平流子步数 substeps = ceil(maxVel·dt/minGrid)：200 px/s @1/30s = 6.7px/步
        //     ⇒ 正常尺寸贴片仍是 1 个子步。
        // ★ 小力度推力：`gravity` 4000 → **20 px/s²**。这里只是初值，
        //   `DeathAnimEffect.play()` 会立刻 `updateConfig` 覆盖成随机方向的 20（见其 DEATH_PUSH_FORCE）。
        //   ★ 判据 = 稳态流速 v_eq ≈ 1.63·g 必须 < maxVelocity；g=20 ⇒ ≈33 px/s，留足余量。
        // ★ 2026-09-18：levelSet **开启**（此前未配置 = 关）。配置说明见 FtxAsset 同名方法。
        const physics = {
            ...(this.frames[frameIndex].physics ?? {}),
            enableAdvection: true,
            enablePressure: true,
            pressureIterations: 30,
            advectionMode: 'vector',
            gravity: { x: 0, y: 20 },
            velocityScale: 0.98,
            maxVelocity: 200,
            levelSetConfig: {
                enabled: true,
                reinitInterval: 10,
                reinitIterations: 2,
                surfaceTension: 10000,
                smoothingRadius: 2,
                narrowBandWidth: 5,
                constrainLiquid: false,
                outwardDamping: 1,
                clampAirPhi: true,
                maxAirPhi: 0,
                compensateWaterPhi: true,
                waterCompensationRate: 0.1,
            },
        };
        return new FluidEffect_1.FluidEffect(renderer, physics, ftxFrame, palette, entities);
    }
    /**
     * ★ 创建独立受击染料流体（角色受伤时注入红色；scalar 模式 + 高粘度 + LevelSet 表面张力，
     * 红色以浓度场扩散晕开，持续时间结束后 dispose 即恢复原纹理）
     */
    createHitDyeEffect(renderer, frameIndex) {
        const ftxFrame = this.getFtxFrame(frameIndex);
        if (!ftxFrame)
            return null;
        const palette = this._ftx.palette;
        const entities = [];
        for (const ed of this.frames[frameIndex].regionEntities) {
            entities.push(ed);
        }
        const physics = {
            // coreSwitches
            enableAdvection: true,
            // ★★ 2026-09-18 关掉压力投影：本路径**不注入速度**（`Asset` 不声明 hitDyeSpreadSpeed
            //    ⇒ CharacterBase 的 hitDyeVel 恒为 {0,0}），且 gravity = {0,0}、无持续源 / 无爆炸
            //    ⇒ 速度场自 initFields() 清零后**恒为 0** ⇒ ∇·u ≡ 0 ⇒ 解 ∇²p = 0（Neumann）得 p ≡ 0。
            //    于是「100 迭代 × 红黑两趟 = 200 趟 GPU pass/step」全部是恒等变换（纯白烧）。
            //    关掉后视觉零影响，且这笔省下的预算**超过** vector 路径恢复压力投影的代价
            //    （那边 20 迭代 = 40 趟/step）⇒ 两边合起来仍是净省。
            //    ⚠ 若将来给这条路径也加注入速度，必须改回 true，否则压力不投影。
            enablePressure: false,
            pressureIterations: 100,
            pressureOmega: 1.7,
            pressureBoundaryMode: 'neumann',
            enableWarmStart: true,
            // advectionAndComposite
            advectionMode: 'scalar',
            combineMode: 'sub',
            channels: { h: true, s: true, l: true, a: true },
            scalarConfig: {
                hMultiplier: 0.8,
                sMultiplier: 0.8,
                lMultiplier: 0.8,
                aMultiplier: 0.8,
                baselineDensity: 1,
                decayRate: 0.0588,
            },
            // globalForce
            gravity: { x: 0, y: 0 },
            velocityScale: 2,
            maxVelocity: 50,
            viscosity: 1000,
            colorBoundaryMode: 'clamp',
            // levelSet
            levelSetConfig: {
                enabled: false,
                reinitInterval: 1,
                reinitIterations: 6,
                surfaceTension: -5000000,
                smoothingRadius: 5,
                narrowBandWidth: 5,
                constrainLiquid: false,
                outwardDamping: 1,
                clampAirPhi: true,
                maxAirPhi: 0,
                compensateWaterPhi: false,
                waterCompensationRate: 0.1,
            },
        };
        return new FluidEffect_1.FluidEffect(renderer, physics, ftxFrame, palette, entities);
    }
    dispose() {
        for (const ctrl of this._controllers)
            ctrl.dispose();
        this._controllers.clear();
        for (const tex of this.baseTextures)
            tex.dispose();
        for (const tex of this.residualTextures)
            tex.dispose();
        for (const [, em] of this._entityMeshMap) {
            em.displacementTexture.dispose();
            em.mesh.geometry.dispose();
            em.fillMesh.geometry.dispose();
            em.mesh.material.dispose();
            em.fillMesh.material.dispose();
        }
        this._entityMeshMap.clear();
        this.clearFluidEffects();
        this.baseTextures.length = 0;
        this.residualTextures.length = 0;
    }
}
exports.Asset = Asset;
// ============================================================
// .phys.json 格式归一化：五块结构（编辑器导出）→ 扁平结构（解析器输入）
// ============================================================
function normalizePhysJson(json) {
    const cs = json.coreSwitches;
    if (!cs)
        return json; // 已是扁平格式，原样返回
    const ac = (json.advectionAndComposite ?? {});
    const gf = (json.globalForce ?? {});
    const ls = (json.levelSet ?? {});
    return {
        ...json, // 透传扩展键：regionWalls / obstacle / name / category …
        enableAdvection: cs.enableAdvection,
        enablePressure: cs.enablePressure,
        pressureIterations: cs.pressureIterations,
        pressureOmega: cs.pressureOmega,
        pressureBoundaryMode: cs.pressureBoundaryMode,
        enableWarmStart: cs.enableWarmStart,
        advectionMode: ac.advectionMode,
        combineMode: ac.combineMode,
        channels: ac.channels,
        scalarConfig: ac.scalarConfig,
        gravity: gf.gravity,
        velocityScale: gf.velocityScale,
        maxVelocity: gf.maxVelocity,
        viscosity: gf.viscosity,
        colorBoundaryMode: gf.colorBoundaryMode,
        levelSetConfig: {
            enabled: ls.enabled ?? ls.enableLevelSet,
            ...ls,
        },
        resolution: json.resolution,
        continuousSources: json.continuousSources ?? [],
    };
}
