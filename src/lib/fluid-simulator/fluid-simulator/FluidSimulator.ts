import * as THREE from 'three';

export interface FluidParams {
    width: number;
    height: number;
    density: number;            // kg/m³
    viscosity: number;          // Pa·s (动力粘度)
    surfaceTension: number;     // N/m
    gravity: number;            // m/s² 向下为正
    pressureIterations: number; // 推荐15~30（PCG迭代，收敛远快于Jacobi）
    reinitIterations: number;   // 推荐3~5（窄带重初始化，更稳定）
    reinitInterval?: number;    // 重初始化间隔帧数，默认1（每帧），性能优先可设10~20
    timeStep: number;           // 固定步长，推荐0.002（静水测试用更小值）
    restitution: number;        // 恢复系数：0.0-1.0，推荐0.8
    friction: number;           // 摩擦系数：0.0-1.0，推荐0.95
    initialLevelSet?: THREE.Texture;  // 自定义初始 Level Set 纹理（可选）
    injectionEnabled?: boolean;
    injectionPosX?: number;
    injectionPosY?: number;
    injectionFlowRate?: number;
    injectionVelX?: number;
    injectionVelY?: number;
    injectionSize?: number;
    usePCG?: boolean;           // 是否使用PCG求解器（默认true）
    maxLifetime?: number;       // 流体最大寿命（秒），超过后消散，0表示不消散
    // 解耦边界处理参数
    decoupledBoundary?: boolean;     // 是否启用解耦边界处理（默认false）
    boundaryRingWidth?: number;      // 边界环宽度（UV空间），默认 2/resolution
    boundaryDivDamping?: number;     // 散度阻尼系数（0~1），越小边界越软，默认0.5
    boundaryVelDamping?: number;     // 速度修正阻尼系数（0~1），默认0.3
    // 爆炸随机扰动参数
    usePerturbation?: boolean;       // 是否启用随机扰动（默认false）
    perturbationStrength?: number;   // 扰动强度（0~1），推荐0.3~0.5
    fragmentCount?: number;          // 多团块爆炸子团块数，默认4
    // 分层渲染参数
    waterColor?: THREE.Color;           // 水面颜色
    deepColor?: THREE.Color;            // 深水颜色
    edgeWidth?: number;                 // 边缘宽度
    edgeIntensity?: number;             // 边缘发光强度
    specularIntensity?: number;         // 高光强度
    flowIntensity?: number;             // 流动扰动强度
    lightDir?: THREE.Vector3;           // 光照方向
    // 纹理居中追踪参数
    enableCentering?: boolean;          // 是否开启纹理居中追踪，默认 false
    centeringInterval?: number;          // 居中追踪间隔（秒），默认 1.0
}

export class FluidSimulator {
    // 模拟分辨率
    private width: number;
    private height: number;
    private params: FluidParams;
    private renderer: THREE.WebGLRenderer;

    // 临时场景、相机、全屏四边形（复用）
    private scene: THREE.Scene;
    private camera: THREE.OrthographicCamera;
    private quad: THREE.Mesh;
    private quadGeometry: THREE.PlaneGeometry;

    // 纹理对（乒乓缓冲）
    private velTexA!: THREE.WebGLRenderTarget;
    private velTexB!: THREE.WebGLRenderTarget;
    private phiTexA!: THREE.WebGLRenderTarget;
    private phiTexB!: THREE.WebGLRenderTarget;
    private pressureTexA!: THREE.WebGLRenderTarget;
    private pressureTexB!: THREE.WebGLRenderTarget;

    // 辅助纹理（单缓冲）
    private divergenceTex!: THREE.WebGLRenderTarget;
    private forcedVelTex!: THREE.WebGLRenderTarget;
    private velAfterCollisionTex!: THREE.WebGLRenderTarget;
    private velCorrectTex!: THREE.WebGLRenderTarget;

    // PCG求解器纹理（用于预条件共轭梯度法）
    private rTex!: THREE.WebGLRenderTarget;    // 残差 r = b - Ap
    private dTex!: THREE.WebGLRenderTarget;    // 搜索方向 d
    private qTex!: THREE.WebGLRenderTarget;    // q = A * d
    private zTex!: THREE.WebGLRenderTarget;    // 预条件后的残差 (M⁻¹r)
    private bTex!: THREE.WebGLRenderTarget;    // 右侧项 b = (ρ/dt) * div

    // PCG材质缓存（预分配，避免每帧创建）
    private spmvMat!: THREE.ShaderMaterial;
    private axpyMat!: THREE.ShaderMaterial;
    private scaleMat!: THREE.ShaderMaterial;
    private computeBMat!: THREE.ShaderMaterial;
    private precondMat!: THREE.ShaderMaterial;
    private vecSubMat!: THREE.ShaderMaterial;
    private multiplyMat!: THREE.ShaderMaterial;
    private reduceMat!: THREE.ShaderMaterial;
    private copyMat!: THREE.ShaderMaterial;

    // 预分配的归约纹理链（避免每帧动态创建）
    private reduceTexPool!: THREE.WebGLRenderTarget[];

    // 固体相关
    private solidMaskTex: THREE.Texture | null = null;
    private solidNormalTex: THREE.Texture | null = null;
    private dummySolidMaskTex!: THREE.DataTexture;

    // 当前活动的纹理引用（用于交换）
    private curVelTex!: THREE.WebGLRenderTarget;
    private curPhiTex!: THREE.WebGLRenderTarget;
    private curPressureTex!: THREE.WebGLRenderTarget;

    // 爆炸散度纹理（用于散度源模型）
    private explosionDivTex!: THREE.WebGLRenderTarget;

    // 活跃爆炸列表（使用帧计数代替墙钟时间，确保模拟结果一致）
    private activeExplosions: Array<{
        cx: number;
        cy: number;
        radius: number;
        strength: number;
        createWater: boolean;
        waterGenerated: boolean;  // 是否已生成过水花（防止每帧重复生成）
        startFrame: number;
        durationFrames: number;
        noiseOffsetX: number;  // 噪声相位偏移X
        noiseOffsetY: number;  // 噪声相位偏移Y
        anisotropyMode: number;      // 各向异性模式：0=各向同性, 1=四极子, 2=偶极子
        anisotropyPhase: number;     // 相位偏移（弧度）
        anisotropyStrength: number;  // 各向异性强度 (0~1)
    }> = [];

    // 调试录制相关
    private debugRecordingEnabled: boolean = false;
    private debugFramesToRecord: number = 20;
    private debugStartFrame: number = 0;
    private debugCurrentFrame: number = 0;
    private debugRecordedData: Array<{
        frame: number;
        phi: number[][];
        velX: number[][];
        velY: number[][];
    }> = [];

    // 缓存的着色器材质（复用）
    private velocityAdvectionMat!: THREE.ShaderMaterial;
    private externalForcesMat!: THREE.ShaderMaterial;
    private wallCollisionMat!: THREE.ShaderMaterial;
    private divergenceMat!: THREE.ShaderMaterial;
    private pressureJacobiMat!: THREE.ShaderMaterial;  // 压力迭代只需要一个材质
    private velocityCorrectMat!: THREE.ShaderMaterial;
    private levelSetAdvectionMat!: THREE.ShaderMaterial;
    private levelSetReinitMat!: THREE.ShaderMaterial;
    private solidBoundaryClearVelMat!: THREE.ShaderMaterial;  // 清理固体内部速度
    private solidBoundaryClearPhiMat!: THREE.ShaderMaterial;   // 清理固体内部 phi
    private bottomWallMat!: THREE.ShaderMaterial;              // 底部墙体边界（已废弃）
    private dissipationMat!: THREE.ShaderMaterial;           // 流体消散着色器
    private ageUpdateMat!: THREE.ShaderMaterial;             // 年龄更新着色器
    private ageAdvectionMat!: THREE.ShaderMaterial;          // 年龄平流着色器（让年龄跟随水流）

    // 爆炸相关材质（预缓存，避免每帧创建）
    private explosionDivMat!: THREE.ShaderMaterial;          // 爆炸散度源着色器
    private waterGenMat!: THREE.ShaderMaterial;              // 水花生成着色器
    private waterVelInitMat!: THREE.ShaderMaterial;          // 水花速度初始化着色器
    private ageResetMat!: THREE.ShaderMaterial;              // 年龄重置着色器

    // 注入/脉冲相关材质（预缓存，避免每帧创建）
    private velocityImpulseMat!: THREE.ShaderMaterial;       // 全局速度脉冲
    private localVelocityImpulseMat!: THREE.ShaderMaterial;  // 局部速度脉冲
    private divergenceImpulseMat!: THREE.ShaderMaterial;     // 散度脉冲
    private waterImpulseMat!: THREE.ShaderMaterial;          // 水脉冲

    // 流体年龄纹理（用于定时消散）
    private ageTexA!: THREE.WebGLRenderTarget;
    private ageTexB!: THREE.WebGLRenderTarget;
    private curAgeTex!: THREE.WebGLRenderTarget;

    // 分层渲染相关
    private renderMaterial!: THREE.ShaderMaterial;
    private waterColor: THREE.Color;
    private deepColor: THREE.Color;
    private edgeWidth: number;
    private edgeIntensity: number;
    private specularIntensity: number;
    private flowIntensity: number;
    private lightDir: THREE.Vector3;

    // 解耦边界处理参数
    private decoupledBoundary: boolean;
    private boundaryRingWidth: number;
    private boundaryDivDamping: number;
    private boundaryVelDamping: number;

    // 爆炸随机扰动参数
    private usePerturbation: boolean;
    private perturbationStrength: number;
    private fragmentCount: number;
    private noiseTex: THREE.DataTexture;

    private initialized = false;
    private frameCount = 0;
    private lastDissipationLogTime = 0;

    // 纹理居中追踪相关
    private centeringEnabled: boolean;
    private centeringInterval: number;
    private lastCenteringTime: number;
    private smoothedOffset: THREE.Vector2 = new THREE.Vector2(0, 0);
    private centeringPhiMat: THREE.ShaderMaterial;
    private centeringVelMat: THREE.ShaderMaterial;

    // 可见性裁剪相关
    private externalCamera: THREE.Camera | null = null;
    private fluidWorldBounds: THREE.Box3 = new THREE.Box3();
    private isVisibleInCamera: boolean = true;
    private visibilityCheckInterval: number = 0.5;  // 每0.5秒检查一次
    private lastVisibilityCheckTime: number = 0;
    private cachedWorldCenter: THREE.Vector3 = new THREE.Vector3();
    private cachedWorldRadius: number = 0.5;

    constructor(renderer: THREE.WebGLRenderer, params: FluidParams) {
        this.renderer = renderer;
        this.params = params;
        this.width = params.width;
        this.height = params.height;

        // 初始化分层渲染参数（带默认值）
        this.waterColor = params.waterColor ?? new THREE.Color(0.2, 0.5, 0.8);
        this.deepColor = params.deepColor ?? new THREE.Color(0.05, 0.15, 0.3);
        this.edgeWidth = params.edgeWidth ?? 0.05;
        this.edgeIntensity = params.edgeIntensity ?? 0.3;
        this.specularIntensity = params.specularIntensity ?? 0.5;
        this.flowIntensity = params.flowIntensity ?? 0.3;
        this.lightDir = params.lightDir ?? new THREE.Vector3(0.5, 1.0, 0.3).normalize();

        // 初始化解耦边界处理参数
        this.decoupledBoundary = params.decoupledBoundary ?? false;
        this.boundaryRingWidth = params.boundaryRingWidth ?? 2.0 / this.width;
        this.boundaryDivDamping = params.boundaryDivDamping ?? 0.5;
        this.boundaryVelDamping = params.boundaryVelDamping ?? 0.3;

        // 初始化爆炸随机扰动参数
        this.usePerturbation = params.usePerturbation ?? false;
        this.perturbationStrength = params.perturbationStrength ?? 0.4;
        this.fragmentCount = params.fragmentCount ?? 4;

        // 初始化纹理居中追踪参数
        this.centeringEnabled = params.enableCentering ?? false;
        this.centeringInterval = params.centeringInterval ?? 1.0;  // 默认1秒
        this.lastCenteringTime = 0;

        // 生成噪声纹理（用于随机扰动）
        this.noiseTex = this.generateNoiseTexture();

        // 创建正交相机和全屏四边形（UV 从 0 到 1）
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quadGeometry = new THREE.PlaneGeometry(2, 2);
        this.scene = new THREE.Scene();
        this.quad = new THREE.Mesh(this.quadGeometry, new THREE.MeshBasicMaterial());
        this.scene.add(this.quad);

        // 创建全零的 1x1 纹理作为 solidMask 的 fallback
        this.dummySolidMaskTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);

