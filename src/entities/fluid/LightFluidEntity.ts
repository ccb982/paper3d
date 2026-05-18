import * as THREE from 'three';
import { FluidSimulator } from '@lib/fluid-simulator/fluid-simulator';
import type { FluidParams } from '@lib/fluid-simulator/fluid-simulator';
import { Entity } from '@core/Entity';
import { FluidLOD } from './FluidTypes';
import type { IFluidForceTarget, FluidExternalForce } from '@entities/fluid';
import { GRAVITY, GROUND_HEIGHT } from '../../utils/constants';

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
    
    private readonly texSize = 32;       // 内部纹理尺寸（保持32x32不变）
    private readonly baseScale = 2.0;    // 基础缩放（控制纹理本身的显示大小）
    private readonly sizeMultiplier = 1.25; // 绘制大小倍增器（水滴过于大，缩小到1/4）
    private age: number = 0;
    public maxAge: number = 5;
    private frameCount: number = 0;
    private prevVelocity: THREE.Vector3 = new THREE.Vector3();  // 用于惯性挤压计算
    
    // LOD 相关
    public lod: FluidLOD = FluidLOD.HIGH;
    private simUpdateAccumulated: number = 0;
    
    // 外部力累积（每帧加速度）
    private externalAccel = new THREE.Vector3();
    private pendingForces: FluidExternalForce[] = [];

    // 可见性裁剪相关
    private externalCamera: THREE.Camera | null = null;
    private isVisibleInCamera: boolean = true;
    private visibilityCheckInterval: number = 0.5;  // 每0.5秒检查一次
    private lastVisibilityCheckTime: number = 0;
    private cachedWorldRadius: number = 1.0;  // 小液滴的典型半径
    
    // 旋转插值相关
    private currentRotation: number = 0;      // 当前旋转角度
    private rotationLerp: number = 0.1;       // 插值速度

    constructor(
        id: string, 
        renderer: THREE.WebGLRenderer, 
        initialPosition?: THREE.Vector3,
        initialVelocity?: THREE.Vector3,
        waterVolume: number = 0.45,       // 修改为直接传入水量
        maxAge: number = 100                // 寿命改为5秒
    ) {
        // 确保水量在有效范围内
        waterVolume = Math.max(0.01, Math.min(1.0, waterVolume));
        
        // 性能优化：精简模拟参数，针对小水滴牺牲部分物理细节以降低开销
        // 注意：不再在模拟器内设置 gravity，重力由 GravitySystem 统一管理
        const params: FluidParams = {
            width: 32,
            height: 32,
            density: 1000,
            viscosity: 0.001,
            surfaceTension: 0.1,          // 让界面更紧凑，受力后回弹更真实
            gravity: 0,                    // 重力由 GravitySystem 统一应用，不再内部处理
            pressureIterations: 4,        // 提高压力迭代，让压力场能真正响应散度
            reinitIterations: 1,          // 每100帧执行1次：单次迭代次数
            reinitInterval: 100,         // 每100帧执行1次：间隔帧数
            timeStep: 0.01,              // 略减小步长，提高稳定性，使外力可更精确地每一步作用
            restitution: 0.2,
            friction: 0.9,
            usePCG: false,                // 禁用PCG（避免GPU回读卡顿）
            maxLifetime: 0,
            decoupledBoundary: false,
            usePerturbation: false,
            injectionEnabled: false,
            enableCentering: true,       // 启用纹理居中追踪
            centeringInterval: 0.1,     // 居中追踪间隔1秒，减少GPU回读频率
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

        super(id, 'lightFluid', mesh);
        
        this.renderer = renderer;
        this.waterVolume = waterVolume;
        this.maxAge = maxAge;

        this.simulator = new FluidSimulator(renderer, params);
        this.setInitialWaterVolume(waterVolume);
        // 实体初始速度（第一帧会触发惯性挤压效果）
        // 使用基类的 velocity 属性（而非独立的 worldVelocity）
        const defaultVelocity = new THREE.Vector3(0, -20.0, 0);
        this.velocity = initialVelocity?.clone() ?? defaultVelocity;
        this.prevVelocity.copy(this.velocity);  // 初始化前一帧速度

        const renderMaterial = this.simulator.getRenderMaterial();
        this.mesh.material = renderMaterial;

        if (initialPosition) {
            this.mesh.position.copy(initialPosition);
            this.position.copy(initialPosition);
            // 设置模拟器的世界变换用于可见性检测
            this.simulator.setWorldTransform(initialPosition, displayScale * 0.5);
        }
        
        // 碰撞半径也根据水量计算
        this.radius = displayScale * 0.5;
        
        // 设置小液滴的可见性检测半径
        this.cachedWorldRadius = displayScale * 0.5;
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
        
        // ========== 1. 根据水量计算基础尺寸 ==========
        // 形状：上三角 + 下半圆
        // 面积 = 三角形面积 + 半圆面积 = r² + πr²/2 ≈ 2.57r²
        // r = √(面积 / 2.57)
        const area = volume * w * h;
        const r = Math.sqrt(area / 2.57);
        
        // 随机高宽比（高矮胖瘦）
        const heightRatio = 0.8 + Math.random() * 0.4;  // 0.8~1.2，高
        const widthRatio = 0.3 + Math.random() * 0.3;  // 0.6~1.2，胖
        const halfW = r * widthRatio;
        const halfH = r * heightRatio;
        
        // ========== 2. 角平分线朝向（初始运动方向） ==========
        // 默认竖直向下（重力）
        const angle = this.velocity.lengthSq() > 0.001 
            ? -Math.atan2(this.velocity.y, this.velocity.x)  // 负号：纹理Y轴朝下
            : 0;  // 默认：尖端朝上
        
        // 纹理中心 = 重心位置
        const centerX = w / 2;
        const centerY = h / 2;
        
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                
                // 转换为以重心为原点的坐标
                let dx = (x - centerX) / halfW;
                let dy = (y - centerY) / halfH;  // y向下为正（UV坐标系）
                
                // 旋转到角平分线方向
                const rotX = dx * cosA - dy * sinA;
                const rotY = dx * sinA + dy * cosA;
                
                // rotY > 0 是上方（三角形尖端向下），rotY < 0 是下方（半圆向上）
                let phi: number;
                
                if (rotY > 0) {
                    // 三角形尖端区域：rotY 从 0 递增到 1
                    const t = rotY;  // 0~1，从底边到尖端
                    const triWidth = 1.0 - t;  // 底边宽，逐渐变尖
                    phi = Math.abs(rotX) - triWidth;
                } else {
                    // 半圆区域：rotY 从 0 递减到 -1，圆心在 rotY=0
                    phi = Math.sqrt(rotX * rotX + rotY * rotY) - 1.0;
                }
                
                data[i] = phi;         // phi: 内部负，外部正
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
    private readonly simTimeStep = 0.008;

    update(delta: number): void {
        if (!this.isActive) return;

        // 始终维护生命周期
        this.age += delta;
        this.frameCount++;

        // 调试：每60帧输出一次状态
        if (this.frameCount % 60 === 0) {
            console.log(`[LightFluid:${this.id}] frame=${this.frameCount}, age=${this.age.toFixed(2)}/${this.maxAge}, LOD=${FluidLOD[this.lod]}, visible=${this.isVisibleInCamera}, vel=${this.velocity.length().toFixed(1)}, pos=(${this.mesh.position.x.toFixed(1)}, ${this.mesh.position.y.toFixed(1)})`);
        }

        // 寿命检测
        if (this.age > this.maxAge) {
            this.isActive = false;
            return;
        }

        // OFF 级别：完全跳过更新
        if (this.lod === FluidLOD.OFF) {
            this.mesh.visible = false;
            return;
        }

        // ★★★ 复用 Entity 基类的 velocity + GravitySystem 重力 ★★★
        // 应用累积的外部加速度vel.y -= gravity * dt;  // 模拟器内部重力

        if (this.externalAccel.lengthSq() > 0.0001) {
            this.velocity.add(this.externalAccel.clone().multiplyScalar(delta));
        }
        // 重置外部加速度（每帧重新累积）
        this.externalAccel.set(0, 0, 0);

        // 应用重力（使用统一的 GravitySystem）
        this.velocity.y += GRAVITY * delta;

        // 地面碰撞检测
        const groundY = GROUND_HEIGHT + this.radius * 0.5 + 0.2;
        if (this.position.y <= groundY) {
            this.position.y = groundY;
            this.velocity.y = 0;
            // 地面摩擦
            this.velocity.x *= 0.95;
            this.velocity.z *= 0.95;
        }

        // 位置更新（始终执行，不受LOD和可见性影响）
        this.mesh.position.x += this.velocity.x * delta;
        this.mesh.position.y += this.velocity.y * delta;
        this.mesh.position.z += this.velocity.z * delta;
        this.position.copy(this.mesh.position);
        
        // 旋转插值：重心（半圆那头）朝运动方向，尖端朝运动反方向
        if (this.velocity.lengthSq() > 0.01) {
            // atan2(vx, -vy)：让半圆那头朝下（运动方向）
            const targetAngle = Math.atan2(this.velocity.x, -this.velocity.y);
            // 角度插值（处理跨越 -π/π 的情况）
            let diff = targetAngle - this.currentRotation;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            this.currentRotation += diff * this.rotationLerp;
            this.mesh.rotation.z = this.currentRotation;
        }

        // 更新模拟器的世界位置（用于可见性检测）
        if (this.simulator) {
            this.simulator.setWorldTransform(this.mesh.position, this.cachedWorldRadius);
        }

        if (!this.simulator) return;

        // 可见性检测：不可见时跳过纹理模拟更新
        const isVisible = this.updateVisibilityIfNeeded(performance.now() / 1000);
        
        // 根据可见性和LOD控制纹理更新
        if (!isVisible || this.lod === FluidLOD.LOW) {
            this.simulator.setTextureUpdateEnabled(false);
            this.mesh.visible = true;
            // 如果不可见，跳过模拟更新但保留渲染
            if (!isVisible) {
                return;
            }
        } else {
            this.simulator.setTextureUpdateEnabled(true);
        }

        // 根据LOD获取模拟更新间隔
        const simInterval = this.getSimInterval();

        // 累积时间步
        this.simUpdateAccumulated += delta;

        // 仅当累积时间达到间隔时才更新模拟
        if (this.simUpdateAccumulated >= simInterval) {
            this.processPendingForces(this.simUpdateAccumulated);

            // 计算加速度（基于累计时间，更准确）
            // 使用基类的 velocity
            const accel = new THREE.Vector3().subVectors(this.velocity, this.prevVelocity).divideScalar(this.simUpdateAccumulated || delta);
            this.prevVelocity.copy(this.velocity);

            // 将世界加速度转化为局部散度注入，模拟惯性挤压
            if (accel.length() > 1.0) { // 只对明显的加速度反应
                const accelDir = new THREE.Vector2(accel.x, accel.y).normalize();
                // 在加速度反方向的边缘注入散度，模拟惯性让水向一边堆积
                const offsetDist = 0.3; // 偏离中心的距离
                const cx = 0.5 - accelDir.x * offsetDist;
                const cy = 0.5 - accelDir.y * offsetDist;
                const squeeze = accel.length() * 200; // 降低散度强度，避免数值不稳定
                // 调试：惯性挤压触发
                if (this.frameCount % 60 === 0) {
                    console.log(`[LightFluid:${this.id}] 惯性挤压: accel=${accel.length().toFixed(1)}, squeeze=${squeeze.toFixed(0)}, dir=(${accelDir.x.toFixed(2)}, ${accelDir.y.toFixed(2)})`);
                }
                this.simulator.addDivergenceImpulse(-squeeze, 0.25, cx, cy); // 负散度 = 向外推
            }

            // ★★★ 修复：执行多个子步让物理时间跟上真实时间 ★★★
            const substeps = Math.max(1, Math.floor(this.simUpdateAccumulated / this.simTimeStep));
            const actualSubsteps = Math.min(substeps, 10);

            for (let s = 0; s < actualSubsteps; s++) {
                this.simulator.update(this.simTimeStep);
            }

            this.simulator.updateRenderUniforms();

            this.simUpdateAccumulated -= actualSubsteps * this.simTimeStep;
        }

        // 纹理更新控制：更新材质引用（如果LOD不是LOW且可见）
        if (this.isVisibleInCamera && this.lod !== FluidLOD.LOW) {
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
        // 使用基类的 velocity
        this.velocity.add(force.clone().multiplyScalar(delta));
    }

    public applyImpulse(impulse: THREE.Vector3): void {
        // 使用基类的 velocity
        this.velocity.add(impulse);
    }

    public setVelocity(velocity: THREE.Vector3): void {
        // 使用基类的 velocity
        this.velocity.copy(velocity);
    }

    public setCamera(camera: THREE.Camera): void {
        this.externalCamera = camera;
        this.simulator.setCamera(camera);
    }

    public setWorldRadius(radius: number): void {
        this.cachedWorldRadius = radius;
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

        const sphere = new THREE.Sphere(this.mesh.position, this.cachedWorldRadius);
        return frustum.intersectsSphere(sphere);
    }

    private updateVisibilityIfNeeded(currentTime: number): boolean {
        if (currentTime - this.lastVisibilityCheckTime >= this.visibilityCheckInterval) {
            this.lastVisibilityCheckTime = currentTime;
            const wasVisible = this.isVisibleInCamera;
            this.isVisibleInCamera = this.checkVisibility();
            if (wasVisible && !this.isVisibleInCamera) {
                console.log(`[LightFluidEntity] 液滴 ${this.id} 移出视野，暂停模拟`);
            } else if (!wasVisible && this.isVisibleInCamera) {
                console.log(`[LightFluidEntity] 液滴 ${this.id} 进入视野，恢复模拟`);
            }
        }
        return this.isVisibleInCamera;
    }

    public isEmpty(): boolean {
        return this.waterVolume < 0.05;
    }

    public getSimulator(): FluidSimulator {
        return this.simulator;
    }

    onDestroy(): void {
        super.onDestroy();
        // 先释放 mesh.material（它引用的是 simulator.getRenderMaterial() 返回的 renderMaterial）
        // 由于 mesh.material 和 simulator.renderMaterial 是同一个对象，
        // simulator.dispose() 也会释放它，所以需要先处理避免双重释放
        const mat = this.mesh.material;
        this.mesh.material = new THREE.MeshBasicMaterial(); // 临时替换为空白材质
        if (mat instanceof THREE.ShaderMaterial) {
            mat.dispose();
        } else if (mat instanceof THREE.Material) {
            mat.dispose();
        }
        // 再释放几何体
        this.mesh.geometry.dispose();
        // 最后释放 simulator（会释放内部所有纹理和材质，包括原来的 renderMaterial）
        this.simulator.dispose();
    }

    // ==================== IFluidForceTarget 接口实现 ====================

    isMovable(): boolean {
        return true; // 小液滴可以在世界空间移动
    }

    getPosition(): THREE.Vector3 {
        return this.position;
    }

    getBoundingRadius(): number {
        // 返回液滴的世界空间半径
        return this.cachedWorldRadius;
    }

    applyFluidForce(force: FluidExternalForce): void {
        // ========== 1. 世界运动 ==========
        if (force.worldImpulse) {
            // 调试：冲量接收
            console.log(`[LightFluid:${this.id}] 接收冲量: (${force.worldImpulse.x.toFixed(2)}, ${force.worldImpulse.y.toFixed(2)}, ${force.worldImpulse.z.toFixed(2)})`);
            this.applyImpulse(force.worldImpulse);
        }
        if (force.worldAcceleration) {
            // 调试：加速度接收
            console.log(`[LightFluid:${this.id}] 接收加速度: (${force.worldAcceleration.x.toFixed(2)}, ${force.worldAcceleration.y.toFixed(2)}, ${force.worldAcceleration.z.toFixed(2)})`);
            // 加速度累积，在 update() 中每帧施加
            this.externalAccel.add(force.worldAcceleration);
        }

        // ========== 2. 内部流场注入（缓存后在 update 中处理） ==========
        if (force.velocityInjection || force.divergenceInjection || force.waterInjection) {
            // 调试：流场注入
            if (force.velocityInjection) {
                console.log(`[LightFluid:${this.id}] 速度注入: (${force.velocityInjection.velocity.x.toFixed(2)}, ${force.velocityInjection.velocity.y.toFixed(2)}), r=${force.velocityInjection.radius}`);
            }
            if (force.divergenceInjection) {
                console.log(`[LightFluid:${this.id}] 散度注入: ${force.divergenceInjection.divergence.toFixed(0)}, r=${force.divergenceInjection.radius}`);
            }
            if (force.waterInjection) {
                console.log(`[LightFluid:${this.id}] 水量注入: ${force.waterInjection.amount.toFixed(3)}, r=${force.waterInjection.radius}`);
            }
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
                const texVel = worldToTex(inj.velocity);
                const center = inj.centerUV ?? new THREE.Vector2(0.5, 0.5);
                // 使用局部速度注入，限制速度上限防止飞出纹理
                sim.addLocalVelocityImpulse(
                    texVel.x, texVel.y,
                    inj.radius ?? 0.2,
                    center.x, center.y,
                    5.0  // 最大速度限制，适当放宽
                );
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
