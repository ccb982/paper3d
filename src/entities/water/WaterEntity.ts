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
  private waterMesh: THREE.Mesh;
  private waterSize: number = 40;
  private gridSegments: number;
  private markerSphere: THREE.Mesh;
  private randomDisturbances: { pos: THREE.Vector2; strength: number }[] = [];
  private frameCount: number = 0;
  private time: number = 0;
  private playerRipplePos: THREE.Vector2 = new THREE.Vector2(-1, -1);
  private playerRippleStrength: number = 0;

  private waveConfig: {
    isDynamic: boolean;
    wave1Freq: number;
    wave1Speed: number;
    wave2Freq: number;
    wave2Speed: number;
    wave3Freq: number;
    wave3Speed: number;
    bigWaveAmp: number;
    bigWaveFreq: number;
    bigWaveAmpRange: number;
  };

  private static STATIC_WAVE_PARAMS = {
    isDynamic: false,
    wave1Freq: 0.4,
    wave1Speed: 0.8,
    wave2Freq: 0.3,
    wave2Speed: 0.6,
    wave3Freq: 0.2,
    wave3Speed: 1.0,
    bigWaveAmp: 0.35,
    bigWaveFreq: 0.4,
    bigWaveAmpRange: 0.15
  };

  private static DYNAMIC_WAVE_PARAMS = {
    isDynamic: true,
    wave1Freq: 1.0,
    wave1Speed: 1.2,
    wave2Freq: 0.5,
    wave2Speed: 0.9,
    wave3Freq: 0.3,
    wave3Speed: 1.5,
    bigWaveAmp: 0.7,
    bigWaveFreq: 0.6,
    bigWaveAmpRange: 0.7
  };

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
    this.isShootable = false;

    this.waveConfig = Math.random() > 0.5
      ? { ...WaterEntity.DYNAMIC_WAVE_PARAMS }
      : { ...WaterEntity.STATIC_WAVE_PARAMS };
    console.log(`WaterEntity ${id}: ${this.waveConfig.isDynamic ? 'DYNAMIC' : 'STATIC'} mode`);

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
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector2(-1, -1) },
        uPlayerStrength: { value: 0 }
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
        uniform vec2 uPlayerPos;
        uniform float uPlayerStrength;
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
            float radius = 0.25;
            if (dist < radius) {
              float strength = uDisturbStrengths[i];
              disturbance += strength * (1.0 - dist / radius);
            }
          }
          hNext += disturbance;

          // 玩家涟漪红光效果
          if (uPlayerStrength > 0.0) {
            float playerDist = length(uv - uPlayerPos);
            float redRadius = 0.15;
            if (playerDist < redRadius) {
              float redIntensity = uPlayerStrength * (1.0 - playerDist / redRadius);
              hNext += redIntensity * 0.5;
            }
          }

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
        uHeightScale: { value: 0.6 },
        uHeightTexture: { value: this.rtA.texture },
        uColorA: { value: new THREE.Color(0x2c7da0) },
        uColorB: { value: new THREE.Color(0x61a5c2) },
        uPlayerPos: { value: new THREE.Vector2(-1, -1) },
        uPlayerStrength: { value: 0 },
        uWaterWorldPos: { value: new THREE.Vector2(0, 0) },
        uWave1Freq: { value: this.waveConfig.wave1Freq },
        uWave1Speed: { value: this.waveConfig.wave1Speed },
        uWave2Freq: { value: this.waveConfig.wave2Freq },
        uWave2Speed: { value: this.waveConfig.wave2Speed },
        uWave3Freq: { value: this.waveConfig.wave3Freq },
        uWave3Speed: { value: this.waveConfig.wave3Speed },
        uBigWaveAmp: { value: this.waveConfig.bigWaveAmp },
        uBigWaveFreq: { value: this.waveConfig.bigWaveFreq },
        uBigWaveAmpRange: { value: this.waveConfig.bigWaveAmpRange }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uHeightScale;
        uniform sampler2D uHeightTexture;
        uniform vec2 uPlayerPos;
        uniform float uPlayerStrength;
        uniform vec2 uWaterWorldPos;
        uniform float uWave1Freq;
        uniform float uWave1Speed;
        uniform float uWave2Freq;
        uniform float uWave2Speed;
        uniform float uWave3Freq;
        uniform float uWave3Speed;
        uniform float uBigWaveAmp;
        uniform float uBigWaveFreq;
        uniform float uBigWaveAmpRange;
        varying vec2 vUv;
        varying float vHeight;
        varying float vPlayerGlow;
        varying vec3 vWorldPos;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vUv = uv;
          vec3 pos = position;
          vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

          float texHeight = texture2D(uHeightTexture, uv).r;

          float noise1 = hash(vec2(floor(pos.x * 2.0), floor(pos.z * 2.0 + uTime * 0.2)));
          float noise2 = hash(vec2(floor(pos.x * 3.0 + uTime * 0.15), floor(pos.z * 2.5)));
          float noise3 = hash(vec2(floor(pos.x * 4.0), floor(pos.z * 3.0 + uTime * 0.25)));

          // 三波交错 - 使用配置的频率和速度
          float wave1 = sin(pos.x * uWave1Freq + pos.z * (uWave1Freq * 0.75) + uTime * uWave1Speed) * 0.15;
          float wave2 = sin(pos.x * uWave2Freq - pos.z * (uWave2Freq * 1.33) + uTime * uWave2Speed + noise1 * 3.14) * 0.12;
          float wave3 = sin((pos.x * uWave3Freq + pos.z * (uWave3Freq * 2.5)) + uTime * uWave3Speed + noise2 * 4.71) * 0.10;

          // 大波幅波动 - 使用配置的振幅范围
          float bigWavePhase = sin(uTime * uBigWaveFreq) * 0.5 + 0.5;
          float bigWaveAmp = uBigWaveAmp - uBigWaveAmpRange * 0.5 + uBigWaveAmpRange * bigWavePhase;
          float bigWave = sin(pos.x * (uBigWaveFreq * 0.375) + uTime * (uBigWaveFreq * 0.8)) * bigWaveAmp;

          // 组合所有波动 - 动态模式使用更大的乘数
          float waveMultiplier = 1.0;
          float height = (wave1 + wave2 + wave3 + bigWave) * waveMultiplier + texHeight * 4.0;
          pos.y += height * uHeightScale;
          vHeight = height;

          // 计算玩家涟漪红光 - 使用世界坐标计算
          if (uPlayerStrength > 0.0) {
            vec2 playerWorldPos = uWaterWorldPos + (uPlayerPos - 0.5) * vec2(40.0, 46.0);
            float playerDist = length(vWorldPos.xz - playerWorldPos);
            float redRadius = 2.0;
            vPlayerGlow = uPlayerStrength * (1.0 - playerDist / redRadius);
            if (playerDist >= redRadius) vPlayerGlow = 0.0;
          } else {
            vPlayerGlow = 0.0;
          }

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uTime;
        uniform float uPlayerStrength;
        varying vec2 vUv;
        varying float vHeight;
        varying float vPlayerGlow;

        void main() {
          vec3 color = mix(uColorA, uColorB, vHeight * 2.0 + 0.5);

          float shine = sin(vUv.x * 30.0 + uTime * 1.5) * cos(vUv.y * 30.0 + uTime * 1.0) * 0.1 + 0.9;
          color *= shine;

          float highlight = smoothstep(0.2, 0.4, vHeight) * 0.2;
          color += vec3(highlight);

          // 添加玩家涟漪红光
          if (vPlayerGlow > 0.0) {
            vec3 redColor = vec3(1.0, 0.2, 0.1);
            color = mix(color, redColor, vPlayerGlow * 0.8);
            color += vec3(vPlayerGlow * 0.5);
          }

          gl_FragColor = vec4(color, 0.9);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });

    const waterMesh = new THREE.Mesh(geometry, this.waterMaterial);
    waterMesh.position.copy(this.position);
    this.waterMesh = waterMesh;

    const markerGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 });
    this.markerSphere = new THREE.Mesh(markerGeo, markerMat);
    this.markerSphere.visible = false;

    const scene = EntityManager.getInstance().getScene();
    if (scene && this.mesh) {
      scene.remove(this.mesh);
    }

    this.mesh = waterMesh;
    this.position.copy(waterMesh.position);

    if (scene) {
      scene.add(this.mesh);
      scene.add(this.markerSphere);
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
      this.randomDisturbances[i].strength *= 0.995;
      if (this.randomDisturbances[i].strength < 0.001) {
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
      return;
    }

    this.computeMaterial.uniforms.uHeightNow.value = this.rtA.texture;
    this.computeMaterial.uniforms.uHeightPrev.value = this.rtB.texture;
    this.computeMaterial.uniforms.uPlayerPos.value = this.playerRipplePos;
    this.computeMaterial.uniforms.uPlayerStrength.value = this.playerRippleStrength;

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

    // 衰减玩家涟漪强度
    if (this.playerRippleStrength > 0) {
      this.playerRippleStrength *= 0.97;
      if (this.playerRippleStrength < 0.01) {
        this.playerRippleStrength = 0;
        this.playerRipplePos.set(-1, -1);
        this.markerSphere.visible = false;
      }
    }

    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = this.time;
      this.waterMaterial.uniforms.uHeightTexture.value = this.rtA.texture;
      this.waterMaterial.uniforms.uPlayerPos.value = this.playerRipplePos;
      this.waterMaterial.uniforms.uPlayerStrength.value = this.playerRippleStrength;
      if (this.waterMesh) {
        this.waterMaterial.uniforms.uWaterWorldPos.value.set(this.waterMesh.position.x, this.waterMesh.position.z);
      }
    }
  }

  public addDisturbance(position: THREE.Vector2, strength: number = 0.1): void {
    const uv = new THREE.Vector2(
      position.x / this.width,
      position.y / this.height
    );
    if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
      this.randomDisturbances.push({ pos: uv, strength });
    }
  }

  public isInWater(worldPos: THREE.Vector3): boolean {
    if (!this.waterMesh) return false;

    const meshPos = this.waterMesh.position;
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;

    return (
      worldPos.x >= meshPos.x - halfWidth &&
      worldPos.x <= meshPos.x + halfWidth &&
      worldPos.z >= meshPos.z - halfHeight &&
      worldPos.z <= meshPos.z + halfHeight
    );
  }

  public addDisturbanceAtWorldPos(worldPos: THREE.Vector3, strength: number = 0.15): void {
    if (!this.waterMesh) return;

    const meshPos = this.waterMesh.position;
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;
    const localX = worldPos.x - (meshPos.x - halfWidth);
    const localZ = worldPos.z - (meshPos.z - halfHeight);
    const uvX = localX / this.width;
    const uvY = localZ / this.height;

    this.markerSphere.position.set(worldPos.x, meshPos.y + 1, worldPos.z);
    this.markerSphere.visible = true;

    this.playerRipplePos.set(uvX, uvY);
    this.playerRippleStrength = strength * 2.0;

    const localPos = new THREE.Vector2(localX, localZ);
    this.addDisturbance(localPos, strength);
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