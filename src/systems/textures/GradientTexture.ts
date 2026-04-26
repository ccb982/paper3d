import * as THREE from 'three';

interface ITextureGenerator {
  type: 'canvas' | 'shader';
  generate(): THREE.Texture | THREE.Material;
  update(delta?: number): void;
  dispose(): void;
}

interface GradientOptions {
  regionCount?: number;
  blockCount?: number;
  internalGradStrength?: number;
  seed?: number;
  blockAlpha?: number;
  hueVariation?: number;
  satVariation?: number;
  lightVariation?: number;
}

function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r, g, b];
}

export function createGradientCanvas(
  baseColor: string | number[],
  width: number = 512,
  height: number = 512,
  options: GradientOptions = {}
): HTMLCanvasElement {
  const {
    regionCount = 5,      // 调整分层数量，使每层差异更明显
    blockCount = 3,       // 减少色块数量
    internalGradStrength = 0.05, // 减小内部渐变强度
    seed = 42,
    blockAlpha = 0.75,
    hueVariation = 0.05,  // 减小色相变化
    satVariation = 0.05,  // 减小饱和度变化
    lightVariation = 0.05 // 减小明度变化
  } = options;

  let baseRgb: number[];
  if (typeof baseColor === 'string') {
    const c = new THREE.Color(baseColor);
    baseRgb = [c.r, c.g, c.b];
  } else {
    baseRgb = baseColor.slice(0, 3) as number[];
  }
  const [baseH, baseS, baseL] = rgbToHsl(baseRgb[0], baseRgb[1], baseRgb[2]);

  const random = seededRandom(seed);

  const regionColors: Array<{ h: number; s: number; l: number; rgb: number[] }> = [];
  for (let i = 0; i < regionCount; i++) {
    // 使用HSL算法生成分层基色：色相固定，明度递增
    // 略微增大明度范围，使相邻层色差更大
    const lightness = 0.35 + (i / (regionCount - 1)) * 0.4; // 0.35 ~ 0.75
    const saturation = 0.8; // 固定饱和度
    const hue = baseH; // 使用基础颜色的色相
    regionColors.push({ h: hue, s: saturation, l: lightness, rgb: hslToRgb(hue, saturation, lightness) });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // 计算分层边界（y轴上的横线，加入sin调整）
  const layerBoundaries = [];
  for (let i = 0; i < regionCount - 1; i++) {
    const baseY = (i + 1) / regionCount * height;
    // 加入sin调整分界线，使边界产生波浪效果
    layerBoundaries.push(baseY);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 计算当前位置的sin调整值
      const sinOffset = Math.sin(x * 0.05) * 3; // 波浪振幅为3像素
      const adjustedY = y + sinOffset;
      
      // 确定当前位置属于哪个层次
      let layerIndex = 0;
      for (let i = 0; i < layerBoundaries.length; i++) {
        if (adjustedY >= layerBoundaries[i]) {
          layerIndex = i + 1;
        }
      }
      
      // 获取当前层次的颜色
      const layerColor = regionColors[layerIndex];
      
      // 加入轻微的内部渐变
      const t = y / height;
      const hueShift = 0.01 * Math.sin(x * 0.1 + y * 0.1) * internalGradStrength;
      const satShift = 0.05 * Math.cos(x * 0.08) * internalGradStrength;
      const litShift = 0.08 * Math.sin(y * 0.1) * internalGradStrength;
      
      const h = ((layerColor.h + hueShift % 1) + 1) % 1;
      const s = Math.min(1, Math.max(0, layerColor.s + satShift));
      const l = Math.min(1, Math.max(0, layerColor.l + litShift));
      const [r, g, b] = hslToRgb(h, s, l);
      
      const idx = (y * width + x) * 4;
      data[idx] = r * 255;
      data[idx + 1] = g * 255;
      data[idx + 2] = b * 255;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  function drawRandomBlock() {
    const type = Math.floor(random() * 3);
    const centerX = random() * width;
    const centerY = random() * height;
    // 减小色块大小到几十像素面积
    const baseSize = Math.max(10, Math.min(30, Math.min(width, height) * 0.1));
    const sizeW = baseSize + random() * baseSize * 0.5;
    const sizeH = baseSize + random() * baseSize * 0.5;
    const rotation = random() * Math.PI * 2;

    // 生成RGB差值不超过5的随机颜色
    const [baseR, baseG, baseB] = baseRgb;
    const randR = Math.min(1, Math.max(0, baseR + (random() - 0.5) * 5/255));
    const randG = Math.min(1, Math.max(0, baseG + (random() - 0.5) * 5/255));
    const randB = Math.min(1, Math.max(0, baseB + (random() - 0.5) * 5/255));
    // 转换回HSL用于后续处理
    const [randHue, randSat, randLit] = rgbToHsl(randR, randG, randB);
    const [rCol, gCol, bCol] = hslToRgb(randHue, randSat, randLit);
    ctx.fillStyle = `rgba(${rCol * 255}, ${gCol * 255}, ${bCol * 255}, ${blockAlpha})`;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.beginPath();
    if (type === 0) {
      ctx.ellipse(0, 0, sizeW / 2, sizeH / 2, 0, 0, Math.PI * 2);
    } else if (type === 1) {
      ctx.rect(-sizeW / 2, -sizeH / 2, sizeW, sizeH);
    } else {
      const points = 5 + Math.floor(random() * 4);
      ctx.moveTo(sizeW / 2 * (0.8 + random() * 0.4), 0);
      for (let i = 1; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const rad = (sizeW / 2) * (0.6 + random() * 0.4);
        const xOff = Math.cos(angle) * rad;
        const yOff = Math.sin(angle) * rad * (sizeH / sizeW);
        ctx.lineTo(xOff, yOff);
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  for (let i = 0; i < blockCount; i++) {
    drawRandomBlock();
  }

  return canvas;
}

export class GradientTexture implements ITextureGenerator {
  type: 'canvas' | 'shader' = 'canvas';
  private texture: THREE.Texture | null = null;

  private baseColor: string | number[];
  private width: number;
  private height: number;
  private options: GradientOptions;

  constructor(
    baseColor: string | number[] = '#ff3366',
    width: number = 512,
    height: number = 512,
    options: GradientOptions = {}
  ) {
    this.baseColor = baseColor;
    this.width = width;
    this.height = height;
    this.options = options;
  }

  generate(): THREE.Texture | THREE.Material {
    const canvas = createGradientCanvas(this.baseColor, this.width, this.height, this.options);
    if (!this.texture) {
      this.texture = new THREE.CanvasTexture(canvas);
    } else {
      (this.texture as THREE.CanvasTexture).image = canvas;
    }
    this.texture.needsUpdate = true;
    return this.texture;
  }

  update(delta?: number): void {
    // 渐变纹理是静态的，不需要每帧更新
  }

  dispose(): void {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
  }
}

export function createGradientTexture(
  baseColor: string | number[] = '#ff3366',
  width: number = 512,
  height: number = 512,
  options: GradientOptions = {}
): THREE.CanvasTexture {
  const canvas = createGradientCanvas(baseColor, width, height, options);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}