import * as THREE from 'three';

/**
 * 平流通道掩码 —— 控制 R/G/B/A 中哪些通道参与平流。
 * true = 参与平流（跟随速度场流动）
 * false = 静止直传（像素原地不动）
 */
export interface AdvectionMask {
  r: boolean;
  g: boolean;
  b: boolean;
  a: boolean;
}

/**
 * 纹理数据类型。
 * - uint8: 1 字节/通道，匹配 RGB565 精度，带宽仅 Float32 的 1/4
 * - half-float: 2 字节/通道，精度更高但带宽翻倍
 */
export type TextureDataType = 'uint8' | 'half-float';

const THREE_TYPE_MAP: Record<TextureDataType, THREE.TextureDataType> = {
  'uint8': THREE.UnsignedByteType,
  'half-float': THREE.HalfFloatType,
};

const FORMAT_NAMES: Record<THREE.PixelFormat, string> = {
  [THREE.RedFormat]: 'RedFormat',
  [THREE.RGFormat]: 'RGFormat',
  [THREE.RGBFormat]: 'RGBFormat',
  [THREE.RGBAFormat]: 'RGBAFormat',
};

const TYPE_NAMES: Record<THREE.TextureDataType, string> = {
  [THREE.UnsignedByteType]: 'UnsignedByteType',
  [THREE.HalfFloatType]: 'HalfFloatType',
  [THREE.FloatType]: 'FloatType',
};

/**
 * FluidGrid —— 双缓冲纹理管理器。
 *
 * 职责：
 * - 持有两个 WebGLRenderTarget（Ping-Pong A/B）
 * - 提供 read（当前可读纹理）和 write（当前可写目标）的引用
 * - swap() 交换读/写引用
 * - 不关心数据语义（HSLA 还是速度场），只负责搬运纹理
 *
 * 使用方式：
 *   const grid = new FluidGrid({ w: 256, h: 256 }, 4, 'uint8');
 *   solver.advect(grid, velocityTex, dt, mask);
 *   // 求解器内部写入 grid.write，调用 grid.swap() 完成翻转
 */
export class FluidGrid {
  private texA: THREE.WebGLRenderTarget;
  private texB: THREE.WebGLRenderTarget;
  private current: 'A' | 'B' = 'A';

  public readonly resolution: { w: number; h: number };
  public readonly channelCount: number;
  public readonly dataType: TextureDataType;

  constructor(
    resolution: { w: number; h: number },
    channels: 1 | 2 | 3 | 4 = 4,
    dataType: TextureDataType = 'uint8',
  ) {
    this.resolution = { w: resolution.w, h: resolution.h };
    this.channelCount = channels;
    this.dataType = dataType;

    const formatMap: Record<number, THREE.PixelFormat> = {
      1: THREE.RedFormat,
      2: THREE.RGFormat,
      3: THREE.RGBAFormat, // 3 通道也分配 RGBA，GPU 按四通道对齐
      4: THREE.RGBAFormat,
    };

    const threeType = THREE_TYPE_MAP[dataType];
    const format = formatMap[channels];

    this.texA = new THREE.WebGLRenderTarget(resolution.w, resolution.h, {
      format,
      type: threeType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.texB = new THREE.WebGLRenderTarget(resolution.w, resolution.h, {
      format,
      type: threeType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });

    console.log(`[FluidGrid] 创建双缓冲纹理:`);
    console.log(`  分辨率: ${resolution.w} × ${resolution.h}`);
    console.log(`  通道数: ${channels} (格式: ${FORMAT_NAMES[format] || format})`);
    console.log(`  数据类型: ${TYPE_NAMES[threeType] || threeType}`);
    console.log(`  texA:`, this.texA.texture);
    console.log(`  texB:`, this.texB.texture);
  }

  /** 当前可读纹理 */
  get read(): THREE.Texture {
    const tex = this.current === 'A' ? this.texA.texture : this.texB.texture;
    console.debug(`[FluidGrid.read] current=${this.current}, 返回 tex=${this.current}`);
    return tex;
  }

  /** 当前可读 RenderTarget（用于 readRenderTargetPixels 回读） */
  get readTarget(): THREE.WebGLRenderTarget {
    const target = this.current === 'A' ? this.texA : this.texB;
    console.debug(`[FluidGrid.readTarget] current=${this.current}, 返回 target=${this.current}`);
    return target;
  }

  /** 当前可写入目标 */
  get write(): THREE.WebGLRenderTarget {
    const target = this.current === 'A' ? this.texB : this.texA;
    console.debug(`[FluidGrid.write] current=${this.current}, 返回 target=${this.current === 'A' ? 'B' : 'A'}`);
    return target;
  }

  /**
   * 交换读/写引用（Ping-Pong）。
   * 调用后 read 返回刚写入的数据，write 指向即将被覆盖的旧数据。
   */
  swap(): void {
    const old = this.current;
    this.current = this.current === 'A' ? 'B' : 'A';
    console.debug(`[FluidGrid.swap] ${old} → ${this.current}`);
  }

  setRenderTargetSize(w: number, h: number): void {
    console.log(`[FluidGrid.setRenderTargetSize] ${this.resolution.w}×${this.resolution.h} → ${w}×${h}`);
    this.resolution.w = w;
    this.resolution.h = h;
    this.texA.setSize(w, h);
    this.texB.setSize(w, h);
  }

  dispose(): void {
    console.log(`[FluidGrid.dispose] 释放纹理`);
    this.texA.dispose();
    this.texB.dispose();
  }
}
