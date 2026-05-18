import * as THREE from 'three';
import { EntityManager } from '@core/EntityManager';
import { LightFluidEntity } from './LightFluidEntity';
import { FluidLOD } from './FluidTypes';

export { FluidLOD };

export class FluidRegionManager {
  private entities: LightFluidEntity[] = [];
  private center: THREE.Vector3;          // 区域中心
  private radius: number;                 // 区域半径
  private maxDroplets: number;
  private currentLOD: FluidLOD = FluidLOD.HIGH;
  private markedForRemoval: boolean = false;  // 标记是否需要销毁（由EntityManager安全处理）
  
  // 性能优化：限制同时活跃的模拟实例数
  private maxActiveSimulations: number = 4;   // 最多同时运行4个模拟实例

  constructor(center: THREE.Vector3, radius: number, maxDroplets = 20) {
    this.center = center.clone();
    this.radius = radius;
    this.maxDroplets = maxDroplets;
  }

  // 添加现有液滴（由 EntityManager 创建后转入）
  addDroplet(droplet: LightFluidEntity): void {
    // 可限制总量
    if (this.entities.length >= this.maxDroplets) {
      // 标记最老的为非活跃，由EntityManager统一删除
      const oldest = this.entities.shift();
      if (oldest) oldest.isActive = false;
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
        new THREE.Vector3(Math.cos(angle) * dist, Math.sin(angle) * dist + 30.0, 0)  // 抬高 3.0 单位
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        0
      );
      const dropletAge = 4 + Math.random() * 2;  // 寿命：4-6秒（平均5秒）
      const droplet = new LightFluidEntity(
        `fluid_${Date.now()}_${Math.random()}`,
        renderer,
        pos,
        vel,
        0.3 + Math.random() * 0.4,  // 水量
        dropletAge
      );
      em.addEntity(droplet);                 // 注册到全局管理器
      this.addDroplet(droplet);              // 由本管理器跟踪
    }
  }

  // 核心更新：由 EntityManager 每帧调用，传入 LOD 等级
  // 注意：本方法不再直接调用实体的update，而是设置LOD让实体自己处理
  update(delta: number, lod: FluidLOD): void {
    const previousLOD = this.currentLOD;
    this.currentLOD = lod;

    // 收集已失效的液滴（已在 EntityManager 中标记为非活跃的）
    this.entities = this.entities.filter(e => e.isActive);

    // 距离角色过远（LOD = OFF），标记整个区域待销毁
    // 不直接删除，由EntityManager统一处理
    if (lod === FluidLOD.OFF) {
      this.markedForRemoval = true;
      // 标记所有液滴为非活跃，由EntityManager安全删除
      for (const droplet of this.entities) {
        droplet.isActive = false;
      }
      console.log(`[FluidRegionManager] 区域已标记待销毁（距离角色超过10单位），当前液滴数量: ${this.entities.length}`);
      return;
    }
    
    // 调试：输出距离变化信息
    if (previousLOD !== lod) {
      const lodNames = ['HIGH', 'MEDIUM', 'LOW', 'OFF'];
      console.log(`[FluidRegionManager] LOD变化: ${lodNames[previousLOD]} -> ${lodNames[lod]}, 液滴数量: ${this.entities.length}`);
    }

    // 重置销毁标记
    this.markedForRemoval = false;

    // 性能优化：限制同时活跃的模拟实例数
    // 只允许前 N 个液滴保持活跃，其余的暂时休眠
    let activeCount = 0;
    for (const droplet of this.entities) {
      if (droplet.isActive && lod < FluidLOD.OFF) {
        if (activeCount < this.maxActiveSimulations) {
          droplet.lod = lod;
          activeCount++;
        } else {
          // 超出限制的液滴强制休眠（冻结纹理和模拟）
          droplet.lod = FluidLOD.OFF;
        }
      } else {
        droplet.lod = lod;
      }
    }
  }

  // 检查是否需要移除（由EntityManager调用）
  isMarkedForRemoval(): boolean {
    return this.markedForRemoval;
  }

  // 获取区域中心与半径，供 EntityManager 计算距离
  getBounds(): { center: THREE.Vector3; radius: number } {
    return { center: this.center, radius: this.radius };
  }

  // 清理资源（由EntityManager在安全时机调用）
  destroy(): void {
    // 不需要主动删除实体，EntityManager会处理
    this.entities = [];
    console.log(`[FluidRegionManager] 区域已清理`);
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