import * as THREE from 'three';
import { GPUComputationRenderer, Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

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
    injectionEnabled?: boolean;      // 是否启用注入
    injectionPosX?: number;         // 注入位置 X (0-1 UV)
    injectionPosY?: number;         // 注入位置 Y (0-1 UV)
    injectionFlowRate?: number;     // 注入流量 (phi 变化率)
    injectionVelX?: number;        // 注入速度 X
    injectionVelY?: number;        // 注入速度 Y
    injectionSize?: number;         // 注入区域大小
}

export class FluidSimulator {
    private gpuCompute: GPUComputationRenderer;
    private velPrevVar: Variable;
    private velNextVar: Variable;
    private phiPrevVar: Variable;
    private phiNextVar: Variable;
    private pressureVarA: Variable;
    private pressureVarB: Variable;
    private divergenceVar: Variable;
    private forcedVelVar: Variable;
    private velAfterCollisionVar: Variable;
    private velCorrectVar: Variable;
    private solidNormalTexture: THREE.Texture | null = null;
    private velClearedTarget: THREE.WebGLRenderTarget | null = null;
    private phiClearedTarget: THREE.WebGLRenderTarget | null = null;
    
    private clearScene: THREE.Scene;
    private clearCamera: THREE.OrthographicCamera;
    private clearGeometry: THREE.PlaneGeometry;
    private clearMaterial: THREE.ShaderMaterial;
    private clearMesh: THREE.Mesh;

    private params: FluidParams;
    private renderer: THREE.WebGLRenderer;
    private initialized: boolean = false;
    private normalComputed: boolean = false;
    private solidMaskTexture: THREE.Texture | null = null;
    private customLevelSetTexture: THREE.Texture | null = null;

    constructor(renderer: THREE.WebGLRenderer, params: FluidParams) {
        this.renderer = renderer;
        this.params = params;
        if (params.initialLevelSet) {
            this.customLevelSetTexture = params.initialLevelSet;
        }
        
        this.clearCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.clearGeometry = new THREE.PlaneGeometry(2, 2);
        this.clearMaterial = new THREE.ShaderMaterial({
            uniforms: {
                velInput: { value: null },
                phiInput: { value: null },
                solidMask: { value: null }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: FluidSimulator.solidBoundaryClearShader()
        });
        this.clearMesh = new THREE.Mesh(this.clearGeometry, this.clearMaterial);
        this.clearScene = new THREE.Scene();
        this.clearScene.add(this.clearMesh);
        
        this.initGPUCompute();
    }

    private initGPUCompute(): void {
        const w = this.params.width;
        const h = this.params.height;
        this.gpuCompute = new GPUComputationRenderer(w, h, this.renderer);

        const velTex0 = this.createVelocityTexture();
        const velTex1 = this.gpuCompute.createTexture();
        const phiTex0 = this.customLevelSetTexture 
            ? this.createLevelSetTextureFromCustom(this.customLevelSetTexture)
            : this.createLevelSetTexture();
        const phiTex1 = this.gpuCompute.createTexture();
        const pressureTex0 = this.gpuCompute.createTexture();
        const pressureTex1 = this.gpuCompute.createTexture();
        const divergenceTex = this.gpuCompute.createTexture();
        const forcedVelTex = this.gpuCompute.createTexture();
        const velAfterCollisionTex = this.gpuCompute.createTexture();

        this.velPrevVar = this.gpuCompute.addVariable('velPrev', this.velocityAdvectionShader(), velTex0);
        this.velNextVar = this.gpuCompute.addVariable('velNext', this.velocityAdvectionShader(), velTex1);
        this.phiPrevVar = this.gpuCompute.addVariable('phiPrev', this.levelSetAdvectionShader(), phiTex0);
        this.phiNextVar = this.gpuCompute.addVariable('phiNext', this.levelSetAdvectionShader(), phiTex1);
        this.pressureVarA = this.gpuCompute.addVariable('pressureA', this.pressureJacobiShader(), pressureTex0);
        this.pressureVarB = this.gpuCompute.addVariable('pressureB', this.pressureJacobiShader(), pressureTex1);
        this.divergenceVar = this.gpuCompute.addVariable('divergence', this.divergenceShader(), divergenceTex);
        this.forcedVelVar = this.gpuCompute.addVariable('forcedVel', this.externalForcesShader(), forcedVelTex);
        this.velAfterCollisionVar = this.gpuCompute.addVariable('velAfterCollision', this.wallCollisionShader(), velAfterCollisionTex);
        this.velCorrectVar = this.gpuCompute.addVariable('velCorrect', this.velocityCorrectShader(), this.gpuCompute.createTexture());

        this.gpuCompute.setVariableDependencies(this.velPrevVar, [this.velNextVar]);
        this.gpuCompute.setVariableDependencies(this.velNextVar, [this.velPrevVar]);
        this.gpuCompute.setVariableDependencies(this.phiPrevVar, [this.velPrevVar, this.forcedVelVar]);
        this.gpuCompute.setVariableDependencies(this.phiNextVar, [this.velPrevVar, this.forcedVelVar]);
        this.gpuCompute.setVariableDependencies(this.divergenceVar, [this.velAfterCollisionVar]);
        this.gpuCompute.setVariableDependencies(this.pressureVarA, [this.divergenceVar, this.pressureVarB]);
        this.gpuCompute.setVariableDependencies(this.pressureVarB, [this.divergenceVar, this.pressureVarA]);
        this.gpuCompute.setVariableDependencies(this.forcedVelVar, [this.velPrevVar, this.phiPrevVar]);
        this.gpuCompute.setVariableDependencies(this.velAfterCollisionVar, [this.forcedVelVar]);
        this.gpuCompute.setVariableDependencies(this.velCorrectVar, [this.velAfterCollisionVar]);

        this.gpuCompute.init();
        this.initialized = true;
    }

    private createVelocityTexture(): THREE.DataTexture {
        const w = this.params.width;
        const h = this.params.height;
        const data = new Float32Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            data[i*4] = 0.0;
            data[i*4+1] = 0.0;
            data[i*4+2] = 0.0;
            data[i*4+3] = 1.0;
        }
        const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
        tex.needsUpdate = true;
        return tex;
    }

