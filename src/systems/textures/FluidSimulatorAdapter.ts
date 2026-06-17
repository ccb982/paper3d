import * as THREE from 'three';
import { FluidSimulator } from '@lib/fluid-simulator/fluid-simulator';
import type { FluidParams } from '@lib/fluid-simulator/fluid-simulator';
import type { ITextureGenerator } from './TextureManager';
import type { IFluidForceTarget, FluidExternalForce } from '@entities/fluid';
// import { FluidFragmentSystem } from '@entities/fluid';
// import { EntityManager } from '@core/EntityManager';

export class FluidSimulatorAdapter implements ITextureGenerator, IFluidForceTarget {
    type: 'shader' = 'shader';

    private simulator: FluidSimulator;
    private material: THREE.ShaderMaterial;
    private lastUpdateTime: number = performance.now();
    private updateInterval: number = 0;
    private isFirstFrame: boolean = true;
    private explosionFrameCount: number = 0;
    private originalPressureIterations: number = 50;
    private isExplosionBoosted: boolean = false;
    private pendingForces: FluidExternalForce[] = [];
    private constantInjectionStarted: boolean = false;  // 追踪恒定注入是否已启动
    private adapterCamera: THREE.Camera | null = null;  // 相机引用，用于可见性裁剪
    
    // // 水面分裂相关（已注释）
    // private entityManager: EntityManager | null = null;
    // private fragmentSystem: FluidFragmentSystem | null = null;

    constructor(
        renderer: THREE.WebGLRenderer,
        params: Partial<FluidParams> = {}
    ) {
        // 默认参数，包含分层渲染配置
        const defaultParams: FluidParams = {
            width: 512,
            height: 256,
            density: 1,
            viscosity: 1000,
            surfaceTension: 728000,
            gravity: 9.81,
            pressureIterations: 200,
            reinitIterations: 1,           // 每100帧执行1次：单次迭代次数
            reinitInterval: 100,         // 每100帧执行1次：间隔帧数
            timeStep: 0.002,
            restitution: 1.0,
            friction: 0.0,
            usePCG: false,
            maxLifetime: 2000,
            maxVelocity: 110,             // 流体速度上限，默认75
            // 解耦边界处理参数（增强爆炸飞溅效果）
            decoupledBoundary: true,
            boundaryRingWidth: 0.03,
            boundaryDivDamping: 1.0,
            boundaryVelDamping: 1.0,
            // 爆炸随机扰动参数（实现碎片感和不规则冲击波）
            usePerturbation: false,   // 关闭随机扰动
            perturbationStrength: 0.4,
            fragmentCount: 1,         // 关闭多团块爆炸（设为1表示单团块）
            // 分层渲染参数
            waterColor: new THREE.Color(0.2, 0.6, 0.9),
            deepColor: new THREE.Color(0.05, 0.2, 0.4),
            edgeWidth: 0.05,
            edgeIntensity: 0.3,
            specularIntensity: 0.5,
            flowIntensity: 0.3,
            lightDir: new THREE.Vector3(0.5, 1.0, 0.3).normalize(),
            // 纹理居中追踪参数
            enableCentering: false,     // 开启纹理居中追踪（GPU质心计算，避免回读）
            centeringInterval: 0.5,    // 每0.5秒计算一次质心并居中
            // phi 场后处理修正参数
            clampAirPhi: true,          // 启用空气区 phi 上限钳制
            maxAirPhi: 0.000,           // 空气区 phi 上限
            compensateWaterPhi: true,   // 启用水体区负向补偿
            waterCompensationRate: 0.1, // 补偿速率（避免水体流失）
            ...params
        };
        
        // 创建模拟器，传入完整参数（包括分层渲染配置）
        this.simulator = new FluidSimulator(renderer, defaultParams);
        this.originalPressureIterations = defaultParams.pressureIterations;
        
        // 使用 FluidSimulator 内置的分层渲染材质
        this.material = this.simulator.getRenderMaterial();
        
        // 启用水量调试输出
        //this.simulator.enableWaterDebug(true);
        
        // 调试录制（已关闭）
        //this.simulator.enableDebugRecording(true,25, 30);
    }
    
    generate(): THREE.Texture | THREE.Material {
        return this.material;
    }
    
