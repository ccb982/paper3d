import * as THREE from 'three';

/**
 * 实体基类 - 所有动态对象（玩家、敌人、子弹、特效）都应继承此类
 */
export abstract class Entity {
  public id: string;
  public type: string;
  public mesh: THREE.Object3D;
  public position: THREE.Vector3;
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public isActive: boolean = true;
  public radius: number = 0.5;

  constructor(id: string, type: string, mesh: THREE.Object3D) {
    this.id = id;
    this.type = type;
    this.mesh = mesh;
    this.position = mesh.position.clone();
  }

  /**
   * 每帧更新（子类必须实现）
   * @param delta 时间差（秒）
   */
  public abstract update(delta: number): void;

  /**
   * 销毁时调用（从场景移除、清理资源）
   * 子类可覆盖以添加额外逻辑
   */
  public onDestroy(): void {
  }
}