    private createLevelSetTexture(): THREE.DataTexture {
        const w = this.params.width;
        const h = this.params.height;
        const data = new Float32Array(w * h * 4);
        const cx = 0.5, cy = 0.5;
        const radius = 0.3 * Math.min(w, h) / w;
        for (let i = 0; i < w; i++) {
            for (let j = 0; j < h; j++) {
                const u = (i + 0.5) / w;
                const v = (j + 0.5) / h;
                const dx = u - cx;
                const dy = v - cy;
                const dist = Math.sqrt(dx*dx + dy*dy);
                let phi = dist - radius;
                phi = Math.min(0.5, Math.max(-0.5, phi));
                const idx = (j * w + i) * 4;
                data[idx] = phi;
                data[idx+1] = 0;
                data[idx+2] = 0;
                data[idx+3] = 1.0;
            }
        }
        const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
        tex.needsUpdate = true;
        return tex;
    }

    private createLevelSetTextureFromCustom(customTex: THREE.Texture): THREE.DataTexture {
        const w = this.params.width;
        const h = this.params.height;
        const data = new Float32Array(w * h * 4);

        if (customTex.image instanceof HTMLCanvasElement || customTex.image instanceof HTMLImageElement) {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(customTex.image as HTMLCanvasElement, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            const pixels = imageData.data;

            for (let i = 0; i < w * h; i++) {
                const idx = i * 4;
                const r = pixels[idx] / 255.0;
                data[idx] = 1.0 - 2.0 * r;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 1.0;
            }
        } else if (customTex.image && (customTex.image as ImageData).data) {
            const imageData = (customTex.image as ImageData).data;
            for (let i = 0; i < w * h; i++) {
                const idx = i * 4;
                const r = imageData[idx] / 255.0;
                data[idx] = 1.0 - 2.0 * r;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 1.0;
            }
        } else {
            console.warn('Custom Level Set texture format not recognized, using default circle');
            return this.createLevelSetTexture();
        }

        const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
        tex.needsUpdate = true;
        return tex;
    }

    public setSolidMaskTexture(texture: THREE.Texture | null): void {
        this.solidMaskTexture = texture;
        if (texture) {
            this.computeSolidNormalTexture();
        }
    }

    public setLevelSetTexture(texture: THREE.Texture | null): void {
        this.customLevelSetTexture = texture;
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

    private computeSolidNormalTexture(): void {
        if (!this.solidMaskTexture || this.normalComputed) return;

        const w = this.params.width;
        const h = this.params.height;
        const data = new Float32Array(w * h * 4);

        const maskData = this.solidMaskTexture.image.data;

        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const idx = (j * w + i) * 4;
                const solid_r = this.getSolidMaskValue(maskData, w, h, i + 1, j);
                const solid_l = this.getSolidMaskValue(maskData, w, h, i - 1, j);
                const solid_t = this.getSolidMaskValue(maskData, w, h, i, j + 1);
                const solid_b = this.getSolidMaskValue(maskData, w, h, i, j - 1);

                let nx = solid_r - solid_l;
                let ny = solid_t - solid_b;

                const len = Math.sqrt(nx * nx + ny * ny);
                if (len > 0.001) {
                    nx /= len;
                    ny /= len;
                } else {
                    nx = 0.0;
                    ny = 0.0;
                }

                data[idx] = nx;
                data[idx + 1] = ny;
                data[idx + 2] = 0.0;
                data[idx + 3] = 1.0;
            }
        }

        this.solidNormalTexture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
        this.solidNormalTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.solidNormalTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.solidNormalTexture.needsUpdate = true;

        this.normalComputed = true;
    }

