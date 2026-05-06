import * as THREE from 'three';

export interface FluidParams {
    width: number;
    height: number;
    density: number;            // kg/m³
    viscosity: number;          // Pa·s (动力粘度)
    surfaceTension: number;     // N/m
    gravity: number;            // m/s² 向下为正
    pressureIterations: number; // 推荐20~40
    reinitIterations: number;   // 推荐3~5
    timeStep: number;           // 固定步长，推荐0.016
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
    // 分层渲染参数
    waterColor?: THREE.Color;           // 水面颜色
    deepColor?: THREE.Color;            // 深水颜色
    edgeWidth?: number;                 // 边缘宽度
    edgeIntensity?: number;             // 边缘发光强度
    specularIntensity?: number;         // 高光强度
    flowIntensity?: number;             // 流动扰动强度
    lightDir?: THREE.Vector3;           // 光照方向
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

    // 固体相关
    private solidMaskTex: THREE.Texture | null = null;
    private solidNormalTex: THREE.Texture | null = null;
    private dummySolidMaskTex!: THREE.DataTexture;

    // 当前活动的纹理引用（用于交换）
    private curVelTex!: THREE.WebGLRenderTarget;
    private curPhiTex!: THREE.WebGLRenderTarget;
    private curPressureTex!: THREE.WebGLRenderTarget;

    // 调试录制相关
    private debugRecordingEnabled: boolean = false;
    private debugFramesToRecord: number = 20;
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

    // 分层渲染相关
    private renderMaterial!: THREE.ShaderMaterial;
    private waterColor: THREE.Color;
    private deepColor: THREE.Color;
    private edgeWidth: number;
    private edgeIntensity: number;
    private specularIntensity: number;
    private flowIntensity: number;
    private lightDir: THREE.Vector3;

    private initialized = false;

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
        this.initRenderMaterial();  // 初始化分层渲染材质
        this.initialized = true;
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

        this.curVelTex = this.velTexA;
        this.curPhiTex = this.phiTexA;
        this.curPressureTex = this.pressureTexA;
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
        const radius = 0.3 * Math.min(this.width, this.height) / this.width;
        return new THREE.ShaderMaterial({
            uniforms: { radius: { value: radius }, center: { value: new THREE.Vector2(0.5, 0.5) } },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `uniform vec2 center; uniform float radius; varying vec2 vUv; void main() { float d = distance(vUv, center) - radius; d = clamp(d, -0.5, 0.5); gl_FragColor = vec4(d, 0.0, 0.0, 1.0); }`
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
                    vel.y += gravity * dt; 

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
                        if (dist < injectionSize) { 
                            float mask = 1.0 - smoothstep(0.0, injectionSize, dist); 
                            phi = phi - injectionFlowRate * dt * mask; 
                            phi = clamp(phi, -0.5, 0.5); 
                            vel += injectionVel * mask; 
                        } 
                    } 

                    // 全局速度限制 - 应用于所有流体区域 
                    float maxVel = 30.0; 
                    float velLen = length(vel); 
                    if (velLen > maxVel) vel = vel / velLen * maxVel; 

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
            uniforms: { velocity: { value: null }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D velocity; uniform vec2 resolution; varying vec2 vUv; void main() { vec2 uv = vUv; vec2 dx = vec2(1.0/resolution.x, 0.0); vec2 dy = vec2(0.0, 1.0/resolution.y); float vxR = texture2D(velocity, uv + dx).r; float vxL = texture2D(velocity, uv - dx).r; float vyT = texture2D(velocity, uv + dy).g; float vyB = texture2D(velocity, uv - dy).g; float div = (vxR - vxL) / (2.0*dx.x) + (vyT - vyB) / (2.0*dy.y); gl_FragColor = vec4(div, 0.0, 0.0, 1.0); }`
        });

        // 压力迭代（只需要一个材质反复使用）- 添加自由表面和固体边界条件
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
            fragmentShader: `uniform sampler2D pressure; uniform sampler2D divergence; uniform sampler2D levelset; uniform sampler2D solidMask; uniform float dt; uniform float density; uniform vec2 resolution; varying vec2 vUv; void main() { float phi = texture2D(levelset, vUv).r; float isSolid = texture2D(solidMask, vUv).r; if (phi > 0.0 || isSolid > 0.5) { gl_FragColor = vec4(0.0); return; } vec2 uv = vUv; vec2 dx = vec2(1.0/resolution.x, 0.0); vec2 dy = vec2(0.0, 1.0/resolution.y); float pL = texture2D(pressure, uv - dx).r; float pR = texture2D(pressure, uv + dx).r; float pD = texture2D(pressure, uv - dy).r; float pU = texture2D(pressure, uv + dy).r; float div = texture2D(divergence, uv).r; float h = 1.0 / resolution.x; float p_new = (pL + pR + pD + pU - (density / dt) * div * h * h) / 4.0; gl_FragColor = vec4(p_new, 0.0, 0.0, 1.0); }`
        });

        // 速度修正
        this.velocityCorrectMat = new THREE.ShaderMaterial({
            uniforms: { velocity: { value: null }, pressure: { value: null }, dt: { value: dt }, density: { value: this.params.density }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D velocity; uniform sampler2D pressure; uniform float dt; uniform float density; uniform vec2 resolution; varying vec2 vUv; void main() { vec2 uv = vUv; vec2 dx = vec2(1.0/resolution.x, 0.0); vec2 dy = vec2(0.0, 1.0/resolution.y); float pL = texture2D(pressure, uv - dx).r; float pR = texture2D(pressure, uv + dx).r; float pD = texture2D(pressure, uv - dy).r; float pU = texture2D(pressure, uv + dy).r; vec2 vel = texture2D(velocity, uv).rg; vel.x -= (dt / density) * (pR - pL) / (2.0*dx.x); vel.y -= (dt / density) * (pU - pD) / (2.0*dy.y); gl_FragColor = vec4(vel, 0.0, 1.0); }`
        });

