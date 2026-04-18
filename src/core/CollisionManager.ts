import { Entity } from './Entity';
import { EntityManager } from './EntityManager';

type CollisionCallback = (a: Entity, b: Entity) => void;

export class CollisionManager {
  private static instance: CollisionManager;
  private callbacks: Map<string, CollisionCallback> = new Map();

  private constructor() {}

  public static getInstance(): CollisionManager {
    if (!CollisionManager.instance) {
      CollisionManager.instance = new CollisionManager();
    }
    return CollisionManager.instance;
  }

  /**
   * 注册碰撞回调
   * @param typeA 实体A的类型（如 'bullet', 'enemy', 'player', 'static'）
   * @param typeB 实体B的类型
   * @param callback 碰撞时调用的函数
   */
  public registerCollision(typeA: string, typeB: string, callback: CollisionCallback): void {
    const key = `${typeA}|${typeB}`;
    this.callbacks.set(key, callback);
  }

  /**
   * 每帧更新：检测所有实体对之间的碰撞
   */
  public update(): void {
    const entities = EntityManager.getInstance().getAllEntities();
    // 为了避免重复检测 (i, j) 和 (j, i)，使用嵌套循环
    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      if (!a.isActive) continue;
      for (let j = i + 1; j < entities.length; j++) {
        const b = entities[j];
        if (!b.isActive) continue;
        // 距离检测
        const dx = a.position.x - b.position.x;
        const dz = a.position.z - b.position.z;
        const dy = a.position.y - b.position.y;
        const distSq = dx * dx + dy * dy + dz * dz;
        const minDist = a.radius + b.radius;
        if (distSq < minDist * minDist) {
          this.handleCollision(a, b);
        }
      }
    }
  }

  private handleCollision(a: Entity, b: Entity): void {
    // 尝试 (typeA, typeB) 顺序
    let key = `${a.type}|${b.type}`;
    let callback = this.callbacks.get(key);
    if (callback) {
      callback(a, b);
      return;
    }
    // 尝试 (typeB, typeA) 顺序
    key = `${b.type}|${a.type}`;
    callback = this.callbacks.get(key);
    if (callback) {
      callback(b, a);
    }
  }
}