        this.createTextures();
        this.initTextures();
        this.initShaders();
        this.initCenteringShaders();  // 初始化纹理居中着色器
        this.initRenderMaterial();  // 初始化分层渲染材质
        this.initialized = true;
        console.log(`[FluidSimulator] 初始化完成，分辨率: ${this.width}×${this.height}`);
    }

    private createTextures(): void {
        const opts = {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
        };
        const createRT = () => new THREE.WebGLRenderTarget(this.width, this.height, opts);

        this.velTexA = createRT();
        this.velTexB = createRT();
        this.phiTexA = createRT();
        this.phiTexB = createRT();
        this.pressureTexA = createRT();
        this.pressureTexB = createRT();
        this.divergenceTex = createRT();
        this.forcedVelTex = createRT();
        this.velAfterCollisionTex = createRT();
        this.velCorrectTex = createRT();

        // 爆炸散度纹理
        this.explosionDivTex = createRT();

        // PCG求解器纹理
        this.rTex = createRT();
        this.dTex = createRT();
        this.qTex = createRT();
        this.zTex = createRT();
        this.bTex = createRT();

        // 预分配归约纹理链（用于 computeDot 的 GPU 归约）
        // 256x256 -> 128x128 -> 64x64 -> 32x32 -> 16x16 -> 8x8 -> 4x4 -> 2x2 -> 1x1
        // 共 8 级归约，加上 multiply 输出（256x256），共 9 个纹理
        const reduceOpts = {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
        };
        this.reduceTexPool = [];
        // 第0级：256x256（multiply 输出）
        this.reduceTexPool.push(new THREE.WebGLRenderTarget(this.width, this.height, reduceOpts));
        // 第1-8级：逐级减半直到 1x1
        let w = this.width;
        let h = this.height;
        for (let i = 0; i < 8; i++) {
            w = Math.ceil(w / 2);
            h = Math.ceil(h / 2);
            if (w < 1) w = 1;
            if (h < 1) h = 1;
            this.reduceTexPool.push(new THREE.WebGLRenderTarget(w, h, reduceOpts));
        }

        this.curVelTex = this.velTexA;
        this.curPhiTex = this.phiTexA;
        this.curPressureTex = this.pressureTexA;

        // 年龄纹理（用于定时消散）
        this.ageTexA = createRT();
        this.ageTexB = createRT();
        this.curAgeTex = this.ageTexA;
    }

    private initTextures(): void {
        // 初始化速度场为 0
        this.renderFullscreen(this.initVelocityShader(), this.velTexA);
        this.renderFullscreen(this.initVelocityShader(), this.velTexB);

        // 初始化 Level Set
        if (this.params.initialLevelSet) {
            this.copyTextureToTarget(this.params.initialLevelSet, this.phiTexA);
            this.copyTextureToTarget(this.params.initialLevelSet, this.phiTexB);
        } else {
            this.renderFullscreen(this.initLevelSetShader(), this.phiTexA);
            this.renderFullscreen(this.initLevelSetShader(), this.phiTexB);
        }

        // 初始压力为 0
        this.renderFullscreen(this.initPressureShader(), this.pressureTexA);
        this.renderFullscreen(this.initPressureShader(), this.pressureTexB);

        // 确保 curPhiTex 已设置（虽然 createTextures 已经设置过）
        this.curPhiTex = this.phiTexA;

        // 初始化年龄纹理（所有像素年龄=0）
        const initAgeShader = new THREE.ShaderMaterial({
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `varying vec2 vUv; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }`
        });
        this.renderFullscreen(initAgeShader, this.ageTexA);
        this.renderFullscreen(initAgeShader, this.ageTexB);
        initAgeShader.dispose();

        // 确保 curAgeTex 指向正确的初始纹理
        this.curAgeTex = this.ageTexA;
    }

    private copyTextureToTarget(source: THREE.Texture, target: THREE.WebGLRenderTarget): void {
        const material = new THREE.ShaderMaterial({
            uniforms: { tex: { value: source } },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `uniform sampler2D tex; varying vec2 vUv; void main() { gl_FragColor = texture2D(tex, vUv); }`
        });
        this.renderFullscreen(material, target);
        material.dispose();
    }

    // 通用渲染函数：使用指定的材质渲染到目标（或屏幕）
    private renderFullscreen(material: THREE.ShaderMaterial, outputTarget?: THREE.WebGLRenderTarget, clear = true): void {
        const prevMaterial = this.quad.material;
        this.quad.material = material;
        const prevTarget = this.renderer.getRenderTarget();
        if (outputTarget) this.renderer.setRenderTarget(outputTarget);
        if (clear) this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        if (outputTarget) this.renderer.setRenderTarget(prevTarget);
        this.quad.material = prevMaterial;
    }

    // ==================== 初始化着色器 ====================
    private initVelocityShader(): THREE.ShaderMaterial {
        return new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `void main() { gl_FragColor = vec4(0.0); }`
        });
    }

    private initLevelSetShader(): THREE.ShaderMaterial {
        // 固定半径 0.1（UV空间）
        const radius = 0.1;
        // 随机种子（每次初始化不同）
        const randomSeed = Math.random() * 1000.0;
        return new THREE.ShaderMaterial({
            uniforms: { 
                radius: { value: radius }, 
                center: { value: new THREE.Vector2(0.5, 0.5) },
                randomSeed: { value: randomSeed }
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform vec2 center; 
                uniform float radius; 
                uniform float randomSeed;
                varying vec2 vUv;
                
                // 简化的噪声函数
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                }
                
                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));
                    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
                }
                
                // 边缘凹凸扰动 - 更强的凸起和凹陷
                float edgeDistortion(float angle, float seed) {
                    float n1 = noise(vec2(angle * 2.0, seed)) * 1.0;         // 大块凸起
                    float n2 = noise(vec2(angle * 5.0, seed + 100.0)) * 0.6;  // 中等凸起
                    float n3 = noise(vec2(angle * 10.0, seed + 200.0)) * 0.3; // 小凸起
                    
                    return n1 + n2 + n3 - 0.8; // 范围约 [-0.8, 1.1]
                }
                
                void main() { 
                    vec2 delta = vUv - center;
                    float dist = length(delta);
                    float seed = randomSeed;
                    
                    // 基础距离场
                    float d = dist - radius;
                    
                    // 圆形水体内部
                    if (dist < radius) {
                        // 基础圆形，phi = dist - radius
                        d = dist - radius;
                        
                        // 边缘强烈凹凸扰动
                        float angle = atan(delta.y, delta.x);
                        float edgeNoise = edgeDistortion(angle, seed);
                        float edgeMask = smoothstep(radius * 0.1, radius, dist);
                        d -= edgeNoise * radius * 0.6 * edgeMask;
                        
                        // 内部气泡效果：4个大气泡，分散分布
                        vec2 localPos = delta / radius;
                        
                        // 气泡1 - 中心偏左上
                        vec2 bubble1 = vec2(-0.25, 0.25);
                        float bubble1Dist = length(localPos - bubble1);
                        float bubble1Radius = 0.15;
                        if (bubble1Dist < bubble1Radius) {
                            d = max(d, (bubble1Dist - bubble1Radius) * radius * 1.0);
                        }
                        
                        // 气泡2 - 中心偏右下
                        vec2 bubble2 = vec2(0.25, -0.2);
                        float bubble2Dist = length(localPos - bubble2);
                        float bubble2Radius = 0.14;
                        if (bubble2Dist < bubble2Radius) {
                            d = max(d, (bubble2Dist - bubble2Radius) * radius * 1.0);
                        }
                        
                        // 气泡3 - 左侧
                        vec2 bubble3 = vec2(-0.3, -0.1);
                        float bubble3Dist = length(localPos - bubble3);
                        float bubble3Radius = 0.12;
                        if (bubble3Dist < bubble3Radius) {
                            d = max(d, (bubble3Dist - bubble3Radius) * radius * 1.0);
                        }
                        
                        // 气泡4 - 右侧
                        vec2 bubble4 = vec2(0.28, 0.15);
                        float bubble4Dist = length(localPos - bubble4);
                        float bubble4Radius = 0.11;
                        if (bubble4Dist < bubble4Radius) {
                            d = max(d, (bubble4Dist - bubble4Radius) * radius * 1.0);
                        }
                    }
                    
                    gl_FragColor = vec4(d, 0.0, 0.0, 1.0); 
                }
            `
        });
    }

    private initPressureShader(): THREE.ShaderMaterial {
        return new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `void main() { gl_FragColor = vec4(0.0); }`
        });
    }

    // ==================== 缓存着色器初始化 ====================
    private initShaders(): void {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const res = new THREE.Vector2(this.width, this.height);
        const dt = this.params.timeStep;

        // 速度平流
        this.velocityAdvectionMat = new THREE.ShaderMaterial({
            uniforms: { velocity: { value: null }, dt: { value: dt }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D velocity; uniform float dt; uniform vec2 resolution; varying vec2 vUv; void main() { vec2 uv = vUv; vec2 vel = texture2D(velocity, uv).rg; vec2 step = vel * dt / resolution; vec2 back = uv - step; vec2 newVel = texture2D(velocity, back).rg; gl_FragColor = vec4(newVel, 0.0, 1.0); }`
        });

        // 外力计算
        this.externalForcesMat = new THREE.ShaderMaterial({
            uniforms: {
                velocity: { value: null }, levelset: { value: null },
                gravity: { value: this.params.gravity }, sigma: { value: this.params.surfaceTension },
                density: { value: this.params.density }, viscosity: { value: this.params.viscosity },
                resolution: { value: res }, dt: { value: dt },
                injectionEnabled: { value: this.params.injectionEnabled ?? false },
                injectionPos: { value: new THREE.Vector2(this.params.injectionPosX ?? 0.5, this.params.injectionPosY ?? 0.5) },
                injectionFlowRate: { value: this.params.injectionFlowRate ?? 1.0 },
                injectionVel: { value: new THREE.Vector2(this.params.injectionVelX ?? 0.0, this.params.injectionVelY ?? 0.0) },
                injectionSize: { value: this.params.injectionSize ?? 0.05 }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D velocity; 
                uniform sampler2D levelset; 
                uniform float gravity; 
                uniform float sigma; 
                uniform float density; 
                uniform float viscosity; 
                uniform vec2 resolution; 
                uniform float dt; 
                uniform bool injectionEnabled; 
                uniform vec2 injectionPos; 
                uniform float injectionFlowRate; 
                uniform vec2 injectionVel; 
                uniform float injectionSize; 
                varying vec2 vUv; 

                void main() { 
                    vec2 uv = vUv; 
                    float phi = texture2D(levelset, uv).r; 
                    vec2 vel = texture2D(velocity, uv).rg; 
                    vel.y -= gravity * dt; 

                    vec2 dx = vec2(1.0/resolution.x, 0.0); 
                    vec2 dy = vec2(0.0, 1.0/resolution.y); 
                    vec2 vel_r = texture2D(velocity, uv + dx).rg; 
                    vec2 vel_l = texture2D(velocity, uv - dx).rg; 
                    vec2 vel_t = texture2D(velocity, uv + dy).rg; 
                    vec2 vel_b = texture2D(velocity, uv - dy).rg; 
                    vec2 laplacian = (vel_r + vel_l + vel_t + vel_b - 4.0*vel) * (resolution.x * resolution.x); 
                    float nu = viscosity / density; 
                    vel += nu * dt * laplacian; 

                    float eps = 1.5 / resolution.x; 
                    if (abs(phi) < eps) { 
                        float phi_r = texture2D(levelset, uv + dx).r; 
                        float phi_l = texture2D(levelset, uv - dx).r; 
                        float phi_t = texture2D(levelset, uv + dy).r; 
                        float phi_b = texture2D(levelset, uv - dy).r; 
                        vec2 grad = vec2(phi_r - phi_l, phi_t - phi_b) / (2.0 * dx.x); 
                        float len = length(grad); 
                        if (len > 1e-6) { 
                            vec2 n = grad / len; 
                            float phi_xx = phi_r + phi_l - 2.0*phi; 
                            float phi_yy = phi_t + phi_b - 2.0*phi; 
                            float phi_xy = (texture2D(levelset, uv + dx + dy).r - texture2D(levelset, uv + dx - dy).r - texture2D(levelset, uv - dx + dy).r + texture2D(levelset, uv - dx - dy).r) / (4.0 * dx.x * dx.x); 
                            float kappa = (phi_xx * n.y * n.y - 2.0 * phi_xy * n.x * n.y + phi_yy * n.x * n.x) / len; 
                            float delta = 0.0; 
                            if (abs(phi) < eps) delta = (1.0 + cos(3.1415926 * phi / eps)) / (2.0 * eps); 
                            vec2 f_st = sigma * kappa * delta * n; 
                            vel += (f_st / density) * dt; 
                        } 
                    } 

                    if (injectionEnabled) {
                        float dist = length(uv - injectionPos);
                        // 只在空气中（phi > 0）且距离足够近时注射
                        if (dist < injectionSize && phi > 0.0) {
                            float mask = 1.0 - smoothstep(0.0, injectionSize, dist);
                            phi = phi - injectionFlowRate * dt * mask;
                            vel += injectionVel * mask;
                        }
                    } 

                    // 移除全局速度限制，允许爆炸产生的高速度
                    gl_FragColor = vec4(vel, phi, 1.0); 
                }
            `
        });

        // 墙碰撞
        this.wallCollisionMat = new THREE.ShaderMaterial({
            uniforms: { velocity: { value: null }, solidMask: { value: null }, solidNormal: { value: null }, restitution: { value: this.params.restitution }, friction: { value: this.params.friction }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D velocity; uniform sampler2D solidMask; uniform sampler2D solidNormal; uniform float restitution; uniform float friction; uniform vec2 resolution; varying vec2 vUv; void main() { float isSolid = texture2D(solidMask, vUv).r; if (isSolid < 0.5) { vec2 vel = texture2D(velocity, vUv).rg; gl_FragColor = vec4(vel, 0.0, 1.0); return; } vec2 normal = texture2D(solidNormal, vUv).rg; float len = length(normal); if (len < 0.001) { gl_FragColor = vec4(0.0); return; } normal /= len; vec2 vel = texture2D(velocity, vUv).rg; float vn = dot(vel, normal); vec2 vt = vel - vn * normal; float vn_new = -vn * restitution; vec2 vt_new = vt * friction; vec2 vel_new = vt_new + vn_new * normal; gl_FragColor = vec4(vel_new, 0.0, 1.0); }`
        });

        // 散度计算
        this.divergenceMat = new THREE.ShaderMaterial({
            uniforms: { 
                velocity: { value: null }, 
                explosionDiv: { value: null }, 
                resolution: { value: res },
                decoupledBoundary: { value: this.decoupledBoundary ? 1.0 : 0.0 },
                boundaryRingWidth: { value: this.boundaryRingWidth },
                boundaryDivDamping: { value: this.boundaryDivDamping }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D velocity;
                uniform sampler2D explosionDiv;
                uniform vec2 resolution;
                uniform float decoupledBoundary;
                uniform float boundaryRingWidth;
                uniform float boundaryDivDamping;
                varying vec2 vUv;
                void main() {
                    vec2 uv = vUv;
                    vec2 dx = vec2(1.0/resolution.x, 0.0);
                    vec2 dy = vec2(0.0, 1.0/resolution.y);
                    float vxR = texture2D(velocity, uv + dx).r;
                    float vxL = texture2D(velocity, uv - dx).r;
                    float vyT = texture2D(velocity, uv + dy).g;
                    float vyB = texture2D(velocity, uv - dy).g;
                    float div = (vxR - vxL) / (2.0*dx.x) + (vyT - vyB) / (2.0*dy.y);
                    // 叠加爆炸散度源
                    float explosionDivergence = texture2D(explosionDiv, uv).r;
                    div += explosionDivergence;

                    // 解耦边界：使用 smoothstep 做软过渡，对边界环内的散度进行阻尼
                    if (decoupledBoundary > 0.5) {
                        // 计算到四个边界的距离
                        float distToLeft = uv.x;
                        float distToRight = 1.0 - uv.x;
                        float distToBottom = uv.y;
                        float distToTop = 1.0 - uv.y;
                        float minDist = min(min(distToLeft, distToRight), min(distToBottom, distToTop));
                        
                        // 使用 smoothstep 创建软过渡的阻尼因子
                        // 在边界处阻尼最强（boundaryDivDamping），在环带外完全无阻尼（1.0）
                        float ringMask = smoothstep(0.0, boundaryRingWidth, minDist);
                        float dampingFactor = mix(boundaryDivDamping, 1.0, ringMask);
                        div *= dampingFactor;
                    }

                    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
                }
            `
        });

        // 压力迭代（只需要一个材质反复使用）- 添加自由表面 Neumann 边界条件
        this.pressureJacobiMat = new THREE.ShaderMaterial({
            uniforms: {
                pressure: { value: null },
                divergence: { value: null },
                levelset: { value: null },
                solidMask: { value: null },
                dt: { value: dt },
                density: { value: this.params.density },
                resolution: { value: res }
            },
            vertexShader: vs,
            fragmentShader: `
            uniform sampler2D pressure;
            uniform sampler2D divergence;
            uniform sampler2D levelset;
            uniform sampler2D solidMask;
            uniform float dt;
            uniform float density;
            uniform vec2 resolution;
            varying vec2 vUv;

            void main() {
                float phi = texture2D(levelset, vUv).r;
                float isSolid = texture2D(solidMask, vUv).r;
                if (phi > 0.0 || isSolid > 0.5) {
                    gl_FragColor = vec4(0.0);
                    return;
                }

                vec2 uv = vUv;
                vec2 dx = vec2(1.0/resolution.x, 0.0);
                vec2 dy = vec2(0.0, 1.0/resolution.y);
                float h = 1.0 / resolution.x;

                float pL = texture2D(pressure, uv - dx).r;
                float pR = texture2D(pressure, uv + dx).r;
                float pD = texture2D(pressure, uv - dy).r;
                float pU = texture2D(pressure, uv + dy).r;

                float div = texture2D(divergence, uv).r;

                float p_new = (pL + pR + pD + pU - (density / dt) * div * h * h) / 4.0;

                gl_FragColor = vec4(p_new, 0.0, 0.0, 1.0);
            }
            `
        });

        // 速度修正 - 添加自由表面处理
        this.velocityCorrectMat = new THREE.ShaderMaterial({
            uniforms: { 
                velocity: { value: null }, 
                pressure: { value: null }, 
                levelset: { value: null }, 
                dt: { value: dt }, 
                density: { value: this.params.density }, 
                resolution: { value: res },
                decoupledBoundary: { value: this.decoupledBoundary ? 1.0 : 0.0 },
                boundaryRingWidth: { value: this.boundaryRingWidth },
                boundaryVelDamping: { value: this.boundaryVelDamping }
            },
            vertexShader: vs,
            fragmentShader: `
            uniform sampler2D velocity;
            uniform sampler2D pressure;
            uniform sampler2D levelset;
            uniform float dt;
            uniform float density;
            uniform vec2 resolution;
            uniform float decoupledBoundary;
            uniform float boundaryRingWidth;
            uniform float boundaryVelDamping;
            varying vec2 vUv;

            void main() {
                vec2 uv = vUv;
                float phi = texture2D(levelset, uv).r;
                // 空气区不修正速度，保持原状
                if (phi > 0.0) {
                    vec2 vel = texture2D(velocity, uv).rg;
                    gl_FragColor = vec4(vel, 0.0, 1.0);
                    return;
                }

                vec2 dx = vec2(1.0/resolution.x, 0.0);
                vec2 dy = vec2(0.0, 1.0/resolution.y);

                float pL = texture2D(pressure, uv - dx).r;
                float pR = texture2D(pressure, uv + dx).r;
                float pD = texture2D(pressure, uv - dy).r;
                float pU = texture2D(pressure, uv + dy).r;

                vec2 vel = texture2D(velocity, uv).rg;
                vec2 pressureGrad = vec2(pR - pL, pU - pD) / (2.0*dx.x);

                // 解耦边界：使用 smoothstep 做软过渡，在边界环内衰减压力梯度的修正作用
                if (decoupledBoundary > 0.5) {
                    // 计算到四个边界的距离
                    float distToLeft = uv.x;
                    float distToRight = 1.0 - uv.x;
                    float distToBottom = uv.y;
                    float distToTop = 1.0 - uv.y;
                    float minDist = min(min(distToLeft, distToRight), min(distToBottom, distToTop));
                    
                    // 使用 smoothstep 创建软过渡的阻尼因子
                    // 在边界处阻尼最强（boundaryVelDamping），在环带外完全无阻尼（1.0）
                    float ringMask = smoothstep(0.0, boundaryRingWidth, minDist);
                    float dampingFactor = mix(boundaryVelDamping, 1.0, ringMask);
                    pressureGrad *= dampingFactor;
                }

                vel.x -= (dt / density) * pressureGrad.x;
                vel.y -= (dt / density) * pressureGrad.y;

                // 速度上限限制，防止 CFL 条件失效
                float maxVel = 200.0;
                float speed = length(vel);
                if (speed > maxVel) vel = vel * (maxVel / speed);

                gl_FragColor = vec4(vel, 0.0, 1.0);
            }
            `
        });

        // Level Set 平流
        this.levelSetAdvectionMat = new THREE.ShaderMaterial({
            uniforms: { velocity: { value: null }, forcedVel: { value: null }, levelset: { value: null }, dt: { value: dt }, resolution: { value: res }, injectionEnabled: { value: this.params.injectionEnabled ?? false } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D velocity; uniform sampler2D forcedVel; uniform sampler2D levelset; uniform float dt; uniform vec2 resolution; uniform bool injectionEnabled; varying vec2 vUv; void main() { vec2 uv = vUv; vec2 vel = texture2D(velocity, uv).rg; vec2 step = vel * dt / resolution; vec2 back = clamp(uv - step, 0.0, 1.0); float phi; if (injectionEnabled) { phi = texture2D(forcedVel, back).b; } else { phi = texture2D(levelset, back).r; } gl_FragColor = vec4(phi, 0.0, 0.0, 1.0); }`
        });

        // Level Set 重初始化（窄带限制，只在界面附近演化）
        this.levelSetReinitMat = new THREE.ShaderMaterial({
            uniforms: { levelset: { value: null }, dt_reinit: { value: 0.1 / Math.min(this.width, this.height) }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `
            uniform sampler2D levelset;
            uniform float dt_reinit;
            uniform vec2 resolution;
            varying vec2 vUv;

            void main() {
                vec2 uv = vUv;
                float phi0 = texture2D(levelset, uv).r;
                float dx = 1.0 / resolution.x;
                float eps = 0.001;

                // 移除窄带限制，允许全屏流体
                // if (abs(phi0) > 8.0 * dx) {
                //     gl_FragColor = vec4(phi0, 0.0, 0.0, 1.0);
                //     return;
                // }

                float phi_r = texture2D(levelset, uv + vec2(dx, 0.0)).r;
                float phi_l = texture2D(levelset, uv - vec2(dx, 0.0)).r;
                float phi_t = texture2D(levelset, uv + vec2(0.0, dx)).r;
                float phi_b = texture2D(levelset, uv - vec2(0.0, dx)).r;

                vec2 grad = vec2(phi_r - phi_l, phi_t - phi_b) / (2.0 * dx);
                float grad_len = length(grad);

                float sign_phi0 = phi0 > eps ? 1.0 : (phi0 < -eps ? -1.0 : 1.0);
                float phi_new = phi0 - dt_reinit * sign_phi0 * (grad_len - 1.0);

                // 温和的符号保护：使用 clamp 保持符号，避免直接设为0导致界面不准确
                // 当 phi_new 跨越0时，限制为一个小的 epsilon 值保持原有符号
                float sign_eps = 1e-6;
                if (sign_phi0 > 0.0 && phi_new < sign_eps) phi_new = sign_eps;
                if (sign_phi0 < 0.0 && phi_new > -sign_eps) phi_new = -sign_eps;

                gl_FragColor = vec4(phi_new, 0.0, 0.0, 1.0);
            }
            `
        });

        // 固体边界清理 - 清理速度
        this.solidBoundaryClearVelMat = new THREE.ShaderMaterial({
            uniforms: { velocity: { value: null }, solidMask: { value: null } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D velocity; uniform sampler2D solidMask; varying vec2 vUv; void main() { float isSolid = texture2D(solidMask, vUv).r; vec2 vel = texture2D(velocity, vUv).rg; if (isSolid > 0.5) vel = vec2(0.0); gl_FragColor = vec4(vel, 0.0, 1.0); }`
        });

        // 固体边界清理 - 清理 phi
        this.solidBoundaryClearPhiMat = new THREE.ShaderMaterial({
            uniforms: { levelset: { value: null }, solidMask: { value: null } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D levelset; uniform sampler2D solidMask; varying vec2 vUv; void main() { float isSolid = texture2D(solidMask, vUv).r; float phi = texture2D(levelset, vUv).r; if (isSolid > 0.5) phi = 1.0; gl_FragColor = vec4(phi, 0.0, 0.0, 1.0); }`
        });

        // 底部墙体边界 - 防止流体穿透底部
        this.bottomWallMat = new THREE.ShaderMaterial({
            uniforms: { velocity: { value: null }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `
            uniform sampler2D velocity;
            uniform vec2 resolution;
            varying vec2 vUv;
            void main() {
                vec2 vel = texture2D(velocity, vUv).rg;
                float bottomRow = 1.0 / resolution.y;
                // 如果是底部边界行（vUv.y 很小），将垂直速度强制为0
                if (vUv.y < bottomRow + 0.0001) {
                    vel.y = 0.0;
                }
                gl_FragColor = vec4(vel, 0.0, 1.0);
            }
            `
        });

        // ========== 预创建 PCG 材质缓存（避免每帧创建）==========
        // 注意：vs 和 res 已在 initShaders() 前面的代码中声明

        this.spmvMat = new THREE.ShaderMaterial({
            uniforms: { x: { value: null }, levelset: { value: null }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D x; uniform sampler2D levelset; uniform vec2 resolution; varying vec2 vUv;
                void main() {
                    vec2 uv = vUv; float dx = 1.0 / resolution.x; vec2 dxVec = vec2(dx, 0.0); vec2 dyVec = vec2(0.0, dx);
                    float phi = texture2D(levelset, uv).r;
                    if (phi > 0.0) { gl_FragColor = vec4(0.0); return; }
                    float xC = texture2D(x, uv).r; float xL = texture2D(x, uv - dxVec).r; float xR = texture2D(x, uv + dxVec).r; float xD = texture2D(x, uv - dyVec).r; float xU = texture2D(x, uv + dyVec).r;
                    float phiL = texture2D(levelset, uv - dxVec).r; float phiR = texture2D(levelset, uv + dxVec).r; float phiD = texture2D(levelset, uv - dyVec).r; float phiU = texture2D(levelset, uv + dyVec).r;
                    if (phiL > 0.0) xL = xC; if (phiR > 0.0) xR = xC; if (phiD > 0.0) xD = xC; if (phiU > 0.0) xU = xC;
                    float Ax = (xL + xR + xD + xU - 4.0 * xC) / (dx * dx);
                    gl_FragColor = vec4(Ax, 0.0, 0.0, 1.0);
                }
            `
        });

        this.axpyMat = new THREE.ShaderMaterial({
            uniforms: { x: { value: null }, y: { value: null }, a: { value: 0.0 } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D x; uniform sampler2D y; uniform float a; varying vec2 vUv; void main() { float xVal = texture2D(x, vUv).r; float yVal = texture2D(y, vUv).r; gl_FragColor = vec4(a * xVal + yVal, 0.0, 0.0, 1.0); }`
        });

        this.scaleMat = new THREE.ShaderMaterial({
            uniforms: { x: { value: null }, a: { value: 0.0 } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D x; uniform float a; varying vec2 vUv; void main() { float xVal = texture2D(x, vUv).r; gl_FragColor = vec4(a * xVal, 0.0, 0.0, 1.0); }`
        });

        this.computeBMat = new THREE.ShaderMaterial({
            uniforms: { divergence: { value: null }, density: { value: this.params.density }, dt: { value: this.params.timeStep } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D divergence; uniform float density; uniform float dt; varying vec2 vUv; void main() { float div = texture2D(divergence, vUv).r; gl_FragColor = vec4((density / dt) * div, 0.0, 0.0, 1.0); }`
        });

        this.precondMat = new THREE.ShaderMaterial({
            uniforms: { r: { value: null }, levelset: { value: null }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D r; uniform sampler2D levelset; uniform vec2 resolution; varying vec2 vUv;
                void main() {
                    float phi = texture2D(levelset, vUv).r;
                    if (phi > 0.0) { gl_FragColor = vec4(0.0); return; }
                    float dx = 1.0 / resolution.x;
                    float rC = texture2D(r, vUv).r;
                    float diag = 4.0 / (dx * dx);
                    gl_FragColor = vec4(rC / diag, 0.0, 0.0, 1.0);
                }
            `
        });

        this.vecSubMat = new THREE.ShaderMaterial({
            uniforms: { x: { value: null }, z: { value: null }, a: { value: 0.0 } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D x; uniform sampler2D z; uniform float a; varying vec2 vUv; void main() { float xVal = texture2D(x, vUv).r; float zVal = texture2D(z, vUv).r; gl_FragColor = vec4(xVal - a * zVal, 0.0, 0.0, 1.0); }`
        });

        this.multiplyMat = new THREE.ShaderMaterial({
            uniforms: { a: { value: null }, b: { value: null } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D a; uniform sampler2D b; varying vec2 vUv; void main() { float aVal = texture2D(a, vUv).r; float bVal = texture2D(b, vUv).r; gl_FragColor = vec4(aVal * bVal, 0.0, 0.0, 1.0); }`
        });

        this.reduceMat = new THREE.ShaderMaterial({
            uniforms: { inputTex: { value: null }, resolution: { value: new THREE.Vector2(this.width, this.height) } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D inputTex; uniform vec2 resolution; varying vec2 vUv;
                void main() {
                    vec2 dx = vec2(1.0 / resolution.x, 0.0);
                    vec2 dy = vec2(0.0, 1.0 / resolution.y);
                    float v00 = texture2D(inputTex, vUv).r;
                    float v01 = texture2D(inputTex, vUv + dx).r;
                    float v10 = texture2D(inputTex, vUv + dy).r;
                    float v11 = texture2D(inputTex, vUv + dx + dy).r;
                    float sum = v00 + v01 + v10 + v11;
                    gl_FragColor = vec4(sum, 0.0, 0.0, 1.0);
                }
            `
        });

        this.copyMat = new THREE.ShaderMaterial({
            uniforms: { tex: { value: null } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D tex; varying vec2 vUv; void main() { gl_FragColor = texture2D(tex, vUv); }`
        });

        // 流体消散着色器
        this.dissipationMat = new THREE.ShaderMaterial({
            uniforms: {
                levelset: { value: null },
                age: { value: null },
                maxLifetime: { value: this.params.maxLifetime !== undefined ? this.params.maxLifetime : 10.0 },
                dt: { value: this.params.timeStep }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D levelset;
                uniform sampler2D age;
                uniform float maxLifetime;
                uniform float dt;
                varying vec2 vUv;
                void main() {
                    float phi = texture2D(levelset, vUv).r;
                    float currentAge = texture2D(age, vUv).r;

                    // 只有当 maxLifetime > 0 且水的年龄超过最大寿命时才消散
                    if (maxLifetime > 0.0 && phi < 0.0 && currentAge >= maxLifetime) {
                        phi = 1.0; // 设为空气，便于后续处理正确清除
                    }

                    gl_FragColor = vec4(phi, 0.0, 0.0, 1.0);
                }
            `
        });

        // 年龄更新着色器
        this.ageUpdateMat = new THREE.ShaderMaterial({
            uniforms: { 
                age: { value: null },
                levelset: { value: null },
                dt: { value: this.params.timeStep },
                injectionEnabled: { value: this.params.injectionEnabled ?? false },
                injectionPos: { value: new THREE.Vector2(this.params.injectionPosX ?? 0.5, this.params.injectionPosY ?? 0.5) },
                injectionSize: { value: this.params.injectionSize ?? 0.05 }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D age;
                uniform sampler2D levelset;
                uniform float dt;
                uniform bool injectionEnabled;
                uniform vec2 injectionPos;
                uniform float injectionSize;
                varying vec2 vUv;
                void main() {
                    float currentAge = texture2D(age, vUv).r;
                    float phi = texture2D(levelset, vUv).r;
                    
                    // 如果是注入区域，重置年龄为0
                    if (injectionEnabled) {
                        float dist = length(vUv - injectionPos);
                        if (dist < injectionSize && phi < 0.0) {
                            currentAge = 0.0;
                        }
                    }
                    
                    // 水粒子年龄增加
                    if (phi < 0.0) {
                        currentAge += dt;
                    } else {
                        currentAge = 0.0; // 空气区域年龄为0
                    }
                    
                    gl_FragColor = vec4(currentAge, 0.0, 0.0, 1.0);
                }
            `
        });

        // 年龄平流着色器（让年龄跟随水流移动）
        this.ageAdvectionMat = new THREE.ShaderMaterial({
            uniforms: { 
                age: { value: null },
                velocity: { value: null },
                levelset: { value: null },
                dt: { value: this.params.timeStep },
                resolution: { value: new THREE.Vector2(this.width, this.height) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D age;
                uniform sampler2D velocity;
                uniform sampler2D levelset;
                uniform float dt;
                uniform vec2 resolution;
                varying vec2 vUv;
                void main() {
                    float phi = texture2D(levelset, vUv).r;
                    
                    // 如果是空气，年龄为0
                    if (phi >= 0.0) {
                        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                        return;
                    }
                    
                    // 获取当前速度
                    vec2 vel = texture2D(velocity, vUv).rg;
                    
                    // 计算反向追踪位置（与速度平流保持一致：vel * dt / resolution）
                    vec2 step = vel * dt / resolution;
                    vec2 prevPos = vUv - step;
                    
                    // 边界检查：确保采样位置在纹理范围内
                    prevPos = clamp(prevPos, vec2(0.0), vec2(1.0));
                    
                    // 采样该位置的年龄（跟随水流移动）
                    float prevAge = texture2D(age, prevPos).r;
                    
                    gl_FragColor = vec4(prevAge, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // ==================== 纹理居中追踪着色器 ====================
    private initCenteringShaders(): void {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        
        // 平移 phi 的着色器（只操作 r 通道）
        this.centeringPhiMat = new THREE.ShaderMaterial({
            uniforms: {
                tex: { value: null },
                offset: { value: new THREE.Vector2(0, 0) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D tex;
                uniform vec2 offset;
                varying vec2 vUv;
                void main() {
                    // 采样时向反方向偏移，原来在 center 的内容就被移到了 uv+offset 处
                    vec2 sampleUV = vUv - offset;
                    float phi = texture2D(tex, sampleUV).r;
                    gl_FragColor = vec4(phi, 0.0, 0.0, 1.0);
                }
            `
        });

        // 平移 vel 的着色器（操作 rg 通道）
        this.centeringVelMat = new THREE.ShaderMaterial({
            uniforms: {
                tex: { value: null },
                offset: { value: new THREE.Vector2(0, 0) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D tex;
                uniform vec2 offset;
                varying vec2 vUv;
                void main() {
                    vec2 sampleUV = vUv - offset;
                    vec2 vel = texture2D(tex, sampleUV).rg;
                    gl_FragColor = vec4(vel, 0.0, 1.0);
                }
            `
        });
    }

    // ==================== 流体边界框中心计算 ====================
    private computeFluidBoundingBoxCenter(): THREE.Vector2 | null {
        // 读取当前 phi 纹理
        const pixels = new Float32Array(this.width * this.height * 4);
        this.renderer.readRenderTargetPixels(this.curPhiTex, 0, 0, this.width, this.height, pixels);

        let minX = this.width, maxX = -1, minY = this.height, maxY = -1;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const phi = pixels[(y * this.width + x) * 4]; // r 通道
                if (phi < 0) { // 水体区域
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX < 0) return null; // 没有水

        // 将像素坐标映射回 UV 坐标（0~1）
        const uCenter = ((minX + maxX) * 0.5 + 0.5) / this.width;
        const vCenter = ((minY + maxY) * 0.5 + 0.5) / this.height;
        return new THREE.Vector2(uCenter, vCenter);
    }

    // ==================== GPU质心计算（避免大数据回读）====================
    // 使用 GPU 归约计算水体质心，只回读 1x1 纹理（4个float），开销极小
    private computeFluidCentroidGPU(): THREE.Vector2 | null {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const eps = 1.0 / this.width;  // 用于平滑掩模

        // ---------- 阶段1：加权累加（基于水‑空气掩模，而非 abs(phi)）----------
        const weightedMat = new THREE.ShaderMaterial({
            uniforms: {
                phi: { value: this.curPhiTex.texture },
                eps: { value: eps }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D phi;
                uniform float eps;
                varying vec2 vUv;
                void main() {
                    float phiVal = texture2D(phi, vUv).r;
                    // 平滑水体掩模：phi < 0 时 weight → 1，过渡区平滑衰减
                    float weight = 1.0 - smoothstep(-eps, eps, phiVal);
                    gl_FragColor = vec4(weight * vUv.x, weight * vUv.y, weight, 1.0);
                }
            `
        });

        // 渲染到 reduceTexPool[0]（该纹理尺寸为 this.width × this.height）
        this.renderFullscreen(weightedMat, this.reduceTexPool[0]);
        weightedMat.dispose();

        // ---------- 阶段2：GPU 归约 ----------
        let currentWidth = this.width;
        let currentHeight = this.height;
        let reduceIdx = 0;

        // 修正后的归约着色器（本地创建，不修改全局 reduceMat，避免影响其他归约）
        const safeReduceMat = new THREE.ShaderMaterial({
            uniforms: { inputTex: { value: null }, srcRes: { value: new THREE.Vector2(currentWidth, currentHeight) } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D inputTex;
                uniform vec2 srcRes;            // 当前归约输入纹理的真实分辨率
                varying vec2 vUv;
                void main() {
                    vec2 d = vec2(1.0 / srcRes.x, 1.0 / srcRes.y);
                    // 钳制 UV，防止"采样到重复边界像素"
                    vec2 uv = min(vUv, vec2(1.0) - d);
                    float v00 = texture2D(inputTex, uv).r;
                    float v01 = texture2D(inputTex, uv + vec2(d.x, 0.0)).r;
                    float v10 = texture2D(inputTex, uv + vec2(0.0, d.y)).r;
                    float v11 = texture2D(inputTex, uv + d).r;
                    float sum = v00 + v01 + v10 + v11;
                    gl_FragColor = vec4(sum, 0.0, 0.0, 1.0);
                }
            `
        });

        while (currentWidth > 1 || currentHeight > 1) {
            const nextWidth = Math.max(1, Math.ceil(currentWidth / 2));
            const nextHeight = Math.max(1, Math.ceil(currentHeight / 2));
            const nextTexIdx = reduceIdx + 1;

            safeReduceMat.uniforms.inputTex.value = this.reduceTexPool[reduceIdx].texture;
            safeReduceMat.uniforms.srcRes.value = new THREE.Vector2(currentWidth, currentHeight);
            this.renderFullscreen(safeReduceMat, this.reduceTexPool[nextTexIdx]);

            currentWidth = nextWidth;
            currentHeight = nextHeight;
            reduceIdx = nextTexIdx;
        }
        safeReduceMat.dispose();

        // ---------- 阶段3：回读 1×1 纹理 ----------
        const pixelBuffer = new Float32Array(4);
        this.renderer.readRenderTargetPixels(this.reduceTexPool[reduceIdx], 0, 0, 1, 1, pixelBuffer);

        const sumPhiX = pixelBuffer[0];
        const sumPhiY = pixelBuffer[1];
        const sumPhi  = pixelBuffer[2];

        if (sumPhi < 0.0001) return null;      // 无水

        const uCenter = sumPhiX / sumPhi;
        const vCenter = sumPhiY / sumPhi;
        return new THREE.Vector2(uCenter, vCenter);
    }

    // ==================== PCG求解器相关着色器 ====================
    // SpMV着色器：计算 q = A * x（A是Poisson矩阵，负拉普拉斯算子）
    private spmvShader(): THREE.ShaderMaterial {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const res = new THREE.Vector2(this.width, this.height);
        return new THREE.ShaderMaterial({
            uniforms: { x: { value: null }, levelset: { value: null }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D x;
                uniform sampler2D levelset;
                uniform vec2 resolution;
                varying vec2 vUv;
                void main() {
                    vec2 uv = vUv;
                    float dx = 1.0 / resolution.x;
                    vec2 dxVec = vec2(dx, 0.0);
                    vec2 dyVec = vec2(0.0, dx);

                    float phi = texture2D(levelset, uv).r;
                    // 空气区域，直接输出0（不参与系统）
                    if (phi > 0.0) { gl_FragColor = vec4(0.0); return; }

                    float xC = texture2D(x, uv).r;
                    float xL = texture2D(x, uv - dxVec).r;
                    float xR = texture2D(x, uv + dxVec).r;
                    float xD = texture2D(x, uv - dyVec).r;
                    float xU = texture2D(x, uv + dyVec).r;

                    // Neumann边界：如果邻居是空气，用当前值代替
                    float phiL = texture2D(levelset, uv - dxVec).r;
                    float phiR = texture2D(levelset, uv + dxVec).r;
                    float phiD = texture2D(levelset, uv - dyVec).r;
                    float phiU = texture2D(levelset, uv + dyVec).r;
                    if (phiL > 0.0) xL = xC;
                    if (phiR > 0.0) xR = xC;
                    if (phiD > 0.0) xD = xC;
                    if (phiU > 0.0) xU = xC;

                    // 标准正拉普拉斯: ∇²x ≈ (xL + xR + xD + xU - 4*xC) / (dx*dx)
                // 用于求解 ∇²p = (ρ/Δt)·div，与Jacobi迭代保持一致
                float Ax = (xL + xR + xD + xU - 4.0 * xC) / (dx * dx);
                    gl_FragColor = vec4(Ax, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // 向量更新着色器：y = a * x + y
    private axpyShader(): THREE.ShaderMaterial {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        return new THREE.ShaderMaterial({
            uniforms: { x: { value: null }, y: { value: null }, a: { value: 0.0 } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D x;
                uniform sampler2D y;
                uniform float a;
                varying vec2 vUv;
                void main() {
                    float xVal = texture2D(x, vUv).r;
                    float yVal = texture2D(y, vUv).r;
                    gl_FragColor = vec4(a * xVal + yVal, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // 向量缩放着色器：y = a * x
    private scaleShader(): THREE.ShaderMaterial {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        return new THREE.ShaderMaterial({
            uniforms: { x: { value: null }, a: { value: 0.0 } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D x;
                uniform float a;
                varying vec2 vUv;
                void main() {
                    float xVal = texture2D(x, vUv).r;
                    gl_FragColor = vec4(a * xVal, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // 计算右侧项着色器：b = (density / dt) * div
    private computeBShader(): THREE.ShaderMaterial {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        return new THREE.ShaderMaterial({
            uniforms: { divergence: { value: null }, density: { value: this.params.density }, dt: { value: this.params.timeStep } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D divergence;
                uniform float density;
                uniform float dt;
                varying vec2 vUv;
                void main() {
                    float div = texture2D(divergence, vUv).r;
                    float b = (density / dt) * div;
                    gl_FragColor = vec4(b, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // Jacobi预条件着色器：z = M⁻¹ * r = r / diag(A)，diag(A) = 4/dx²
    private jacobiPreconditionShader(): THREE.ShaderMaterial {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const res = new THREE.Vector2(this.width, this.height);
        return new THREE.ShaderMaterial({
            uniforms: { r: { value: null }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D r;
                uniform vec2 resolution;
                varying vec2 vUv;
                void main() {
                    float dx = 1.0 / resolution.x;
                    float diag = 4.0 / (dx * dx);  // A的对角元
                    float rVal = texture2D(r, vUv).r;
                    float z = rVal / diag;  // z = M⁻¹r = r / diag(A)
                    gl_FragColor = vec4(z, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // 向量减法着色器：y = x - a * z
    private vecSubShader(): THREE.ShaderMaterial {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        return new THREE.ShaderMaterial({
            uniforms: { x: { value: null }, z: { value: null }, a: { value: 0.0 } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D x;
                uniform sampler2D z;
                uniform float a;
                varying vec2 vUv;
                void main() {
                    float xVal = texture2D(x, vUv).r;
                    float zVal = texture2D(z, vUv).r;
                    gl_FragColor = vec4(xVal - a * zVal, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // 向量相乘着色器：out = a * b（用于内积计算）
    private multiplyShader(): THREE.ShaderMaterial {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        return new THREE.ShaderMaterial({
            uniforms: { a: { value: null }, b: { value: null } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D a;
                uniform sampler2D b;
                varying vec2 vUv;
                void main() {
                    float aVal = texture2D(a, vUv).r;
                    float bVal = texture2D(b, vUv).r;
                    gl_FragColor = vec4(aVal * bVal, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // 归约着色器：2x2 区域求和（用于内积归约）
    private reduceShader(): THREE.ShaderMaterial {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const res = new THREE.Vector2(this.width, this.height);
        return new THREE.ShaderMaterial({
            uniforms: { inputTex: { value: null }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D inputTex;
                uniform vec2 resolution;
                varying vec2 vUv;
                void main() {
                    vec2 dx = vec2(1.0 / resolution.x, 0.0);
                    vec2 dy = vec2(0.0, 1.0 / resolution.y);
                    
                    // 读取2x2区域的四个像素
                    float v00 = texture2D(inputTex, vUv).r;
                    float v01 = texture2D(inputTex, vUv + dx).r;
                    float v10 = texture2D(inputTex, vUv + dy).r;
                    float v11 = texture2D(inputTex, vUv + dx + dy).r;
                    
                    // 求和
                    float sum = v00 + v01 + v10 + v11;
                    gl_FragColor = vec4(sum, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // 复制着色器
    private copyShader(): THREE.ShaderMaterial {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        return new THREE.ShaderMaterial({
            uniforms: { tex: { value: null } },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D tex;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = texture2D(tex, vUv);
                }
            `
        });
    }

    // 计算两个向量的内积：dot(a, b) = sum(a_i * b_i)
    // 使用GPU归约：先计算逐像素乘积，然后逐级2x2归约到1x1
    private computeDot(aTex: THREE.WebGLRenderTarget, bTex: THREE.WebGLRenderTarget): number {
        // 阶段1: 计算逐像素乘积 a * b（使用预分配的 multiplyMat）
        this.multiplyMat.uniforms.a.value = aTex.texture;
        this.multiplyMat.uniforms.b.value = bTex.texture;
        this.renderFullscreen(this.multiplyMat, this.reduceTexPool[0]);

        // 阶段2: 逐级归约（每次将分辨率减半，使用预分配的纹理池）
        let currentWidth = this.width;
        let currentHeight = this.height;
        let reduceIdx = 0;

        while (currentWidth > 1 || currentHeight > 1) {
            const nextWidth = Math.ceil(currentWidth / 2);
            const nextHeight = Math.ceil(currentHeight / 2);
            const nextTexIdx = reduceIdx + 1;

            this.reduceMat.uniforms.resolution.value = new THREE.Vector2(currentWidth, currentHeight);
            this.reduceMat.uniforms.inputTex.value = this.reduceTexPool[reduceIdx].texture;
            this.renderFullscreen(this.reduceMat, this.reduceTexPool[nextTexIdx]);

            currentWidth = nextWidth;
            currentHeight = nextHeight;
            reduceIdx = nextTexIdx;
        }

        // 阶段3: 读取最终的1x1纹理值
        const pixelBuffer = new Float32Array(4);
        this.renderer.readRenderTargetPixels(this.reduceTexPool[reduceIdx], 0, 0, 1, 1, pixelBuffer);
        return pixelBuffer[0];
    }

    // PCG求解器主方法（使用缓存材质，避免每帧创建）
    private solvePressurePCG(): void {
        const cgIter = this.params.pressureIterations;
        
        // 重置压力场为零，避免状态污染
        this.renderFullscreen(this.initPressureShader(), this.pressureTexA);
        this.renderFullscreen(this.initPressureShader(), this.pressureTexB);
        this.curPressureTex = this.pressureTexA;
        
        // 1. 计算右侧项 b = (density/dt) * divergence
        this.computeBMat.uniforms.divergence.value = this.divergenceTex.texture;
        this.renderFullscreen(this.computeBMat, this.bTex);

        // 2. 初始化：r = b, z = M⁻¹r, d = z
        // r = b
        this.copyMat.uniforms.tex.value = this.bTex.texture;
        this.renderFullscreen(this.copyMat, this.rTex);

        // z = M⁻¹r
        this.precondMat.uniforms.r.value = this.rTex.texture;
        this.renderFullscreen(this.precondMat, this.zTex);

        // d = z
        this.copyMat.uniforms.tex.value = this.zTex.texture;
        this.renderFullscreen(this.copyMat, this.dTex);

        // 计算初始 rz = dot(r, z)
        let rz = this.computeDot(this.rTex, this.zTex);

        for (let i = 0; i < cgIter; i++) {
            // 1. q = A * d
            this.spmvMat.uniforms.x.value = this.dTex.texture;
            this.spmvMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.renderFullscreen(this.spmvMat, this.qTex);

            // 2. alpha = rz / dot(d, q)
            let dq = this.computeDot(this.dTex, this.qTex);
            let alpha = rz / dq;

            // 3. p = p + alpha * d
            this.axpyMat.uniforms.x.value = this.dTex.texture;
            this.axpyMat.uniforms.y.value = this.curPressureTex.texture;
            this.axpyMat.uniforms.a.value = alpha;
            this.renderFullscreen(this.axpyMat, this.pressureTexA);
            this.curPressureTex = this.pressureTexA;

            // 4. r = r - alpha * q
            this.vecSubMat.uniforms.x.value = this.rTex.texture;
            this.vecSubMat.uniforms.z.value = this.qTex.texture;
            this.vecSubMat.uniforms.a.value = alpha;
            this.renderFullscreen(this.vecSubMat, this.rTex);

            // 5. z_new = M⁻¹ * r
            this.precondMat.uniforms.r.value = this.rTex.texture;
            this.renderFullscreen(this.precondMat, this.zTex);

            // 6. beta = dot(r, z) / rz_old
            let rz_new = this.computeDot(this.rTex, this.zTex);
            let beta = rz_new / rz;

            // 7. d = z + beta * d
            this.axpyMat.uniforms.x.value = this.dTex.texture;
            this.axpyMat.uniforms.y.value = this.zTex.texture;
            this.axpyMat.uniforms.a.value = beta;
            this.renderFullscreen(this.axpyMat, this.dTex);

            // 8. 更新 rz
            rz = rz_new;
        }
    }

    // ==================== 分层渲染材质初始化 ====================
    private initRenderMaterial(): void {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const res = new THREE.Vector2(this.width, this.height);

        this.renderMaterial = new THREE.ShaderMaterial({
            uniforms: {
                phiTex: { value: null },
                velTex: { value: null },
                resolution: { value: res },
                lightDir: { value: this.lightDir },
                waterColor: { value: this.waterColor },
                deepColor: { value: this.deepColor },
                edgeWidth: { value: this.edgeWidth },
                edgeIntensity: { value: this.edgeIntensity },
                specularIntensity: { value: this.specularIntensity },
                flowIntensity: { value: this.flowIntensity },
                // 尾部挖空参数（用于拖尾效果）
                trailEnabled: { value: false },
                trailUV: { value: new THREE.Vector2(0.5, 0.5) },
                trailRadius: { value: 0.1 }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D phiTex;
                uniform sampler2D velTex;
                uniform vec2 resolution;
                uniform vec3 lightDir;
                uniform vec3 waterColor;
                uniform vec3 deepColor;
                uniform float edgeWidth;
                uniform float edgeIntensity;
                uniform float specularIntensity;
                uniform float flowIntensity;
                // 尾部挖空 uniforms
                uniform bool trailEnabled;
                uniform vec2 trailUV;
                uniform float trailRadius;

                varying vec2 vUv;

                vec3 computeNormal(vec2 uv, float eps) {
                    float phi = texture2D(phiTex, uv).r;
                    float phi_r = texture2D(phiTex, uv + vec2(eps, 0.0)).r;
                    float phi_l = texture2D(phiTex, uv - vec2(eps, 0.0)).r;
                    float phi_t = texture2D(phiTex, uv + vec2(0.0, eps)).r;
                    float phi_b = texture2D(phiTex, uv - vec2(0.0, eps)).r;
                    vec3 grad = vec3(phi_r - phi_l, phi_t - phi_b, 0.0);
                    float len = length(grad);
                    if (len < 0.001) return vec3(0.0, 0.0, 1.0);
                    return normalize(grad);
                }

                void main() {
                    float phi = texture2D(phiTex, vUv).r;

                    // ========== 0. 尾部挖空效果（phi > 0 变成空气）==========
                    if (trailEnabled) {
                        float trailDist = distance(vUv, trailUV);
                        float trailMask = 1.0 - smoothstep(0.0, trailRadius, trailDist);
                        // 在尾部区域强制将 phi 设为正值（空气）
                        phi = mix(phi, 1.0, trailMask);
                    }

                    // phi >= 0 是空气或界面区域，显示为淡蓝色半透明
                    if (phi >= 0.0) {
                        gl_FragColor = vec4(0.6, 0.8, 1.0, 0.1);  // 淡蓝色半透明空气
                        return;
                    }

                    float eps = 1.0 / resolution.x;
                    vec3 normal = computeNormal(vUv, eps);
                    vec3 viewDir = vec3(0.0, 0.0, 1.0);
                    vec3 lightDirNorm = normalize(lightDir);

                    // ========== 1. 基础颜色层 ==========
                    float depth = clamp(-phi * 2.0, 0.0, 1.0);
                    vec3 baseColor = mix(waterColor, deepColor, depth);

                    // ========== 2. 漫反射光照层 ==========
                    float diff = max(0.1, dot(normal, lightDirNorm));
                    vec3 diffuse = baseColor * diff;

                    // ========== 3. 高光层（独立） ==========
                    vec3 halfDir = normalize(lightDirNorm + viewDir);
                    float spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
                    vec3 specular = vec3(1.0) * spec * specularIntensity;

                    // ========== 4. 边缘发光层（独立） ==========
                    float edge = 1.0 - smoothstep(0.0, edgeWidth, abs(phi));
                    vec3 glowColor = vec3(0.2, 0.6, 1.0);   // 淡蓝色
                    vec3 emissive = glowColor * edge * edgeIntensity;

                    // ========== 5. 流动扰动层（细节） ==========
                    vec2 vel = texture2D(velTex, vUv).rg;
                    float flow = length(vel) * 0.05;  // 降低速度敏感度，避免高速度时变白
                    vec3 flowColor = vec3(0.15, 0.25, 0.35) * flow * flowIntensity;

                    // ========== 最终合成（各层互不干扰） ==========
                    vec3 color = diffuse + specular + emissive + flowColor;

                    // 透明度（边缘稍透，中心不透明）
                    float alpha = clamp(0.6 - phi * 2.0, 0.2, 0.9);

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide
        });

        // ==================== 爆炸相关材质（预缓存）====================
        // 爆炸散度源着色器
        this.explosionDivMat = new THREE.ShaderMaterial({
            uniforms: {
                center: { value: new THREE.Vector2(0.5, 0.5) },
                radius: { value: 0.1 },
                strength: { value: 100.0 },
                envelope: { value: 1.0 },
                resolution: { value: res },
                noiseTex: { value: null },
                noiseOffset: { value: new THREE.Vector2(0.0, 0.0) },
                perturbationStrength: { value: 0.4 },
                usePerturbation: { value: 0.0 },
                anisotropyMode: { value: 0 },           // 0=各向同性, 1=四极子, 2=偶极子
                anisotropyPhase: { value: 0.0 },        // 相位偏移（弧度）
                anisotropyStrength: { value: 0.0 }      // 各向异性强度 (0~1)
            },
            vertexShader: vs,
            fragmentShader: `
                uniform vec2 center;
                uniform float radius;
                uniform float strength;
                uniform float envelope;
                uniform vec2 resolution;
                uniform sampler2D noiseTex;
                uniform vec2 noiseOffset;
                uniform float perturbationStrength;
                uniform float usePerturbation;
                uniform int anisotropyMode;
                uniform float anisotropyPhase;
                uniform float anisotropyStrength;
                varying vec2 vUv;

                void main() {
                    vec2 uv = vUv;
                    float dist = distance(uv, center);
                    float mask = 1.0 - smoothstep(0.0, radius, dist);
                    
                    // 应用噪声扰动（如果启用）
                    if (usePerturbation > 0.5) {
                        float perturb = texture2D(noiseTex, uv * 8.0 + noiseOffset).r;
                        perturb = (perturb - 0.5) * 2.0;  // 映射到 -1..1
                        float noiseMask = 1.0 + perturb * perturbationStrength;
                        mask *= noiseMask;
                        mask = clamp(mask, 0.0, 1.0);  // 防止负值或过冲
                    }
                    
                    // 应用各向异性调制
                    float dirMod = 1.0;
                    if (anisotropyStrength > 0.001) {
                        vec2 rel = uv - center;
                        float angle = atan(rel.y, rel.x) + anisotropyPhase;
                        
                        if (anisotropyMode == 1) {
                            // 四极子：cos(2*angle)，两个方向膨胀，两个方向收缩
                            dirMod = cos(2.0 * angle);
                        } else if (anisotropyMode == 2) {
                            // 偶极子：cos(angle)，一侧膨胀、对侧收缩
                            dirMod = cos(angle);
                        }
                        
                        // 限制收缩强度：收缩效果过强会显得不自然
                        // dirMod > 0: 膨胀区域，保持原值
                        // dirMod < 0: 收缩区域，减弱强度
                        float shrinkDamping = 0.3;  // 收缩阻尼，默认0.3使收缩弱于膨胀
                        dirMod = dirMod > 0.0 ? dirMod : dirMod * shrinkDamping;
                        
                        // 将各向异性混合进去
                        dirMod = mix(1.0, dirMod, anisotropyStrength);
                    }
                    
                    // 散度源: S = -strength * envelope * mask * dirMod（负散度产生向外膨胀效果）
                    float S = -strength * envelope * mask * dirMod;
                    gl_FragColor = vec4(S, 0.0, 0.0, 1.0);
                }
            `
        });

        // 水花生成着色器 - 只修改 phi
        this.waterGenMat = new THREE.ShaderMaterial({
            uniforms: {
                center: { value: new THREE.Vector2(0.5, 0.5) },
                radius: { value: 0.1 },
                envelope: { value: 1.0 },
                phiTex: { value: null },
                resolution: { value: res }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform vec2 center;
                uniform float radius;
                uniform float envelope;
                uniform sampler2D phiTex;
                uniform vec2 resolution;
                varying vec2 vUv;

                void main() {
                    vec2 uv = vUv;
                    float phi = texture2D(phiTex, uv).r;
                    float dist = distance(uv, center);
                    float mask = 1.0 - smoothstep(0.0, radius, dist);

                    // 只在空气区域生成水花（phi >= 0），不修改已有水体
                    if (mask > 0.0 && phi >= 0.0) {
                        // 在空气中生成新水
                        phi = -radius * mask * envelope * 2.0;
                    }

                    // 只输出 phi 到 R 通道
                    gl_FragColor = vec4(phi, 0.0, 0.0, 1.0);
                }
            `
        });

        // 水花速度初始化着色器 - 为新生成的水花赋予径向向外速度
        this.waterVelInitMat = new THREE.ShaderMaterial({
            uniforms: {
                center: { value: new THREE.Vector2(0.5, 0.5) },
                radius: { value: 0.1 },
                envelope: { value: 1.0 },
                phiTex: { value: null },
                velTex: { value: null },
                resolution: { value: res },
                noiseTex: { value: null },
                noiseOffset: { value: new THREE.Vector2(0.0, 0.0) },
                perturbationStrength: { value: 0.4 },
                usePerturbation: { value: 0.0 }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform vec2 center;
                uniform float radius;
                uniform float envelope;
                uniform sampler2D phiTex;
                uniform sampler2D velTex;
                uniform vec2 resolution;
                uniform sampler2D noiseTex;
                uniform vec2 noiseOffset;
                uniform float perturbationStrength;
                uniform float usePerturbation;
                varying vec2 vUv;

                void main() {
                    vec2 uv = vUv;
                    float phi = texture2D(phiTex, uv).r;
                    vec2 vel = texture2D(velTex, uv).rg;
                    float dist = distance(uv, center);
                    float mask = 1.0 - smoothstep(0.0, radius, dist);

                    // 只在新生成的水区域（phi < 0）赋予径向向外速度
                    if (mask > 0.0 && phi < 0.0) {
                        vec2 dir = normalize(uv - center);
                        float baseSpeed = 2.0 * mask * envelope * radius * resolution.x;
                        vel = dir * baseSpeed;
                        
                        // 添加切向速度扰动（如果启用）
                        if (usePerturbation > 0.5) {
                            vec2 tangent = vec2(dir.y, -dir.x);  // 垂直于径向
                            float tangentStrength = (texture2D(noiseTex, uv * 6.0 + noiseOffset).g - 0.5) * 2.0;
                            vel += tangent * tangentStrength * baseSpeed * 0.3;  // 切向强度约为径向的30%
                        }
                    }

                    // 速度上限限制，防止 CFL 条件失效
                    float maxVel = 200.0;
                    float currentSpeed = length(vel);
                    if (currentSpeed > maxVel) vel = vel * (maxVel / currentSpeed);

                    gl_FragColor = vec4(vel, 0.0, 1.0);
                }
            `
        });

        // 年龄重置着色器 - 重置新生成水花的年龄为0
        this.ageResetMat = new THREE.ShaderMaterial({
            uniforms: {
                center: { value: new THREE.Vector2(0.5, 0.5) },
                radius: { value: 0.1 },
                envelope: { value: 1.0 },
                phiTex: { value: null },
                ageTex: { value: null },
                resolution: { value: res }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform vec2 center;
                uniform float radius;
                uniform float envelope;
                uniform sampler2D phiTex;
                uniform sampler2D ageTex;
                uniform vec2 resolution;
                varying vec2 vUv;

                void main() {
                    vec2 uv = vUv;
                    float phi = texture2D(phiTex, uv).r;
                    float dist = distance(uv, center);
                    float mask = 1.0 - smoothstep(0.0, radius * 1.5, dist);

                    // 在爆炸范围内且是水体（phi < 0），重置年龄为0
                    // 使用扩大的半径确保所有新生成的水花都被覆盖
                    if (mask > 0.0 && phi < 0.0) {
                        // 新生成的水，年龄重置为0
                        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                        return;
                    }

                    // 其他区域保持原有年龄
                    gl_FragColor = texture2D(ageTex, uv);
                }
            `
        });

        // ==================== 注入/脉冲相关材质（预缓存，避免每帧创建）====================

        // 全局速度脉冲着色器
        this.velocityImpulseMat = new THREE.ShaderMaterial({
            uniforms: {
                curVel: { value: null },
                impulse: { value: new THREE.Vector2(0.0, 0.0) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D curVel;
                uniform vec2 impulse;
                varying vec2 vUv;
                void main() {
                    vec4 oldVel = texture2D(curVel, vUv);
                    vec2 newVel = oldVel.rg + impulse;
                    gl_FragColor = vec4(newVel, 0.0, 1.0);
                }
            `
        });

        // 局部速度脉冲着色器（带半径限制和速度上限）
        this.localVelocityImpulseMat = new THREE.ShaderMaterial({
            uniforms: {
                curVel: { value: null },
                impulse: { value: new THREE.Vector2(0.0, 0.0) },
                radius: { value: 0.2 },
                center: { value: new THREE.Vector2(0.5, 0.5) },
                maxSpeed: { value: 2.0 }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D curVel;
                uniform vec2 impulse;
                uniform float radius;
                uniform vec2 center;
                uniform float maxSpeed;
                varying vec2 vUv;
                void main() {
                    float d = distance(vUv, center);
                    float mask = 1.0 - smoothstep(0.0, radius, d);
                    vec4 oldVel = texture2D(curVel, vUv);
                    vec2 addedVel = impulse * mask;
                    
                    // 只对新增的速度分量应用速度限制，保留原始速度不变
                    float addedSpeed = length(addedVel);
                    if (addedSpeed > maxSpeed) {
                        addedVel = normalize(addedVel) * maxSpeed;
                    }
                    
                    vec2 newVel = oldVel.rg + addedVel;
                    gl_FragColor = vec4(newVel, 0.0, 1.0);
                }
            `
        });

        // 散度脉冲着色器
        this.divergenceImpulseMat = new THREE.ShaderMaterial({
            uniforms: {
                divergence: { value: 0.0 },
                radius: { value: 0.2 },
                center: { value: new THREE.Vector2(0.5, 0.5) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform float divergence;
                uniform float radius;
                uniform vec2 center;
                varying vec2 vUv;
                void main() {
                    float d = distance(vUv, center);
                    float mask = 1.0 - smoothstep(0.0, radius, d);
                    float S = divergence * mask;
                    gl_FragColor = vec4(S, 0.0, 0.0, 1.0);
                }
            `
        });

        // 水脉冲着色器（向 phi 场添加水）
        this.waterImpulseMat = new THREE.ShaderMaterial({
            uniforms: {
                amount: { value: 0.1 },
                radius: { value: 0.2 },
                center: { value: new THREE.Vector2(0.5, 0.5) },
                phiTex: { value: null }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform float amount;
                uniform float radius;
                uniform vec2 center;
                uniform sampler2D phiTex;
                varying vec2 vUv;
                void main() {
                    vec2 uv = vUv;
                    float phi = texture2D(phiTex, uv).r;
                    float dist = distance(uv, center);
                    float mask = 1.0 - smoothstep(0.0, radius, dist);
                    
                    // amount > 0: 添加水（phi 变小，让更多区域变为水）
                    // amount < 0: 移除水（phi 变大，让更多区域变为空气）
                    phi -= amount * mask;
                    
                    gl_FragColor = vec4(phi, 0.0, 0.0, 1.0);
                }
            `
        });
    }

    // ==================== 更新流程 ====================

    private updateAgeOnly(realDelta: number): void {
        if (!this.params.maxLifetime || this.params.maxLifetime <= 0) return;

        const ageAdvectionDst = this.curAgeTex === this.ageTexA ? this.ageTexB : this.ageTexA;
        this.ageAdvectionMat.uniforms.age.value = this.curAgeTex.texture;
        this.ageAdvectionMat.uniforms.velocity.value = this.curVelTex.texture;
        this.ageAdvectionMat.uniforms.levelset.value = this.curPhiTex.texture;
        this.ageAdvectionMat.uniforms.dt.value = this.params.timeStep;
        this.renderFullscreen(this.ageAdvectionMat, ageAdvectionDst);
        this.curAgeTex = ageAdvectionDst;

        const ageUpdateDst = this.curAgeTex === this.ageTexA ? this.ageTexB : this.ageTexA;
        this.ageUpdateMat.uniforms.age.value = this.curAgeTex.texture;
        this.ageUpdateMat.uniforms.levelset.value = this.curPhiTex.texture;
        this.ageUpdateMat.uniforms.injectionEnabled.value = false;
        this.ageUpdateMat.uniforms.dt.value = realDelta;
        this.renderFullscreen(this.ageUpdateMat, ageUpdateDst);
        this.curAgeTex = ageUpdateDst;
    }

    public update(_deltaTime?: number): void {
        if (!this.initialized) return;

        const realDelta = _deltaTime ?? this.params.timeStep;

        if (!this.updateVisibilityIfNeeded(performance.now() / 1000)) {
            if (this.params.maxLifetime && this.params.maxLifetime > 0) {
                this.updateAgeOnly(realDelta);
            }
            this.frameCount++;
            return;
        }

        // 辅助函数：更新注入相关的 uniform
        const updateInjectionUniforms = (mat: THREE.ShaderMaterial) => {
            if (mat.uniforms.injectionEnabled) mat.uniforms.injectionEnabled.value = this.params.injectionEnabled ?? false;
            if (mat.uniforms.injectionPos) {
                mat.uniforms.injectionPos.value.set(this.params.injectionPosX ?? 0.5, this.params.injectionPosY ?? 0.5);
            }
            if (mat.uniforms.injectionFlowRate) mat.uniforms.injectionFlowRate.value = this.params.injectionFlowRate ?? 1.0;
            if (mat.uniforms.injectionVel) {
                mat.uniforms.injectionVel.value.set(this.params.injectionVelX ?? 0.0, this.params.injectionVelY ?? 0.0);
            }
            if (mat.uniforms.injectionSize) mat.uniforms.injectionSize.value = this.params.injectionSize ?? 0.05;
        };

        // 更新注入参数（仅在参数可能变化时）
        updateInjectionUniforms(this.externalForcesMat);
        updateInjectionUniforms(this.levelSetAdvectionMat);

        // 1. 固体边界清理 #1（如果需要）
        if (this.solidMaskTex) {
            // 清理速度
            this.solidBoundaryClearVelMat.uniforms.velocity.value = this.curVelTex.texture;
            this.solidBoundaryClearVelMat.uniforms.solidMask.value = this.solidMaskTex;
            this.renderFullscreen(this.solidBoundaryClearVelMat, this.velAfterCollisionTex);
            this.curVelTex = this.velAfterCollisionTex;

            // 清理 phi - 使用双缓冲，避免读写同一纹理
            const phiClearDst1 = this.curPhiTex === this.phiTexA ? this.phiTexB : this.phiTexA;
            this.solidBoundaryClearPhiMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.solidBoundaryClearPhiMat.uniforms.solidMask.value = this.solidMaskTex;
            this.renderFullscreen(this.solidBoundaryClearPhiMat, phiClearDst1);
            this.curPhiTex = phiClearDst1;
        }

        // 2. 速度平流
        this.velocityAdvectionMat.uniforms.velocity.value = this.curVelTex.texture;
        this.renderFullscreen(this.velocityAdvectionMat, this.velTexB);
        this.curVelTex = this.velTexB;

        // 3. 外力计算
        this.externalForcesMat.uniforms.velocity.value = this.curVelTex.texture;
        this.externalForcesMat.uniforms.levelset.value = this.curPhiTex.texture;
        this.renderFullscreen(this.externalForcesMat, this.forcedVelTex);
        this.curVelTex = this.forcedVelTex;  // ★ 更新为包含重力的速度

        // 4. 墙碰撞处理
        let velForDiv = this.forcedVelTex.texture;
        if (this.solidMaskTex && this.solidNormalTex) {
            this.wallCollisionMat.uniforms.velocity.value = this.forcedVelTex.texture;
            this.wallCollisionMat.uniforms.solidMask.value = this.solidMaskTex;
            this.wallCollisionMat.uniforms.solidNormal.value = this.solidNormalTex;
            this.renderFullscreen(this.wallCollisionMat, this.velAfterCollisionTex);
            velForDiv = this.velAfterCollisionTex.texture;
        }

        // 4.5 构建爆炸散度源（散度源模型）
        const dt = this.params.timeStep;
        this.buildExplosionDivergence(dt);

        // ★ 如果爆炸修改了速度场，这里同步更新 velForDiv
        velForDiv = this.curVelTex.texture;

        // 5. 散度计算
        this.divergenceMat.uniforms.velocity.value = velForDiv;
        this.divergenceMat.uniforms.explosionDiv.value = this.explosionDivTex.texture;
        this.renderFullscreen(this.divergenceMat, this.divergenceTex);

        // 6. 压力求解
        if (this.params.usePCG ?? true) {
            // 使用PCG求解器
            this.solvePressurePCG();
        } else {
            // 使用Jacobi迭代 (双缓冲) - 只使用一个材质反复更新
            let pressureSrc = this.pressureTexA;
            let pressureDst = this.pressureTexB;
            for (let i = 0; i < this.params.pressureIterations; i++) {
                this.pressureJacobiMat.uniforms.pressure.value = pressureSrc.texture;
                this.pressureJacobiMat.uniforms.divergence.value = this.divergenceTex.texture;
                this.pressureJacobiMat.uniforms.levelset.value = this.curPhiTex.texture;
                this.pressureJacobiMat.uniforms.solidMask.value = this.solidMaskTex ?? this.dummySolidMaskTex;
                this.renderFullscreen(this.pressureJacobiMat, pressureDst);
                [pressureSrc, pressureDst] = [pressureDst, pressureSrc];
            }
            this.curPressureTex = pressureSrc;
        }

        // 7. 速度修正
        this.velocityCorrectMat.uniforms.velocity.value = velForDiv;
        this.velocityCorrectMat.uniforms.pressure.value = this.curPressureTex.texture;
        this.velocityCorrectMat.uniforms.levelset.value = this.curPhiTex.texture;
        this.renderFullscreen(this.velocityCorrectMat, this.velCorrectTex);
        this.curVelTex = this.velCorrectTex;

        // 8. Level Set 平流（双缓冲）
        const phiAdvectDst = this.curPhiTex === this.phiTexA ? this.phiTexB : this.phiTexA;
        this.levelSetAdvectionMat.uniforms.velocity.value = this.curVelTex.texture;
        this.levelSetAdvectionMat.uniforms.forcedVel.value = this.forcedVelTex.texture;
        this.levelSetAdvectionMat.uniforms.levelset.value = this.curPhiTex.texture;
        this.renderFullscreen(this.levelSetAdvectionMat, phiAdvectDst);
        this.curPhiTex = phiAdvectDst;

        // 8.5. 流体年龄更新（包含平流）
        if (this.params.maxLifetime && this.params.maxLifetime > 0) {
            // 使用真实时间增量更新年龄（_deltaTime 可能是真实时间，也可能是默认的 timeStep）
            const realDelta = _deltaTime ?? this.params.timeStep;

            // 步骤1: 年龄平流 - 让年龄跟随水流移动
            const ageAdvectionDst = this.curAgeTex === this.ageTexA ? this.ageTexB : this.ageTexA;
            this.ageAdvectionMat.uniforms.age.value = this.curAgeTex.texture;
            this.ageAdvectionMat.uniforms.velocity.value = this.curVelTex.texture;
            this.ageAdvectionMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.ageAdvectionMat.uniforms.dt.value = this.params.timeStep;  // 物理步长用于平流
            this.renderFullscreen(this.ageAdvectionMat, ageAdvectionDst);
            this.curAgeTex = ageAdvectionDst;

            // 步骤2: 年龄更新 - 增加年龄（使用真实时间）+ 注入区域重置
            const ageUpdateDst = this.curAgeTex === this.ageTexA ? this.ageTexB : this.ageTexA;
            this.ageUpdateMat.uniforms.age.value = this.curAgeTex.texture;
            this.ageUpdateMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.ageUpdateMat.uniforms.injectionEnabled.value = this.params.injectionEnabled ?? false;
            this.ageUpdateMat.uniforms.injectionPos.value.set(
                this.params.injectionPosX ?? 0.5,
                this.params.injectionPosY ?? 0.5
            );
            this.ageUpdateMat.uniforms.injectionSize.value = this.params.injectionSize ?? 0.05;
            this.ageUpdateMat.uniforms.dt.value = realDelta;  // 使用真实时间增量
            this.renderFullscreen(this.ageUpdateMat, ageUpdateDst);
            this.curAgeTex = ageUpdateDst;

            // 步骤3: 流体消散（基于年龄）
            // 使用双缓冲避免读写冲突
            const dissipationDst = this.curPhiTex === this.phiTexA ? this.phiTexB : this.phiTexA;
            this.dissipationMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.dissipationMat.uniforms.age.value = this.curAgeTex.texture;
            this.renderFullscreen(this.dissipationMat, dissipationDst);
            this.curPhiTex = dissipationDst;

            // 检测消散的水体并输出日志（每60帧检测一次，仅调试模式）
            if (this.waterDebugEnabled && this.frameCount % 60 === 0) {
                this.detectDissipatedWater(dissipationDst);
            }
        }

        // 9. Level Set 重初始化（双缓冲交替）
        // 根据 reinitInterval 参数决定是否执行重初始化
        const reinitInterval = this.params.reinitInterval ?? 1;
        let phiSrc = this.curPhiTex;
        let phiDst = phiSrc === this.phiTexA ? this.phiTexB : this.phiTexA;
        
        if (this.frameCount % reinitInterval === 0) {
            // 仅在间隔帧执行重初始化，性能优化策略
            for (let i = 0; i < this.params.reinitIterations; i++) {
                this.levelSetReinitMat.uniforms.levelset.value = phiSrc.texture;
                this.renderFullscreen(this.levelSetReinitMat, phiDst);
                [phiSrc, phiDst] = [phiDst, phiSrc];  // 交换
            }
        }
        this.curPhiTex = phiSrc;

        // 10. 固体边界清理 #2
        if (this.solidMaskTex) {
            // 清理速度
            this.solidBoundaryClearVelMat.uniforms.velocity.value = this.curVelTex.texture;
            this.solidBoundaryClearVelMat.uniforms.solidMask.value = this.solidMaskTex;
            this.renderFullscreen(this.solidBoundaryClearVelMat, this.velAfterCollisionTex);
            this.curVelTex = this.velAfterCollisionTex;

            // 清理 phi - 使用双缓冲，避免读写同一纹理
            const phiClearDst1 = this.curPhiTex === this.phiTexA ? this.phiTexB : this.phiTexA;
            this.solidBoundaryClearPhiMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.solidBoundaryClearPhiMat.uniforms.solidMask.value = this.solidMaskTex;
            this.renderFullscreen(this.solidBoundaryClearPhiMat, phiClearDst1);
            this.curPhiTex = phiClearDst1;
        }

        // ========== 调试录制 ==========
        if (this.debugRecordingEnabled && this.frameCount >= this.debugStartFrame && this.debugCurrentFrame < this.debugFramesToRecord) {
            this.captureCurrentState();
            this.debugCurrentFrame++;
            if (this.debugCurrentFrame >= this.debugFramesToRecord) {
                this.debugRecordingEnabled = false;
                this.downloadDebugData();
            }
        }

        // ========== 纹理居中追踪（带节流，每 centeringInterval 秒执行一次）==========
        if (this.centeringEnabled) {
            const now = performance.now() / 1000;  // 转换为秒
            if (now - this.lastCenteringTime >= this.centeringInterval) {
                this.lastCenteringTime = now;
                // 使用包围盒中心计算（稳定可靠）
                const currentCenter = this.computeFluidBoundingBoxCenter();
                if (currentCenter) {
                    const targetCenter = new THREE.Vector2(0.5, 0.5);
                    const rawOffset = new THREE.Vector2().subVectors(targetCenter, currentCenter);
                    // 一阶低通平滑，避免突然跳动（系数可调，0.2~0.5）
                    this.smoothedOffset.lerp(rawOffset, 0.3);

                    // 只应用足够大的偏移，避免噪声（可根据分辨率调整阈值）
                    if (this.smoothedOffset.length() > 0.001) {
                        // 平移 phi 场
                        this.centeringPhiMat.uniforms.tex.value = this.curPhiTex.texture;
                        this.centeringPhiMat.uniforms.offset.value = this.smoothedOffset;
                        const phiDst = this.curPhiTex === this.phiTexA ? this.phiTexB : this.phiTexA;
                        this.renderFullscreen(this.centeringPhiMat, phiDst);
                        this.curPhiTex = phiDst;

                        // 平移 vel 场
                        this.centeringVelMat.uniforms.tex.value = this.curVelTex.texture;
                        this.centeringVelMat.uniforms.offset.value = this.smoothedOffset;
                        const velDst = this.curVelTex === this.velTexA ? this.velTexB : this.velTexA;
                        this.renderFullscreen(this.centeringVelMat, velDst);
                        this.curVelTex = velDst;

                        // 同步平移年龄场
                        const ageDst = this.curAgeTex === this.ageTexA ? this.ageTexB : this.ageTexA;
                        this.centeringPhiMat.uniforms.tex.value = this.curAgeTex.texture;
                        this.renderFullscreen(this.centeringPhiMat, ageDst);
                        this.curAgeTex = ageDst;
                    }
                }
            }
        }

        // 帧计数递增
        this.frameCount++;

        // ========== 每帧结束时清空爆炸散度纹理（为下一帧准备） ==========
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const clearMat = new THREE.ShaderMaterial({
            vertexShader: vs,
            fragmentShader: `void main() { gl_FragColor = vec4(0.0); }`
        });
        this.renderFullscreen(clearMat, this.explosionDivTex, true);
        clearMat.dispose();

        // ★ 关键：每帧更新渲染材质的纹理引用，确保画面正确刷新
        this.updateRenderUniforms();
    }

    // ==================== 水量检测接口 ====================
    public getWaterAmount(): { totalWaterCount: number; dissipatedCount: number } {
        const pixels = this.readTextureData(this.curPhiTex);
        let dissipatedCount = 0;
        let totalWaterCount = 0;

        for (let i = 0; i < pixels.length; i += 4) {
            const phi = pixels[i];
            if (phi < 0) {
                totalWaterCount++;
                if (phi === 0.05) {
                    dissipatedCount++;
                }
            }
        }

        return { totalWaterCount, dissipatedCount };
    }

    public enableWaterDebug(enabled: boolean): void {
        this.waterDebugEnabled = enabled;
    }

    private waterDebugEnabled: boolean = false;

    private detectDissipatedWater(renderTarget: THREE.WebGLRenderTarget): void {
        // ★ 性能优化：仅在调试模式启用时才执行GPU回读
        if (!this.waterDebugEnabled) return;

        const { totalWaterCount, dissipatedCount } = this.getWaterAmount();
        console.log(`[水量监测] 帧${this.frameCount}: 水体总数=${totalWaterCount}, 消散数=${dissipatedCount}, maxLifetime=${this.params.maxLifetime}s`);
    }

    // ==================== 调试录制接口 ====================
    public enableDebugRecording(enable: boolean, framesToRecord: number = 20, startFrame: number = 0): void {
        this.debugRecordingEnabled = enable;
        if (enable) {
            this.debugFramesToRecord = framesToRecord;
            this.debugStartFrame = startFrame;
            this.debugCurrentFrame = 0;
            this.debugRecordedData = [];
            if (startFrame === 0) {
                this.captureCurrentState();
                this.debugCurrentFrame++;
            }
            console.log(`[FluidSimulator] 调试录制已启用，将记录第 ${startFrame} 到 ${startFrame + framesToRecord} 帧`);
        } else {
            console.log('[FluidSimulator] 调试录制已禁用');
        }
    }

    public exportDebugData(): void {
        if (this.debugRecordedData.length === 0) {
            console.warn('[FluidSimulator] 没有录制数据可导出');
            return;
        }
        this.downloadDebugData();
    }

    private readTextureData(renderTarget: THREE.WebGLRenderTarget): Float32Array {
        const pixelBuffer = new Float32Array(this.width * this.height * 4);
        // 使用 Three.js 内置方法，已处理 WebGL1/WebGL2 兼容性
        this.renderer.readRenderTargetPixels(renderTarget, 0, 0, this.width, this.height, pixelBuffer);
        return pixelBuffer;
    }

    private textureTo2DArray(pixelBuffer: Float32Array, channel: 'r' | 'g' | 'b' | 'a'): number[][] {
        const idxMap = { r: 0, g: 1, b: 2, a: 3 };
        const channelIdx = idxMap[channel];
        const sampleStep = 4; // 每隔4个像素取一个样本
        const data2D: number[][] = [];
        for (let y = 0; y < this.height; y += sampleStep) {
            const row: number[] = [];
            for (let x = 0; x < this.width; x += sampleStep) {
                const i = (y * this.width + x) * 4 + channelIdx;
                row.push(parseFloat(pixelBuffer[i].toFixed(4))); // 保留4位小数
            }
            data2D.push(row);
        }
        return data2D;
    }

    private captureCurrentState(): void {
        const phiPixels = this.readTextureData(this.curPhiTex);
        const phiData = this.textureTo2DArray(phiPixels, 'r');

        const velPixels = this.readTextureData(this.curVelTex);
        const velXData = this.textureTo2DArray(velPixels, 'r');
        const velYData = this.textureTo2DArray(velPixels, 'g');

        this.debugRecordedData.push({
            frame: this.debugCurrentFrame,
            phi: phiData,
            velX: velXData,
            velY: velYData,
        });
    }

    private downloadDebugData(): void {
        const output = {
            resolution: { width: this.width, height: this.height },
            frames: this.debugRecordedData,
            params: {
                density: this.params.density,
                viscosity: this.params.viscosity,
                surfaceTension: this.params.surfaceTension,
                gravity: this.params.gravity,
                pressureIterations: this.params.pressureIterations,
                reinitIterations: this.params.reinitIterations,
                timeStep: this.params.timeStep,
            }
        };
        
        try {
            const jsonStr = JSON.stringify(output, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `fluid_debug_${Date.now()}.json`;
            a.style.display = 'none';
            
            document.body.appendChild(a);
            
            // 处理浏览器安全限制
            const event = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            a.dispatchEvent(event);
            
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            
            console.log(`[FluidSimulator] 调试数据已导出，共 ${this.debugRecordedData.length} 帧`);
        } catch (error) {
            console.error('[FluidSimulator] 导出调试数据失败:', error);
            // 降级到控制台输出
            console.log('[FluidSimulator] 调试数据（控制台输出）:', output);
        }
    }

    // ==================== 公共接口 ====================
    public getLevelSetTexture(): THREE.Texture {
        return this.curPhiTex.texture;
    }

    public getVelocityTexture(): THREE.Texture {
        return this.curVelTex.texture;
    }

    public setSolidMaskTexture(texture: THREE.Texture | null): void {
        this.solidMaskTex = texture;
        if (texture && !this.solidNormalTex) {
            const w = this.width, h = this.height;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(texture.image as HTMLImageElement, 0, 0, w, h);
            const imgData = ctx.getImageData(0, 0, w, h);
            const data = new Float32Array(w * h * 4);
            const getSolid = (x: number, y: number) => {
                if (x < 0 || x >= w || y < 0 || y >= h) return 0;
                const idx = (y * w + x) * 4;
                return imgData.data[idx] > 128 ? 1 : 0;
            };
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const solid_r = getSolid(x+1, y);
                    const solid_l = getSolid(x-1, y);
                    const solid_t = getSolid(x, y+1);
                    const solid_b = getSolid(x, y-1);
                    let nx = solid_r - solid_l;
                    let ny = solid_t - solid_b;
                    const len = Math.hypot(nx, ny);
                    if (len > 0.001) { nx /= len; ny /= len; }
                    const idx = (y * w + x) * 4;
                    data[idx] = nx; data[idx+1] = ny; data[idx+2] = 0; data[idx+3] = 1;
                }
            }
            const normalTex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
            normalTex.needsUpdate = true;
            this.solidNormalTex = normalTex;
        }
    }

    public setLevelSetTexture(texture: THREE.Texture): void {
        this.copyTextureToTarget(texture, this.phiTexA);
        this.copyTextureToTarget(texture, this.phiTexB);
        this.curPhiTex = this.phiTexA;
    }

    public setInitialVelocity(vx: number, vy: number): void {
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                vel: { value: new THREE.Vector2(vx, vy) },
                center: { value: new THREE.Vector2(0.5, 0.5) },
                radius: { value: 0.6 }
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform vec2 vel;
                uniform vec2 center;
                uniform float radius;
                varying vec2 vUv;
                void main() {
                    float d = distance(vUv, center);
                    float inside = 1.0 - smoothstep(radius * 0.6, radius, d);
                    gl_FragColor = vec4(vel * inside, 0.0, 1.0);
                }
            `
        });
        this.renderFullscreen(mat, this.velTexA);
        this.renderFullscreen(mat, this.velTexB);
        mat.dispose();
        this.curVelTex = this.velTexA;
    }

    /**
     * 直接注入散度到流体场中（各向同性版本）
     * @param divergence 散度值（负值=向外膨胀，正值=向内收缩）
     * @param radius 影响半径（UV空间，0~1）
     * @param cx 中心X（UV空间）
     * @param cy 中心Y（UV空间）
     */
    public addDivergenceImpulse(divergence: number, radius: number = 0.2, cx: number = 0.5, cy: number = 0.5): void {
        // 使用预创建的材质，更新 uniform 值
        this.divergenceImpulseMat.uniforms.divergence.value = divergence;
        this.divergenceImpulseMat.uniforms.radius.value = radius;
        this.divergenceImpulseMat.uniforms.center.value.set(cx, cy);
        
        this.renderFullscreen(this.divergenceImpulseMat, this.explosionDivTex, false);
    }

    /**
     * 生成水函数：向 phi 场添加水
     * @param amount 生成水量（负值会减少水）
     * @param radius 影响半径（UV空间，0~1）
     * @param cx 中心X（UV空间）
     * @param cy 中心Y（UV空间）
     */
    public addWaterImpulse(
        amount: number, 
        radius: number = 0.2, 
        cx: number = 0.5, 
        cy: number = 0.5
    ): void {
        // 使用预创建的材质，更新 uniform 值
        this.waterImpulseMat.uniforms.phiTex.value = this.curPhiTex.texture;
        this.waterImpulseMat.uniforms.amount.value = amount;
        this.waterImpulseMat.uniforms.radius.value = radius;
        this.waterImpulseMat.uniforms.center.value.set(cx, cy);
        
        // 渲染到 phi 双缓冲
        const targetTex = this.curPhiTex === this.phiTexA ? this.phiTexB : this.phiTexA;
        this.renderFullscreen(this.waterImpulseMat, targetTex, false);
        
        // 交换 phi 缓冲区
        this.curPhiTex = targetTex;
    }

    /**
     * 正散度收缩函数：S = strength * envelope * mask
     * 用于让流体向内收缩
     */
    public addShrinkDivergenceImpulse(
        strength: number, 
        radius: number = 0.2, 
        cx: number = 0.5, 
        cy: number = 0.5
    ): void {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const divMat = new THREE.ShaderMaterial({
            uniforms: {
                strength: { value: strength },
                radius: { value: radius },
                center: { value: new THREE.Vector2(cx, cy) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform float strength;
                uniform float radius;
                uniform vec2 center;
                varying vec2 vUv;
                void main() {
                    float d = distance(vUv, center);
                    float mask = 1.0 - smoothstep(0.0, radius, d);
                    float S = strength * mask;
                    gl_FragColor = vec4(S, 0.0, 0.0, 1.0);
                }
            `
        });
        
        this.renderFullscreen(divMat, this.explosionDivTex, false);
        divMat.dispose();
    }

    /**
     * 负散度膨胀函数：S = -strength * envelope * mask
     * 用于让流体向外膨胀
     */
    public addExpandDivergenceImpulse(
        strength: number, 
        radius: number = 0.2, 
        cx: number = 0.5, 
        cy: number = 0.5
    ): void {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const divMat = new THREE.ShaderMaterial({
            uniforms: {
                strength: { value: strength },
                radius: { value: radius },
                center: { value: new THREE.Vector2(cx, cy) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform float strength;
                uniform float radius;
                uniform vec2 center;
                varying vec2 vUv;
                void main() {
                    float d = distance(vUv, center);
                    float mask = 1.0 - smoothstep(0.0, radius, d);
                    float S = -strength * mask;
                    gl_FragColor = vec4(S, 0.0, 0.0, 1.0);
                }
            `
        });
        
        this.renderFullscreen(divMat, this.explosionDivTex, false);
        divMat.dispose();
    }

    /**
     * 各向异性散度注入（随机方向膨胀/收缩）
     * @param divergence 散度幅度（负值=膨胀，正值=收缩）
     * @param radius 影响半径（UV空间，0~1）
     * @param cx 中心X（UV空间）
     * @param cy 中心Y（UV空间）
     * @param directionAngle 扩张主方向（弧度，0=右，PI/2=上）
     * @param anisotropy 各向异性强度（0=各向同性，1=完全各向异性）
     */
    public addAnisotropicDivergenceImpulse(
        divergence: number, 
        radius: number = 0.2, 
        cx: number = 0.5, 
        cy: number = 0.5,
        directionAngle: number = 0,
        anisotropy: number = 0.8
    ): void {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const divMat = new THREE.ShaderMaterial({
            uniforms: {
                divergence: { value: divergence },
                radius: { value: radius },
                center: { value: new THREE.Vector2(cx, cy) },
                dirAngle: { value: directionAngle },
                anisoStrength: { value: anisotropy }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform float divergence;
                uniform float radius;
                uniform vec2 center;
                uniform float dirAngle;
                uniform float anisoStrength;
                varying vec2 vUv;
                
                void main() {
                    float d = distance(vUv, center);
                    float mask = 1.0 - smoothstep(0.0, radius, d);
                    
                    // 计算当前像素相对于中心的方向角
                    vec2 rel = vUv - center;
                    float angle = atan(rel.y, rel.x);
                    
                    // 计算与主方向的夹角
                    float diff = angle - dirAngle;
                    
                    // 使用余弦调制实现各向异性
                    // dirMod 在主方向上为 1，在垂直方向上为负值（反向收缩）
                    float dirMod = cos(diff);
                    
                    // 混合各向同性和各向异性
                    // anisoStrength=0: 完全各向同性，所有方向一致
                    // anisoStrength=1: 完全各向异性，对面方向收缩
                    float finalMod = mix(1.0, dirMod, anisoStrength);
                    
                    float S = divergence * mask * finalMod;
                    gl_FragColor = vec4(S, 0.0, 0.0, 1.0);
                }
            `
        });
        
        this.renderFullscreen(divMat, this.explosionDivTex, false);
        divMat.dispose();
    }

    public addVelocityImpulse(dvx: number, dvy: number): void {
        // 使用预创建的材质，更新 uniform 值
        this.velocityImpulseMat.uniforms.curVel.value = this.curVelTex.texture;
        this.velocityImpulseMat.uniforms.impulse.value.set(dvx, dvy);
        
        const velDst = this.curVelTex === this.velTexA ? this.velTexB : this.velTexA;
        this.renderFullscreen(this.velocityImpulseMat, velDst);
        this.curVelTex = velDst;
    }

    public addLocalVelocityImpulse(dvx: number, dvy: number, radius: number = 0.2, cx: number = 0.5, cy: number = 0.5, maxSpeed: number = 2.0): void {
        // 使用预创建的材质，更新 uniform 值
        this.localVelocityImpulseMat.uniforms.curVel.value = this.curVelTex.texture;
        this.localVelocityImpulseMat.uniforms.impulse.value.set(dvx, dvy);
        this.localVelocityImpulseMat.uniforms.radius.value = radius;
        this.localVelocityImpulseMat.uniforms.center.value.set(cx, cy);
        this.localVelocityImpulseMat.uniforms.maxSpeed.value = maxSpeed;
        
        const velDst = this.curVelTex === this.velTexA ? this.velTexB : this.velTexA;
        this.renderFullscreen(this.localVelocityImpulseMat, velDst);
        this.curVelTex = velDst;
    }

    public setInjectionEnabled(enabled: boolean): void {
        this.params.injectionEnabled = enabled;
    }

    public setInjectionPosition(x: number, y: number): void {
        this.params.injectionPosX = x;
        this.params.injectionPosY = y;
    }

    public setInjectionFlowRate(rate: number): void {
        this.params.injectionFlowRate = rate;
    }

    public setInjectionVelocity(x: number, y: number): void {
        this.params.injectionVelX = x;
        this.params.injectionVelY = y;
    }

    public setInjectionSize(size: number): void {
        this.params.injectionSize = size;
    }

    public configureInjection(config: {
        enabled?: boolean;
        posX?: number;
        posY?: number;
        flowRate?: number;
        velX?: number;
        velY?: number;
        size?: number;
    }): void {
        if (config.enabled !== undefined) this.params.injectionEnabled = config.enabled;
        if (config.posX !== undefined) this.params.injectionPosX = config.posX;
        if (config.posY !== undefined) this.params.injectionPosY = config.posY;
        if (config.flowRate !== undefined) this.params.injectionFlowRate = config.flowRate;
        if (config.velX !== undefined) this.params.injectionVelX = config.velX;
        if (config.velY !== undefined) this.params.injectionVelY = config.velY;
        if (config.size !== undefined) this.params.injectionSize = config.size;
    }

    // ==================== 爆炸系统接口 ====================
    /**
     * 在流体中产生爆炸效果
     * @param cx 爆炸中心X坐标（UV空间，0~1）
     * @param cy 爆炸中心Y坐标（UV空间，0~1）
     * @param radius 爆炸半径（UV空间）
     * @param strength 散度源强度（推荐5000~10000）
     * @param createWater 是否生成新水（true=生成水花，false=仅注入散度）
     * @param duration 爆炸持续时间（秒），默认0.1
     */
    public explode(cx: number, cy: number, radius: number, strength: number, 
                  createWater: boolean = true, duration: number = 0.1,
                  anisotropyMode: number = 0, anisotropyPhase: number = 0.0, anisotropyStrength: number = 0.0): void {
        const durationFrames = Math.ceil(duration / this.params.timeStep);
        this.activeExplosions.push({
            cx,
            cy,
            radius,
            strength,
            createWater,
            waterGenerated: false,  // 初始为未生成状态
            startFrame: this.frameCount,
            durationFrames,
            noiseOffsetX: Math.random() * 10.0,
            noiseOffsetY: Math.random() * 10.0,
            anisotropyMode,
            anisotropyPhase,
            anisotropyStrength
        });
    }

    /**
     * 各向异性爆炸 - 支持方向性爆炸效果
     * @param cx 爆炸中心X坐标（UV空间，0~1）
     * @param cy 爆炸中心Y坐标（UV空间，0~1）
     * @param radius 爆炸半径（UV空间）
     * @param strength 散度源强度
     * @param createWater 是否生成新水
     * @param duration 爆炸持续时间（秒）
     * @param mode 各向异性模式：0=各向同性, 1=四极子, 2=偶极子
     * @param phase 相位偏移（弧度）
     * @param anisoStrength 各向异性强度 (0~1)
     */
    public explodeAnisotropic(
        cx: number, cy: number, radius: number, strength: number,
        createWater: boolean = true, duration: number = 0.1,
        mode: number = 0, phase: number = 0, anisoStrength: number = 0.0
    ): void {
        this.explode(cx, cy, radius, strength, createWater, duration, mode, phase, anisoStrength);
    }

    /**
     * 多团块爆炸 - 将一次爆炸分裂成多个子团块
     * @param cx 爆炸中心X坐标（UV空间，0~1）
     * @param cy 爆炸中心Y坐标（UV空间，0~1）
     * @param radius 爆炸半径（UV空间）
     * @param strength 总散度源强度
     * @param createWater 是否生成新水
     * @param duration 爆炸持续时间（秒）
     * @param fragmentCount 子团块数量，默认4
     * @param seed 随机种子（可选，用于确定性重放）
     */
    public explodeFragmented(cx: number, cy: number, radius: number, strength: number, 
                            createWater: boolean = true, duration: number = 0.1, 
                            fragmentCount?: number, seed?: number, waterMultiplier: number = 1): void {
        const count = fragmentCount ?? this.fragmentCount;
        const rand = seed !== undefined ? this.seededRandom(seed) : Math.random.bind(Math);
        
        for (let i = 0; i < count; i++) {
            const angle = rand() * Math.PI * 2;
            const offsetR = radius * 0.3 * rand();
            const fx = cx + Math.cos(angle) * offsetR;
            const fy = cy + Math.sin(angle) * offsetR;
            const fr = radius * (0.6 + rand() * 0.4);
            // 首次爆炸(createWater=true)保持正强度（外扩），后续爆炸全部负强度（收缩）
            const sign = createWater ? 1 : -1;
            const fs = sign * strength / count * (0.8 + rand() * 0.4);
            // console.log(`[Explosion] i=${i}, createWater=${createWater}, sign=${sign}, fs=${fs.toFixed(2)}, strength=${strength}, count=${count}`);
            this.explode(fx, fy, fr, fs, createWater, duration);
        }
        
        // 如果需要增加水量，额外生成水花
        if (createWater && waterMultiplier > 1) {
            const extraWaterCount = Math.floor(count * (waterMultiplier - 1));
            for (let i = 0; i < extraWaterCount; i++) {
                const angle = rand() * Math.PI * 2;
                const offsetR = radius * (0.5 + rand() * 0.5);  // 更外围的水花
                const fx = cx + Math.cos(angle) * offsetR;
                const fy = cy + Math.sin(angle) * offsetR;
                const fr = radius * (0.3 + rand() * 0.3);  // 更小的水花
                const fs = strength / count * (0.5 + rand() * 0.5);
                this.explode(fx, fy, fr, fs, true, duration * 0.5);  // 更短的持续时间
            }
        }
    }

    /**
     * 基于种子的确定性伪随机函数
     */
    private seededRandom(seed: number): () => number {
        let s = seed;
        return () => {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
        };
    }

    /**
     * 生成噪声纹理（双通道解耦设计）
     * R通道：基础扰动（多八度叠加）
     * G通道：方向扰动（独立哈希函数）
     */
    private generateNoiseTexture(size: number = 64): THREE.DataTexture {
        const data = new Float32Array(size * size * 4);
        // 基础哈希函数（用于强度扰动）
        const hash1 = (x: number, y: number) => {
            let h = x * 374761393 + y * 668265263;
            h = (h ^ (h >> 13)) * 1274126177;
            return (h ^ (h >> 16)) / 2147483648;
        };
        // 独立哈希函数（用于方向扰动，与hash1解耦）
        const hash2 = (x: number, y: number) => {
            let h = x * 131071 + y * 524287;
            h = (h ^ (h >> 15)) * 786433;
            return (h ^ (h >> 13)) / 2147483648;
        };
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                // R通道：多八度叠加的基础扰动
                let val = 0.0;
                for (let oct = 1; oct <= 4; oct++) {
                    const freq = 1 << oct;
                    val += 0.5 / oct * hash1(x * freq % size, y * freq % size);
                }
                data[idx] = val;     // R: 基础扰动（hash1）
                data[idx + 1] = hash2(x, y);  // G: 方向扰动（hash2，独立于R）
                data[idx + 2] = 0;
                data[idx + 3] = 1;
            }
        }
        const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        return tex;
    }

    // ==================== 构建爆炸散度源（散度源模型） ====================
    private buildExplosionDivergence(dt: number): void {
        // 注意：爆炸散度纹理不再在这里清空
        
        // 计算反向偏移量（用于补偿纹理居中追踪的偏移）
        // 只有启用了居中追踪且存在爆炸散度纹理时才进行补偿
        const hasExplosionDivTex = this.explosionDivTex !== undefined;
        const invOffset = hasExplosionDivTex && this.centeringEnabled 
            ? new THREE.Vector2(-this.smoothedOffset.x, -this.smoothedOffset.y)
            : new THREE.Vector2(0, 0);
        
        // 遍历活跃爆炸列表，累加散度贡献（使用帧计数代替墙钟时间）
        for (let i = this.activeExplosions.length - 1; i >= 0; i--) {
            const exp = this.activeExplosions[i];
            const frameElapsed = this.frameCount - exp.startFrame;
            const u = Math.min(1.0, Math.max(0.0, frameElapsed / exp.durationFrames));
            const envelope = 4.0 * u * (1.0 - u); // 二次抛物线包络，先升后降

            if (u >= 1.0 || exp.durationFrames <= 0) {
                this.activeExplosions.splice(i, 1);
                continue;
            }

            // 使用预缓存的材质，更新 uniform 值
            // 根据当前居中偏移调整爆炸中心，使爆炸始终出现在流体团内部
            this.explosionDivMat.uniforms.center.value.set(exp.cx + invOffset.x, exp.cy + invOffset.y);
            this.explosionDivMat.uniforms.radius.value = exp.radius;
            this.explosionDivMat.uniforms.strength.value = exp.strength;
            this.explosionDivMat.uniforms.envelope.value = envelope;
            // 设置噪声扰动参数
            this.explosionDivMat.uniforms.noiseTex.value = this.noiseTex;
            this.explosionDivMat.uniforms.noiseOffset.value.set(exp.noiseOffsetX, exp.noiseOffsetY);
            this.explosionDivMat.uniforms.perturbationStrength.value = this.perturbationStrength;
            this.explosionDivMat.uniforms.usePerturbation.value = this.usePerturbation ? 1.0 : 0.0;
            // 设置各向异性参数
            this.explosionDivMat.uniforms.anisotropyMode.value = exp.anisotropyMode;
            this.explosionDivMat.uniforms.anisotropyPhase.value = exp.anisotropyPhase;
            this.explosionDivMat.uniforms.anisotropyStrength.value = exp.anisotropyStrength;

            // 累加渲染到 explosionDivTex（不清屏实现叠加）
            this.renderFullscreen(this.explosionDivMat, this.explosionDivTex, false);
        }

        // 处理水花生成（createWater=true，且只在第一帧生成一次）
        for (const exp of this.activeExplosions) {
            if (!exp.createWater || exp.waterGenerated) continue;

            const frameElapsed = this.frameCount - exp.startFrame;
            const u = Math.min(1.0, Math.max(0.0, frameElapsed / exp.durationFrames));
            const envelope = 4.0 * u * (1.0 - u);

            // 只在水花包络最大时生成一次（通常在爆炸开始后的短暂窗口）
            if (envelope < 0.5) continue;

            // 标记为已生成，防止后续帧重复生成
            exp.waterGenerated = true;

            // 使用预缓存的水花生成材质更新 phi
            // 根据当前居中偏移调整水花中心
            this.waterGenMat.uniforms.center.value.set(exp.cx + invOffset.x, exp.cy + invOffset.y);
            this.waterGenMat.uniforms.radius.value = exp.radius;
            this.waterGenMat.uniforms.envelope.value = envelope;
            this.waterGenMat.uniforms.phiTex.value = this.curPhiTex.texture;

            // 使用双缓冲方式更新 phi
            const phiDst = this.curPhiTex === this.phiTexA ? this.phiTexB : this.phiTexA;
            this.renderFullscreen(this.waterGenMat, phiDst);
            this.curPhiTex = phiDst;

            // 使用水花速度初始化材质更新速度
            // 根据当前居中偏移调整速度初始化中心
            this.waterVelInitMat.uniforms.center.value.set(exp.cx + invOffset.x, exp.cy + invOffset.y);
            this.waterVelInitMat.uniforms.radius.value = exp.radius;
            this.waterVelInitMat.uniforms.envelope.value = envelope;
            this.waterVelInitMat.uniforms.phiTex.value = this.curPhiTex.texture;
            this.waterVelInitMat.uniforms.velTex.value = this.curVelTex.texture;
            // 设置噪声扰动参数
            this.waterVelInitMat.uniforms.noiseTex.value = this.noiseTex;
            this.waterVelInitMat.uniforms.noiseOffset.value.set(exp.noiseOffsetX, exp.noiseOffsetY);
            this.waterVelInitMat.uniforms.perturbationStrength.value = this.perturbationStrength;
            this.waterVelInitMat.uniforms.usePerturbation.value = this.usePerturbation ? 1.0 : 0.0;

            // 使用双缓冲方式更新速度
            const velDst = this.curVelTex === this.velTexA ? this.velTexB : this.velTexA;
            this.renderFullscreen(this.waterVelInitMat, velDst);
            this.curVelTex = velDst;

            // 重置新生成水花区域的年龄为0（使用更新后的 phi）
            // 根据当前居中偏移调整年龄重置中心
            this.ageResetMat.uniforms.center.value.set(exp.cx + invOffset.x, exp.cy + invOffset.y);
            this.ageResetMat.uniforms.radius.value = exp.radius;
            this.ageResetMat.uniforms.envelope.value = envelope;
            this.ageResetMat.uniforms.phiTex.value = this.curPhiTex.texture;
            this.ageResetMat.uniforms.ageTex.value = this.curAgeTex.texture;

            const ageDst = this.curAgeTex === this.ageTexA ? this.ageTexB : this.ageTexA;
            this.renderFullscreen(this.ageResetMat, ageDst);
            this.curAgeTex = ageDst;
        }
    }

    // ==================== 分层渲染相关接口 ====================
    private textureUpdateEnabled = true;

    public setTextureUpdateEnabled(enabled: boolean): void {
        this.textureUpdateEnabled = enabled;
    }

    public getRenderMaterial(): THREE.ShaderMaterial {
        // 根据纹理更新标志决定是否更新纹理引用
        if (this.textureUpdateEnabled) {
            this.renderMaterial.uniforms.phiTex.value = this.curPhiTex.texture;
            this.renderMaterial.uniforms.velTex.value = this.curVelTex.texture;
        }
        // 否则维持上一次纹理，画面静止
        return this.renderMaterial;
    }

    public getCurPhiTex(): THREE.WebGLRenderTarget {
        return this.curPhiTex;
    }

    public getCurVelTex(): THREE.WebGLRenderTarget {
        return this.curVelTex;
    }

    public setPressureIterations(iterations: number): void {
        this.params.pressureIterations = iterations;
    }

    public updateRenderUniforms(): void {
        this.renderMaterial.uniforms.phiTex.value = this.curPhiTex.texture;
        this.renderMaterial.uniforms.velTex.value = this.curVelTex.texture;
    }

    public setWaterColor(color: THREE.Color): void {
        this.waterColor = color;
        this.renderMaterial.uniforms.waterColor.value = color;
    }

    public setDeepColor(color: THREE.Color): void {
        this.deepColor = color;
        this.renderMaterial.uniforms.deepColor.value = color;
    }

    public setEdgeIntensity(intensity: number): void {
        this.edgeIntensity = intensity;
        this.renderMaterial.uniforms.edgeIntensity.value = intensity;
    }

    public setSpecularIntensity(intensity: number): void {
        this.specularIntensity = intensity;
        this.renderMaterial.uniforms.specularIntensity.value = intensity;
    }

    public setFlowIntensity(intensity: number): void {
        this.flowIntensity = intensity;
        this.renderMaterial.uniforms.flowIntensity.value = intensity;
    }

    // ==================== 尾部挖空设置方法（用于拖尾效果）====================

    /**
     * 启用/禁用尾部挖空效果
     * @param enabled 是否启用
     */
    public setTrailEnabled(enabled: boolean): void {
        this.renderMaterial.uniforms.trailEnabled.value = enabled;
    }

    /**
     * 设置尾部挖空的位置（纹理坐标 0~1）
     * @param u 纹理 U 坐标
     * @param v 纹理 V 坐标
     */
    public setTrailUV(u: number, v: number): void {
        this.renderMaterial.uniforms.trailUV.value.set(u, v);
    }

    /**
     * 设置尾部挖空的半径
     * @param radius 半径（纹理空间，0~0.5）
     */
    public setTrailRadius(radius: number): void {
        this.renderMaterial.uniforms.trailRadius.value = radius;
    }

    public setLightDirection(dir: THREE.Vector3): void {
        this.lightDir = dir.clone().normalize();
        this.renderMaterial.uniforms.lightDir.value = this.lightDir;
    }

    public setWorldTransform(center: THREE.Vector3, radius: number): void {
        this.cachedWorldCenter.copy(center);
        this.cachedWorldRadius = radius;
        this.fluidWorldBounds.setFromCenterAndSize(
            center,
            new THREE.Vector3(radius * 2, radius * 2, radius * 2)
        );
    }

    public setCamera(camera: THREE.Camera): void {
        this.externalCamera = camera;
    }

    public getIsVisible(): boolean {
        return this.isVisibleInCamera;
    }

    private checkVisibility(): boolean {
        if (!this.externalCamera) {
            return true;
        }

        const frustum = new THREE.Frustum();
        const projScreenMatrix = new THREE.Matrix4();
        projScreenMatrix.multiplyMatrices(
            this.externalCamera.projectionMatrix,
            this.externalCamera.matrixWorldInverse
        );
        frustum.setFromProjectionMatrix(projScreenMatrix);

        const sphere = new THREE.Sphere(this.cachedWorldCenter, this.cachedWorldRadius);
        return frustum.intersectsSphere(sphere);
    }

    public updateVisibilityIfNeeded(currentTime: number): boolean {
        if (currentTime - this.lastVisibilityCheckTime >= this.visibilityCheckInterval) {
            this.lastVisibilityCheckTime = currentTime;
            this.isVisibleInCamera = this.checkVisibility();
            if (!this.isVisibleInCamera) {
                console.log(`[FluidSimulator] 流体移出摄像机视野，暂停模拟计算`);
            }
        }
        return this.isVisibleInCamera;
    }

    public dispose(): void {
        const targets = [
            this.velTexA, this.velTexB,
            this.phiTexA, this.phiTexB,
            this.pressureTexA, this.pressureTexB,
            this.divergenceTex,
            this.forcedVelTex,
            this.velAfterCollisionTex,
            this.velCorrectTex,
            // 爆炸散度纹理
            this.explosionDivTex,
            // PCG求解器纹理
            this.rTex, this.dTex, this.qTex, this.zTex, this.bTex,
            // 预分配归约纹理池
            ...this.reduceTexPool,
            // 年龄纹理
            this.ageTexA, this.ageTexB
        ];
        targets.forEach(t => t?.dispose());
        
        // 释放 dummy 纹理
        this.dummySolidMaskTex?.dispose();
        
        // 释放缓存的着色器材质
        const materials = [
            this.velocityAdvectionMat,
            this.externalForcesMat,
            this.wallCollisionMat,
            this.divergenceMat,
            this.pressureJacobiMat,
            this.velocityCorrectMat,
            this.levelSetAdvectionMat,
            this.levelSetReinitMat,
            this.solidBoundaryClearVelMat,
            this.solidBoundaryClearPhiMat,
            this.renderMaterial,
            // PCG材质
            this.spmvMat, this.axpyMat, this.scaleMat, this.computeBMat,
            this.precondMat, this.vecSubMat, this.multiplyMat, this.reduceMat, this.copyMat,
            // 消散材质
            this.dissipationMat,
            // 年龄更新材质
            this.ageUpdateMat,
            // 年龄平流材质
            this.ageAdvectionMat,
            // 爆炸相关材质
            this.explosionDivMat,
            this.waterGenMat,
            this.waterVelInitMat,
            this.ageResetMat,
            // 脉冲注入相关材质
            this.velocityImpulseMat,
            this.localVelocityImpulseMat,
            this.divergenceImpulseMat,
            this.waterImpulseMat
        ];
        materials.forEach(m => m?.dispose());
        
        this.quadGeometry.dispose();
    }

    public static waterVertexShader(): string {
        return `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    }

    public static waterFragmentShader(): string {
        return `uniform sampler2D phiTex; uniform sampler2D velTex; uniform float time; uniform vec2 resolution; uniform vec3 lightDir; uniform vec3 waterColor; uniform vec3 deepColor; uniform float edgeWidth; uniform float edgeIntensity; varying vec2 vUv; vec3 computeNormal(vec2 uv, float eps) { float phi = texture2D(phiTex, uv).r; float phi_r = texture2D(phiTex, uv + vec2(eps, 0.0)).r; float phi_l = texture2D(phiTex, uv - vec2(eps, 0.0)).r; float phi_t = texture2D(phiTex, uv + vec2(0.0, eps)).r; float phi_b = texture2D(phiTex, uv - vec2(0.0, eps)).r; vec3 grad = vec3(phi_r - phi_l, phi_t - phi_b, 0.0); float len = length(grad); if (len < 0.001) return vec3(0.0, 0.0, 1.0); return normalize(grad); } void main() { float phi = texture2D(phiTex, vUv).r; if (phi >= 0.0) discard; float eps = 1.0 / resolution.x; vec3 normal = computeNormal(vUv, eps); float depth = clamp(-phi * 2.0, 0.0, 1.0); vec3 baseColor = mix(waterColor, deepColor, depth); float diff = max(0.2, dot(normal, normalize(lightDir))); vec3 color = baseColor * diff; vec3 viewDir = vec3(0.0, 0.0, 1.0); vec3 halfDir = normalize(normalize(lightDir) + viewDir); float spec = pow(max(dot(normal, halfDir), 0.0), 64.0); color += vec3(1.0) * spec * 0.6; float edge = 1.0 - smoothstep(0.0, edgeWidth, abs(phi)); color += vec3(0.5, 0.7, 1.0) * edge * edgeIntensity; vec2 vel = texture2D(velTex, vUv).rg; float flow = length(vel) * 0.3; color += vec3(0.1, 0.2, 0.3) * flow; gl_FragColor = vec4(color, 0.92); }`;
    }

    // ==================== 水面纹理分裂相关方法 ====================
    public setVelocityTexture(texture: THREE.Texture): void {
        this.copyTextureToTarget(texture, this.velTexA);
        this.copyTextureToTarget(texture, this.velTexB);
        this.curVelTex = this.velTexA;
    }

    public generateCrackMaskGPU(
        targetRT: THREE.WebGLRenderTarget,
        centerUV: THREE.Vector2,
        angles: number[],
        angleWidth: number,
        seed: number
    ): void {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const crackMat = new THREE.ShaderMaterial({
            uniforms: {
                center: { value: centerUV },
                angles: { value: new Float32Array(angles) },
                angleCount: { value: angles.length },
                angleWidth: { value: angleWidth },
                seed: { value: seed },
                resolution: { value: new THREE.Vector2(this.width, this.height) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform vec2 center;
                uniform float angles[32];
                uniform int angleCount;
                uniform float angleWidth;
                uniform float seed;
                uniform vec2 resolution;
                
                varying vec2 vUv;
                
                float rand(vec2 co) {
                    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
                }
                
                void main() {
                    vec2 d = vUv - center;
                    float dist = length(d);
                    float angle = atan(d.y, d.x);
                    
                    // 角度规范化到 [0, 2π)
                    if (angle < 0.0) angle += 6.283185307;
                    
                    float mask = 1.0;
                    for (int i = 0; i < 32; i++) {
                        if (i >= angleCount) break;
                        float targetAngle = angles[i];
                        float diff = abs(angle - targetAngle);
                        // 处理环绕
                        if (diff > 3.141592653) diff = 6.283185307 - diff;
                        if (diff < angleWidth) {
                            mask = 0.0;
                            break;
                        }
                    }
                    
                    // 添加随机扰动
                    float noise = rand(vUv * resolution + seed);
                    mask = mix(mask, 0.0, smoothstep(0.95, 1.0, noise));
                    
                    gl_FragColor = vec4(mask, mask, mask, 1.0);
                }
            `
        });
        
        this.renderFullscreen(crackMat, targetRT);
        crackMat.dispose();
    }

    public applyCrackMask(maskTexture: THREE.Texture): void {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const applyMat = new THREE.ShaderMaterial({
            uniforms: {
                phi: { value: this.curPhiTex.texture },
                mask: { value: maskTexture }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D phi;
                uniform sampler2D mask;
                varying vec2 vUv;
                
                void main() {
                    float phiVal = texture2D(phi, vUv).r;
                    float maskVal = texture2D(mask, vUv).r;
                    // 在裂缝处将 phi 设置为正数（空气）
                    float newPhi = mix(0.1, phiVal, maskVal);
                    gl_FragColor = vec4(newPhi, 0.0, 0.0, 1.0);
                }
            `
        });
        
        const dst = this.curPhiTex === this.phiTexA ? this.phiTexB : this.phiTexA;
        this.renderFullscreen(applyMat, dst);
        this.curPhiTex = dst;
        applyMat.dispose();
    }

    public readPhiAndVel(): { phi: Float32Array; vel: Float32Array } {
        const phiBuffer = new Float32Array(this.width * this.height * 4);
        const velBuffer = new Float32Array(this.width * this.height * 4);
        
        this.renderer.readRenderTargetPixels(this.curPhiTex, 0, 0, this.width, this.height, phiBuffer);
        this.renderer.readRenderTargetPixels(this.curVelTex, 0, 0, this.width, this.height, velBuffer);
        
        return { phi: phiBuffer, vel: velBuffer };
    }

    public clearSectorRegionsGPU(
        centerUV: THREE.Vector2,
        sectors: Array<{ startAngle: number; endAngle: number }>,
        radius: number
    ): void {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        
        // 展平 sectors 数据
        const startAngles = new Float32Array(sectors.map(s => s.startAngle));
        const endAngles = new Float32Array(sectors.map(s => s.endAngle));
        
        const clearMat = new THREE.ShaderMaterial({
            uniforms: {
                phi: { value: this.curPhiTex.texture },
                center: { value: centerUV },
                radius: { value: radius },
                startAngles: { value: startAngles },
                endAngles: { value: endAngles },
                sectorCount: { value: sectors.length },
                resolution: { value: new THREE.Vector2(this.width, this.height) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D phi;
                uniform vec2 center;
                uniform float radius;
                uniform float startAngles[32];
                uniform float endAngles[32];
                uniform int sectorCount;
                uniform vec2 resolution;
                
                varying vec2 vUv;
                
                void main() {
                    vec2 d = vUv - center;
                    float dist = length(d);
                    
                    if (dist > radius) {
                        gl_FragColor = texture2D(phi, vUv);
                        return;
                    }
                    
                    float angle = atan(d.y, d.x);
                    // 角度规范化到 [0, 2π)
                    if (angle < 0.0) angle += 6.283185307;
                    
                    bool inSector = false;
                    for (int i = 0; i < 32; i++) {
                        if (i >= sectorCount) break;
                        float start = startAngles[i];
                        float end = endAngles[i];
                        
                        float testAngle = angle;
                        if (testAngle < start) testAngle += 6.283185307;
                        float testEnd = end;
                        if (testEnd < start) testEnd += 6.283185307;
                        
                        if (testAngle >= start && testAngle < testEnd) {
                            inSector = true;
                            break;
                        }
                    }
                    
                    if (inSector) {
                        gl_FragColor = vec4(0.1, 0.0, 0.0, 1.0);
                    } else {
                        gl_FragColor = texture2D(phi, vUv);
                    }
                }
            `
        });
        
        const dst = this.curPhiTex === this.phiTexA ? this.phiTexB : this.phiTexA;
        this.renderFullscreen(clearMat, dst);
        this.curPhiTex = dst;
        clearMat.dispose();
    }
}