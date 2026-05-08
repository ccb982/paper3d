import * as THREE from 'three';
import { FluidSimulator } from '@lib/fluid-simulator/fluid-simulator';
import type { FluidParams } from '@lib/fluid-simulator/fluid-simulator';
import { Entity } from '@core/Entity';

/**
 * 轻量流体实体 - 可作为独立实体被 EntityManager 管理
 * 内部包含一个小型 FluidSimulator（32x32），用于模拟水滴、碎片等小型流体效果
 * 
 * 水量与大小换算机制：
 * - waterVolume: 0~1，表示水量占比（1 = 完整的32x32纹理被水填满）
 * - 实际水球大小 = baseScale * sqrt(waterVolume) * sizeMultiplier
 * - 纹理中的水半径 = sqrt(waterVolume) * texSize * 0.45
 */
export class LightFluidEntity extends Entity {
    private simulator: FluidSimulator;
    private renderer: THREE.WebGLRenderer;
    
    public waterVolume: number = 0.45;  // 水量占比 0~1
    public worldVelocity: THREE.Vector3;
    
    private readonly texSize = 32;       // 内部纹理尺寸（保持32x32不变）
    private readonly baseScale = 2.0;    // 基础缩放（控制纹理本身的显示大小）
    private readonly sizeMultiplier = 1.25; // 绘制大小倍增器（水滴过于大，缩小到1/4）
    private age: number = 0;
    public maxAge: number = 10;
    private frameCount: number = 0;
    private prevWorldVelocity: THREE.Vector3 = new THREE.Vector3();

    constructor(
        id: string, 
        renderer: THREE.WebGLRenderer, 
        initialPosition?: THREE.Vector3,
        initialVelocity?: THREE.Vector3,
        waterVolume: number = 0.45,       // 修改为直接传入水量
        maxAge: number = 10
    ) {
        // 确保水量在有效范围内
        waterVolume = Math.max(0.01, Math.min(1.0, waterVolume));
        
        const params: FluidParams = {
            width: 32,
            height: 32,
            density: 1000,
            viscosity: 0.0001,              // ★ 降低粘度，让流体更容易流动
            surfaceTension: 0.01,           // ★ 降低表面张力，让边界更活跃
            gravity: 50.0,                  // ★ 增大重力（在小纹理上需要更大的值）
            pressureIterations: 8,
            reinitIterations: 2,
            timeStep: 0.005,                // ★ 增大时间步长，加快模拟
            restitution: 0.8,
            friction: 0.99,                 // ★ 降低摩擦
            usePCG: false,
            maxLifetime: 0,
            decoupledBoundary: false,
            usePerturbation: false,
            injectionEnabled: false,
        };

        // 根据水量计算绘制大小
        // 大小与水量的平方根成正比（面积与水量成正比）
        const displayScale = LightFluidEntity.calculateDisplayScale(waterVolume);

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0x3399ff, 
            transparent: true, 
            opacity: 0.8 
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.set(displayScale, displayScale, 1);
        mesh.rotation.z = Math.random() * Math.PI * 2;

        super(id, 'lightFluid', mesh);
        
        this.renderer = renderer;
        this.waterVolume = waterVolume;
        this.maxAge = maxAge;
        
        this.simulator = new FluidSimulator(renderer, params);
        this.setInitialWaterVolume(waterVolume);
        this.setInitialVelocity(0, -200.0); // 初始速度场：向下 200.0
        
        const renderMaterial = this.simulator.getRenderMaterial();
        this.mesh.material = renderMaterial;

        this.worldVelocity = initialVelocity?.clone() ?? new THREE.Vector3();
        if (initialPosition) {
            this.mesh.position.copy(initialPosition);
            this.position.copy(initialPosition);
        }
        
        // 碰撞半径也根据水量计算
        this.radius = displayScale * 0.5;

        console.log(`[LightFluidEntity] 创建液滴: ${id}`);
        console.log(`  - 位置: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)})`);
        console.log(`  - 速度: (${this.worldVelocity.x.toFixed(2)}, ${this.worldVelocity.y.toFixed(2)}, ${this.worldVelocity.z.toFixed(2)})`);
        console.log(`  - 水量: ${(waterVolume * 100).toFixed(1)}%`);
        console.log(`  - 绘制大小: ${displayScale.toFixed(3)}`);
        console.log(`  - 纹理尺寸: ${this.texSize}x${this.texSize}`);
        console.log(`  - 最大生命周期: ${this.maxAge}s`);
    }

