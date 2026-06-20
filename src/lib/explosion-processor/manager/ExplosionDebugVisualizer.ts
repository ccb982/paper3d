import * as THREE from 'three';
import { ExplosionManager } from './ExplosionManager';
import { Explosion1DSolver } from '../Explosion1DSolver';
import type { ExplosionVisualData } from '../types';

/**
 * 爆炸调试可视化配置
 */
export interface ExplosionDebugConfig {
  /** 是否显示冲击波球壳 */
  showShockSphere?: boolean;
  /** 是否显示压力切片圆盘 */
  showPressureDisc?: boolean;
  /** 是否显示速度箭头 */
  showVelocityArrows?: boolean;
  /** 是否显示数值 HUD */
  showHUD?: boolean;
  /** 箭头采样半径列表（归一化到 R_shock） */
  arrowSampleRadii?: number[];
  /** 切片透明度 */
  discOpacity?: number;
  /** 球壳透明度 */
  sphereOpacity?: number;
}

const DEFAULT_CONFIG: Required<ExplosionDebugConfig> = {
  showShockSphere: true,
  showPressureDisc: true,
  showVelocityArrows: true,
  showHUD: true,
  arrowSampleRadii: [0.2, 0.5, 0.8, 1.0],
  discOpacity: 0.3,
  sphereOpacity: 0.2,
};

/**
 * 单个爆炸的可视化对象
 */
interface ExplosionVisuals {
  shockSphere: THREE.Mesh | null;
  pressureDisc: THREE.Mesh | null;
  velocityArrows: THREE.ArrowHelper[];
  hud: HTMLElement | null;
  worldPosition: THREE.Vector3;
}

/**
 * 爆炸 3D 调试可视化器
 * 
 * 功能：
 * - 半透明冲击波球壳（半径 = shockRadius）
 * - 压力切片圆盘（在 XY 平面，映射 P(r)）
 * - 速度箭头（在 0.2R、0.5R、0.8R、1.0R 处）
 * - 数值 HUD（t、R_shock、P_core、U_shock）
 */
export class ExplosionDebugVisualizer {
  private scene: THREE.Scene;
  private explosionManager: ExplosionManager;
  private config: Required<ExplosionDebugConfig>;
  private visuals: Map<string, ExplosionVisuals> = new Map();
  private worldScale: number = 1.0;  // 世界坐标缩放因子
  private parentObject: THREE.Group;  // 可视化对象的父Group
  
  // 材质缓存
  private shockMaterial: THREE.MeshBasicMaterial;
  private pressureMaterial: THREE.ShaderMaterial;
  private arrowMaterial: THREE.LineBasicMaterial;
  
  // HUD 容器
  private hudContainer: HTMLElement | null = null;

