import * as THREE from 'three';
import { StaticEntity } from '../static/StaticEntity';
import { EntityManager } from '../../core/EntityManager';
import { cameraStore } from '../../core/CameraStore';

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
  private randomDisturbances: { pos: THREE.Vector2; strength: number }[] = [];
  private frameCount: number = 0;
  private time: number = 0;

  constructor(
    position: THREE.Vector3,
    width: number = 20,
    height: number = 20,
    resolution: number = 128,
    gridSegments: number = 64
  ) {
    const id = `water-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
    this.rtA = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
      type: THREE.FloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RedFormat
    });
    this.rtB = this.rtA.clone();

    const initialTexture = this.initHeightTexture();
    this.rtA.texture = initialTexture;
    this.rtB.texture = initialTexture.clone();

    this.computeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uHeightNow: { value: this.rtA.texture },
        uHeightPrev: { value: this.rtB.texture },
        uLambda2: { value: 0.4 },
        uDamping: { value: 0.995 },
        uTexelSize: { value: new THREE.Vector2(1 / this.resolution, 1 / this.resolution) },
        uDisturbCount: { value: 0 },
        uDisturbPositions: { value: new Array(20).fill(new THREE.Vector2(0, 0)) },
        uDisturbStrengths: { value: new Array(20).fill(0) },
        uTime: { value: 0 }
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
        uniform float uDamping;
        uniform vec2 uTexelSize;
        uniform int uDisturbCount;
        uniform vec2 uDisturbPositions[20];
        uniform float uDisturbStrengths[20];
        uniform float uTime;
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
          hNext *= uDamping;

          float disturbance = 0.0;
          for (int i = 0; i < 20; i++) {
            if (i >= uDisturbCount) break;
            vec2 delta = uv - uDisturbPositions[i];
            float dist = length(delta);
            float radius = 0.05;
            if (dist < radius) {
              float strength = uDisturbStrengths[i];
              disturbance += strength * (1.0 - dist / radius);
            }
          }
          hNext += disturbance;

          gl_FragColor = vec4(hNext, hNext, hNext, 1.0);
        }
      `
    });

    this.fullscreenPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.computeMaterial
    );
    this.sceneRTT = new THREE.Scene();
    this.sceneRTT.add(this.fullscreenPlane);
    this.cameraRTT = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.cameraRTT.position.z = 1;

    const geometry = new THREE.PlaneGeometry(
      this.width,
      this.height,
      this.gridSegments,
      this.gridSegments
    );
    geometry.rotateX(-Math.PI / 2);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeightScale: { value: 0.3 },
        uColorA: { value: new THREE.Color(0x2c7da0) },
        uColorB: { value: new THREE.Color(0x61a5c2) }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uHeightScale;
        varying vec2 vUv;
        varying float vHeight;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vUv = uv;
          vec3 pos = position;

          float noise1 = hash(vec2(floor(pos.x * 2.0), floor(pos.z * 2.0 + uTime * 0.2)));
          float noise2 = hash(vec2(floor(pos.x * 3.0 + uTime * 0.15), floor(pos.z * 2.5)));

          float bigWaveAmp = 0.25 + 0.45 * (sin(uTime * 0.7) * 0.5 + 0.5);
          float bigWave = sin(pos.x * 0.3 + uTime * 0.8) * bigWaveAmp;
          float smallWave1 = sin(pos.z * 0.5 + uTime * 0.75 + noise1 * 6.28) * 0.1;
          float smallWave2 = sin((pos.x + pos.z) * 0.3 + uTime * 1.25) * 0.08;
          float smallWave3 = cos(pos.x * 0.8 - uTime * 0.9) * 0.05;

          float height = bigWave + smallWave1 + smallWave2 + smallWave3;
          pos.y += height * uHeightScale;
          vHeight = height;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uTime;
        varying vec2 vUv;
        varying float vHeight;

        void main() {
          vec3 color = mix(uColorA, uColorB, vHeight * 2.0 + 0.5);

          float shine = sin(vUv.x * 30.0 + uTime * 1.5) * cos(vUv.y * 30.0 + uTime * 1.0) * 0.1 + 0.9;
          color *= shine;

          float highlight = smoothstep(0.2, 0.4, vHeight) * 0.2;
          color += vec3(highlight);

          gl_FragColor = vec4(color, 0.9);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });

    const waterMesh = new THREE.Mesh(geometry, this.waterMaterial);
    waterMesh.position.copy(this.position);

    const scene = EntityManager.getInstance().getScene();
    if (scene && this.mesh) {
      scene.remove(this.mesh);
    }

    this.mesh = waterMesh;
    this.position.copy(waterMesh.position);

    if (scene) {
      scene.add(this.mesh);
      console.log(`Water mesh added to scene: ${this.id}`);
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
        const value = r < 0.3 ? Math.cos(r * Math.PI * 5) * 0.3 : 0;
        data[i + j * this.resolution] = value;
      }
    }
    const tex = new THREE.DataTexture(data, this.resolution, this.resolution, THREE.RedFormat, THREE.FloatType);
    tex.needsUpdate = true;
    return tex;
  }

  private addRandomDisturbances(): void {
    const chance = 0.05;
    if (Math.random() < chance && this.randomDisturbances.length < 10) {
      const randomX = (Math.random() - 0.5) * 0.8;
      const randomY = (Math.random() - 0.5) * 0.8;
      const pos = new THREE.Vector2(0.5 + randomX, 0.5 + randomY);
      const strength = 0.1 + Math.random() * 0.2;
      this.randomDisturbances.push({ pos, strength });
    }

    for (let i = 0; i < this.randomDisturbances.length; i++) {
      this.randomDisturbances[i].strength *= 0.98;
      if (this.randomDisturbances[i].strength < 0.005) {
        this.randomDisturbances.splice(i, 1);
        i--;
      }
    }

    const count = Math.min(this.randomDisturbances.length, 20);
    const positions = new Array(20).fill(new THREE.Vector2(0, 0));
    const strengths = new Array(20).fill(0);
    for (let i = 0; i < count; i++) {
      positions[i] = this.randomDisturbances[i].pos;
      strengths[i] = this.randomDisturbances[i].strength;
    }
    this.computeMaterial.uniforms.uDisturbCount.value = count;
    this.computeMaterial.uniforms.uDisturbPositions.value = positions;
    this.computeMaterial.uniforms.uDisturbStrengths.value = strengths;
    this.computeMaterial.uniforms.uTime.value = performance.now() / 1000;
  }

  private updateWave(): void {
    const renderer = cameraStore.getRenderer();
    if (!renderer) {
      if (this.frameCount % 100 === 0) {
        console.log('Renderer not available from cameraStore');
      }
      return;
    }

    this.computeMaterial.uniforms.uHeightNow.value = this.rtA.texture;
    this.computeMaterial.uniforms.uHeightPrev.value = this.rtB.texture;

    renderer.setRenderTarget(this.rtB);
    renderer.render(this.sceneRTT, this.cameraRTT);
    renderer.setRenderTarget(null);

    const temp = this.rtA;
    this.rtA = this.rtB;
    this.rtB = temp;
  }

  public update(delta: number): void {
    super.update(delta);
    this.frameCount++;
    this.time += delta;

    this.updateWave();
    this.addRandomDisturbances();

    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = this.time;
    }

    if (this.frameCount % 100 === 0) {
      console.log(`WaterEntity update: ${this.id}, frame: ${this.frameCount}, time: ${this.time.toFixed(2)}`);
    }
  }

  public addDisturbance(position: THREE.Vector2, strength: number = 0.1): void {
    const uv = new THREE.Vector2(
      (position.x + this.width / 2) / this.width,
      (position.z + this.height / 2) / this.height
    );
    if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
      this.randomDisturbances.push({ pos: uv, strength });
    }
  }

  public onDestroy(): void {
    super.onDestroy();

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