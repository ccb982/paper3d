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
  colors?: string[]; // 多颜色分层
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

function parseColor(color: string): [number, number, number] {
  const c = new THREE.Color(color);
  return [c.r, c.g, c.b];
}

export function createGradientCanvas(
  baseColor: string | number[],
  width: number = 512,
  height: number = 512,
  options: GradientOptions = {}
): HTMLCanvasElement {
  const {
    regionCount = 5,
    blockCount = 3,
    internalGradStrength = 0.05,
    seed = 42,
    blockAlpha = 0.75,
    hueVariation = 0.05,
    satVariation = 0.05,
    lightVariation = 0.05,
    colors = [] // 多颜色分层数组
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

  // 如果提供了多颜色数组，则使用多颜色分层
  const useMultiColors = colors.length > 0;

  // 生成分层颜色
  const regionColors: Array<{ h: number; s: number; l: number; rgb: number[] }> = [];

  if (useMultiColors) {
    // 使用提供的颜色数组进行分层
    for (let i = 0; i < colors.length; i++) {
      const colorRgb = parseColor(colors[i]);
      const [h, s, l] = rgbToHsl(colorRgb[0], colorRgb[1], colorRgb[2]);
      regionColors.push({ h, s, l, rgb: colorRgb });
    }
  } else {
    // 使用HSL算法生成分层基色（原有逻辑）
    for (let i = 0; i < regionCount; i++) {
      const lightness = 0.35 + (i / (regionCount - 1)) * 0.4; // 0.35 ~ 0.75
      const saturation = 0.8; // 固定饱和度
      const hue = baseH; // 使用基础颜色的色相
      regionColors.push({ h: hue, s: saturation, l: lightness, rgb: hslToRgb(hue, saturation, lightness) });
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // 计算分层边界（y轴上的横线，加入sin调整）
  const layerBoundaries = [];
  const totalLayers = useMultiColors ? regionColors.length - 1 : regionCount - 1;
  for (let i = 0; i < totalLayers; i++) {
    const baseY = (i + 1) / (useMultiColors ? regionColors.length : regionCount) * height;
    layerBoundaries.push(baseY);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 计算当前位置的sin调整值
      const sinOffset = Math.sin(x * 0.05) * 3; // 波浪振幅为3像素
      const adjustedY = y + sinOffset;

      // 初始化颜色变量
      let finalH = 0, finalS = 0, finalL = 0;

      // 检查是否处于层边界的过渡区域
      let isInTransition = false;
      let transitionLayerIndex = -1;
      let transitionT = 0;

      // 检测是否在层边界的过渡区域
      for (let i = 0; i < layerBoundaries.length; i++) {
        const boundary = layerBoundaries[i];
        const transitionWidth = 10; // 过渡区域宽度（像素）
        
        if (Math.abs(adjustedY - boundary) < transitionWidth) {
          isInTransition = true;
          transitionLayerIndex = i;
          // 计算过渡系数（0-1），使用sin函数实现平滑过渡
          transitionT = 0.5 + 0.5 * Math.sin((adjustedY - boundary) / transitionWidth * Math.PI);
          break;
        }
      }

      if (isInTransition && transitionLayerIndex >= 0) {
        // 在过渡区域，混合相邻两层的颜色
        const layerA = regionColors[transitionLayerIndex];
        const layerB = regionColors[transitionLayerIndex + 1];

        // 计算两层的颜色值
        // 为每层添加层内渐变效果
        const layerAStartY = transitionLayerIndex > 0 ? layerBoundaries[transitionLayerIndex - 1] : 0;
        const layerAEndY = layerBoundaries[transitionLayerIndex];
        const layerAT = (y - layerAStartY) / (layerAEndY - layerAStartY);
        
        const layerBStartY = layerBoundaries[transitionLayerIndex];
        const layerBEndY = transitionLayerIndex < layerBoundaries.length - 1 ? layerBoundaries[transitionLayerIndex + 1] : height;
        const layerBT = (y - layerBStartY) / (layerBEndY - layerBStartY);

        // 层内渐变强度
        const gradientStrength = 0.3;
        
        // 计算两层的实际颜色
        const layerAH = layerA.h;
        const layerAS = Math.min(1, layerA.s + layerAT * gradientStrength);
        const layerAL = Math.min(1, layerA.l + layerAT * gradientStrength);
        
        const layerBH = layerB.h;
        const layerBS = Math.min(1, layerB.s + layerBT * gradientStrength);
        const layerBL = Math.min(1, layerB.l + layerBT * gradientStrength);

        // 使用sin过渡系数混合颜色
        finalH = layerAH + (layerBH - layerAH) * transitionT;
        finalS = layerAS + (layerBS - layerAS) * transitionT;
        finalL = layerAL + (layerBL - layerAL) * transitionT;
      } else {
        // 不在过渡区域，使用单层颜色
        // 确定当前位置属于哪个层次
        let layerIndex = 0;
        for (let i = 0; i < layerBoundaries.length; i++) {
          if (adjustedY >= layerBoundaries[i]) {
            layerIndex = i + 1;
          }
        }

        // 获取当前层次的颜色
        const layerColor = regionColors[layerIndex];

        // 计算当前层内的相对位置（0-1）
        let layerStartY = 0;
        let layerEndY = height;
        if (layerIndex > 0) {
          layerStartY = layerBoundaries[layerIndex - 1];
        }
        if (layerIndex < layerBoundaries.length) {
          layerEndY = layerBoundaries[layerIndex];
        }
        const layerHeight = layerEndY - layerStartY;
        const layerT = layerHeight > 0 ? (y - layerStartY) / layerHeight : 0;

        // 为每个基色层添加从上到下逐渐增强的渐变效果
        // 渐变方向：上 → 下，亮度和饱和度逐渐增加
        const gradientStrength = 0.3; // 渐变强度
        const hueShift = 0;
        const satShift = layerT * gradientStrength; // 饱和度从上到下增加
        const litShift = layerT * gradientStrength; // 亮度从上到下增加

        finalH = layerColor.h + hueShift;
        finalS = Math.min(1, layerColor.s + satShift);
        finalL = Math.min(1, layerColor.l + litShift);
      }

      // 加入轻微的内部细节变化
      const detailHueShift = 0.01 * Math.sin(x * 0.1 + y * 0.1) * internalGradStrength;
      const detailSatShift = 0.05 * Math.cos(x * 0.08) * internalGradStrength;
      const detailLitShift = 0.08 * Math.sin(y * 0.1) * internalGradStrength;

      const h = ((finalH + detailHueShift % 1) + 1) % 1;
      const s = Math.min(1, Math.max(0, finalS + detailSatShift));
      const l = Math.min(1, Math.max(0, finalL + detailLitShift));
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
    const baseSize = Math.max(10, Math.min(30, Math.min(width, height) * 0.1));
    const sizeW = baseSize + random() * baseSize * 0.5;
    const sizeH = baseSize + random() * baseSize * 0.5;
    const rotation = random() * Math.PI * 2;

    const [baseR, baseG, baseB] = baseRgb;
    const randR = Math.min(1, Math.max(0, baseR + (random() - 0.5) * 5/255));
    const randG = Math.min(1, Math.max(0, baseG + (random() - 0.5) * 5/255));
    const randB = Math.min(1, Math.max(0, baseB + (random() - 0.5) * 5/255));
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

// 子弹拖尾专用多颜色分层
export const BULLET_TRAIL_COLORS = [
  '#010103', // 黑色（头部）
  '#141928', // 深蓝紫色
  '#3C1928', // 紫红色
  '#7F1827', // 暗红色
  '#A31B2B', // 红色
  '#C81E30', // 亮红色
  '#FE7A91', // 粉色（尾部）
];