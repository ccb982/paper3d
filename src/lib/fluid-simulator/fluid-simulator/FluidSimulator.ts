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

    // 当前活动的纹理引用（用于交换）
    private curVelTex!: THREE.WebGLRenderTarget;
    private curPhiTex!: THREE.WebGLRenderTarget;
    private curPressureTex!: THREE.WebGLRenderTarget;

    // 缓存的着色器材质（复用）
    private velocityAdvectionMat!: THREE.ShaderMaterial;
    private externalForcesMat!: THREE.ShaderMaterial;
    private wallCollisionMat!: THREE.ShaderMaterial;
    private divergenceMat!: THREE.ShaderMaterial;
    private pressureJacobiMat!: THREE.ShaderMaterial;  // 压力迭代只需要一个材质
    private velocityCorrectMat!: THREE.ShaderMaterial;
    private levelSetAdvectionMat!: THREE.ShaderMaterial;
    private levelSetReinitMat!: THREE.ShaderMaterial;
    private solidBoundaryClearMat!: THREE.ShaderMaterial;

    private initialized = false;

    constructor(renderer: THREE.WebGLRenderer, params: FluidParams) {
        this.renderer = renderer;
        this.params = params;
        this.width = params.width;
        this.height = params.height;

        // 创建正交相机和全屏四边形（UV 从 0 到 1）
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quadGeometry = new THREE.PlaneGeometry(2, 2);
        this.scene = new THREE.Scene();
        this.quad = new THREE.Mesh(this.quadGeometry, new THREE.MeshBasicMaterial());
        this.scene.add(this.quad);

        this.createTextures();
        this.initTextures();
        this.initShaders();
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
            fragmentShader: `uniform sampler2D velocity; uniform sampler2D levelset; uniform float gravity; uniform float sigma; uniform float density; uniform float viscosity; uniform vec2 resolution; uniform float dt; uniform bool injectionEnabled; uniform vec2 injectionPos; uniform float injectionFlowRate; uniform vec2 injectionVel; uniform float injectionSize; varying vec2 vUv; void main() { vec2 uv = vUv; float phi = texture2D(levelset, uv).r; vec2 vel = texture2D(velocity, uv).rg; vel.y += gravity * dt; vec2 dx = vec2(1.0/resolution.x, 0.0); vec2 dy = vec2(0.0, 1.0/resolution.y); vec2 vel_r = texture2D(velocity, uv + dx).rg; vec2 vel_l = texture2D(velocity, uv - dx).rg; vec2 vel_t = texture2D(velocity, uv + dy).rg; vec2 vel_b = texture2D(velocity, uv - dy).rg; vec2 laplacian = (vel_r + vel_l + vel_t + vel_b - 4.0*vel) * (resolution.x * resolution.x); float nu = viscosity / density; vel += nu * dt * laplacian; float eps = 1.5 / resolution.x; if (abs(phi) < eps) { float phi_r = texture2D(levelset, uv + dx).r; float phi_l = texture2D(levelset, uv - dx).r; float phi_t = texture2D(levelset, uv + dy).r; float phi_b = texture2D(levelset, uv - dy).r; vec2 grad = vec2(phi_r - phi_l, phi_t - phi_b) / (2.0 * dx.x); float len = length(grad); if (len > 1e-6) { vec2 n = grad / len; float phi_xx = phi_r + phi_l - 2.0*phi; float phi_yy = phi_t + phi_b - 2.0*phi; float phi_xy = (texture2D(levelset, uv + dx + dy).r - texture2D(levelset, uv + dx - dy).r - texture2D(levelset, uv - dx + dy).r + texture2D(levelset, uv - dx - dy).r) / (4.0 * dx.x * dx.x); float kappa = (phi_xx * n.y * n.y - 2.0 * phi_xy * n.x * n.y + phi_yy * n.x * n.x) / len; float delta = 0.0; if (abs(phi) < eps) delta = (1.0 + cos(3.1415926 * phi / eps)) / (2.0 * eps); vec2 f_st = sigma * kappa * delta * n; vel += (f_st / density) * dt; } } if (injectionEnabled) { float dist = length(uv - injectionPos); if (dist < injectionSize) { float mask = 1.0 - smoothstep(0.0, injectionSize, dist); phi = phi - injectionFlowRate * dt * mask; phi = clamp(phi, -0.5, 0.5); vel += injectionVel * mask; float maxVel = 30.0; float velLen = length(vel); if (velLen > maxVel) vel = vel / velLen * maxVel; } } gl_FragColor = vec4(vel, phi, 1.0); }`
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

        // 固体边界清理：同时清理固体内部的速度场和 phi
        this.solidBoundaryClearMat = new THREE.ShaderMaterial({
            uniforms: { 
                velocity: { value: null }, 
                levelset: { value: null }, 
                solidMask: { value: null } 
            },
            vertexShader: vs,
            fragmentShader: `uniform sampler2D velocity; uniform sampler2D levelset; uniform sampler2D solidMask; varying vec2 vUv; void main() { float isSolid = texture2D(solidMask, vUv).r; vec2 vel = texture2D(velocity, vUv).rg; float phi = texture2D(levelset, vUv).r; if (isSolid > 0.5) { vel = vec2(0.0); phi = -1.0; } gl_FragColor = vec4(vel, phi, 1.0); }`
        });
    }

    // ==================== 更新流程 ====================
    public update(deltaTime?: number): void {
        if (!this.initialized) return;
        let dt = this.params.timeStep;
        if (deltaTime !== undefined) dt = Math.min(deltaTime, 0.033);

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
            this.solidBoundaryClearMat.uniforms.velocity.value = this.curVelTex.texture;
            this.solidBoundaryClearMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.solidBoundaryClearMat.uniforms.solidMask.value = this.solidMaskTex;
            this.renderFullscreen(this.solidBoundaryClearMat, this.velAfterCollisionTex);
            this.curVelTex = this.velAfterCollisionTex;
            this.renderFullscreen(this.solidBoundaryClearMat, this.phiTexA);
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
            this.pressureJacobiMat.uniforms.solidMask.value = this.solidMaskTex ?? this.divergenceTex.texture;
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
            this.solidBoundaryClearMat.uniforms.velocity.value = this.curVelTex.texture;
            this.solidBoundaryClearMat.uniforms.levelset.value = this.curPhiTex.texture;
            this.renderFullscreen(this.solidBoundaryClearMat, this.velAfterCollisionTex);
            this.curVelTex = this.velAfterCollisionTex;
            this.renderFullscreen(this.solidBoundaryClearMat, this.phiTexA);
            this.curPhiTex = this.phiTexA;
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
            this.solidBoundaryClearMat
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