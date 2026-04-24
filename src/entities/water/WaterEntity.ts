import * as THREE from 'three';
import { StaticEntity } from '../static/StaticEntity';
import { EntityManager } from '../../core/EntityManager';

/**
 * 水面实体 - 使用波动方程实现的动态水面效果
 */
export class WaterEntity extends StaticEntity {
  private width: number;
  private height: number;
  private resolution: number;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private computeMaterial: THREE.ShaderMaterial;
  private fullscreenPlane: THREE.Mesh;
  private sceneRTT: THREE.Scene;
  private cameraRTT: THREE.OrthographicCamera;
  private waterMaterial: THREE.ShaderMaterial;
  private gridSegments: number;

  constructor(
    position: THREE.Vector3,
    width: number = 200,
    height: number = 200,
    resolution: number = 256,
    gridSegments: number = 128
  ) {
    // 生成唯一ID
    const id = `water-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    // 创建临时mesh对象
    const tempMesh = new THREE.Object3D();
    super(id, tempMesh, position);
    this.width = width;
    this.height = height;
    this.resolution = resolution;
    this.gridSegments = gridSegments;
    console.log(`WaterEntity created: ${id}, position: ${position.x}, ${position.y}, ${position.z}`);
    this.createWaterEffect();
  }

  private createWaterEffect(): void {
    // 创建双缓冲纹理
    this.rtA = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
      type: THREE.FloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RedFormat
    });
    this.rtB = this.rtA.clone();

    // 初始化高度纹理
    const initialTexture = this.initHeightTexture();
    this.rtA.texture = initialTexture;
    this.rtB.texture = initialTexture.clone();

    // 创建波动方程计算材质
    this.computeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uHeightNow: { value: this.rtA.texture },
        uHeightPrev: { value: this.rtB.texture },
        uLambda2: { value: 0.4 }, // 控制波速
        uTexelSize: { value: new THREE.Vector2(1 / this.resolution, 1 / this.resolution) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uHeightNow;
        uniform sampler2D uHeightPrev;
        uniform float uLambda2;
        uniform vec2 uTexelSize;
        varying vec2 vUv;

        void main() {
          vec2 uv = vUv;
          float h = texture2D(uHeightNow, uv).r;
          float hL = texture2D(uHeightNow, uv + vec2(-uTexelSize.x, 0)).r;
          float hR = texture2D(uHeightNow, uv + vec2(uTexelSize.x, 0)).r;
          float hT = texture2D(uHeightNow, uv + vec2(0, uTexelSize.y)).r;
          float hB = texture2D(uHeightNow, uv + vec2(0, -uTexelSize.y)).r;
          float hPrev = texture2D(uHeightPrev, uv).r;

          float laplacian = (hL + hR + hT + hB - 4.0 * h);
          float hNext = 2.0 * h - hPrev + uLambda2 * laplacian;

          gl_FragColor = vec4(hNext, 0.0, 0.0, 1.0);
        }
      `
    });

    // 创建全屏平面用于渲染到纹理
    this.fullscreenPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.computeMaterial
    );
    this.sceneRTT = new THREE.Scene();
    this.sceneRTT.add(this.fullscreenPlane);
    this.cameraRTT = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.cameraRTT.position.z = 1;

    // 创建水面网格
    const geometry = new THREE.PlaneGeometry(
      this.width,
      this.height,
      this.gridSegments,
      this.gridSegments
    );

    // 创建水面材质 - 使用MeshPhongMaterial实现基本水面效果
    this.waterMaterial = new THREE.MeshPhongMaterial({
      color: 0x3399ff, // 亮蓝色
      specular: 0xffffff, // 高光颜色
      shininess: 30, // 高光强度
      side: THREE.DoubleSide
    });

    // 创建新的水面网格
    const waterMesh = new THREE.Mesh(geometry, this.waterMaterial);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.copy(this.position);
    
    // 移除旧的tempMesh，添加新的水面网格
    const scene = EntityManager.getInstance().getScene();
    if (scene && this.mesh) {
      scene.remove(this.mesh);
    }
    
    this.mesh = waterMesh;
    // 更新position以保持与mesh一致
    this.position.copy(waterMesh.position);
    
    // 添加新的水面网格到场景
    if (scene) {
      scene.add(this.mesh);
      console.log(`Water mesh added to scene: ${this.id}, position: ${this.mesh.position.x}, ${this.mesh.position.y}, ${this.mesh.position.z}`);
      console.log(`Water mesh properties: width=${this.width}, height=${this.height}, segments=${this.gridSegments}`);
    } else {
      console.log('Scene is null, cannot add water mesh');
    }
  }

  private initHeightTexture(): THREE.DataTexture {
    const data = new Float32Array(this.resolution * this.resolution);
    for (let i = 0; i < this.resolution; i++) {
      for (let j = 0; j < this.resolution; j++) {
        const x = (i / this.resolution) * 2 - 1;
        const y = (j / this.resolution) * 2 - 1;
        const r = Math.sqrt(x * x + y * y);
        // 在中心创建一个初始鼓包
        const value = r < 0.2 ? Math.cos(r * Math.PI * 5) * 0.1 : 0;
        data[i + j * this.resolution] = value;
      }
    }
    const tex = new THREE.DataTexture(data, this.resolution, this.resolution, THREE.RedFormat, THREE.FloatType);
    tex.needsUpdate = true;
    return tex;
  }

  public update(delta: number): void {
    super.update(delta);
    
    // 每100帧打印一次更新日志
    if (Math.floor(Date.now() / 16) % 100 === 0) {
      console.log(`WaterEntity update: ${this.id}, position: ${this.position.x}, ${this.position.y}, ${this.position.z}`);
    }
  }

  private updateWave(): void {
    // 暂时禁用波动效果，确保水面能够正常显示
  }

  /**
   * 在水面上添加一个扰动
   * @param position 扰动位置（相对于水面中心）
   * @param strength 扰动强度
   */
  public addDisturbance(position: THREE.Vector2, strength: number = 0.1): void {
    // 计算纹理坐标
    const texX = (position.x / this.width) + 0.5;
    const texY = (position.y / this.height) + 0.5;
    
    // 这里可以实现向高度纹理添加扰动的逻辑
    // 由于 WebGLRenderTarget 不能直接修改，实际应用中可能需要使用帧缓冲对象或其他方法
    console.log(`Adding disturbance at (${texX}, ${texY}) with strength ${strength}`);
  }

  public onDestroy(): void {
    super.onDestroy();
    
    // 清理资源
    if (this.rtA) {
      this.rtA.dispose();
    }
    if (this.rtB) {
      this.rtB.dispose();
    }
    if (this.computeMaterial) {
      this.computeMaterial.dispose();
    }
    if (this.waterMaterial) {
      this.waterMaterial.dispose();
    }
  }
}