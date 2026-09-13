// ============================================================
// SwarmBatch —— 远层代理批量渲染（《蜂群架构.md》§5.7）
// ============================================================
// 每兵种一张图集（前/后两帧；base+residual 在 CPU 按 FTXQuad 同款公式烘焙），
// 一个 InstancedMesh 画完该兵种全部代理（≤4 兵种 = ≤4 draw call）。
// 放弃 residual 动态/流体/受击染色（L2/L1 视觉底线：半频动画 / 冻结帧）。
// ============================================================

import * as THREE from 'three';
import type { FrameAssetSource } from '../../services/fx/AssetSource';
import type { AgentPool } from './AgentPool';
import { AGENT_CAPACITY } from './AgentPool';

interface MobBatch {
  mesh: THREE.InstancedMesh;
  tiles: THREE.InstancedBufferAttribute;
  /** ★ 受击白闪（0~1；命中置 1，指数衰减） */
  flash: THREE.InstancedBufferAttribute;
  /** 贴图高宽比（h/w；实例缩放用） */
  aspect: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0);

/** FTX 合成（与 FTXQuad 片元着色器同款：base HSL + residual 偏移 → RGB） */
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const ch = (n: number): number => {
    const k = (n + h * 6) % 6;
    return Math.min(Math.max(Math.min(k, 4 - k), 0), 1);
  };
  const mix = 1 - Math.abs(2 * l - 1);
  return [
    l + s * (ch(0) - 0.5) * mix,
    l + s * (ch(4) - 0.5) * mix,
    l + s * (ch(2) - 0.5) * mix,
  ];
}

/** 单帧烘焙为 RGBA8（base 为 HSL Float32；residual 为 Uint8 偏移） */
function bakeFrame(asset: FrameAssetSource, frameIndex: number): ImageData | null {
  const pair = asset.getFramePair(frameIndex);
  const base = pair?.base?.image as unknown as
    | { data?: Float32Array; width: number; height: number }
    | undefined;
  if (!base?.data) return null;
  const res = pair?.residual?.image as unknown as
    | { data?: Uint8Array; width: number; height: number }
    | undefined;
  const w = base.width, h = base.height;
  const b = base.data;
  const r = res?.data;
  const out = new ImageData(w, h);
  const o = out.data;
  for (let i = 0, n = w * h * 4; i < n; i += 4) {
    const dH = r ? r[i] / 255 - 0.5 : 0;
    const dS = r ? r[i + 1] / 255 - 0.5 : 0;
    const dL = r ? r[i + 2] / 255 - 0.5 : 0;
    const fh = b[i] + dH - Math.floor(b[i] + dH); // fract
    const fs = Math.max(0, Math.min(1, b[i + 1] + dS));
    const fl = Math.max(0, Math.min(1, b[i + 2] + dL));
    const [cr, cg, cb] = hsl2rgb(fh, fs, fl);
    o[i] = Math.max(0, Math.min(255, Math.round(cr * 255)));
    o[i + 1] = Math.max(0, Math.min(255, Math.round(cg * 255)));
    o[i + 2] = Math.max(0, Math.min(255, Math.round(cb * 255)));
    o[i + 3] = Math.max(0, Math.min(255, Math.round(b[i + 3] * 255)));
  }
  return out;
}

const VERT = /* glsl */ `
  attribute float aTile;
  attribute float aFlash;
  uniform vec4 uTiles[2];
  varying vec2 vUv;
  varying float vFlash;
  void main() {
    vec4 t = uTiles[0];
    if (aTile > 0.5) t = uTiles[1];
    vUv = t.xy + uv * t.zw;
    vFlash = aFlash;
    vec3 transformed = position;
    #ifdef USE_INSTANCING
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
    #else
      gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    #endif
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying float vFlash;
  void main() {
    vec4 c = texture2D(uAtlas, vUv);
    if (c.a < 0.5) discard;
    // ★ 受击白闪（P3）：朝白混色，0 无效果
    c.rgb = mix(c.rgb, vec3(1.0, 0.92, 0.85), clamp(vFlash, 0.0, 1.0) * 0.85);
    gl_FragColor = c;
  }
`;