    update(delta?: number): void {
        const now = performance.now();
        const elapsed = now - this.lastUpdateTime;
        this.lastUpdateTime = now;

        const realDelta = (delta !== undefined) ? delta : (elapsed / 1000);

        this.processPendingForces(realDelta);

        // 爆炸序列控制
        if (this.isExplosionBoosted) {
            this.explosionFrameCount++;
            
            // 每6帧爆炸一次（第6、12、18、24、30帧），共5次爆炸
            if (this.explosionFrameCount % 6 === 0 && this.explosionFrameCount <= 30) {
                // 计算当前爆炸阶段（0-4共5次爆炸）
                const stage = (this.explosionFrameCount / 6) - 1;
                // 强度递减：25000 -> 20000 -> 15000 -> 10000 -> 5000
                const strengths = [25000, 20000, 15000, 10000, 5000];
                const strength = strengths[stage];
                // 第一次和最后一次爆炸生成水（负散度外扩），中间爆炸收缩（正散度）
                const createWater = stage === 0 || stage === 4;
                // 最后一次爆炸增加水量倍数并增强强度
                const waterMultiplier = stage === 4 ? 2 : 1;
                const boostedStrength = stage === 4 ? strength * 2 : strength;
                // 添加随机位置偏移，避免完美同心圆
                const offsetX = (Math.random() - 0.5) * 0.01;
                const offsetY = (Math.random() - 0.5) * 0.01;
                // console.log(`[FluidSimulatorAdapter] 爆炸触发: frame=${this.explosionFrameCount}, stage=${stage}, createWater=${createWater}, strength=${boostedStrength}, waterMultiplier=${waterMultiplier}`);
                // 使用多团块爆炸方法，duration=0.5秒
                this.simulator.explodeFragmented(0.5 + offsetX, 0.5 + offsetY, 0.15, boostedStrength, createWater, 0.1, undefined, undefined, waterMultiplier);
            }
            
            // 5次爆炸完成后停止爆炸序列
            if (this.explosionFrameCount > 35) {
                this.simulator.setPressureIterations(this.originalPressureIterations);
                this.isExplosionBoosted = false;
                this.explosionFrameCount = 0;
            }
        }

        // 第一帧时触发爆炸序列
        if (this.isFirstFrame) {
            this.isFirstFrame = false;
            // 爆炸期间增加压力迭代次数到200，确保流体体积守恒
            this.simulator.setPressureIterations(500);
            this.isExplosionBoosted = true;
            this.explosionFrameCount = 0;
            // 初始爆炸已删除
        }

        // 启动恒定散度注入（只在第一次update时启动一次）
        if (!this.constantInjectionStarted) {
            this.constantInjectionStarted = true;
            // 中心位置注入：中心(0.5,0.5)，半径0.3，每帧强度-2000（向外膨胀注入流体）
            this.startConstantInjection(new THREE.Vector2(0.5, 0.5), 0.3, -2000);
            console.log('[FluidSimulatorAdapter] 已启动恒定散度注入');
        }
        
        if (delta !== undefined) {
            this.simulator.update(delta);
        } else {
            this.simulator.update(realDelta);
        }

        this.simulator.updateRenderUniforms();
    }
    
    public getSimulator(): FluidSimulator {
        return this.simulator;
    }
    
    public getMaterial(): THREE.ShaderMaterial {
        return this.material;
    }
    
    public setInjectionEnabled(enabled: boolean): void {
        this.simulator.setInjectionEnabled(enabled);
    }

    public setPhiCorrection(clampAir: boolean, maxAir: number, compensateWater: boolean, compensationRate: number): void {
        this.simulator.setPhiCorrection(clampAir, maxAir, compensateWater, compensationRate);
    }

    public startConstantInjection(centerUV: THREE.Vector2, radius: number, strength: number): void {
        this.simulator.startConstantInjection(centerUV, radius, strength);
    }

    public stopConstantInjection(): void {
        this.simulator.stopConstantInjection();
    }

    public setInjectionStrength(strength: number): void {
        this.simulator.setInjectionStrength(strength);
    }

    /**
     * 设置相机引用，用于可见性裁剪
     * 设置后，流体模拟会在不可见时自动跳过更新
     * @param camera Three.js 相机
     */
    public setCamera(camera: THREE.Camera): void {
        this.adapterCamera = camera;
        this.simulator.setCamera(camera);
        this.simulator.setWorldTransform(new THREE.Vector3(0, 0, 0), 5.0);
    }
    
    public configureInjection(config: {
        posX?: number;
        posY?: number;
        flowRate?: number;
        velX?: number;
        velY?: number;
        size?: number;
    }): void {
        this.simulator.configureInjection(config);
    }

    public getWaterAmount(): { totalWaterCount: number; dissipatedCount: number } {
        return this.simulator.getWaterAmount();
    }

    public enableWaterDebug(enabled: boolean): void {
        this.simulator.enableWaterDebug(enabled);
    }
    
    public setSolidMaskTexture(texture: THREE.Texture): void {
        this.simulator.setSolidMaskTexture(texture);
    }
    
