// ============================================================
// src/fx/channels/HitEffectChannel —— 击中特效（统一运行时通道）
// ============================================================
// 从 vendor/player/hitEffect/HitEffectView 收敛而来（形状解析/烘焙/变体算法零变化），改动：
//   ① 生命周期归 FxRuntime；实例从**固定池**借出，播完归还；
//   ② **变体预烘焙成图集**（ATLAS_VARIANTS × ATLAS_FRAMES 格），播放时**零重绘、
//      零纹理上传** —— 每帧只改 4 个顶点的 uv（32 字节），也不再需要每实例 canvas；
//   ③ 材质全池共享（同一张图集），每实例只持自己的 geometry；
//   ④ 跟随语义不变：句柄实现 EntityEffect 的 update/render/dispose 三件套，
//      `dispose()` = **归还池**（EffectSlots 一行都不用改）。
//
// ★ 为什么之前贵：每个在播实例每帧 clearRect + 逐形状 drawImage + texture.needsUpdate
//   （128² RGBA = 64KB 上传/实例/帧）。8 个同时播 = 每帧 512KB。
//   现在：整张图集只在构造时上传一次；播放期每实例每生命周期最多 ATLAS_FRAMES 次
//   4 顶点 uv 更新（12 × 32B = 384B）。
// ============================================================

import * as THREE from 'three';
import type { HitEffectShapeExport } from '../../vendor/player/core/types';
import {
  generateVariant,
  randomSeed,
  shapeSeed,
  tickVariant,
  variantDuration,
} from '../../vendor/player/hitEffect/variantGenerator';
import type { EffectShapeDef, EffectShapeVariant } from '../../vendor/player/hitEffect/types';
import type { FxChannel } from '../runtime/FxChannel';
import { compositeHslResidualToRgba, ftxHsl2rgb } from '../tex/ftxComposite';

/** 同时最多几个命中特效（超出 → 抢播得最久的复用，不新建） */
const MAX_INSTANCES = 8;
/** 图集行数 = 预烘焙的随机变体数 */
const ATLAS_VARIANTS = 4;
/** 图集列数 = 每个变体的动画帧数（总时长 / 12 ≈ 30fps 动画） */
const ATLAS_FRAMES = 12;
const DEFAULT_WORLD_SIZE = 1.5;
const DEFAULT_BAKE_SIZE = 128;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** FTX 嵌入（baseHsl + 量化残差）→ RGB 画布（通道级共享一次）
 *  ★ 像素合成转调唯一真源；alpha 口径 = binary/0.5（形状外必须全透明） */
function buildFtxImage(ftx: NonNullable<HitEffectShapeExport['ftx']>): HTMLCanvasElement {
  const hsl = new Float32Array(base64ToBytes(ftx.baseHslBase64).buffer);
  const res = base64ToBytes(ftx.residualBase64);
  const w = ftx.width, h = ftx.height;
  const data = compositeHslResidualToRgba(hsl, res, w, h, { alpha: 'binary', alphaThreshold: 0.5 });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}

/** 外置残差层 base64 → 画布（通道级共享） */
function buildResidualImage(res: NonNullable<HitEffectShapeExport['residualLayer']>): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = res.width; c.height = res.height;
  c.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(base64ToBytes(res.dataBase64)), res.width, res.height),
    0, 0,
  );
  return c;
}

interface HitInstance {
  id: number;
  active: boolean;
  elapsed: number;
  worldSize: number;
  /** 本次播放用的图集行（随机变体） */
  variantRow: number;
  /** 已应用到 geometry 的帧列（-1 = 尚未设置） */
  lastFrame: number;
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.PlaneGeometry;
  readonly uv: THREE.BufferAttribute;
  followOffset: { x: number; y: number; z: number };
}

/** 借出的句柄：结构上满足 EntityEffect（update/render/dispose），dispose = 归还池 */
export interface FxHitHandle {
  readonly kind: 'hit';
  readonly active: boolean;
  setFollowOffset(dx: number, dy: number, dz: number): void;
  update(dt: number, x: number, y: number, z: number): boolean;
  render(camera: THREE.Camera): void;
  dispose(): void;
}

