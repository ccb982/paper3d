import * as THREE from 'three';
import { FluidSimulator } from '@lib/fluid-simulator/fluid-simulator';
import type { FluidParams } from '@lib/fluid-simulator/fluid-simulator';
import { Entity } from '@core/Entity';
import { FluidLOD } from './FluidRegionManager';
import type { IFluidForceTarget, FluidExternalForce } from '@entities/fluid';

/**
 * 轻量流体实体 - 可作为独立实体被 EntityManager 管理
 * 内部包含一个小型 FluidSimulator（32x32），用于模拟水滴、碎片等小型流体效果
 * 
 * 水量与大小换算机制：
 * - waterVolume: 0~1，表示水量占比（1 = 完整的32x32纹理被水填满）
 * - 实际水球大小 = baseScale * sqrt(waterVolume) * sizeMultiplier
 * - 纹理中的水半径 = sqrt(waterVolume) * texSize * 0.45
 */
export class LightFluidEntity extends Entity implements IFluidForceTarget {
    private simulator: FluidSimulator;
    private renderer: THREE.WebGLRenderer;
    
    public waterVolume: number = 0.45;  // 水量占比 0~1
    public worldVelocity: THREE.Vector3;
    
    private readonly texSize = 32;       // 内部纹理尺寸（保持32x32不变）
    private readonly baseScale = 2.0;    // 基础缩放（控制纹理本身的显示大小）
    private readonly sizeMultiplier = 1.25; // 绘制大小倍增器（水滴过于大，缩小到1/4）
    private age: number = 0;
    public maxAge: number = 5;
    private frameCount: number = 0;
    private prevWorldVelocity: THREE.Vector3 = new THREE.Vector3();
    
    // LOD 相关
    public lod: FluidLOD = FluidLOD.HIGH;
    private simUpdateAccumulated: number = 0;
    
    // 外部力累积（每帧加速度）
    private externalAccel = new THREE.Vector3();
    private pendingForces: FluidExternalForce[] = [];
    
    // 呼吸/脉动效果参数
    private breathingPhase: number = 0;       // 呼吸相位
    private breathingSpeed: number;           // 呼吸频率（每秒周期数）- 随机化
    private breathingAmplitude: number;       // 呼吸强度（散度幅度）- 随机化
    private breathingOffset: number;          // 呼吸相位偏移（让每个水滴不同步）
    private breathingDirection: number;        // 当前膨胀主方向（弧度）
    private expandChoice: boolean = true;      // 当前选择：true=膨胀，false=收缩
    private expandChoiceFrames: number = 0;   // 当前选择已持续帧数