        // Level Set 平流
        this.levelSetAdvectionMat = new THREE.ShaderMaterial({
            uniforms: { velocity: { value: null }, forcedVel: { value: null }, levelset: { value: null }, dt: { value: dt }, resolution: { value: res }, injectionEnabled: { value: this.params.injectionEnabled ?? false } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D velocity; uniform sampler2D forcedVel; uniform sampler2D levelset; uniform float dt; uniform vec2 resolution; uniform bool injectionEnabled; varying vec2 vUv; void main() { vec2 uv = vUv; vec2 vel = texture2D(velocity, uv).rg; vec2 step = vel * dt / resolution; vec2 back = uv - step; float phi; if (injectionEnabled) { phi = texture2D(forcedVel, back).b; } else { phi = texture2D(levelset, back).r; } gl_FragColor = vec4(phi, 0.0, 0.0, 1.0); }`
        });

        // Level Set 重初始化
        this.levelSetReinitMat = new THREE.ShaderMaterial({
            uniforms: { levelset: { value: null }, dt_reinit: { value: 0.5 / Math.min(this.width, this.height) }, resolution: { value: res } },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D levelset; uniform float dt_reinit; uniform vec2 resolution; varying vec2 vUv; void main() { vec2 uv = vUv; float phi0 = texture2D(levelset, uv).r; vec2 dx = vec2(1.0/resolution.x, 0.0); vec2 dy = vec2(0.0, 1.0/resolution.y); float phi_r = texture2D(levelset, uv + dx).r; float phi_l = texture2D(levelset, uv - dx).r; float phi_t = texture2D(levelset, uv + dy).r; float phi_b = texture2D(levelset, uv - dy).r; vec2 grad = vec2(phi_r - phi_l, phi_t - phi_b) / (2.0 * dx.x); float grad_len = length(grad); float sign_phi0 = sign(phi0); float phi_new = phi0 - dt_reinit * sign_phi0 * (grad_len - 1.0); gl_FragColor = vec4(phi_new, 0.0, 0.0, 1.0); }`
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
            fragmentShader: `uniform sampler2D levelset; uniform sampler2D solidMask; varying vec2 vUv; void main() { float isSolid = texture2D(solidMask, vUv).r; float phi = texture2D(levelset, vUv).r; if (isSolid > 0.5) phi = -1.0; gl_FragColor = vec4(phi, 0.0, 0.0, 1.0); }`
        });
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
                flowIntensity: { value: this.flowIntensity }
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
                    
                    // 空气区域完全透明 - phi > 0 表示空气
                    // 使用合理阈值避免边界区域被错误 discard
                    if (phi > 0.0) {
                        discard;  // 空气区域完全透明
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
                    float flow = length(vel) * 0.5;
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
    }

    // ==================== 更新流程 ====================
    public update(_deltaTime?: number): void {
        if (!this.initialized) return;

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

            // 清理 phi
            this.solidBoundaryClearPhiMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.solidBoundaryClearPhiMat.uniforms.solidMask.value = this.solidMaskTex;
            this.renderFullscreen(this.solidBoundaryClearPhiMat, this.phiTexA);
            this.curPhiTex = this.phiTexA;
        }

        // 2. 速度平流
        this.velocityAdvectionMat.uniforms.velocity.value = this.curVelTex.texture;
        this.renderFullscreen(this.velocityAdvectionMat, this.velTexB);
        this.curVelTex = this.velTexB;

        // 3. 外力计算
        this.externalForcesMat.uniforms.velocity.value = this.curVelTex.texture;
        this.externalForcesMat.uniforms.levelset.value = this.curPhiTex.texture;
        this.renderFullscreen(this.externalForcesMat, this.forcedVelTex);

        // 4. 墙碰撞处理
        let velForDiv = this.forcedVelTex.texture;
        if (this.solidMaskTex && this.solidNormalTex) {
            this.wallCollisionMat.uniforms.velocity.value = this.forcedVelTex.texture;
            this.wallCollisionMat.uniforms.solidMask.value = this.solidMaskTex;
            this.wallCollisionMat.uniforms.solidNormal.value = this.solidNormalTex;
            this.renderFullscreen(this.wallCollisionMat, this.velAfterCollisionTex);
            velForDiv = this.velAfterCollisionTex.texture;
        }

        // 5. 散度计算
        this.divergenceMat.uniforms.velocity.value = velForDiv;
        this.renderFullscreen(this.divergenceMat, this.divergenceTex);

        // 6. 压力迭代 (Jacobi, 双缓冲) - 只使用一个材质反复更新
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

        // 7. 速度修正
        this.velocityCorrectMat.uniforms.velocity.value = velForDiv;
        this.velocityCorrectMat.uniforms.pressure.value = this.curPressureTex.texture;
        this.renderFullscreen(this.velocityCorrectMat, this.velCorrectTex);
        this.curVelTex = this.velCorrectTex;

        // 8. Level Set 平流
        this.levelSetAdvectionMat.uniforms.velocity.value = this.curVelTex.texture;
        this.levelSetAdvectionMat.uniforms.forcedVel.value = this.forcedVelTex.texture;
        this.levelSetAdvectionMat.uniforms.levelset.value = this.curPhiTex.texture;
        this.renderFullscreen(this.levelSetAdvectionMat, this.phiTexB);
        this.curPhiTex = this.phiTexB;

        // 9. Level Set 重初始化
        for (let i = 0; i < this.params.reinitIterations; i++) {
            this.levelSetReinitMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.renderFullscreen(this.levelSetReinitMat, this.phiTexA);
            this.curPhiTex = this.phiTexA;
        }

        // 10. 固体边界清理 #2
        if (this.solidMaskTex) {
            // 清理速度
            this.solidBoundaryClearVelMat.uniforms.velocity.value = this.curVelTex.texture;
            this.solidBoundaryClearVelMat.uniforms.solidMask.value = this.solidMaskTex;
            this.renderFullscreen(this.solidBoundaryClearVelMat, this.velAfterCollisionTex);
            this.curVelTex = this.velAfterCollisionTex;

            // 清理 phi
            this.solidBoundaryClearPhiMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.solidBoundaryClearPhiMat.uniforms.solidMask.value = this.solidMaskTex;
            this.renderFullscreen(this.solidBoundaryClearPhiMat, this.phiTexA);
            this.curPhiTex = this.phiTexA;
        }

        // ========== 调试录制 ==========
        if (this.debugRecordingEnabled && this.debugCurrentFrame < this.debugFramesToRecord) {
            this.captureCurrentState();
            this.debugCurrentFrame++;
            if (this.debugCurrentFrame >= this.debugFramesToRecord) {
                this.debugRecordingEnabled = false;
                this.downloadDebugData();
            }
        }
    }