    /**
     * 根据水量计算显示大小
     * @param waterVolume 水量占比（0~1）
     * @returns 显示缩放值
     */
    public static calculateDisplayScale(waterVolume: number): number {
        const baseScale = 2.0;
        const sizeMultiplier = 1.25;
        const randomFactor = 0.6 + Math.random() * 0.8;
        return baseScale * Math.sqrt(waterVolume) * sizeMultiplier * randomFactor;
    }

    public setInitialVelocity(vx: number, vy: number): void {
        this.simulator.setInitialVelocity(vx, vy);
    }

    private setInitialWaterVolume(volume: number): void {
        const w = this.texSize, h = this.texSize;
        const data = new Float32Array(w * h * 4);
        const cx = w / 2, cy = h / 2;
        const baseRadius = Math.sqrt(volume) * w * 0.45;

        const hash = (x: number, y: number): number => {
            let h = x * 374761393 + y * 668265263;
            h = (h ^ (h >> 13)) * 1274126177;
            return (h ^ (h >> 16)) / 2147483648;
        };

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const dx = x - cx, dy = y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);

                let perturbation = 0;
                for (let oct = 1; oct <= 3; oct++) {
                    const freq = 1 << oct;
                    perturbation += (hash((x * freq) % w, (y * freq) % h) - 0.5) * 2.0 / oct;
                }
                perturbation *= 2.0;

                const perturbedRadius = baseRadius + perturbation;
                data[i] = dist - perturbedRadius;
                data[i + 1] = 0;
                data[i + 2] = 0;
                data[i + 3] = 1;
            }
        }
        
        const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
        tex.needsUpdate = true;
        this.simulator.setLevelSetTexture(tex);
        tex.dispose();
    }

    update(delta: number): void {
        if (!this.isActive) return;

        this.age += delta;
        this.frameCount++;

        if (this.age > this.maxAge) {
            this.isActive = false;
            return;
        }

        this.mesh.position.x += this.worldVelocity.x * delta;
        this.mesh.position.y += this.worldVelocity.y * delta;
        this.mesh.position.z += this.worldVelocity.z * delta;
        this.position.copy(this.mesh.position);

        if (!this.simulator) return;

        const accel = new THREE.Vector3().subVectors(this.worldVelocity, this.prevWorldVelocity).divideScalar(delta);
        this.prevWorldVelocity.copy(this.worldVelocity);

        const internalForceX = -accel.x * 0.5;
        const internalForceY = -accel.y * 0.5;
        this.simulator.addVelocityImpulse(internalForceX, internalForceY);

        this.simulator.update(delta);

        const newMaterial = this.simulator.getRenderMaterial();
        if (this.mesh.material !== newMaterial) {
            if (this.mesh.material instanceof THREE.ShaderMaterial) {
                this.mesh.material.dispose();
            }
            this.mesh.material = newMaterial;
        }
    }

    private readPhiCenter(): number {
        const w = this.texSize, h = this.texSize;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const buffer = new Float32Array(w * h * 4);
        try {
            this.renderer.readRenderTargetPixels(this.simulator.getCurPhiTex(), 0, 0, w, h, buffer);
            return buffer[(cy * w + cx) * 4];
        } catch (e) {
            console.error(`[LightFluidEntity] 读取phi失败: ${e}`);
            return 0;
        }
    }

    private readVelCenter(): THREE.Vector2 {
        const w = this.texSize, h = this.texSize;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const buffer = new Float32Array(w * h * 4);
        try {
            this.renderer.readRenderTargetPixels(this.simulator.getCurVelTex(), 0, 0, w, h, buffer);
            const vx = buffer[(cy * w + cx) * 4];
            const vy = buffer[(cy * w + cx) * 4 + 1];
            return new THREE.Vector2(vx, vy);
        } catch (e) {
            console.error(`[LightFluidEntity] 读取vel失败: ${e}`);
            return new THREE.Vector2(0, 0);
        }
    }

    public applyForce(force: THREE.Vector3, delta: number): void {
        this.worldVelocity.add(force.clone().multiplyScalar(delta));
    }

    public applyImpulse(impulse: THREE.Vector3): void {
        this.worldVelocity.add(impulse);
    }

    public setVelocity(velocity: THREE.Vector3): void {
        this.worldVelocity.copy(velocity);
    }

    public isEmpty(): boolean {
        return this.waterVolume < 0.05;
    }

    public getSimulator(): FluidSimulator {
        return this.simulator;
    }

    onDestroy(): void {
        super.onDestroy();
        this.simulator.dispose();
        this.mesh.geometry.dispose();
        if (this.mesh.material instanceof THREE.ShaderMaterial) {
            this.mesh.material.dispose();
        }
    }
}