  constructor(
    scene: THREE.Scene,
    explosionManager: ExplosionManager,
    config?: Partial<ExplosionDebugConfig>
  ) {
    this.scene = scene;
    this.explosionManager = explosionManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.parentObject = new THREE.Group();
    this.parentObject.name = 'ExplosionDebugVisuals';
    this.scene.add(this.parentObject);
    
    // 初始化材质
    this.shockMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: this.config.sphereOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    
    this.pressureMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        opacity: { value: this.config.discOpacity },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float opacity;
        varying vec2 vUv;
        
        void main() {
          // 基于到中心距离计算颜色（高压=红，低压=蓝）
          float dist = length(vUv - vec2(0.5));
          float pressure = 1.0 - smoothstep(0.0, 0.5, dist);
          
          // 颜色映射：蓝->绿->黄->红
          vec3 lowColor = vec3(0.0, 0.0, 1.0);
          vec3 midColor = vec3(0.0, 1.0, 0.0);
          vec3 highColor = vec3(1.0, 0.0, 0.0);
          
          vec3 color;
          if (pressure < 0.5) {
            color = mix(lowColor, midColor, pressure * 2.0);
          } else {
            color = mix(midColor, highColor, (pressure - 0.5) * 2.0);
          }
          
          // 边缘渐隐
          float alpha = opacity * smoothstep(0.5, 0.3, dist);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    
    this.arrowMaterial = new THREE.LineBasicMaterial({ 
      color: 0x00ff00,
      transparent: true,
      opacity: 0.8,
    });
  }

  /**
   * 设置世界坐标缩放因子
   * 用于将爆炸物理坐标映射到场景坐标
   * @param scale 缩放因子
   */
  public setWorldScale(scale: number): void {
    this.worldScale = scale;
  }

  /**
   * 设置 HUD 容器
   * @param container HTML元素
   */
  public setHUDContainer(container: HTMLElement | null): void {
    this.hudContainer = container;
  }

  /**
   * 更新所有爆炸可视化
   * 应在每帧 render loop 中调用
   */
  public update(): void {
    const activeExplosions = this.explosionManager.getAllExplosions();
    const activeIds = new Set<string>();
    
    // 更新或创建可视化
    this.explosionManager.forEach((explosion, id) => {
      activeIds.add(id);
      this.updateExplosionVisuals(explosion, id);
    });
    
    // 移除已失效的可视化
    for (const [id, visuals] of this.visuals) {
      if (!activeIds.has(id)) {
        this.removeVisuals(visuals);
        this.visuals.delete(id);
      }
    }
  }

  /**
   * 更新单个爆炸的可视化
   */
  private updateExplosionVisuals(explosion: Explosion1DSolver, id: string): void {
    let visuals = this.visuals.get(id);
    
    if (!explosion.isActive()) {
      // 爆炸已结束，移除可视化
      if (visuals) {
        this.removeVisuals(visuals);
        this.visuals.delete(id);
      }
      return;
    }
    
    const position = this.explosionManager.getPosition(id);
    if (!position) return;
    
    const worldPos = new THREE.Vector3(
      position.x * this.worldScale,
      position.y * this.worldScale,
      0
    );
    
    if (!visuals) {
      visuals = this.createVisuals(explosion, id, worldPos);
      this.visuals.set(id, visuals);
    } else {
      visuals.worldPosition.copy(worldPos);
    }
    
    const data = this.getVisualData(explosion);
    
    // 更新冲击波球壳
    if (this.config.showShockSphere && visuals.shockSphere) {
      visuals.shockSphere.position.copy(worldPos);
      visuals.shockSphere.scale.setScalar(data.shockRadius * this.worldScale);
      visuals.shockSphere.visible = true;
      
      // 根据核心压力调整颜色
      const pressureRatio = data.corePressure / 101325;
      const hue = Math.max(0, 0.1 - pressureRatio * 0.1); // 压力越高越红
      visuals.shockSphere.material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(hue, 1.0, 0.5),
        transparent: true,
        opacity: this.config.sphereOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    }
    
    // 更新压力切片
    if (this.config.showPressureDisc && visuals.pressureDisc) {
      visuals.pressureDisc.position.copy(worldPos);
      visuals.pressureDisc.scale.setScalar(data.shockRadius * this.worldScale);
      visuals.pressureDisc.visible = true;
    }
    
    // 更新速度箭头
    if (this.config.showVelocityArrows) {
      const arrowScale = this.worldScale * 0.5;
      for (let i = 0; i < this.config.arrowSampleRadii.length; i++) {
        const xi = this.config.arrowSampleRadii[i];
        const state = explosion.sampleNormalized(xi);
        const arrow = visuals.velocityArrows[i];
        
        if (arrow) {
          arrow.position.copy(worldPos);
          arrow.position.x += xi * data.shockRadius * this.worldScale;
          
          // 设置箭头方向（径向向外）
          arrow.setDirection(new THREE.Vector3(1, 0, 0));
          // 设置箭头长度（速度大小）
          const speed = Math.abs(state.u) * arrowScale;
          arrow.setLength(Math.min(speed, 2.0), 0.1, 0.05);
          arrow.visible = true;
        }
      }
    }
    
    // 更新 HUD
    if (this.config.showHUD && visuals.hud && this.hudContainer) {
      visuals.hud.style.display = 'block';
      visuals.hud.style.left = `${worldPos.x * 50 + this.hudContainer.clientWidth / 2}px`;
      visuals.hud.style.top = `${-worldPos.y * 50 + this.hudContainer.clientHeight / 2}px`;
      visuals.hud.innerHTML = `
        <div style="color: #fff; font-family: monospace; font-size: 12px; background: rgba(0,0,0,0.7); padding: 4px;">
          <div>t: ${data.shockRadius.toFixed(3)}s</div>
          <div>R: ${data.shockRadius.toFixed(3)}</div>
          <div>P: ${(data.corePressure / 1000).toFixed(1)}kPa</div>
          <div>U: ${data.shockSpeed.toFixed(1)}m/s</div>
        </div>
      `;
    }
  }

  /**
   * 创建可视化对象
   */
  private createVisuals(
    explosion: Explosion1DSolver,
    id: string,
    worldPos: THREE.Vector3
  ): ExplosionVisuals {
    const visuals: ExplosionVisuals = {
      shockSphere: null,
      pressureDisc: null,
      velocityArrows: [],
      hud: null,
      worldPosition: worldPos.clone(),
    };
    
    // 创建冲击波球壳
    if (this.config.showShockSphere) {
      const sphereGeo = new THREE.SphereGeometry(1, 32, 16);
      visuals.shockSphere = new THREE.Mesh(sphereGeo, this.shockMaterial.clone());
      visuals.shockSphere.position.copy(worldPos);
      this.parentObject.add(visuals.shockSphere);
    }
    
    // 创建压力切片圆盘
    if (this.config.showPressureDisc) {
      const discGeo = new THREE.CircleGeometry(1, 64);
      discGeo.rotateX(-Math.PI / 2); // 旋转到 XY 平面
      visuals.pressureDisc = new THREE.Mesh(discGeo, this.pressureMaterial);
      visuals.pressureDisc.position.copy(worldPos);
      visuals.pressureDisc.position.z = 0.01; // 略微偏移避免 z-fighting
      this.parentObject.add(visuals.pressureDisc);
    }
    
    // 创建速度箭头
    if (this.config.showVelocityArrows) {
      for (const xi of this.config.arrowSampleRadii) {
        const arrow = new THREE.ArrowHelper(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(),
          0.5,
          0x00ff00,
          0.2,
          0.1
        );
        arrow.visible = false;
        this.parentObject.add(arrow);
        visuals.velocityArrows.push(arrow);
      }
    }
    
    // 创建 HUD 元素
    if (this.config.showHUD && this.hudContainer) {
      const hud = document.createElement('div');
      hud.style.position = 'absolute';
      hud.style.pointerEvents = 'none';
      hud.style.display = 'none';
      this.hudContainer.appendChild(hud);
      visuals.hud = hud;
    }
    
    return visuals;
  }

  /**
   * 移除可视化对象
   */
  private removeVisuals(visuals: ExplosionVisuals): void {
    if (visuals.shockSphere) {
      this.parentObject.remove(visuals.shockSphere);
      visuals.shockSphere.geometry.dispose();
      (visuals.shockSphere.material as THREE.Material).dispose();
    }
    
    if (visuals.pressureDisc) {
      this.parentObject.remove(visuals.pressureDisc);
      visuals.pressureDisc.geometry.dispose();
      (visuals.pressureDisc.material as THREE.Material).dispose();
    }
    
    for (const arrow of visuals.velocityArrows) {
      this.parentObject.remove(arrow);
    }
    
    if (visuals.hud) {
      visuals.hud.remove();
    }
  }

  /**
   * 获取可视化数据
   */
  private getVisualData(explosion: Explosion1DSolver): ExplosionVisualData {
    return {
      shockRadius: explosion.getShockRadius(),
      shockSpeed: explosion.getShockSpeed(),
      coreTemperature: explosion.getCoreTemperature(),
      corePressure: explosion.getCorePressure(),
      profiles: explosion.getProfiles(),
    };
  }

  /**
   * 设置所有可视化对象的可见性
   * @param visible 是否可见
   */
  public setVisible(visible: boolean): void {
    this.parentObject.visible = visible;
    for (const visuals of this.visuals.values()) {
      if (visuals.hud) {
        visuals.hud.style.display = visible ? 'block' : 'none';
      }
    }
  }

  /**
   * 更新配置
   * @param config 新配置（部分更新）
   */
  public updateConfig(config: Partial<ExplosionDebugConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * 销毁可视化器
   */
  public destroy(): void {
    // 移除所有可视化对象
    for (const visuals of this.visuals.values()) {
      this.removeVisuals(visuals);
    }
    this.visuals.clear();
    
    // 移除父对象
    this.scene.remove(this.parentObject);
    
    // 释放材质
    this.shockMaterial.dispose();
    this.pressureMaterial.dispose();
    this.arrowMaterial.dispose();
  }
}