    // ==================== 调试录制接口 ====================
    public enableDebugRecording(enable: boolean, framesToRecord: number = 20): void {
        this.debugRecordingEnabled = enable;
        if (enable) {
            this.debugFramesToRecord = framesToRecord;
            this.debugCurrentFrame = 0;
            this.debugRecordedData = [];
            console.log(`[FluidSimulator] 调试录制已启用，将记录 ${framesToRecord} 帧`);
        } else {
            console.log(`[FluidSimulator] 调试录制已禁用`);
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
        const gl = this.renderer.getContext() as WebGL2RenderingContext;
        const pixelBuffer = new Float32Array(this.width * this.height * 4);
        
        // 保存当前帧缓冲区绑定
        const prevFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        
        // 绑定目标帧缓冲区
        gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget.framebuffer);
        
        // 读取像素（RGBA格式，FLOAT类型）
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, pixelBuffer);
        
        // 恢复之前的绑定
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFramebuffer as WebGLFramebuffer);
        
        return pixelBuffer;
    }

    private textureTo2DArray(pixelBuffer: Float32Array, channel: 'r' | 'g' | 'b' | 'a'): number[][] {
        const idxMap = { r: 0, g: 1, b: 2, a: 3 };
        const channelIdx = idxMap[channel];
        const data2D: number[][] = [];
        for (let y = 0; y < this.height; y++) {
            const row: number[] = [];
            for (let x = 0; x < this.width; x++) {
                const i = (y * this.width + x) * 4 + channelIdx;
                row.push(pixelBuffer[i]);
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

    // ==================== 分层渲染相关接口 ====================
    public getRenderMaterial(): THREE.ShaderMaterial {
        // 更新纹理引用
        this.renderMaterial.uniforms.phiTex.value = this.curPhiTex.texture;
        this.renderMaterial.uniforms.velTex.value = this.curVelTex.texture;
        return this.renderMaterial;
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

    public setLightDirection(dir: THREE.Vector3): void {
        this.lightDir = dir.clone().normalize();
        this.renderMaterial.uniforms.lightDir.value = this.lightDir;
    }

    public dispose(): void {
        const targets = [
            this.velTexA, this.velTexB,
            this.phiTexA, this.phiTexB,
            this.pressureTexA, this.pressureTexB,
            this.divergenceTex,
            this.forcedVelTex,
            this.velAfterCollisionTex,
            this.velCorrectTex
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
            this.renderMaterial
        ];
        materials.forEach(m => m?.dispose());
        
        this.quadGeometry.dispose();
    }

    public static waterVertexShader(): string {
        return `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    }

    public static waterFragmentShader(): string {
        return `uniform sampler2D phiTex; uniform sampler2D velTex; uniform float time; uniform vec2 resolution; uniform vec3 lightDir; uniform vec3 waterColor; uniform vec3 deepColor; uniform float edgeWidth; uniform float edgeIntensity; varying vec2 vUv; vec3 computeNormal(vec2 uv, float eps) { float phi = texture2D(phiTex, uv).r; float phi_r = texture2D(phiTex, uv + vec2(eps, 0.0)).r; float phi_l = texture2D(phiTex, uv - vec2(eps, 0.0)).r; float phi_t = texture2D(phiTex, uv + vec2(0.0, eps)).r; float phi_b = texture2D(phiTex, uv - vec2(0.0, eps)).r; vec3 grad = vec3(phi_r - phi_l, phi_t - phi_b, 0.0); float len = length(grad); if (len < 0.001) return vec3(0.0, 0.0, 1.0); return normalize(grad); } void main() { float phi = texture2D(phiTex, vUv).r; if (phi > 0.0) discard; float eps = 1.0 / resolution.x; vec3 normal = computeNormal(vUv, eps); float depth = clamp(-phi * 2.0, 0.0, 1.0); vec3 baseColor = mix(waterColor, deepColor, depth); float diff = max(0.2, dot(normal, normalize(lightDir))); vec3 color = baseColor * diff; vec3 viewDir = vec3(0.0, 0.0, 1.0); vec3 halfDir = normalize(normalize(lightDir) + viewDir); float spec = pow(max(dot(normal, halfDir), 0.0), 64.0); color += vec3(1.0) * spec * 0.6; float edge = 1.0 - smoothstep(0.0, edgeWidth, abs(phi)); color += vec3(0.5, 0.7, 1.0) * edge * edgeIntensity; vec2 vel = texture2D(velTex, vUv).rg; float flow = length(vel) * 0.3; color += vec3(0.1, 0.2, 0.3) * flow; gl_FragColor = vec4(color, 0.92); }`;
    }
}