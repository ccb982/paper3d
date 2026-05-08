import * as THREE from 'three';
import { FluidSimulator } from '@lib/fluid-simulator/fluid-simulator';
import type { FluidParams } from '@lib/fluid-simulator/fluid-simulator';
import { Entity } from '@core/Entity';

/**
 * 轻量流体实体 - 可作为独立实体被 EntityManager 管理
 * 内部包含一个小型 FluidSimulator（32x32），用于模拟水滴、碎片等小型流体效果
 */
export class LightFluidEntity extends Entity {
    private simulator: FluidSimulator;
    private renderer: THREE.WebGLRenderer;
    
    public waterVolume: number = 0.45;
    public worldVelocity: THREE.Vector3;
    
    private readonly texSize = 32;
    private age: number = 0;
    public maxAge: number = 10;

    constructor(
        id: string, 
        renderer: THREE.WebGLRenderer, 
        initialPosition?: THREE.Vector3,
        initialVelocity?: THREE.Vector3,
        scale: number = 0.3
    ) {
        const params: FluidParams = {
            width: 32,
            height: 32,
            density: 1000,
            viscosity: 0.001,
            surfaceTension: 0.0728,
            gravity: 0,
            pressureIterations: 8,
            reinitIterations: 2,
            timeStep: 0.002,
            restitution: 0.8,
            friction: 0.95,
            usePCG: false,
            maxLifetime: 0,
            decoupledBoundary: false,
            usePerturbation: false,
            injectionEnabled: false,
        };

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0x3399ff, 
            transparent: true, 
            opacity: 0.8 
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.set(scale, scale, 1);
        mesh.rotation.z = Math.random() * Math.PI * 2;

        super(id, 'lightFluid', mesh);
        
        this.renderer = renderer;
        this.simulator = new FluidSimulator(renderer, params);
        this.setInitialWaterVolume(this.waterVolume);
        
        const renderMaterial = this.simulator.getRenderMaterial();
        this.mesh.material = renderMaterial;

        this.worldVelocity = initialVelocity?.clone() ?? new THREE.Vector3();
        if (initialPosition) {
            this.mesh.position.copy(initialPosition);
            this.position.copy(initialPosition);
        }
        
        this.radius = scale * 0.5;

        console.log(`[LightFluidEntity] 创建液滴: ${id}`);
        console.log(`  - 位置: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)})`);
        console.log(`  - 速度: (${this.worldVelocity.x.toFixed(2)}, ${this.worldVelocity.y.toFixed(2)}, ${this.worldVelocity.z.toFixed(2)})`);
        console.log(`  - 缩放: ${scale}, 最大生命周期: ${this.maxAge}s`);
    }

    private setInitialWaterVolume(volume: number): void {
        const w = this.texSize, h = this.texSize;
        const data = new Float32Array(w * h * 4);
        const cx = w / 2, cy = h / 2;
        const radius = Math.sqrt(volume) * w * 0.45;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const dx = x - cx, dy = y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                data[i] = dist - radius;
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
        if (this.age > this.maxAge) {
            console.log(`[LightFluidEntity] 液滴 ${this.id} 达到最大生命周期(${this.maxAge}s)，即将销毁`);
            this.isActive = false;
            return;
        }

        this.mesh.position.x += this.worldVelocity.x * delta;
        this.mesh.position.y += this.worldVelocity.y * delta;
        this.mesh.position.z += this.worldVelocity.z * delta;
        this.position.copy(this.mesh.position);

        this.simulator.update(delta);
        this.simulator.updateRenderUniforms();

        if (this.age < 0.1 || Math.random() < 0.01) {
            console.log(`[LightFluidEntity] 更新液滴: ${this.id}`);
            console.log(`  - 年龄: ${this.age.toFixed(2)}s / ${this.maxAge}s`);
            console.log(`  - 位置: (${this.position.x.toFixed(3)}, ${this.position.y.toFixed(3)}, ${this.position.z.toFixed(3)})`);
            console.log(`  - 速度: (${this.worldVelocity.x.toFixed(3)}, ${this.worldVelocity.y.toFixed(3)}, ${this.worldVelocity.z.toFixed(3)})`);
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