    private getSolidMaskValue(data: Float32Array | Uint8Array, w: number, h: number, i: number, j: number): number {
        if (i < 0 || i >= w || j < 0 || j >= h) return 0.0;
        const idx = (j * w + i) * 4;
        return data[idx] > 0.5 ? 1.0 : 0.0;
    }

    private clearSolidBoundary(velTexture: THREE.Texture, phiTexture: THREE.Texture, targetWidth: number, targetHeight: number): { velCleared: THREE.Texture, phiCleared: THREE.Texture } {
        if (!this.velClearedTarget || this.velClearedTarget.width !== targetWidth || this.velClearedTarget.height !== targetHeight) {
            if (this.velClearedTarget) this.velClearedTarget.dispose();
            if (this.phiClearedTarget) this.phiClearedTarget.dispose();

            this.velClearedTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
                format: THREE.RGBAFormat,
                type: THREE.FloatType,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                wrapS: THREE.ClampToEdgeWrapping,
                wrapT: THREE.ClampToEdgeWrapping
            });

            this.phiClearedTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
                format: THREE.RGBAFormat,
                type: THREE.FloatType,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                wrapS: THREE.ClampToEdgeWrapping,
                wrapT: THREE.ClampToEdgeWrapping
            });
        }

        this.clearMaterial.uniforms.velInput.value = velTexture;
        this.clearMaterial.uniforms.phiInput.value = phiTexture;
        this.clearMaterial.uniforms.solidMask.value = this.solidMaskTexture;

        const originalTarget = this.renderer.getRenderTarget();

        this.renderer.setRenderTarget(this.velClearedTarget);
        this.renderer.render(this.clearScene, this.clearCamera);
        this.renderer.setRenderTarget(this.phiClearedTarget);
        this.renderer.render(this.clearScene, this.clearCamera);
        this.renderer.setRenderTarget(originalTarget);

        return { velCleared: this.velClearedTarget.texture, phiCleared: this.phiClearedTarget.texture };
    }

    private swapVel(): void {
        const temp = this.velPrevVar;
        this.velPrevVar = this.velNextVar;
        this.velNextVar = temp;
    }

    private swapPhi(): void {
        const temp = this.phiPrevVar;
        this.phiPrevVar = this.phiNextVar;
        this.phiNextVar = temp;
    }

    private swapPressure(): void {
        const temp = this.pressureVarA;
        this.pressureVarA = this.pressureVarB;
        this.pressureVarB = temp;
    }

    private velocityAdvectionShader(): string {
        return `
            uniform sampler2D velocity;
            uniform float dt;
            uniform vec2 resolution;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv;
                vec2 vel = texture2D(velocity, uv).rg;
                vec2 step = vel * dt / resolution;
                vec2 back = uv - step;
                vec2 newVel = texture2D(velocity, back).rg;
                gl_FragColor = vec4(newVel, 0.0, 1.0);
            }
        `;
    }

    private levelSetAdvectionShader(): string {
        return `
            uniform sampler2D velocity;
            uniform sampler2D forcedVel;
            uniform sampler2D levelset;
            uniform float dt;
            uniform vec2 resolution;
            uniform bool injectionEnabled;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv;
                vec2 vel = texture2D(velocity, uv).rg;
                vec2 step = vel * dt / resolution;
                vec2 back = uv - step;
                float phi;
                if (injectionEnabled) {
                    phi = texture2D(forcedVel, back).b;
                } else {
                    phi = texture2D(levelset, back).r;
                }
                gl_FragColor = vec4(phi, 0.0, 0.0, 1.0);
            }
        `;
    }

    private divergenceShader(): string {
        return `
            uniform sampler2D velocity;
            uniform vec2 resolution;
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
                gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
            }
        `;
    }

    private pressureJacobiShader(): string {
        return `
            uniform sampler2D pressure;
            uniform sampler2D divergence;
            uniform vec2 resolution;
            uniform float dt;
            uniform float density;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv;
                vec2 dx = vec2(1.0/resolution.x, 0.0);
                vec2 dy = vec2(0.0, 1.0/resolution.y);
                float pL = texture2D(pressure, uv - dx).r;
                float pR = texture2D(pressure, uv + dx).r;
                float pD = texture2D(pressure, uv - dy).r;
                float pU = texture2D(pressure, uv + dy).r;
                float div = texture2D(divergence, uv).r;
                float h = 1.0 / resolution.x;
                float p_new = (pL + pR + pD + pU - (density / dt) * div * h * h) / 4.0;
                gl_FragColor = vec4(p_new, 0.0, 0.0, 1.0);
            }
        `;
    }

    private velocityCorrectShader(): string {
        return `
            uniform sampler2D velocity;
            uniform sampler2D pressure;
            uniform vec2 resolution;
            uniform float dt;
            uniform float density;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv;
                vec2 dx = vec2(1.0/resolution.x, 0.0);
                vec2 dy = vec2(0.0, 1.0/resolution.y);
                float pL = texture2D(pressure, uv - dx).r;
                float pR = texture2D(pressure, uv + dx).r;
                float pD = texture2D(pressure, uv - dy).r;
                float pU = texture2D(pressure, uv + dy).r;
                vec2 vel = texture2D(velocity, uv).rg;
                vel.x -= (dt / density) * (pR - pL) / (2.0*dx.x);
                vel.y -= (dt / density) * (pU - pD) / (2.0*dy.y);
                gl_FragColor = vec4(vel, 0.0, 1.0);
            }
        `;
    }

    private externalForcesShader(): string {
        return `
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

                const float eps = 1.5 / resolution.x;
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
                        float phi_xy = (texture2D(levelset, uv + dx + dy).r
                                      - texture2D(levelset, uv + dx - dy).r
                                      - texture2D(levelset, uv - dx + dy).r
                                      + texture2D(levelset, uv - dx - dy).r) / (4.0 * dx.x * dx.x);
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
                        phi = min(phi, -injectionFlowRate * dt * mask);
                        vel += injectionVel * mask;
                    }
                }

                gl_FragColor = vec4(vel, phi, 1.0);
            }
        `;
    }

    private levelSetReinitShader(): string {
        return `
            uniform sampler2D levelset;
            uniform float dt_reinit;
            uniform vec2 resolution;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv;
                float phi0 = texture2D(levelset, uv).r;
                vec2 dx = vec2(1.0/resolution.x, 0.0);
                vec2 dy = vec2(0.0, 1.0/resolution.y);
                float phi_r = texture2D(levelset, uv + dx).r;
                float phi_l = texture2D(levelset, uv - dx).r;
                float phi_t = texture2D(levelset, uv + dy).r;
                float phi_b = texture2D(levelset, uv - dy).r;
                vec2 grad = vec2(phi_r - phi_l, phi_t - phi_b) / (2.0 * dx.x);
                float grad_len = length(grad);
                float sign_phi0 = sign(phi0);
                float phi_new = phi0 - dt_reinit * sign_phi0 * (grad_len - 1.0);
                gl_FragColor = vec4(phi_new, 0.0, 0.0, 1.0);
            }
        `;
    }

    private static solidBoundaryClearShader(): string {
        return `
            uniform sampler2D velInput;
            uniform sampler2D phiInput;
            uniform sampler2D solidMask;
            varying vec2 vUv;
            void main() {
                float isSolid = texture2D(solidMask, vUv).r;
                vec2 vel = texture2D(velInput, vUv).rg;
                float phi = texture2D(phiInput, vUv).r;
                if (isSolid > 0.5) {
                    vel = vec2(0.0);
                    phi = -1.0;
                }
                gl_FragColor = vec4(vel.x, vel.y, phi, 1.0);
            }
        `;
    }

    private wallCollisionShader(): string {
        return `
            uniform sampler2D velocity;
            uniform sampler2D solidMask;
            uniform sampler2D solidNormal;
            uniform float restitution;
            uniform float friction;
            uniform vec2 resolution;
            varying vec2 vUv;
            void main() {
                float isSolid = texture2D(solidMask, vUv).r;

                if (isSolid < 0.5) {
                    vec2 vel = texture2D(velocity, vUv).rg;
                    gl_FragColor = vec4(vel, 0.0, 1.0);
                    return;
                }

                vec2 normal = texture2D(solidNormal, vUv).rg;
                float normalLen = length(normal);
                if (normalLen < 0.001) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }
                normal = normal / normalLen;

                vec2 vel = texture2D(velocity, vUv).rg;

                float vn = dot(vel, normal);
                vec2 vt = vel - vn * normal;

                float vn_new = -vn * restitution;
                vec2 vt_new = vt * friction;
                vec2 vel_new = vt_new + vn_new * normal;

                gl_FragColor = vec4(vel_new, 0.0, 1.0);
            }
        `;
    }

    public update(deltaTime?: number): void {
        if (!this.initialized) return;

        let dt = this.params.timeStep;
        if (deltaTime !== undefined) dt = Math.min(deltaTime, 0.033);

        const resolution = new THREE.Vector2(this.params.width, this.params.height);
        const dtReinit = 0.5 / Math.min(this.params.width, this.params.height);

        const setUniforms = (varObj: Variable, uniforms: Record<string, any>) => {
            for (const [name, val] of Object.entries(uniforms)) {
                varObj.material.uniforms[name] = { value: val };
            }
        };

        if (this.solidMaskTexture) {
            const cleared = this.clearSolidBoundary(
                this.velPrevVar.texture,
                this.phiPrevVar.texture,
                this.params.width,
                this.params.height
            );
            this.velPrevVar.texture = cleared.velCleared;
            this.phiPrevVar.texture = cleared.phiCleared;
        }

        setUniforms(this.velPrevVar, { dt, resolution });
        setUniforms(this.velNextVar, { dt, resolution });
        setUniforms(this.phiPrevVar, { dt, resolution });
        setUniforms(this.phiNextVar, { dt, resolution });
        setUniforms(this.divergenceVar, { resolution });
        setUniforms(this.pressureVarA, { dt, resolution, density: this.params.density });
        setUniforms(this.pressureVarB, { dt, resolution, density: this.params.density });
        setUniforms(this.forcedVelVar, { 
            dt, resolution, 
            gravity: this.params.gravity, 
            sigma: this.params.surfaceTension, 
            density: this.params.density, 
            viscosity: this.params.viscosity,
            injectionEnabled: this.params.injectionEnabled ?? false,
            injectionPos: new THREE.Vector2(this.params.injectionPosX ?? 0.5, this.params.injectionPosY ?? 0.5),
            injectionFlowRate: this.params.injectionFlowRate ?? 1.0,
            injectionVel: new THREE.Vector2(this.params.injectionVelX ?? 0.0, this.params.injectionVelY ?? 0.0),
            injectionSize: this.params.injectionSize ?? 0.05
        });

        setUniforms(this.velAfterCollisionVar, {
            restitution: this.params.restitution,
            friction: this.params.friction,
            resolution: resolution
        });

        setUniforms(this.velCorrectVar, {
            dt, resolution, density: this.params.density
        });

        this.gpuCompute.compute(this.velNextVar);
        this.swapVel();

        this.gpuCompute.compute(this.forcedVelVar);

        if (this.solidMaskTexture && this.solidNormalTexture) {
            setUniforms(this.velAfterCollisionVar, {
                velocity: this.forcedVelVar.texture,
                solidMask: this.solidMaskTexture,
                solidNormal: this.solidNormalTexture,
                restitution: this.params.restitution,
                friction: this.params.friction,
                resolution: resolution
            });
            this.gpuCompute.compute(this.velAfterCollisionVar);
        }

        setUniforms(this.divergenceVar, {
            velocity: this.velAfterCollisionVar.texture,
            resolution: resolution
        });
        this.gpuCompute.compute(this.divergenceVar);

        let pressureSrc = this.pressureVarA;
        let pressureDst = this.pressureVarB;

        setUniforms(pressureSrc, {
            pressure: pressureSrc.texture,
            divergence: this.divergenceVar.texture,
            dt, resolution, density: this.params.density
        });

        for (let i = 0; i < this.params.pressureIterations; i++) {
            setUniforms(pressureDst, {
                pressure: pressureSrc.texture,
                divergence: this.divergenceVar.texture,
                dt, resolution, density: this.params.density
            });
            this.gpuCompute.compute(pressureDst);

            const temp = pressureSrc;
            pressureSrc = pressureDst;
            pressureDst = temp;
        }

        this.pressureVarA = pressureSrc;
        this.pressureVarB = pressureDst;

        const pressureTexture = pressureSrc.texture;
        setUniforms(this.velCorrectVar, {
            velocity: this.velAfterCollisionVar.texture,
            pressure: pressureTexture,
            dt, resolution, density: this.params.density
        });
        this.gpuCompute.compute(this.velCorrectVar);

        this.velPrevVar.texture = this.velCorrectVar.texture;

        setUniforms(this.phiPrevVar, {
            velocity: this.velCorrectVar.texture,
            forcedVel: this.forcedVelVar.texture,
            levelset: this.phiPrevVar.texture,
            dt, resolution,
            injectionEnabled: this.params.injectionEnabled ?? false
        });
        this.gpuCompute.compute(this.phiPrevVar);
        this.swapPhi();

        for (let i = 0; i < this.params.reinitIterations; i++) {
            setUniforms(this.phiPrevVar, {
                levelset: this.phiPrevVar.texture,
                dt_reinit: dtReinit,
                resolution: resolution
            });
            this.gpuCompute.compute(this.phiPrevVar);
            this.swapPhi();
        }

        if (this.solidMaskTexture) {
            const cleared = this.clearSolidBoundary(
                this.velPrevVar.texture,
                this.phiPrevVar.texture,
                this.params.width,
                this.params.height
            );
            this.velPrevVar.texture = cleared.velCleared;
            this.phiPrevVar.texture = cleared.phiCleared;
        }
    }

    public getLevelSetTexture(): THREE.Texture {
        return this.phiPrevVar.texture;
    }

    public getVelocityTexture(): THREE.Texture {
        return this.velPrevVar.texture;
    }

    public dispose(): void {
        if (this.velClearedTarget) this.velClearedTarget.dispose();
        if (this.phiClearedTarget) this.phiClearedTarget.dispose();
        if (this.gpuCompute) this.gpuCompute.dispose();
        
        if (this.clearMaterial) this.clearMaterial.dispose();
        if (this.clearGeometry) this.clearGeometry.dispose();
    }

    public static waterVertexShader(): string {
        return `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
    }

    public static waterFragmentShader(): string {
        return `
            uniform sampler2D phiTex;
            uniform sampler2D velTex;
            uniform float time;
            uniform vec2 resolution;
            uniform vec3 lightDir;
            uniform vec3 waterColor;
            uniform vec3 deepColor;
            uniform float edgeWidth;
            uniform float edgeIntensity;

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
                if (phi > 0.0) discard;

                float eps = 1.0 / resolution.x;
                vec3 normal = computeNormal(vUv, eps);

                float depth = clamp(-phi * 2.0, 0.0, 1.0);
                vec3 baseColor = mix(waterColor, deepColor, depth);

                float diff = max(0.2, dot(normal, normalize(lightDir)));
                vec3 color = baseColor * diff;

                vec3 viewDir = vec3(0.0, 0.0, 1.0);
                vec3 halfDir = normalize(normalize(lightDir) + viewDir);
                float spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
                color += vec3(1.0) * spec * 0.6;

                float edge = 1.0 - smoothstep(0.0, edgeWidth, abs(phi));
                color += vec3(0.5, 0.7, 1.0) * edge * edgeIntensity;

                vec2 vel = texture2D(velTex, vUv).rg;
                float flow = length(vel) * 0.3;
                color += vec3(0.1, 0.2, 0.3) * flow;

                gl_FragColor = vec4(color, 0.92);
            }
        `;
    }
}
