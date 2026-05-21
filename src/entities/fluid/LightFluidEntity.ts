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

    // ========== 性能优化：预创建的临时对象（避免每帧 GC） ==========
    private _tmpAccel = new THREE.Vector3();      // 加速度计算
    private _tmpAccelDir = new THREE.Vector2();   // 加速度方向
    private _frustum = new THREE.Frustum();       // 视锥体裁剪
    private _projScreenMatrix = new THREE.Matrix4(); // 投影矩阵
    private _sphere = new THREE.Sphere();         // 裁剪球体

    // 尾部挖空效果参数（用于拖尾）
    public trailEnabled: boolean = true;          // 是否启用尾部挖空（默认启用）
    public trailRadius: number = 0.1;             // 尾部挖空半径（纹理空间）
    private trailOffset: number = 0.25;           // 尾部偏移量（相对于中心）
    
    // 挖空位置的UV坐标（在初始化时计算并缓存）
    private cachedTipU: number = 0.5;             // 挖空圆心U坐标
    private cachedTipV: number = 0.5;             // 挖空圆心V坐标
    private cachedTipRadiusUV: number = 0.1;      // 挖空半径（UV空间）

    // 重力开关
    public gravityEnabled: boolean = false;        // 是否启用重力

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
        
        const params: FluidParams = {
            width: 32,
            height: 32,
            density: 1000,
            viscosity: 0.001,
            surfaceTension: 0.1,          // 让界面更紧凑，受力后回弹更真实
            gravity: -10,                    //让纹理更像子弹一点，有这玩意真是太好了
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
            injectionEnabled: true,        // 启用持续水流注入（通过 FluidParams 配置）
            injectionPosX: 0.5,           // 注入位置X（头部中心）
            injectionPosY: 0.25,          // 注入位置Y（头部中心）
            injectionFlowRate: 20.0,      // 持续注入流量
            injectionVelX: 0,             // 注入速度X
            injectionVelY: 0.5,           // 注入速度Y（向下，朝向尾部）
            injectionSize: 0.15,          // 注入区域大小
            enableCentering: false,         // 启用纹理居中追踪
            centeringInterval: 0.1,          // 居中追踪间隔1秒，减少GPU回读频率
            // phi 场后处理修正参数
            clampAirPhi: true,               // 启用空气区 phi 上限钳制
            maxAirPhi: 0.001,                // 空气区 phi 上限
            compensateWaterPhi: true,       // 启用水体区负向补偿
            waterCompensationRate: 0.01,    // 补偿速率（避免水体流失）
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
        
        // ========== 配置持续水流注入（已禁用） ==========效果巨jb不明显，而且有问题
        // if (this.trailEnabled) {
        //     this.simulator.configureInjection({
        //         enabled: true,
        //         posX: 0.5,           // 头部中心X
        //         posY: 0.25,          // 头部中心Y
        //         flowRate: 20.0,      // 持续注入流量
        //         velX: 0,             // 注入速度X
        //         velY: 0.5,           // 注入速度Y（向下，朝向尾部）
        //         size: 0.15           // 注入区域大小
        //     });
        // }
        
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
        const widthRatio = 0.3 + Math.random() * 0.3;  // 0.3~0.6，胖
        const halfW = r * widthRatio;
        const halfH = r * heightRatio;
        
        // ========== 2. 角平分线朝向（统一竖直向下创建） ==========
        // 第0帧会在 update 中转向初速度方向
        const angle = 0;  // 统一竖直向下，尖端朝上
        
        // 纹理中心 = 重心位置
        const centerX = w / 2;
        const centerY = h / 2;
        
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        
        // 尾部挖空参数（尖端位置）
        const trailRadius = this.trailRadius * r;  // 转换回像素空间
        const trailOffsetY = this.trailOffset * r;  // 尖端正方向偏移
        
        // ========== 计算挖空位置的UV坐标并缓存 ==========
        // 挖空圆心在旋转坐标系中是 (rotX=0, rotY=trailOffsetY/halfH)
        // 由于初始化时angle=0（竖直向下），旋转坐标系与归一化坐标系重合
        const dy = trailOffsetY / halfH;  // 归一化Y偏移
        this.cachedTipU = 0.5;  // X居中
        this.cachedTipV = 0.5 + dy;  // Y偏移到尖端方向
        this.cachedTipRadiusUV = trailRadius / halfH;  // UV空间中的挖空半径
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                
                // 转换为以重心为原点的坐标
                let dx = (x - centerX) / halfW;
                let dy = (y - centerY) / halfH;  // y向下为正（UV坐标系）
                
                // 旋转到角平分线方向
                const rotX = dx * cosA - dy * sinA;
                const rotY = dx * sinA + dy * cosA;
                
                // rotY > 0 是上方（三角形尖端），rotY < 0 是下方（半圆）
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
                
                // ========== 3. 尾部挖空（在尖端正方向挖一个圆） ==========
                if (this.trailEnabled) {
                    // 尖端正方向距离
                    const distToTip = rotY;
                    // 只在尖端区域挖空
                    if (distToTip > 0 && distToTip < trailOffsetY * 2) {
                        // 计算到尖端圆心的距离
                        const tipX = 0;
                        const tipY = trailOffsetY / halfH;  // 转换回归一化坐标
                        const tipDist = Math.sqrt(Math.pow(rotX - tipX, 2) + Math.pow(rotY - tipY, 2));
                        const tipRadius = trailRadius / halfH;  // 转换回归一化坐标
                        
                        if (tipDist < tipRadius) {
                            phi = 1.0;  // 挖空（空气）
                        }
                    }
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

    /**
     * 应用子弹形状固体墙（phi大幅削弱）
     * 墙体区域会强制增大phi值（变为空气/固体），仅尾部开口区域允许水通过
     * @param strength 墙体强度（phi增加量，推荐 0.5~1.0）
     * @param bulletLength 子弹总长度（相对于纹理半高，默认 0.9）
     * @param width 子弹宽度（相对于纹理半宽，默认 0.6）
     * @param tailOpeningRadius 尾部开口半径（UV空间，默认 0.12）
     */
    private applyBulletSolidWall(
        strength: number = 100,
        bulletLength: number = 0.9,
        width: number = 0.6,
        tailOpeningRadius: number = 0.12
    ): void {
        const sim = this.simulator;
        if (!sim) return;

        const vs = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const centerU = 0.5;
        const centerV = 0.5;
        const angle = this.mesh.rotation.z;

        const bulletWallMat = new THREE.ShaderMaterial({
            uniforms: {
                phiTex: { value: sim.getCurPhiTex().texture },
                strength: { value: strength },
                center: { value: new THREE.Vector2(centerU, centerV) },
                angle: { value: angle },
                bulletLength: { value: bulletLength },
                width: { value: width },
                tailOpeningRadius: { value: tailOpeningRadius },
                resolution: { value: new THREE.Vector2(this.texSize, this.texSize) }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D phiTex;
                uniform float strength;
                uniform vec2 center;
                uniform float angle;
                uniform float bulletLength;
                uniform float width;
                uniform float tailOpeningRadius;
                uniform vec2 resolution;
                varying vec2 vUv;

                vec2 worldToLocal(vec2 uv) {
                    vec2 p = uv - center;
                    float cosA = cos(angle);
                    float sinA = sin(angle);
                    return vec2(p.x * cosA + p.y * sinA, -p.x * sinA + p.y * cosA);
                }

                float bulletSDF(vec2 p) {
                    float halfLen = bulletLength;
                    float t = (p.y + halfLen) / (2.0 * halfLen);
                    float curveWidth = width * (1.0 - t * 0.3);
                    curveWidth = mix(curveWidth, width * 0.4, smoothstep(0.7, 1.0, t));
                    float horizDist = abs(p.x) - curveWidth;
                    float vertDist = max(abs(p.y) - halfLen, 0.0);
                    return max(horizDist, vertDist);
                }

                void main() {
                    vec2 localUV = worldToLocal(vUv);
                    float phi = texture2D(phiTex, vUv).r;
                    float sdf = bulletSDF(localUV);
                    float tipY = bulletLength * 0.85;
                    float dx = localUV.x;
                    float dy = localUV.y - tipY;
                    float distToTip = sqrt(dx*dx + dy*dy);
                    bool inTailOpening = (localUV.y > 0.7 * bulletLength) && (distToTip < tailOpeningRadius);
                    if (sdf > 0.0 && !inTailOpening) {
                        phi = max(phi, strength);
                    }
                    gl_FragColor = vec4(phi, 0.0, 0.0, 1.0);
                }
            `
        });

        // 使用公共方法应用自定义着色器到 phi 场
        sim.applyCustomShaderToPhi(bulletWallMat);

        bulletWallMat.dispose();
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
        if (this.gravityEnabled) {
            this.velocity.y += GRAVITY * delta;
        }

        // 地面碰撞检测（暂停重力时也禁用）
        if (this.gravityEnabled) {
            const groundY = GROUND_HEIGHT + this.radius * 0.5 + 0.2;
            if (this.position.y <= groundY) {
                this.position.y = groundY;
                this.velocity.y = 0;
                // 地面摩擦
                this.velocity.x *= 0.95;
                this.velocity.z *= 0.95;
            }
        }

        // 位置更新（始终执行，不受LOD和可见性影响）
        this.mesh.position.x += this.velocity.x * delta;
        this.mesh.position.y += this.velocity.y * delta;
        this.mesh.position.z += this.velocity.z * delta;
        this.position.copy(this.mesh.position);
        
        // 旋转：第0帧直接跳转到初速度方向，之后正常插值
        if (this.velocity.lengthSq() > 0.01) {
            // atan2(vx, -vy)：让半圆那头朝下（运动方向）
            const targetAngle = Math.atan2(this.velocity.x, -this.velocity.y);
            
            if (this.frameCount <= 1) {
                // 第0帧：直接跳转，不插值
                this.currentRotation = targetAngle;
            } else {
                // 角度插值（处理跨越 -π/π 的情况）
                let diff = targetAngle - this.currentRotation;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                this.currentRotation += diff * this.rotationLerp;
            }
            this.mesh.rotation.z = this.currentRotation;
        }

        // 更新模拟器的世界位置（用于可见性检测）
        if (this.simulator) {
            this.simulator.setWorldTransform(this.mesh.position, this.cachedWorldRadius);
        }

        // 位置更新（始终执行，不受LOD和可见性影响）：不可见时跳过纹理模拟更新
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
            // 使用预创建的临时对象，避免每帧 GC
            this._tmpAccel.subVectors(this.velocity, this.prevVelocity).divideScalar(this.simUpdateAccumulated || delta);
            this.prevVelocity.copy(this.velocity);

            // 将世界加速度转化为局部散度注入，模拟惯性挤压
            if (this._tmpAccel.length() > 1.0) { // 只对明显的加速度反应
                this._tmpAccelDir.set(this._tmpAccel.x, this._tmpAccel.y).normalize();
                const accelDir = this._tmpAccelDir;
                // 在加速度反方向的边缘注入散度，模拟惯性让水向一边堆积
                const offsetDist = 0.6; // 偏离中心的距离
                const cx = 0.5 - accelDir.x * offsetDist;
                const cy = 0.5 - accelDir.y * offsetDist;
                const squeeze = this._tmpAccel.length() * 200; // 降低散度强度，避免数值不稳定
                this.simulator.addDivergenceImpulse(-squeeze, 0.25, cx, cy); // 负散度 = 向外推
            }

            // ========== 持续散度注入：让水向尖端流动 ==========
            if (this.trailEnabled) {
                // 使用缓存的挖空位置坐标，确保与初始化时的挖空位置精确对齐
                const tipU = this.cachedTipU;        // 挖空圆心U坐标
                const tipV = this.cachedTipV;        // 挖空圆心V坐标
                const tipRadius = this.cachedTipRadiusUV;  // 挖空半径（UV空间）
                
                // 修正偏移：让散度注入位置更靠近液滴中心
                const centerBias = 0.6;
                const divU = tipU + (0.5 - tipU) * centerBias;
                const divV = tipV + (0.5 - tipV) * centerBias;
                
                const tipStrength = 15000.0 * delta;  // 散度强度上万
                this.simulator.addDivergenceImpulse(tipStrength, tipRadius, divU, divV);
            }

            // ★★★ 修复：执行多个子步让物理时间跟上真实时间 ★★★
            const substeps = Math.max(1, Math.floor(this.simUpdateAccumulated / this.simTimeStep));
            const actualSubsteps = Math.min(substeps, 10);

            for (let s = 0; s < actualSubsteps; s++) {
                // ★ 每个子步前重新应用墙体（使用当前旋转角度）
                if (this.trailEnabled) {
                    this.applyBulletSolidWall(0.8, 0.9, 0.6, 0.12);
                }
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

        // 使用预创建的临时对象，避免每帧 GC
        this._projScreenMatrix.multiplyMatrices(
            this.externalCamera.projectionMatrix,
            this.externalCamera.matrixWorldInverse
        );
        this._frustum.setFromProjectionMatrix(this._projScreenMatrix);
        this._sphere.set(this.mesh.position, this.cachedWorldRadius);
        return this._frustum.intersectsSphere(this._sphere);
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
