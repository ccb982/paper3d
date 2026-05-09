import * as THREE from 'three';
import { EntityManager } from '@core/EntityManager';
import { LightFluidEntity } from './LightFluidEntity';

export enum FluidLOD {
  HIGH   = 0,   // 每帧更新模拟 + 纹理刷新
  MEDIUM = 1,   // 每2帧更新模拟 + 纹理刷新
  LOW    = 2,   // 每4帧更新模拟，不刷新纹理（冻结画面）
  OFF    = 3    // 完全不更新
}

export class FluidRegionManager {
  private entities: LightFluidEntity[] = [];
  private center: THREE.Vector3;          // 区域中心
  private radius: number;                 // 区域半径
  private maxDroplets: number;
  private currentLOD: FluidLOD = FluidLOD.HIGH;
  private frameSkipCounter: number = 0;

  constructor(center: THREE.Vector3, radius: number, maxDroplets = 20) {
    this.center = center.clone();
    this.radius = radius;
    this.maxDroplets = maxDroplets;
  }

  // 添加现有液滴（由 EntityManager 创建后转入）
  addDroplet(droplet: LightFluidEntity): void {
    // 可限制总量
    if (this.entities.length >= this.maxDroplets) {
      // 移除最老的或距离中心最远的
      this.removeOldest();
    }
    this.entities.push(droplet);
  }

  // 批量创建液滴（内部调用 EntityManager 的单例创建方法）
  async createDroplets(count: number, spread?: number): Promise<void> {
    const em = EntityManager.getInstance();
    const renderer = em.getRenderer();
    if (!renderer) return;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (spread ?? this.radius) * Math.sqrt(Math.random());
      const pos = this.center.clone().add(
        new THREE.Vector3(Math.cos(angle) * dist, Math.sin(angle) * dist, 0)
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        0
      );
      const droplet = new LightFluidEntity(
        `fluid_${Date.now()}_${Math.random()}`,
        renderer,
        pos,
        vel,
        0.3 + Math.random() * 0.4,  // 水量
        8 + Math.random() * 4       // 寿命
      );
      em.addEntity(droplet);                 // 注册到全局管理器
      this.addDroplet(droplet);              // 由本管理器跟踪
    }
  }

  // 核心更新：由 EntityManager 每帧调用，传入 LOD 等级
  update(delta: number, lod: FluidLOD): void {
    this.currentLOD = lod;

    // 收集已失效的液滴（已在 EntityManager 中标记为非活跃的）
    this.entities = this.entities.filter(e => e.isActive);

    // 距离角色过远（LOD = OFF），直接销毁整个区域管理器
    if (lod === FluidLOD.OFF) {
      this.destroy();
      console.log(`[FluidRegionManager] 区域已销毁（距离角色超过10单位）`);
      return;
    }

    // 根据 LOD 决定位移更新频率
    const positionUpdateInterval = lod === FluidLOD.HIGH ? 1 : lod === FluidLOD.MEDIUM ? 2 : 4;
    this.frameSkipCounter++;

    // 更新液滴位移（位置）
    if (this.frameSkipCounter % positionUpdateInterval === 0) {
      for (const droplet of this.entities) {
        // 仅更新位移，不更新内部模拟
        this.updateDropletPosition(droplet, delta);
      }
    }

    // 内部纹理模拟每4帧更新一次（固定频率）
    if (this.frameSkipCounter % 4 === 0) {
      for (const droplet of this.entities) {
        // 更新内部流体模拟
        this.updateDropletSimulation(droplet, delta);
      }
    }

    // LOD = LOW 时停止纹理刷新
    if (lod === FluidLOD.LOW) {
      for (const droplet of this.entities) {
        droplet.getSimulator().setTextureUpdateEnabled(false);
      }
    } else {
      for (const droplet of this.entities) {
        droplet.getSimulator().setTextureUpdateEnabled(true);
      }
    }
  }

  // 更新液滴位移（位置）
  private updateDropletPosition(droplet: LightFluidEntity, delta: number): void {
    droplet.mesh.position.x += droplet.worldVelocity.x * delta;
    droplet.mesh.position.y += droplet.worldVelocity.y * delta;
    droplet.mesh.position.z += droplet.worldVelocity.z * delta;
    droplet.position.copy(droplet.mesh.position);
  }

  // 更新液滴内部流体模拟
  private updateDropletSimulation(droplet: LightFluidEntity, delta: number): void {
    const simulator = droplet.getSimulator();
    if (!simulator) return;

    // 更新速度脉冲（基于加速度）
    const accel = new THREE.Vector3().subVectors(
      droplet.worldVelocity,
      (droplet as any).prevWorldVelocity ?? new THREE.Vector3()
    ).divideScalar(delta);
    
    if ((droplet as any).prevWorldVelocity) {
      (droplet as any).prevWorldVelocity.copy(droplet.worldVelocity);
    }

    const internalForceX = -accel.x * 0.5;
    const internalForceY = -accel.y * 0.5;
    simulator.addVelocityImpulse(internalForceX, internalForceY);

    // 更新呼吸相位（用于未来可能启用的呼吸效果）
    if ((droplet as any).breathingPhase !== undefined && (droplet as any).breathingSpeed !== undefined) {
      (droplet as any).breathingPhase += (droplet as any).breathingSpeed * delta;
    }

    // 更新流体模拟器
    simulator.update(delta);

    // 更新渲染材质
    const newMaterial = simulator.getRenderMaterial();
    if (droplet.mesh.material !== newMaterial) {
      if (droplet.mesh.material instanceof THREE.ShaderMaterial) {
        droplet.mesh.material.dispose();
      }
      droplet.mesh.material = newMaterial;
    }
  }

  // 移除所有液滴
  private removeAllDroplets(): void {
    const em = EntityManager.getInstance();
    for (const d of this.entities) {
      em.removeEntity(d);
    }
    this.entities = [];
    console.log(`[FluidRegionManager] 区域液滴已全部移除（距离角色过远）`);
  }

  // 获取区域中心与半径，供 EntityManager 计算距离
  getBounds(): { center: THREE.Vector3; radius: number } {
    return { center: this.center, radius: this.radius };
  }

  // 销毁整个区域（移除所有液滴）
  destroy(): void {
    const em = EntityManager.getInstance();
    for (const d of this.entities) {
      em.removeEntity(d);
    }
    this.entities = [];
  }

  private removeOldest(): void {
    // 简单删除第一个（最老），更优策略可按距离
    const oldest = this.entities.shift();
    if (oldest) EntityManager.getInstance().removeEntity(oldest);
  }

  // 获取当前区域内液滴数量
  getDropletCount(): number {
    return this.entities.length;
  }

  // 获取当前 LOD 等级
  getCurrentLOD(): FluidLOD {
    return this.currentLOD;
  }
}