// ============================================================
// SolidBulletAsset —— 程序生成的子弹贴片资产（FrameAssetSource）
// ============================================================
// 用途：子弹系统落地前的测试资产（发光圆点）+ 敌方远程弹道（程序化箭矢）。
// 实现最小接口：1 帧 + mock 播放控制器（子弹无动画，帧恒 0）。
// 正式资产就绪后替换为 .ftx3/.scene.zip，管线不变。

import * as THREE from 'three';
import type { FrameAssetSource } from './AssetSource';
import type { FramePlaybackController, PlaybackConfig, FramePlaybackCallbacks } from '../../vendor/player/core/controller';

/** ★ 子弹无动画：mock 控制器（帧恒 0）—— 两种程序化资产共用 */
function mockBulletController(): FramePlaybackController {
  return {
    callbacks: {},
    frameIndex: 0,
    state: 'playing',
    reset: () => undefined,
    goto: () => undefined,
    gotoTime: () => undefined,
    stepForward: () => undefined,
    stepBackward: () => undefined,
    hold: () => undefined,
    release: () => undefined,
    play: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    stop: () => undefined,
    advance: () => undefined,
    dispose: () => undefined,
  } as unknown as FramePlaybackController;
}

/** ★ 单帧程序化资产封装（width/height 由调用方决定；residual 恒 128 = 无残差） */
function makeSingleFrameAsset(
  baseData: Float32Array,
  resData: Uint8Array,
  width: number,
  height: number,
): FrameAssetSource {
  const base = new THREE.DataTexture(baseData, width, height, THREE.RGBAFormat, THREE.FloatType);
  const residual = new THREE.DataTexture(resData, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  base.needsUpdate = true;
  residual.needsUpdate = true;
  return {
    frameCount: 1,
    getFramePair: (i) => (i === 0 ? { base, residual } : null),
    createController: (_config?: PlaybackConfig, _callbacks?: FramePlaybackCallbacks): FramePlaybackController =>
      mockBulletController(),
    resolveFrame: () => 0,
    hasFrame: () => false,
    frameNames: () => [],
  };
}

/** 生成发光圆点子弹资产（size=纹理边长像素；h/s/l=HSL 颜色） */
export function createSolidBulletAsset(size = 64, h = 0.0, s = 0.9, l = 0.6): FrameAssetSource {
  const n = size * size;
  // base：HSL float（r=H, g=S, b=L, a=Alpha）；residual：8bit（128=无残差）
  const baseData = new Float32Array(n * 4);
  const resData = new Uint8Array(n * 4);
  const r = size * 0.45;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      const i = (y * size + x) * 4;
      const inCircle = dx * dx + dy * dy <= r * r;
      baseData[i] = h;
      baseData[i + 1] = inCircle ? s : 0;
      baseData[i + 2] = inCircle ? l : 0;
      baseData[i + 3] = inCircle ? 1 : 0;
      resData[i] = 128;
      resData[i + 1] = 128;
      resData[i + 2] = 128;
      resData[i + 3] = 255;
    }
  }
  return makeSingleFrameAsset(baseData, resData, size, size);
}

// ------------------------------------------------------------
// ★ 程序化箭矢（敌方远程弹道：弩手）
// ------------------------------------------------------------
// 纵向 = 弹道方向：**row 0 = 尖端**（与 BulletEntity「row0=顶部=弹头」约定一致），
// 末行 = 尾羽。宽高比 1:4 ⇒ 世界尺寸 = baseWidth 宽 × baseWidth×4 长（见
// BulletEntity.computeWorldSize）。
// 三段式：箭头（钢灰三角）→ 箭杆（木棕细条）→ 尾羽（红，双侧叶片 + 中间细杆）。
// 纯程序化，无资产文件 —— 与项目"无资产手搓特效"口径一致。

/** HSL 三段配色（与 base 通道语义一致：h∈[0,1), s∈[0,1], l∈[0,1]） */
const ARROW_STEEL: readonly [number, number, number] = [0.60, 0.08, 0.78];  // 箭头：冷钢灰
const ARROW_WOOD: readonly [number, number, number] = [0.07, 0.55, 0.34];   // 箭杆：木棕
const ARROW_FLETCH: readonly [number, number, number] = [0.98, 0.72, 0.48]; // 尾羽：暗红

/** 生成程序化箭矢资产（size=纹理宽像素，length=纹理高像素） */
export function createArrowAsset(size = 24, length = 96): FrameAssetSource {
  const n = size * length;
  const baseData = new Float32Array(n * 4);
  const resData = new Uint8Array(n * 4);
  const HEAD_END = 0.20;      // 箭头段占比（row 0 → HEAD_END）
  const FLETCH_START = 0.82;  // 尾羽起始占比
  const SHAFT_HW = 0.075;     // 箭杆半宽（归一化到纹理宽）
  const HEAD_HW = 0.45;       // 箭头底部半宽
  const FLETCH_HW = 0.40;     // 尾羽末端半宽
  const FLETCH_GAP = 0.14;    // 尾羽与中线之间的缝（做出"两片羽"；> SHAFT_HW 才有可见缝）
  const cx = (size - 1) / 2;

  for (let y = 0; y < length; y++) {
    const ny = y / length;
    for (let x = 0; x < size; x++) {
      const ax = Math.abs((x - cx) / size);
      let col: readonly [number, number, number] | null = null;
      if (ny < HEAD_END) {
        // 箭头：尖端在 row 0，线性张开到 HEAD_HW
        if (ax <= HEAD_HW * (ny / HEAD_END)) col = ARROW_STEEL;
      } else if (ny < FLETCH_START) {
        // 箭杆
        if (ax <= SHAFT_HW) col = ARROW_WOOD;
      } else {
        // 尾羽：中线细杆 + 两侧叶片
        const k = (ny - FLETCH_START) / (1 - FLETCH_START);
        const bladeHw = SHAFT_HW + (FLETCH_HW - SHAFT_HW) * k;
        if (ax <= SHAFT_HW) col = ARROW_WOOD;
        else if (ax >= FLETCH_GAP && ax <= bladeHw) col = ARROW_FLETCH;
      }
      const i = (y * size + x) * 4;
      baseData[i] = col ? col[0] : 0;
      baseData[i + 1] = col ? col[1] : 0;
      baseData[i + 2] = col ? col[2] : 0;
      baseData[i + 3] = col ? 1 : 0;
      resData[i] = 128;
      resData[i + 1] = 128;
      resData[i + 2] = 128;
      resData[i + 3] = 255;
    }
  }
  return makeSingleFrameAsset(baseData, resData, size, length);
}

/** ★ 箭矢世界宽度（米）。长度 = 本值 × 4（纹理 1:4） */
export const ARROW_BASE_WIDTH = 0.28;