    /**
     * 在流体中产生爆炸效果
     * @param cx 爆炸中心X坐标（UV空间，0~1）
     * @param cy 爆炸中心Y坐标（UV空间，0~1）
     * @param radius 爆炸半径（UV空间）
     * @param strength 爆炸强度（散度源强度）
     * @param createWater 是否生成新水（true=生成水花，false=仅加速已有水）
     * @param duration 爆炸持续时间（秒），控制包络的衰减时长，默认0.1
     * @param anisotropyMode 各向异性模式：0=各向同性, 1=四极子, 2=偶极子
     * @param anisotropyPhase 相位偏移（弧度）
     * @param anisotropyStrength 各向异性强度 (0~1)
     */
    public explode(cx: number, cy: number, radius: number, strength: number, 
                  createWater: boolean = true, duration: number = 0.1,
                  anisotropyMode: number = 0, anisotropyPhase: number = 0.0, anisotropyStrength: number = 0.0): void {
        this.simulator.explode(cx, cy, radius, strength, createWater, duration, anisotropyMode, anisotropyPhase, anisotropyStrength);
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
        this.simulator.explodeAnisotropic(cx, cy, radius, strength, createWater, duration, mode, phase, anisoStrength);
    }
    
    /**
     * 在中心位置对水应用一次爆炸（一次性操作）
     * 只对已有水体加速，不产生新水
     */
    public explodeCenterOnce(): void {
        // 在中心位置应用爆炸，只加速已有水体，不产生新水（强度降低一半）
        this.simulator.explode(0.5, 0.5, 0.15, 25000, false, 0.1);
    }
    
    // /**
    //  * 初始化水面分裂系统（已注释）
    //  * @param entityManager 实体管理器
    //  */
    // public initFragmentSystem(entityManager: EntityManager): void {
    //     this.entityManager = entityManager;
    //     this.fragmentSystem = new FluidFragmentSystem(
    //         this.simulator,
    //         entityManager,
    //         (uv) => {
    //             // UV转世界坐标（假设水面在XY平面，UV 0~1对应世界坐标 -5~5）
    //             return new THREE.Vector3(uv.x * 10 - 5, uv.y * 10 - 5, 0);
    //         }
    //     );
    //     console.log('[FluidSimulatorAdapter] 水面分裂系统已初始化');
    // }
    
    // /**
    //  * 执行水面分裂（测试用，已注释）
    //  * 在中心位置分裂水面，产生多个小水滴碎片
    //  */
    // public splitWater(): void {
    //     if (!this.fragmentSystem) {
    //         console.warn('[FluidSimulatorAdapter] 请先调用 initFragmentSystem() 初始化分裂系统');
    //         return;
    //     }
        
    //     // 在中心位置执行分裂
    //     const fragments = this.fragmentSystem.explode(
    //         0.5,      // 中心X (UV坐标)
    //         0.5,      // 中心Y (UV坐标)
    //         0.2,      // 分裂半径
    //         8.0,      // 爆炸强度
    //         6         // 分裂成6个碎片
    //     );
        
    //     console.log(`[FluidSimulatorAdapter] 水面分裂完成，创建了 ${fragments.length} 个碎片`);
    // }
    
    dispose(): void {
        // material 是从 simulator 获取的引用，由 simulator.dispose() 统一释放
        this.simulator.dispose();
    }

    // ==================== IFluidForceTarget 接口实现 ====================

    isMovable(): boolean {
        return false; // 详细纹理不移动
    }

    applyFluidForce(force: FluidExternalForce): void {
        if (!this.simulator) return;
        // 忽略世界运动力（静态纹理不可移动），但内部力全部缓存
        if (force.velocityInjection || force.divergenceInjection || force.waterInjection) {
            this.pendingForces.push(force);
        }
    }

    private processPendingForces(dt: number): void {
        const sim = this.simulator;
        if (!sim || this.pendingForces.length === 0) return;

        for (const force of this.pendingForces) {
            if (force.velocityInjection) {
                const inj = force.velocityInjection;
                const center = inj.centerUV ?? new THREE.Vector2(0.5, 0.5);
                const radius = inj.radius ?? 0.2;
                const dvx = inj.velocity.x * dt;
                const dvy = inj.velocity.y * dt;
                sim.addLocalVelocityImpulse(dvx, dvy, radius, center.x, center.y, 10.0);
            }

            if (force.divergenceInjection) {
                const inj = force.divergenceInjection;
                const center = inj.centerUV ?? new THREE.Vector2(0.5, 0.5);
                const radius = inj.radius ?? 0.2;
                sim.addDivergenceImpulse(inj.divergence, radius, center.x, center.y);
            }

            if (force.waterInjection) {
                const inj = force.waterInjection;
                const center = inj.centerUV ?? new THREE.Vector2(0.5, 0.5);
                const radius = inj.radius ?? 0.2;
                sim.addWaterImpulse(inj.amount, radius, center.x, center.y);
            }
        }

        this.pendingForces.length = 0;
    }
}