export class HitEffectChannel implements FxChannel {
  /** 形状定义（shapes → defs 只转一次） */
  private readonly defs: EffectShapeDef[];
  private readonly ftxImages = new Map<string, HTMLCanvasElement>();
  private readonly residualImages = new Map<string, HTMLCanvasElement>();
  /** 统一烘焙缩放（按最大轮廓跨度 × 最大外扩 × 旋转余量预算） */
  private readonly fitScale: number;
  private readonly bakeSize: number;
  /** 一轮动画的总时长（= 各 shape 外扩时长最大值） */
  private readonly totalDuration: number;
  /** 预烘焙图集（所有实例共享同一张纹理与材质） */
  private readonly atlas: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly instances: HitInstance[] = [];
  private nextId = 1;
  /** 待重烘焙（换日请求）：等所有实例播完再执行，避免正在播的特效突然变形状 */
  private pendingRebake = false;

  constructor(scene: THREE.Scene, shapes: HitEffectShapeExport[], options?: { bakeSize?: number }) {
    this.bakeSize = options?.bakeSize ?? DEFAULT_BAKE_SIZE;

    // 导出形状 → 生成器可消费的 def（只做一次，所有实例共享）
    this.defs = shapes.map((sh, i) => ({
      id: i,
      name: sh.name,
      outline: sh.outline,
      fill: sh.solid ?? { h: 0.55, s: 0.8, l: 0.6, a: 1 },
      params: sh.params,
    }));
    for (const sh of shapes) {
      if (sh.fillMode === 'ftx' && sh.ftx) this.ftxImages.set(sh.name, buildFtxImage(sh.ftx));
      if (sh.residualLayer) this.residualImages.set(sh.name, buildResidualImage(sh.residualLayer));
    }

    // ★ 统一缩放基准：最大「轮廓跨度 × 最大外扩」，再加旋转余量（√2 + 10%）
    let maxSpan = 1e-6;
    for (const sh of shapes) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of sh.outline) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      const span = Math.max(maxX - minX, maxY - minY);
      const maxExpand = Math.max(sh.params.expand.xMax, sh.params.expand.yMax);
      maxSpan = Math.max(maxSpan, span * maxExpand);
    }
    const pad = 16;
    this.fitScale = ((this.bakeSize - pad * 2) / (maxSpan * 1.42 * 1.1));
    this.totalDuration = Math.max(...this.defs.map((d) => variantDuration(d)), 0.05);

    // ---- 预烘焙图集：一次上传，播放期只换 UV ----
    const atlasCanvas = this.bakeAtlas();
    this.atlas = new THREE.CanvasTexture(atlasCanvas);
    this.atlas.minFilter = THREE.LinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    // ★ 烘焙画布是显示空间 sRGB 色，必须打标签（否则 ACES 后双重提亮）
    this.atlas.colorSpace = THREE.SRGBColorSpace;

    this.material = new THREE.MeshBasicMaterial({
      map: this.atlas,
      transparent: true,
      depthWrite: false,
    });

    // 池：固定 MAX_INSTANCES 个，全部常驻场景（idle 时隐藏）
    for (let i = 0; i < MAX_INSTANCES; i++) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.scale.set(DEFAULT_WORLD_SIZE, DEFAULT_WORLD_SIZE, 1);
      const group = new THREE.Group();
      group.add(mesh);
      scene.add(group);

      this.instances.push({
        id: 0, active: false, elapsed: 0, worldSize: DEFAULT_WORLD_SIZE,
        variantRow: 0, lastFrame: -1,
        group, mesh, geometry, uv,
        followOffset: { x: 0, y: 0, z: 0 },
      });
    }
  }

  /** 借一个实例并播放；返回的句柄可直接当 EntityEffect 用 */
  spawn(x: number, y: number, z: number, worldSize = DEFAULT_WORLD_SIZE): FxHitHandle {
    let inst = this.instances.find((i) => !i.active);
    if (!inst) {
      // 全在播 → 抢播得最久的（不新建、不掉帧）
      inst = this.instances[0];
      for (const i of this.instances) if (i.elapsed > inst.elapsed) inst = i;
    }

    inst.id = this.nextId++;
    inst.active = true;
    inst.elapsed = 0;
    inst.worldSize = worldSize;
    inst.variantRow = Math.floor(Math.random() * ATLAS_VARIANTS);
    inst.lastFrame = -1;
    inst.followOffset.x = 0;
    inst.followOffset.y = 0;
    inst.followOffset.z = 0;

    inst.group.position.set(x, y, z);
    inst.mesh.scale.set(worldSize, worldSize, 1);
    inst.mesh.visible = true;
    this.applyUv(inst, 0);

    return this.makeHandle(inst.id);
  }

  /** EntityEffect 兼容：推进 + 跟随（x/y/z = 跟随点，位置 = 跟随点 + 偏移） */
  updateLease(id: number, dt: number, x: number, y: number, z: number): boolean {
    const inst = this.find(id);
    if (!inst) return true;
    inst.elapsed += dt;
    inst.group.position.set(
      x + inst.followOffset.x,
      y + inst.followOffset.y,
      z + inst.followOffset.z,
    );
    if (inst.elapsed >= this.totalDuration) {
      this.retire(inst);
      return true;
    }
    const frame = Math.min(
      ATLAS_FRAMES - 1,
      Math.floor((inst.elapsed / this.totalDuration) * ATLAS_FRAMES),
    );
    if (frame !== inst.lastFrame) this.applyUv(inst, frame);
    return false;
  }

  /** EntityEffect 兼容：billboard 面相机 */
  renderLease(id: number, camera: THREE.Camera): void {
    const inst = this.find(id);
    if (inst) inst.group.quaternion.copy(camera.quaternion);
  }

  setFollowOffset(id: number, dx: number, dy: number, dz: number): void {
    const inst = this.find(id);
    if (!inst) return;
    inst.followOffset.x = dx;
    inst.followOffset.y = dy;
    inst.followOffset.z = dz;
  }

  isPlaying(id: number): boolean {
    return this.find(id) !== null;
  }

  /** 提前归还（句柄 dispose 走这里；幂等） */
  release(id: number): void {
    const inst = this.find(id);
    if (inst) this.retire(inst);
  }

  clear(): void {
    for (const i of this.instances) if (i.active) this.retire(i);
  }

  /** 请求重烘焙一组新变体（换日）。真正烘焙延迟到**没有任何实例在播**的帧。
   *  ★ 为什么要等：图集是所有实例共享的，播到一半换图 → 正播的特效会突然变形状。 */
  requestRebake(): void {
    this.pendingRebake = true;
  }

  update(_dt: number, _camera?: THREE.Camera): void {
    // 推进由持有者（实体槽 / 固定点列表）逐实例驱动；这里只处理"换日重烘焙"的时机
    if (!this.pendingRebake) return;
    for (const inst of this.instances) {
      if (inst.active) return; // 有人还在播 → 下一帧再看
    }
    this.pendingRebake = false;
    const canvas = this.bakeAtlas();
    this.atlas.image = canvas;
    this.atlas.needsUpdate = true;
  }

  dispose(): void {
    for (const inst of this.instances) {
      inst.group.removeFromParent();
      inst.geometry.dispose();
    }
    this.instances.length = 0;
    this.material.dispose();
    this.atlas.dispose();
    this.ftxImages.clear();
    this.residualImages.clear();
  }

  private makeHandle(id: number): FxHitHandle {
    const self = this;
    return {
      kind: 'hit',
      get active() { return self.isPlaying(id); },
      setFollowOffset(dx, dy, dz) { self.setFollowOffset(id, dx, dy, dz); },
      update(dt, x, y, z) { return self.updateLease(id, dt, x, y, z); },
      render(camera) { self.renderLease(id, camera); },
      dispose() { self.release(id); },
    };
  }

  private find(id: number): HitInstance | null {
    if (id <= 0) return null;
    for (const i of this.instances) if (i.active && i.id === id) return i;
    return null;
  }

  private retire(inst: HitInstance): void {
    inst.active = false;
    inst.elapsed = 0;
    inst.lastFrame = -1;
    inst.mesh.visible = false;
  }

  /** 图集格子 UV（PlaneGeometry 顶点序：(0,1) (1,1) (0,0) (1,0)）
   *  CanvasTexture 默认 flipY=true ⇒ canvas 顶部行对应纹理 v=1，行号要反过来算。
   *  ★ 四边各内缩半个像素：LinearFilter 在格子边界会混邻格（轮廓 stroke 会溢到边界）。 */
  private applyUv(inst: HitInstance, frame: number): void {
    const cw = 1 / ATLAS_FRAMES;
    const ch = 1 / ATLAS_VARIANTS;
    const insetX = 0.5 / (this.bakeSize * ATLAS_FRAMES);
    const insetY = 0.5 / (this.bakeSize * ATLAS_VARIANTS);
    const x0 = frame * cw + insetX;
    const x1 = (frame + 1) * cw - insetX;
    const yTop = 1 - inst.variantRow * ch - insetY;
    const yBot = 1 - (inst.variantRow + 1) * ch + insetY;
    const uv = inst.uv;
    uv.setXY(0, x0, yTop);
    uv.setXY(1, x1, yTop);
    uv.setXY(2, x0, yBot);
    uv.setXY(3, x1, yBot);
    uv.needsUpdate = true;
    inst.lastFrame = frame;
  }

  /** 一次性烘焙：ATLAS_VARIANTS 个随机变体 × ATLAS_FRAMES 帧 */
  private bakeAtlas(): HTMLCanvasElement {
    const S = this.bakeSize;
    const canvas = document.createElement('canvas');
    canvas.width = S * ATLAS_FRAMES;
    canvas.height = S * ATLAS_VARIANTS;
    const c2d = canvas.getContext('2d')!;
    for (let v = 0; v < ATLAS_VARIANTS; v++) {
      const seed = randomSeed();
      const variants = this.defs.map((d, i) => generateVariant(d, shapeSeed(seed, i)));
      for (let f = 0; f < ATLAS_FRAMES; f++) {
        const t = (f / (ATLAS_FRAMES - 1)) * this.totalDuration;
        this.drawInto(c2d, t, variants, f * S, v * S);
      }
    }
    return canvas;
  }

  /** 在指定格子（左上角 ox,oy）烘焙一帧：所有形状叠加绘制 */
  private drawInto(
    c2d: CanvasRenderingContext2D,
    t: number,
    variants: EffectShapeVariant[],
    ox: number,
    oy: number,
  ): void {
    const S = this.bakeSize;
    const s = this.fitScale;
    for (let i = 0; i < this.defs.length; i++) {
      const sh = this.defs[i];
      const v = variants[i];
      const pose = tickVariant(v, t, sh);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of v.vertices) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      c2d.save();
      c2d.translate(ox + S / 2, oy + S / 2);
      c2d.rotate(pose.angle);
      c2d.scale(pose.scaleX, pose.scaleY);
      c2d.translate(-cx * s, -cy * s);
      c2d.beginPath();
      v.vertices.forEach((p, j) => {
        const px = p.x * s, py = p.y * s;
        if (j === 0) c2d.moveTo(px, py); else c2d.lineTo(px, py);
      });
      c2d.closePath();
      const ftxImg = this.ftxImages.get(sh.name);
      const solid = this.defs[i].fill;
      if (ftxImg) {
        c2d.save();
        c2d.clip();
        c2d.imageSmoothingEnabled = false;
        c2d.drawImage(ftxImg, 0, 0, S, S);
        c2d.restore();
      } else {
        const [fr, fg, fb] = ftxHsl2rgb(solid.h, solid.s, solid.l);
        c2d.fillStyle = `rgba(${Math.round(fr * 255)},${Math.round(fg * 255)},${Math.round(fb * 255)},${solid.a ?? 1})`;
        c2d.fill();
      }
      const resImg = this.residualImages.get(sh.name);
      if (resImg) {
        c2d.save();
        c2d.clip();
        c2d.imageSmoothingEnabled = false;
        c2d.drawImage(resImg, 0, 0, S, S);
        c2d.restore();
      }
      c2d.strokeStyle = 'rgba(255,255,255,0.35)';
      c2d.lineWidth = 1;
      c2d.stroke();
      c2d.restore();
    }
  }
}