export class SwarmBatch {
  /** 与 assets 一一对应（烘焙失败 = null，保持 mobIndex 映射） */
  private mobs: (MobBatch | null)[] = [];

  constructor(scene: THREE.Scene, assets: FrameAssetSource[]) {
    for (const asset of assets) {
      // 帧位：0=前 / 1=后（缺省回退第 0 帧）
      const iFront = asset.resolveFrame('前') ?? 0;
      const iBack = asset.resolveFrame('后') ?? iFront;
      const fFront = bakeFrame(asset, iFront);
      const fBack = iBack === iFront ? fFront : bakeFrame(asset, iBack);
      if (!fFront) {
        this.mobs.push(null);
        continue;
      }

      const w1 = fFront.width, h1 = fFront.height;
      const w2 = fBack?.width ?? w1, h2 = fBack?.height ?? h1;
      const canvas = document.createElement('canvas');
      canvas.width = w1 + w2;
      canvas.height = Math.max(h1, h2);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        this.mobs.push(null);
        continue;
      }
      ctx.putImageData(fFront, 0, 0);
      if (fBack) ctx.putImageData(fBack, w1, 0);

      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: { value: tex },
          uTiles: {
            value: [
              new THREE.Vector4(0, 0, w1 / canvas.width, h1 / canvas.height),
              new THREE.Vector4(w1 / canvas.width, 0, w2 / canvas.width, h2 / canvas.height),
            ],
          },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      });

      // ★ 每兵种独立几何（实例属性挂在几何上，不能跨兵种共用）
      const geo = new THREE.PlaneGeometry(1, 1);
      const tiles = new THREE.InstancedBufferAttribute(new Float32Array(AGENT_CAPACITY), 1);
      tiles.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aTile', tiles);
      const flash = new THREE.InstancedBufferAttribute(new Float32Array(AGENT_CAPACITY), 1);
      flash.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aFlash', flash);

      const mesh = new THREE.InstancedMesh(geo, material, AGENT_CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      this.mobs.push({ mesh, tiles, flash, aspect: h1 / Math.max(1, w1) });
    }
  }

  /** 每帧同步：代理 → 各兵种实例矩阵（贴地 + 底部锚点 + yaw + 前后帧） */
  sync(pool: AgentPool, groundAt: (x: number, z: number, y: number) => number): void {
    const counters: number[] = [];
    for (let m = 0; m < this.mobs.length; m++) counters.push(0);
    for (let i = 0; i < pool.count; i++) {
      const mob = pool.mobIndex[i];
      const batch = this.mobs[mob];
      if (!batch) continue;
      const idx = counters[mob]++;
      const w = Math.max(0.05, pool.scale[i]);
      const h = w * batch.aspect;
      const gy = groundAt(pool.x[i], pool.z[i], pool.y[i]); // ★ y 提示选层（浮空洞顶）
      pool.y[i] = gy; // 贴地回写（渲染与逻辑同源）
      _p.set(pool.x[i], gy + h / 2, pool.z[i]);
      _q.setFromAxisAngle(_axisY, pool.yaw[i]);
      _s.set(w, h, 1);
      _m.compose(_p, _q, _s);
      batch.mesh.setMatrixAt(idx, _m);
      batch.tiles.setX(idx, pool.facingBack[i]);
      batch.flash.setX(idx, pool.flash[i]);
    }
    for (let m = 0; m < this.mobs.length; m++) {
      const b = this.mobs[m];
      if (!b) continue;
      b.mesh.count = counters[m];
      b.mesh.instanceMatrix.needsUpdate = true;
      b.tiles.needsUpdate = true;
      b.flash.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const b of this.mobs) {
      if (!b) continue;
      b.mesh.geometry.dispose();
      const mat = b.mesh.material as THREE.ShaderMaterial;
      (mat.uniforms.uAtlas.value as THREE.Texture)?.dispose();
      mat.dispose();
      b.mesh.parent?.remove(b.mesh);
    }
    this.mobs.length = 0;
  }
}