    constructor(
        id: string, 
        renderer: THREE.WebGLRenderer, 
        initialPosition?: THREE.Vector3,
        initialVelocity?: THREE.Vector3,
        waterVolume: number = 0.45,       // 修改为直接传入水量
        maxAge: number = 5                // 寿命改为5秒
    ) {
        // 确保水量在有效范围内
        waterVolume = Math.max(0.01, Math.min(1.0, waterVolume));
        
        // 性能优化：精简模拟参数，针对小水滴牺牲部分物理细节以降低开销
        const params: FluidParams = {
            width: 32,
            height: 32,
            density: 1000,
            viscosity: 0.001,
            surfaceTension: 0.03,
            gravity: 5.0,
            pressureIterations: 1,        // 优化：减少压力迭代次数（原为3）
            reinitIterations: 0,          // 优化：关闭重初始化（原为1），小水滴表面张力不重要
            timeStep: 0.01,               // 优化：增大时间步长（原为0.005），更少子步也能稳定
            restitution: 0.2,
            friction: 0.9,
            usePCG: false,                // 禁用PCG（避免GPU回读卡顿）
            maxLifetime: 0,
            decoupledBoundary: false,
            usePerturbation: false,
            injectionEnabled: false,
            enableCentering: true,       // 启用纹理居中追踪
            centeringInterval: 1.0,     // 居中追踪间隔1秒，减少GPU回读频率
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
        
        // ★ 初始化呼吸效果参数（随机化让每个水滴不同）
        this.breathingSpeed = 1.5 + Math.random() * 2.0;   // 1.5~3.5 Hz
        this.breathingAmplitude = 4000 + Math.random() * 3000; // 4000~7000 散度强度
        this.breathingOffset = Math.random() * Math.PI * 2;    // 随机相位偏移
        this.breathingDirection = Math.random() * Math.PI * 2; // 随机初始方向
        
        this.simulator = new FluidSimulator(renderer, params);
        this.setInitialWaterVolume(waterVolume);
        this.setInitialVelocity(0, -20.0); // 降低初始速度，让水滴保持在中心附近
        
        const renderMaterial = this.simulator.getRenderMaterial();
        this.mesh.material = renderMaterial;

        this.worldVelocity = initialVelocity?.clone() ?? new THREE.Vector3();
        if (initialPosition) {
            this.mesh.position.copy(initialPosition);
            this.position.copy(initialPosition);
        }
        
        // 碰撞半径也根据水量计算
        this.radius = displayScale * 0.5;
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
        
        // 液滴形状参数
        const baseRadius = Math.sqrt(volume) * w * 0.4;
        
        // 液滴形状系数：垂直方向拉长，顶部变尖
        const verticalStretch = 1.3;   // 垂直拉伸
        const topTaper = 0.6;          // 顶部收缩系数
        const bottomBulge = 1.2;       // 底部膨胀系数

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const dx = x - cx;
                const dy = y - cy;
                
                // 液滴形状计算
                // 将圆形转换为水滴形状：底部圆润，顶部尖细
                const normalizedY = dy / (h * 0.5); // -1 到 1，顶部为负，底部为正
                
                // 根据垂直位置调整半径
                let radiusScale = 1.0;
                if (normalizedY < 0) {
                    // 顶部区域：逐渐变尖
                    radiusScale = topTaper + (1.0 - topTaper) * (1.0 + normalizedY);
                } else {
                    // 底部区域：略微膨胀
                    radiusScale = 1.0 + (bottomBulge - 1.0) * normalizedY;
                }
                
                // 垂直方向拉伸
                const adjustedDy = dy * verticalStretch;
                
                // 计算液滴形状的距离
                const dist = Math.sqrt(dx * dx + adjustedDy * adjustedDy);
                const adjustedRadius = baseRadius * radiusScale;

                // 规则的液滴形状（无随机扰动）
                data[i] = dist - adjustedRadius; // phi: 内部负，外部正
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

    // 模拟器内部固定时间步长
    private readonly simTimeStep = 0.01;

    update(delta: number): void {
        if (!this.isActive) return;

        // 始终维护生命周期
        this.age += delta;
        this.frameCount++;

        // 寿命检测
        if (this.age > this.maxAge) {
            console.log(`[LightFluidEntity] 液滴 ${this.id} 寿命结束: age=${this.age.toFixed(2)}s, maxAge=${this.maxAge}s`);
            this.isActive = false;
            return;
        }

        // OFF 级别：完全跳过更新
        if (this.lod === FluidLOD.OFF) {
            this.mesh.visible = false;
            return;
        }

        // 应用累积的外部加速度
        if (this.externalAccel.lengthSq() > 0.0001) {
            this.worldVelocity.add(this.externalAccel.clone().multiplyScalar(delta));
        }
        // 重置外部加速度（每帧重新累积）
        this.externalAccel.set(0, 0, 0);

        // 位置更新（始终执行，不受LOD影响）
        this.mesh.position.x += this.worldVelocity.x * delta;
        this.mesh.position.y += this.worldVelocity.y * delta;
        this.mesh.position.z += this.worldVelocity.z * delta;
        this.position.copy(this.mesh.position);

        if (!this.simulator) return;

        // 根据LOD获取模拟更新间隔
        const simInterval = this.getSimInterval();

        // 累积时间步
        this.simUpdateAccumulated += delta;

        // 仅当累积时间达到间隔时才更新模拟
        if (this.simUpdateAccumulated >= simInterval) {
            this.processPendingForces(this.simUpdateAccumulated);

            // 计算加速度（基于累计时间，更准确）
            const accel = new THREE.Vector3().subVectors(this.worldVelocity, this.prevWorldVelocity).divideScalar(this.simUpdateAccumulated || delta);
            this.prevWorldVelocity.copy(this.worldVelocity);

            const internalForceX = -accel.x * 0.5;
            const internalForceY = -accel.y * 0.5;
            this.simulator.addVelocityImpulse(internalForceX, internalForceY);

            // ★★★ 内部随机微风：让水滴一直有内部流动，非常生动 ★★★
            if (this.lod < FluidLOD.LOW) {
                const windAngle = Math.random() * Math.PI * 2;
                const windStrength = 0.3 + Math.random() * 0.4;
                this.simulator.addVelocityImpulse(
                    Math.cos(windAngle) * windStrength,
                    Math.sin(windAngle) * windStrength
                );
            }

            // 呼吸/脉动效果（已禁用）
            this.breathingPhase += this.breathingSpeed * this.simUpdateAccumulated;

            // ★★★ 修复：执行多个子步让物理时间跟上真实时间 ★★★
            const substeps = Math.max(1, Math.floor(this.simUpdateAccumulated / this.simTimeStep));
            const actualSubsteps = Math.min(substeps, 10);

            for (let s = 0; s < actualSubsteps; s++) {
                this.simulator.update(this.simTimeStep);
            }

            this.simulator.updateRenderUniforms();

            this.simUpdateAccumulated -= actualSubsteps * this.simTimeStep;
        }

        // 纹理更新控制：LOW级别冻结纹理
        if (this.lod === FluidLOD.LOW) {
            this.simulator.setTextureUpdateEnabled(false);
        } else {
            this.simulator.setTextureUpdateEnabled(true);
            const newMaterial = this.simulator.getRenderMaterial();
            if (this.mesh.material !== newMaterial) {
                if (this.mesh.material instanceof THREE.ShaderMaterial) {
                    this.mesh.material.dispose();
                }
                this.mesh.material = newMaterial;
            }
        }

        this.mesh.visible = true;
    }

    /**
     * 根据LOD级别获取模拟更新间隔（秒）
     * 性能优化：降低模拟更新频率，小水滴不需要60Hz的物理精度
     */
    private getSimInterval(): number {
        switch (this.lod) {
            case FluidLOD.HIGH:
                return 1 / 30;  // 30 FPS（原为0，每帧更新）
            case FluidLOD.MEDIUM:
                return 1 / 20;  // 20 FPS（原为1/30）
            case FluidLOD.LOW:
                return 1 / 12;  // 12 FPS（原为1/15）
            default:
                return Number.MAX_VALUE;  // 不更新
        }
    }

    // ===========================================
    // GPU 回读方法（已禁用 - 性能杀手，仅用于调试）
    // ===========================================
    /*
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
    */

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

    // ==================== IFluidForceTarget 接口实现 ====================

    isMovable(): boolean {
        return true; // 小液滴可以在世界空间移动
    }

    applyFluidForce(force: FluidExternalForce): void {
        // ========== 1. 世界运动 ==========
        if (force.worldImpulse) {
            this.applyImpulse(force.worldImpulse);
        }
        if (force.worldAcceleration) {
            // 加速度累积，在 update() 中每帧施加
            this.externalAccel.add(force.worldAcceleration);
        }

        // ========== 2. 内部流场注入（缓存后在 update 中处理） ==========
        if (force.velocityInjection || force.divergenceInjection || force.waterInjection) {
            this.pendingForces.push(force);
        }
    }

    private processPendingForces(dt: number): void {
        if (this.lod >= FluidLOD.LOW || this.pendingForces.length === 0) return; // 低LOD或OFF时纹理冻结，跳过注入

        const sim = this.simulator;
        if (!sim) return;

        // 将世界方向转为纹理空间方向（考虑液滴随机旋转）
        const worldToTex = (v: THREE.Vector2): THREE.Vector2 => {
            const angle = -this.mesh.rotation.z;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const tx = v.x * cos - v.y * sin;
            const ty = v.x * sin + v.y * cos;
            return new THREE.Vector2(tx, ty);
        };

        for (const force of this.pendingForces) {
            if (force.velocityInjection) {
                const inj = force.velocityInjection;
                const vel = worldToTex(inj.velocity);
                const dvx = vel.x * dt;
                const dvy = vel.y * dt;
                sim.addVelocityImpulse(dvx, dvy);
            }

            if (force.divergenceInjection) {
                const inj = force.divergenceInjection;
                const center = inj.centerUV ?? new THREE.Vector2(0.5, 0.5);
                sim.addDivergenceImpulse(inj.divergence, inj.radius ?? 0.2, center.x, center.y);
            }

            if (force.waterInjection) {
                const inj = force.waterInjection;
                const center = inj.centerUV ?? new THREE.Vector2(0.5, 0.5);
                sim.addWaterImpulse(inj.amount, inj.radius ?? 0.2, center.x, center.y);
            }
        }

        this.pendingForces.length = 0;
    }
}
