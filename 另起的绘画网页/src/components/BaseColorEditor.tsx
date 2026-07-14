import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  clusterAndGenerateTexturesV2,
  hslToRgb,
  rgbToHsl,
  dequantize,
} from '../utils/colorCompressor';
import type { Point } from '../types';
import BaseColorList from './BaseColorList';

// ========== 贝塞尔曲线辅助函数 ==========
function sampleQuadraticBezier(p0: Point, p1: Point, ctrl: Point, segments = 20): Point[] {
  const result: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
    const y = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
    result.push({ x, y });
  }
  return result;
}

function buildBezierPath(points: Point[]): Point[] {
  if (points.length < 2) return points.slice();
  if (points.length === 2) return [points[0], points[1]];
  const fullPath: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i + 1];
    const ctrl = points[i];
    const curve = sampleQuadraticBezier(p0, p1, ctrl, 20);
    fullPath.push(...curve.slice(1));
  }
  fullPath.push(points[points.length - 1]);
  return fullPath;
}

// ============ 坐标转换 ============
const TEX_SIZE = 512;

function canvasToWorld(cx: number, cy: number): Point {
  return { x: cx / TEX_SIZE, y: 1 - cy / TEX_SIZE };
}

function worldToCanvas(wx: number, wy: number): Point {
  return { x: wx * TEX_SIZE, y: (1 - wy) * TEX_SIZE };
}

// ============ 提取模式下的BFS取色 ============
function extractBaseByClick(
  bgImageData: ImageData,
  worldPolygons: Point[][],
  _clickPixel?: { x: number; y: number },
  textureSize: number = TEX_SIZE
): {
  baseTexture: ImageData;
  residualTexture: ImageData;
  bbox: { x: number; y: number; w: number; h: number };
  baseColors: Array<{ h: number; s: number; l: number }>;
  regionIdTex: Uint8Array;
  texW: number;
  texH: number;
  colorPixelsMap: Map<number, number[]>;
} | null {
  if (worldPolygons.length === 0) return null;

  // 将贝塞尔曲线转换为折线（采样）
  const rasterizablePolygons = worldPolygons.map(poly => {
    if (poly.length === 3) {
      return buildBezierPath(poly);
    }
    return poly.slice();
  });

  // 1. 创建墙mask：虚线和贝塞尔曲线作为不可穿过的墙
  const wallMask = new Uint8Array(textureSize * textureSize);
  
  // 将所有多边形（虚线和贝塞尔）光栅化为墙
  for (const poly of rasterizablePolygons) {
    if (poly.length < 2) continue;
    
    // 绘制线段作为墙（8邻域扩展）
    for (let i = 0; i < poly.length - 1; i++) {
      const p1 = poly[i];
      const p2 = poly[i + 1];
      
      const x1 = Math.round(p1.x * textureSize);
      const y1 = Math.round((1 - p1.y) * textureSize);
      const x2 = Math.round(p2.x * textureSize);
      const y2 = Math.round((1 - p2.y) * textureSize);
      
      // 绘制线段（Bresenham算法）
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      const sx = x1 < x2 ? 1 : -1;
      const sy = y1 < y2 ? 1 : -1;
      let err = dx - dy;
      let x = x1;
      let y = y1;
      
      while (true) {
        if (x >= 0 && x < textureSize && y >= 0 && y < textureSize) {
          // 8邻域标记为墙
          for (let nx = x - 2; nx <= x + 2; nx++) {
            for (let ny = y - 2; ny <= y + 2; ny++) {
              if (nx >= 0 && nx < textureSize && ny >= 0 && ny < textureSize) {
                wallMask[ny * textureSize + nx] = 1;
              }
            }
          }
        }
        if (x === x2 && y === y2) break;
        const e2 = err * 2;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    }
  }

  // 2. 计算多边形的bbox（整个box区域）
  let minX = textureSize, minY = textureSize, maxX = -1, maxY = -1;
  for (const poly of rasterizablePolygons) {
    for (const p of poly) {
      const px = Math.round(p.x * textureSize);
      const py = Math.round((1 - p.y) * textureSize);
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  
  minX = Math.max(0, minX - 10);
  minY = Math.max(0, minY - 10);
  maxX = Math.min(textureSize - 1, maxX + 10);
  maxY = Math.min(textureSize - 1, maxY + 10);
  
  const pxBbox = {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
  
  // 3. 标记整个bbox区域为已访问（不考虑墙的限制）
  const bfsVisited = new Uint8Array(textureSize * textureSize);
  let visitedCount = 0;
  for (let y = pxBbox.y; y < pxBbox.y + pxBbox.h; y++) {
    for (let x = pxBbox.x; x < pxBbox.x + pxBbox.w; x++) {
      bfsVisited[y * textureSize + x] = 1;
      visitedCount++;
    }
  }
  
  console.log('[DEBUG BFS] completed - entire bbox:', { visitedCount, pxBbox });

  // 4. 裁剪局部 mask
  const { w, h } = pxBbox;
  const localMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const globalIdx = (pxBbox.y + y) * textureSize + (pxBbox.x + x);
      localMask[y * w + x] = bfsVisited[globalIdx];
    }
  }
  
  console.log('[DEBUG] localMask created:', {
    localMaskSample: [localMask[0], localMask[100], localMask[1000]],
    localMaskSum: localMask.reduce((a, b) => a + b, 0)
  });

  // 5. 调用聚类函数
  console.log('[DEBUG] before clustering - bfsVisited check:', {
    sample1: bfsVisited[pxBbox.y * textureSize + pxBbox.x],
    sample2: bfsVisited[(pxBbox.y + 5) * textureSize + pxBbox.x + 5],
    count: bfsVisited.reduce((a, b) => a + b, 0)
  });
  
  const { baseColors: colors, regionIdTex, deltaTex } = clusterAndGenerateTexturesV2(
    localMask,
    pxBbox,
    bgImageData,
    0.025,
    textureSize
  );
  
  console.log('[DEBUG] after clustering - bfsVisited check:', {
    sample1: bfsVisited[pxBbox.y * textureSize + pxBbox.x],
    sample2: bfsVisited[(pxBbox.y + 5) * textureSize + pxBbox.x + 5],
    count: bfsVisited.reduce((a, b) => a + b, 0)
  });

  console.log('[DEBUG] extractBaseByClick:', {
    colorsCount: colors.length,
    firstColor: colors.length > 0 ? colors[0] : null,
    regionIdTexLength: regionIdTex?.length,
    deltaTexLength: deltaTex?.length,
    pxBbox: pxBbox,
  });

  if (colors.length === 0) return null;

  // 6. 构建基础色纹理（聚类平均色填充）
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = textureSize;
  baseCanvas.height = textureSize;
  const baseCtx = baseCanvas.getContext('2d')!;
  const baseImageData = baseCtx.createImageData(textureSize, textureSize);
  const baseData = baseImageData.data;

  console.log('[DEBUG] building baseTexture:', {
    pxBbox,
    w, h,
    colorsLength: colors.length,
    regionIdTexLength: regionIdTex?.length,
    regionIdTexSample: regionIdTex ? [
      regionIdTex[0],
      regionIdTex[100],
      regionIdTex[1000]
    ] : 'null'
  });

  let paintedPixels = 0;
  
  if (regionIdTex) {
    for (let localIdx = 0; localIdx < regionIdTex.length; localIdx++) {
      const clusterIdx = regionIdTex[localIdx];
      if (clusterIdx > 0) {
        const colorIndex = clusterIdx - 1;
        const base = colors[colorIndex] || colors[0];
        const rgb = hslToRgb(base.h, base.s, base.l);
        
        const localY = Math.floor(localIdx / w);
        const localX = localIdx % w;
        const globalY = pxBbox.y + localY;
        const globalX = pxBbox.x + localX;
        const idx = (globalY * textureSize + globalX) * 4;
        
        baseData[idx] = rgb.r;
        baseData[idx + 1] = rgb.g;
        baseData[idx + 2] = rgb.b;
        baseData[idx + 3] = 255;
        paintedPixels++;
      }
    }
  } else if (colors.length > 0) {
    const base = colors[0];
    const rgb = hslToRgb(base.h, base.s, base.l);
    for (let localY = 0; localY < h; localY++) {
      for (let localX = 0; localX < w; localX++) {
        const globalY = pxBbox.y + localY;
        const globalX = pxBbox.x + localX;
        const idx = (globalY * textureSize + globalX) * 4;
        baseData[idx] = rgb.r;
        baseData[idx + 1] = rgb.g;
        baseData[idx + 2] = rgb.b;
        baseData[idx + 3] = 255;
        paintedPixels++;
      }
    }
  }
  
  console.log('[DEBUG] baseTexture loop complete:', { paintedPixels });

  let foundPixel = null;
  if (regionIdTex) {
    for (let i = 0; i < regionIdTex.length; i++) {
      if (regionIdTex[i] > 0) {
      const localY = Math.floor(i / w);
      const localX = i % w;
      const globalY = pxBbox.y + localY;
      const globalX = pxBbox.x + localX;
      const idx = (globalY * textureSize + globalX) * 4;
      foundPixel = {
        localIdx: i,
        globalX, globalY,
        clusterIdx: regionIdTex[i],
        rgb: [baseData[idx], baseData[idx + 1], baseData[idx + 2], baseData[idx + 3]]
      };
      break;
      }
    }
  }
  
  console.log('[DEBUG] baseTexture created:', {
    foundPixel,
    foundPixelRgb: foundPixel ? foundPixel.rgb : null,
    paintedPixels: paintedPixels
  });

  // 7. 构建残差纹理（使用 deltaTex 编码值）
  const residualCanvas = document.createElement('canvas');
  residualCanvas.width = textureSize;
  residualCanvas.height = textureSize;
  const residualCtx = residualCanvas.getContext('2d')!;
  const residualImageData = residualCtx.createImageData(textureSize, textureSize);
  const residualData = residualImageData.data;

  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      const idx = (y * textureSize + x) * 4;
      residualData[idx] = 128;
      residualData[idx + 1] = 128;
      residualData[idx + 2] = 128;
      residualData[idx + 3] = 255;
    }
  }
  
  for (let localIdx = 0; localIdx < deltaTex.length / 3; localIdx++) {
    const dIdx = localIdx * 3;
    const localY = Math.floor(localIdx / w);
    const localX = localIdx % w;
    const globalY = pxBbox.y + localY;
    const globalX = pxBbox.x + localX;
    const idx = (globalY * textureSize + globalX) * 4;
    
    residualData[idx] = deltaTex[dIdx];
    residualData[idx + 1] = deltaTex[dIdx + 1];
    residualData[idx + 2] = deltaTex[dIdx + 2];
    residualData[idx + 3] = 255;
  }

  const colorPixelsMap = new Map<number, number[]>();
  if (regionIdTex) {
    for (let i = 0; i < regionIdTex.length; i++) {
      const clusterIdx = regionIdTex[i];
      if (clusterIdx > 0) {
        const colorIdx = clusterIdx - 1;
        if (!colorPixelsMap.has(colorIdx)) colorPixelsMap.set(colorIdx, []);
        colorPixelsMap.get(colorIdx)!.push(i);
      }
    }
  }

  return {
    baseTexture: baseImageData,
    residualTexture: residualImageData,
    bbox: pxBbox,
    baseColors: colors,
    regionIdTex: regionIdTex || new Uint8Array(0),
    texW: w,
    texH: h,
    colorPixelsMap,
  };
}

// ============ 组件 ============
export const BaseColorEditor: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [bgImageData, setBgImageData] = useState<ImageData | null>(null);
  const [dashedPolygons, setDashedPolygons] = useState<Point[][]>([]);
  const [drawingPolygon, setDrawingPolygon] = useState<Point[] | null>(null);
  const [currentTool, setCurrentTool] = useState<'dashed' | 'bezier' | 'paint' | 'picker' | 'select'>('dashed');
  const [mode, setMode] = useState<'base' | 'residual' | 'composite' | 'base2'>('base');
  const [baseTexture, setBaseTexture] = useState<ImageData | null>(null);
  const [residualTexture, setResidualTexture] = useState<ImageData | null>(null);
  const [bbox, setBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [baseColors, setBaseColors] = useState<Array<{ h: number; s: number; l: number }>>([]);
  const [regionIdTex, setRegionIdTex] = useState<Uint8Array>(new Uint8Array(0));
  
  const [texWH, setTexWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [colorPixelsMap, setColorPixelsMap] = useState<Map<number, number[]> | null>(null);
  const [selectedBaseColorIndex, setSelectedBaseColorIndex] = useState<number | null>(null);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);

  const handleSelectBaseColor = useCallback((index: number) => {
    setSelectedBaseColorIndex(prev => prev === index ? null : index);
  }, []);

  const highlightCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const webglCanvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);
  const baseTextureRef = useRef<WebGLTexture | null>(null);
  const selectedIndexUniformRef = useRef<WebGLUniformLocation | null>(null);
  const positionBufferRef = useRef<WebGLBuffer | null>(null);
  const [webglReady, setWebglReady] = useState(false);

  const initWebGL = useCallback(() => {
    const canvas = webglCanvasRef.current;
    if (!canvas) return false;

    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) {
      console.warn('WebGL not supported, fallback to CPU');
      return false;
    }
    console.log('[WebGL] initWebGL success');

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_uv = (a_position + 1.0) / 2.0;
      }
    `;

    const fsSource = `
      precision highp float;
      uniform sampler2D u_tex;
      uniform sampler2D u_baseTex;
      uniform int u_selectedIndex;
      varying vec2 v_uv;

      void main() {
        if (u_selectedIndex > 0) {
          vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
          float idx = texture2D(u_tex, uv).r * 255.0;
          int intIdx = int(floor(idx + 0.5));
          if (intIdx == u_selectedIndex) {
            vec4 baseColor = texture2D(u_baseTex, uv);
            vec3 white = vec3(1.0);
            float mixAmount = 0.6;
            vec3 highlighted = mix(baseColor.rgb, white, mixAmount);
            gl_FragColor = vec4(highlighted, 0.9);
          } else {
            discard;
          }
        } else {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      }
    `;

    const compileShader = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(gl.VERTEX_SHADER, vsSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vertexShader || !fragmentShader) {
      return false;
    }

    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return false;
    }

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    glRef.current = gl;
    programRef.current = program;
    positionBufferRef.current = positionBuffer;
    selectedIndexUniformRef.current = gl.getUniformLocation(program, 'u_selectedIndex');

    const texLoc = gl.getUniformLocation(program, 'u_tex');
    gl.uniform1i(texLoc, 0);

    const baseTexLoc = gl.getUniformLocation(program, 'u_baseTex');
    gl.uniform1i(baseTexLoc, 1);

    setWebglReady(true);
    return true;
  }, []);

  const uploadTexture = useCallback(() => {
    const gl = glRef.current;
    if (!gl || !regionIdTex || regionIdTex.length === 0 || !bbox) return;
    if (!webglReady) return;

    if (textureRef.current) {
      gl.deleteTexture(textureRef.current);
      textureRef.current = null;
    }

    const texture = gl.createTexture();
    if (!texture) {
      console.warn('[WebGL] 创建纹理失败');
      return;
    }

    console.log('[WebGL] uploadTexture start, regionIdTex.length:', regionIdTex.length, 'bbox:', bbox);

    gl.bindTexture(gl.TEXTURE_2D, texture);

    const rgbData = new Uint8Array(TEX_SIZE * TEX_SIZE * 3);
    const { w } = texWH;

    for (let localIdx = 0; localIdx < regionIdTex.length; localIdx++) {
      const localY = Math.floor(localIdx / w);
      const localX = localIdx % w;
      const globalY = bbox.y + localY;
      const globalX = bbox.x + localX;
      if (globalY >= 0 && globalY < TEX_SIZE && globalX >= 0 && globalX < TEX_SIZE) {
        const globalIdx = (globalY * TEX_SIZE + globalX) * 3;
        const val = regionIdTex[localIdx];
        rgbData[globalIdx] = val;
        rgbData[globalIdx + 1] = val;
        rgbData[globalIdx + 2] = val;
      }
    }

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, TEX_SIZE, TEX_SIZE, 0, gl.RGB, gl.UNSIGNED_BYTE, rgbData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (!gl.isTexture(texture)) {
      console.warn('[WebGL] 纹理无效');
      gl.deleteTexture(texture);
      return;
    }
    textureRef.current = texture;
    console.log('[WebGL] uploadTexture done');
  }, [regionIdTex, bbox, texWH, webglReady]);

  const uploadBaseTexture = useCallback(() => {
    const gl = glRef.current;
    if (!gl || !baseTexture) return;
    if (!webglReady) return;

    if (baseTextureRef.current) {
      gl.deleteTexture(baseTextureRef.current);
      baseTextureRef.current = null;
    }

    const texture = gl.createTexture();
    if (!texture) {
      console.warn('[WebGL] 创建基础色纹理失败');
      return;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_SIZE, TEX_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, baseTexture.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (!gl.isTexture(texture)) {
      console.warn('[WebGL] 基础色纹理无效');
      gl.deleteTexture(texture);
      return;
    }
    baseTextureRef.current = texture;
    console.log('[WebGL] uploadBaseTexture done');
  }, [baseTexture, webglReady]);

  const drawHighlightGL = useCallback((index: number | null) => {
    const gl = glRef.current;
    const program = programRef.current;
    const buffer = positionBufferRef.current;

    if (!gl || !program || !buffer || !webglReady) return;

    if (textureRef.current && !gl.isTexture(textureRef.current)) {
      console.warn('[WebGL] 区域ID纹理无效，重新上传');
      textureRef.current = null;
      uploadTexture();
      return;
    }
    if (baseTextureRef.current && !gl.isTexture(baseTextureRef.current)) {
      console.warn('[WebGL] 基础色纹理无效，重新上传');
      baseTextureRef.current = null;
      uploadBaseTexture();
      return;
    }

    if (!textureRef.current || !baseTextureRef.current) return;

    if (!gl.isProgram(program)) {
      console.warn('[WebGL] Program 无效');
      return;
    }

    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textureRef.current);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, baseTextureRef.current);

    const idxLoc = selectedIndexUniformRef.current;
    if (idxLoc !== null) {
      gl.uniform1i(idxLoc, index !== null ? index + 1 : 0);
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [webglReady, uploadTexture, uploadBaseTexture]);

  useEffect(() => {
    if (!glRef.current) {
      const ok = initWebGL();
      if (!ok) return;
    }
    if (!webglReady) return;
    if (!textureRef.current && regionIdTex && regionIdTex.length > 0 && bbox) {
      uploadTexture();
    }
    if (!baseTextureRef.current && baseTexture) {
      uploadBaseTexture();
    }
    if (mode === 'base2') {
      drawHighlightGL(selectedBaseColorIndex);
    } else {
      const gl = glRef.current;
      if (gl) {
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
  }, [selectedBaseColorIndex, regionIdTex, bbox, mode, webglReady, uploadTexture, uploadBaseTexture, drawHighlightGL]);

  useEffect(() => {
    return () => {
      const gl = glRef.current;
      if (gl) {
        if (textureRef.current) gl.deleteTexture(textureRef.current);
        if (baseTextureRef.current) gl.deleteTexture(baseTextureRef.current);
        if (programRef.current) gl.deleteProgram(programRef.current);
        if (positionBufferRef.current) gl.deleteBuffer(positionBufferRef.current);
      }
      glRef.current = null;
      programRef.current = null;
      textureRef.current = null;
      baseTextureRef.current = null;
      positionBufferRef.current = null;
      selectedIndexUniformRef.current = null;
      setWebglReady(false);
    };
  }, []);

  const [brushColor, setBrushColor] = useState('#ff0000');
  const [brushSize, setBrushSize] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapPoint, setSnapPoint] = useState<Point | null>(null);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const [isExtractMode, setIsExtractMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // 撤销历史
  interface HistoryState {
    dashedPolygons: Point[][];
    baseTexture: ImageData | null;
    residualTexture: ImageData | null;
    bbox: { x: number; y: number; w: number; h: number } | null;
    baseColors: Array<{ h: number; s: number; l: number }>;
  }
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const saveToHistory = useCallback(() => {
    const newState: HistoryState = {
      dashedPolygons: dashedPolygons.map(poly => poly.map(p => ({ ...p }))),
      baseTexture: baseTexture ? new ImageData(new Uint8ClampedArray(baseTexture.data), baseTexture.width, baseTexture.height) : null,
      residualTexture: residualTexture ? new ImageData(new Uint8ClampedArray(residualTexture.data), residualTexture.width, residualTexture.height) : null,
      bbox: bbox ? { ...bbox } : null,
      baseColors: baseColors.map(c => ({ ...c })),
    };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [dashedPolygons, baseTexture, residualTexture, bbox, baseColors, history, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const prevState = history[historyIndex - 1];
    setDashedPolygons(prevState.dashedPolygons);
    setBaseTexture(prevState.baseTexture);
    setResidualTexture(prevState.residualTexture);
    setBbox(prevState.bbox);
    setBaseColors(prevState.baseColors);
    setHistoryIndex(historyIndex - 1);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextState = history[historyIndex + 1];
    setDashedPolygons(nextState.dashedPolygons);
    setBaseTexture(nextState.baseTexture);
    setResidualTexture(nextState.residualTexture);
    setBbox(nextState.bbox);
    setBaseColors(nextState.baseColors);
    setHistoryIndex(historyIndex + 1);
  }, [history, historyIndex]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // 滚轮缩放
  // 拖拽平移（中键或空格+左键）
  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  }, [pan]);

  const handleContainerMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
  }, []);

  const handleContainerMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // 点吸附函数（控制点不参与吸附）
  const snapPointToExisting = useCallback((point: Point, currentPointCount: number, toolType: string): Point => {
    if (!snapEnabled) return point;
    const shouldSnap = (() => {
      if (toolType === 'bezier' && currentPointCount >= 2) return false;
      return true;
    })();
    if (!shouldSnap) return point;

    const canvasPoint = { x: point.x * TEX_SIZE, y: (1 - point.y) * TEX_SIZE };
    const snapRadiusPx = 10;
    let bestMatch: Point | null = null;
    let bestDist = snapRadiusPx;

    const candidateMap = new Map<string, Point>();
    const addCandidate = (p: Point) => {
      const key = `${Math.round(p.x * 1e6)}_${Math.round(p.y * 1e6)}`;
      if (!candidateMap.has(key)) candidateMap.set(key, p);
    };

    for (const poly of dashedPolygons) {
      for (let i = 0; i < poly.length; i++) {
        addCandidate(poly[i]);
      }
    }

    if (drawingPolygon) {
      drawingPolygon.forEach(p => addCandidate(p));
    }

    for (const p of candidateMap.values()) {
      const pCanvas = { x: p.x * TEX_SIZE, y: (1 - p.y) * TEX_SIZE };
      const dist = Math.hypot(canvasPoint.x - pCanvas.x, canvasPoint.y - pCanvas.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = p;
      }
    }

    return bestMatch || point;
  }, [snapEnabled, dashedPolygons, drawingPolygon]);

  // 加载背景图
  const handleLoadBackground = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = TEX_SIZE;
        canvas.height = TEX_SIZE;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
        setBgImageData(ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE));
        setDashedPolygons([]);
        setDrawingPolygon(null);
        setBaseTexture(null);
        setResidualTexture(null);
        setBbox(null);
        setBaseColors([]);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  // 进入提取模式
  const handleAutoExtract = useCallback(() => {
    if (!bgImageData) return;
    const allPolygons = drawingPolygon && drawingPolygon.length >= 3
      ? [...dashedPolygons, drawingPolygon]
      : dashedPolygons;
    if (allPolygons.length === 0) return;

    setDrawingPolygon(null);
    setPreviewPoint(null);
    setCurrentTool('select');
    setIsExtractMode(true);
  }, [bgImageData, dashedPolygons, drawingPolygon]);

  const handleExtractClick = useCallback((pixel: { x: number; y: number }) => {
    if (!bgImageData) return;
    const allPolygons = drawingPolygon && drawingPolygon.length >= 3
      ? [...dashedPolygons, drawingPolygon]
      : dashedPolygons;
    if (allPolygons.length === 0) return;

    const result = extractBaseByClick(bgImageData, allPolygons, pixel);
    if (result) {
      console.log('[DEBUG] extract result:', {
        baseTextureExists: !!result.baseTexture,
        firstPixel: result.baseTexture ? [
          result.baseTexture.data[0],
          result.baseTexture.data[1],
          result.baseTexture.data[2],
          result.baseTexture.data[3]
        ] : null,
        bbox: result.bbox
      });
      setBaseTexture(result.baseTexture);
      setResidualTexture(result.residualTexture);
      setBbox(result.bbox);
      setBaseColors(result.baseColors);
      setRegionIdTex(result.regionIdTex);
      setTexWH({ w: result.texW, h: result.texH });
      setColorPixelsMap(result.colorPixelsMap);
      setIsExtractMode(false);
      setTimeout(() => saveToHistory(), 0);
    }
  }, [bgImageData, dashedPolygons, drawingPolygon, saveToHistory]);

  // 更新基础色并重新生成纹理
  const updateBaseColor = useCallback((index: number, newHSL: { h: number; s: number; l: number }) => {
    setBaseColors(prev => {
      const updated = [...prev];
      updated[index] = newHSL;
      return updated;
    });

    if (baseTexture && colorPixelsMap && bbox) {
      const pixelIndices = colorPixelsMap.get(index);
      if (!pixelIndices || pixelIndices.length === 0) return;

      const newData = new Uint8ClampedArray(baseTexture.data);
      const rgb = hslToRgb(newHSL.h, newHSL.s, newHSL.l);
      const { w } = texWH;

      for (const localIdx of pixelIndices) {
        const localY = Math.floor(localIdx / w);
        const localX = localIdx % w;
        const globalY = bbox.y + localY;
        const globalX = bbox.x + localX;
        const idx = (globalY * TEX_SIZE + globalX) * 4;
        newData[idx] = rgb.r;
        newData[idx + 1] = rgb.g;
        newData[idx + 2] = rgb.b;
        newData[idx + 3] = 255;
      }

      setBaseTexture(new ImageData(newData, TEX_SIZE, TEX_SIZE));
    }
  }, [baseTexture, colorPixelsMap, bbox, texWH]);

  const handlePickColor = useCallback((index: number) => {
    setPickingIndex(prev => prev === index ? null : index);
  }, []);

  const handleRecluster = useCallback(() => {
    if (!bbox || !baseTexture) return;
    
    const localMask = new Uint8Array(bbox.w * bbox.h);
    const colorSamples: number[][] = [];
    
    for (let y = 0; y < bbox.h; y++) {
      for (let x = 0; x < bbox.w; x++) {
        const globalIdx = (bbox.y + y) * TEX_SIZE + (bbox.x + x);
        const idx = globalIdx * 4;
        const alpha = baseTexture.data[idx + 3];
        if (alpha > 0) {
          localMask[y * bbox.w + x] = 1;
          colorSamples.push([
            baseTexture.data[idx],
            baseTexture.data[idx + 1],
            baseTexture.data[idx + 2]
          ]);
        } else {
          localMask[y * bbox.w + x] = 0;
        }
      }
    }

    if (colorSamples.length === 0) return;

    const k = Math.max(2, Math.min(baseColors.length, Math.floor(Math.sqrt(colorSamples.length / 10))));
    
    const centroids = colorSamples.slice(0, k);
    
    let iterations = 0;
    const maxIterations = 10;
    let assignments: number[] = new Array(bbox.w * bbox.h).fill(-1);
    
    while (iterations < maxIterations) {
      let changed = false;
      
      for (let y = 0; y < bbox.h; y++) {
        for (let x = 0; x < bbox.w; x++) {
          const localIdx = y * bbox.w + x;
          if (localMask[localIdx] === 0) continue;
          
          const globalIdx = (bbox.y + y) * TEX_SIZE + (bbox.x + x);
          const idx = globalIdx * 4;
          const r = baseTexture.data[idx];
          const g = baseTexture.data[idx + 1];
          const b = baseTexture.data[idx + 2];
          
          let bestDist = Infinity;
          let bestIdx = 0;
          
          for (let i = 0; i < centroids.length; i++) {
            const dr = r - centroids[i][0];
            const dg = g - centroids[i][1];
            const db = b - centroids[i][2];
            const dist = dr * dr + dg * dg + db * db;
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = i;
            }
          }
          
          if (assignments[localIdx] !== bestIdx) {
            assignments[localIdx] = bestIdx;
            changed = true;
          }
        }
      }
      
      if (!changed) break;
      
      const counts = new Array(centroids.length).fill(0);
      const sums = centroids.map(() => [0, 0, 0]);
      
      for (let y = 0; y < bbox.h; y++) {
        for (let x = 0; x < bbox.w; x++) {
          const localIdx = y * bbox.w + x;
          const clusterIdx = assignments[localIdx];
          if (clusterIdx >= 0) {
            const globalIdx = (bbox.y + y) * TEX_SIZE + (bbox.x + x);
            const idx = globalIdx * 4;
            sums[clusterIdx][0] += baseTexture.data[idx];
            sums[clusterIdx][1] += baseTexture.data[idx + 1];
            sums[clusterIdx][2] += baseTexture.data[idx + 2];
            counts[clusterIdx]++;
          }
        }
      }
      
      for (let i = 0; i < centroids.length; i++) {
        if (counts[i] > 0) {
          centroids[i][0] = Math.round(sums[i][0] / counts[i]);
          centroids[i][1] = Math.round(sums[i][1] / counts[i]);
          centroids[i][2] = Math.round(sums[i][2] / counts[i]);
        }
      }
      
      iterations++;
    }

    const newRegionIdTex = new Uint8Array(bbox.w * bbox.h);
    for (let i = 0; i < newRegionIdTex.length; i++) {
      newRegionIdTex[i] = assignments[i] >= 0 ? assignments[i] + 1 : 0;
    }

    const colors = centroids.map(([r, g, b]) => rgbToHsl(r, g, b));

    const newBaseCanvas = document.createElement('canvas');
    newBaseCanvas.width = TEX_SIZE;
    newBaseCanvas.height = TEX_SIZE;
    const newBaseCtx = newBaseCanvas.getContext('2d')!;
    const newBaseImageData = newBaseCtx.createImageData(TEX_SIZE, TEX_SIZE);
    const newBaseData = newBaseImageData.data;

    for (let i = 0; i < newBaseData.length; i++) {
      newBaseData[i] = 0;
    }

    for (let localIdx = 0; localIdx < newRegionIdTex.length; localIdx++) {
      const regionId = newRegionIdTex[localIdx];
      if (regionId > 0 && regionId <= colors.length) {
        const colorIdx = regionId - 1;
        const color = colors[colorIdx];
        const rgb = hslToRgb(color.h, color.s, color.l);
        const localY = Math.floor(localIdx / bbox.w);
        const localX = localIdx % bbox.w;
        const globalY = bbox.y + localY;
        const globalX = bbox.x + localX;
        const idx = (globalY * TEX_SIZE + globalX) * 4;
        newBaseData[idx] = rgb.r;
        newBaseData[idx + 1] = rgb.g;
        newBaseData[idx + 2] = rgb.b;
        newBaseData[idx + 3] = 255;
      }
    }

    const newColorPixelsMap = new Map<number, number[]>();
    for (let i = 0; i < colors.length; i++) {
      newColorPixelsMap.set(i, []);
    }

    for (let localIdx = 0; localIdx < newRegionIdTex.length; localIdx++) {
      const regionId = newRegionIdTex[localIdx];
      if (regionId > 0 && regionId <= colors.length) {
        const colorIdx = regionId - 1;
        const pixels = newColorPixelsMap.get(colorIdx)!;
        pixels.push(localIdx);
      }
    }

    setBaseColors(colors);
    setRegionIdTex(newRegionIdTex);
    setColorPixelsMap(newColorPixelsMap);
    setBaseTexture(new ImageData(newBaseData, TEX_SIZE, TEX_SIZE));
    setSelectedBaseColorIndex(null);
    setTimeout(() => saveToHistory(), 0);
  }, [bbox, baseTexture, baseColors.length, saveToHistory]);

  // 获取画布上的像素坐标
  const getCanvasPixel = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = TEX_SIZE / rect.width;
    const scaleY = TEX_SIZE / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }, []);

  // 取色
  const pickColor = useCallback((px: number, py: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const hex = '#' + [pixel[0], pixel[1], pixel[2]]
      .map(v => v.toString(16).padStart(2, '0'))
      .join('');
    setBrushColor(hex);
  }, []);

  // 在基础色纹理上涂色
  const paintOnBase = useCallback((px: number, py: number) => {
    if (!baseTexture) return;
    const rgb = brushColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!rgb) return;
    const r = parseInt(rgb[1], 16);
    const g = parseInt(rgb[2], 16);
    const b = parseInt(rgb[3], 16);

    const data = baseTexture.data;
    const half = Math.floor(brushSize / 2);

    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (dx * dx + dy * dy > half * half) continue;
        const gx = px + dx;
        const gy = py + dy;
        if (gx < 0 || gx >= TEX_SIZE || gy < 0 || gy >= TEX_SIZE) continue;
        const pi = (gy * TEX_SIZE + gx) * 4;
        data[pi] = r;
        data[pi + 1] = g;
        data[pi + 2] = b;
        data[pi + 3] = 255;
      }
    }

    const updated = new ImageData(new Uint8ClampedArray(data), TEX_SIZE, TEX_SIZE);
    setBaseTexture(updated);
  }, [baseTexture, brushColor, brushSize]);

  // 鼠标事件
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pixel = getCanvasPixel(e);
    const world = canvasToWorld(pixel.x, pixel.y);

    if (isExtractMode && e.button === 0) {
      handleExtractClick(pixel);
      return;
    }

    if (pickingIndex !== null && e.button === 0) {
      if (!bgImageData) return;
      
      const idx = (pixel.y * TEX_SIZE + pixel.x) * 4;
      const r = bgImageData.data[idx];
      const g = bgImageData.data[idx + 1];
      const b = bgImageData.data[idx + 2];
      
      const hsl = rgbToHsl(r, g, b);
      updateBaseColor(pickingIndex, hsl);
      setPickingIndex(null);
      setTimeout(() => saveToHistory(), 0);
      return;
    }

    if (currentTool === 'dashed') {
      if (e.button === 0) {
        if (e.detail === 2 && drawingPolygon && drawingPolygon.length >= 2) {
          const lastPoint = drawingPolygon[drawingPolygon.length - 1];
          const dist = Math.hypot(world.x - lastPoint.x, world.y - lastPoint.y);
          if (dist < 0.02) {
            setDashedPolygons(prev => [...prev, drawingPolygon]);
            setDrawingPolygon(null);
            setPreviewPoint(null);
            setTimeout(() => saveToHistory(), 0);
            return;
          }
        }
        const snapped = snapPointToExisting(world, drawingPolygon ? drawingPolygon.length : 0, 'dashed');
        setDrawingPolygon(prev => prev ? [...prev, snapped] : [snapped]);
      }
    } else if (currentTool === 'bezier') {
      if (e.button === 0) {
        if (e.detail === 2 && drawingPolygon && drawingPolygon.length >= 2) {
          const lastPoint = drawingPolygon[drawingPolygon.length - 1];
          const dist = Math.hypot(world.x - lastPoint.x, world.y - lastPoint.y);
          if (dist < 0.02) {
            setDashedPolygons(prev => [...prev, drawingPolygon]);
            setDrawingPolygon(null);
            setPreviewPoint(null);
            return;
          }
        }
        const pointCount = drawingPolygon ? drawingPolygon.length : 0;
        const snapped = snapPointToExisting(world, pointCount, 'bezier');
        if (pointCount === 2) {
          const newPoly = [...drawingPolygon!, snapped];
          setDashedPolygons(prev => [...prev, newPoly]);
          setDrawingPolygon(null);
          setPreviewPoint(null);
          setTimeout(() => saveToHistory(), 0);
        } else {
          setDrawingPolygon(prev => prev ? [...prev, snapped] : [snapped]);
        }
      }
    } else if (currentTool === 'paint') {
      saveToHistory();
      setIsDrawing(true);
      paintOnBase(pixel.x, pixel.y);
    } else if (currentTool === 'picker') {
      pickColor(pixel.x, pixel.y);
    }
  }, [currentTool, getCanvasPixel, drawingPolygon, paintOnBase, pickColor, saveToHistory, snapPointToExisting, pickingIndex, bgImageData, updateBaseColor]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pixel = getCanvasPixel(e);
    setMousePos(pixel);
    const world = canvasToWorld(pixel.x, pixel.y);

    if (currentTool === 'dashed' || currentTool === 'bezier') {
      if (drawingPolygon && drawingPolygon.length > 0) {
        const pointCount = drawingPolygon.length;
        const snapped = snapPointToExisting(world, pointCount, currentTool);
        setPreviewPoint(snapped);
        const isSnapped = Math.abs(world.x - snapped.x) > 0.0001 || Math.abs(world.y - snapped.y) > 0.0001;
        setSnapPoint(isSnapped ? snapped : null);
      }
    }

    if (isDrawing && currentTool === 'paint') {
      paintOnBase(pixel.x, pixel.y);
    }
  }, [isDrawing, currentTool, getCanvasPixel, paintOnBase, drawingPolygon, snapPointToExisting]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing && baseTexture) {
      setTimeout(() => saveToHistory(), 0);
    }
    setIsDrawing(false);
  }, [isDrawing, baseTexture, saveToHistory]);

  // 右键菜单禁用
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // 渲染画布（主要内容，不依赖 mousePos）
  const renderCountRef = useRef(0);
  useEffect(() => {
    renderCountRef.current++;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    console.log(`[DEBUG] RENDER #${renderCountRef.current} START: mode=${mode}, baseTexture=${!!baseTexture}, isExtractMode=${isExtractMode}`);

    // ===== 新基础色模式：完全独立的渲染路径 =====
    if (mode === 'base2') {
      ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

      if (bbox && baseTexture && baseColors.length > 0) {
        const filledData = new ImageData(
          new Uint8ClampedArray(baseTexture.data),
          TEX_SIZE,
          TEX_SIZE
        );
        
        const baseColorRgbs = baseColors.map(c => hslToRgb(c.h, c.s, c.l));
        
        for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
          for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
            const idx = (y * TEX_SIZE + x) * 4;
            if (filledData.data[idx + 3] === 0 && bgImageData) {
              const r = bgImageData.data[idx];
              const g = bgImageData.data[idx + 1];
              const b = bgImageData.data[idx + 2];
              
              let bestDist = Infinity;
              let bestRgb = baseColorRgbs[0];
              for (const rgb of baseColorRgbs) {
                const dr = r - rgb.r;
                const dg = g - rgb.g;
                const db = b - rgb.b;
                const dist = dr * dr + dg * dg + db * db;
                if (dist < bestDist) {
                  bestDist = dist;
                  bestRgb = rgb;
                }
              }
              
              filledData.data[idx] = bestRgb.r;
              filledData.data[idx + 1] = bestRgb.g;
              filledData.data[idx + 2] = bestRgb.b;
              filledData.data[idx + 3] = 255;
            }
          }
        }
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.clip();
        ctx.putImageData(filledData, 0, 0);
        ctx.restore();
      } else if (bgImageData) {
        ctx.putImageData(bgImageData, 0, 0);
      }

      // 绘制虚线多边形
      ctx.save();
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      for (const poly of dashedPolygons) {
        if (poly.length < 2) continue;
        ctx.beginPath();
        const p0 = worldToCanvas(poly[0].x, poly[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < poly.length; i++) {
          const p = worldToCanvas(poly[i].x, poly[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();

      // 绘制 bbox
      if (bbox) {
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.restore();
      }

      return;
    }

    // 参考图模式：显示原始上传的背景图
    if (mode === 'base') {
      if (bgImageData) {
        ctx.putImageData(bgImageData, 0, 0);
      } else {
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      }
    }
    // 残差模式：基础色区域显示残差（偏移128），其他区域显示灰色
    else if (mode === 'residual') {
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      
      if (bbox && residualTexture && baseColors.length > 0) {
        const filledData = new ImageData(
          new Uint8ClampedArray(residualTexture.data),
          TEX_SIZE,
          TEX_SIZE
        );
        
        const baseColorRgbs = baseColors.map(c => hslToRgb(c.h, c.s, c.l));
        
        for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
          for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
            const idx = (y * TEX_SIZE + x) * 4;
            if (filledData.data[idx + 3] === 0 && bgImageData) {
              const r = bgImageData.data[idx];
              const g = bgImageData.data[idx + 1];
              const b = bgImageData.data[idx + 2];
              
              let bestDist = Infinity;
              let bestRgb = baseColorRgbs[0];
              for (const rgb of baseColorRgbs) {
                const dr = r - rgb.r;
                const dg = g - rgb.g;
                const db = b - rgb.b;
                const dist = dr * dr + dg * dg + db * db;
                if (dist < bestDist) {
                  bestDist = dist;
                  bestRgb = rgb;
                }
              }
              
              const dR = r - bestRgb.r;
              const dG = g - bestRgb.g;
              const dB = b - bestRgb.b;
              
              filledData.data[idx] = Math.max(0, Math.min(255, dR + 128));
              filledData.data[idx + 1] = Math.max(0, Math.min(255, dG + 128));
              filledData.data[idx + 2] = Math.max(0, Math.min(255, dB + 128));
              filledData.data[idx + 3] = 255;
            }
          }
        }
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.clip();
        ctx.putImageData(filledData, 0, 0);
        ctx.restore();
      }
    }
    // 叠加模式：基础色 + 残差还原（原始图像）
    else if (mode === 'composite') {
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      
      if (bbox && baseTexture && residualTexture && baseColors.length > 0) {
        const compositeData = new ImageData(
          new Uint8ClampedArray(baseTexture.data),
          TEX_SIZE,
          TEX_SIZE
        );
        const baseData = baseTexture.data;
        const residualData = residualTexture.data;
        
        const baseColorRgbs = baseColors.map(c => hslToRgb(c.h, c.s, c.l));

        for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
          for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
            const idx = (y * TEX_SIZE + x) * 4;
            if (baseData[idx + 3] > 0) {
              const hslBase = rgbToHsl(baseData[idx], baseData[idx + 1], baseData[idx + 2]);
              const dH = dequantize(residualData[idx], 0.25);
              const dS = dequantize(residualData[idx + 1], 1.0);
              const dL = dequantize(residualData[idx + 2], 1.0);
              let finalH = hslBase.h + dH;
              if (finalH < 0) finalH += 1.0;
              if (finalH >= 1.0) finalH -= 1.0;
              const finalS = Math.max(0, Math.min(1, hslBase.s + dS));
              const finalL = Math.max(0, Math.min(1, hslBase.l + dL));
              const rgb = hslToRgb(finalH, finalS, finalL);
              compositeData.data[idx] = rgb.r;
              compositeData.data[idx + 1] = rgb.g;
              compositeData.data[idx + 2] = rgb.b;
              compositeData.data[idx + 3] = 255;
            } else if (bgImageData) {
              const r = bgImageData.data[idx];
              const g = bgImageData.data[idx + 1];
              const b = bgImageData.data[idx + 2];
              
              let bestDist = Infinity;
              let bestColor = baseColors[0];
              for (let i = 0; i < baseColors.length; i++) {
                const rgb = baseColorRgbs[i];
                const dr = r - rgb.r;
                const dg = g - rgb.g;
                const db = b - rgb.b;
                const dist = dr * dr + dg * dg + db * db;
                if (dist < bestDist) {
                  bestDist = dist;
                  bestColor = baseColors[i];
                }
              }
              
              const dR = r - hslToRgb(bestColor.h, bestColor.s, bestColor.l).r;
              const dG = g - hslToRgb(bestColor.h, bestColor.s, bestColor.l).g;
              const dB = b - hslToRgb(bestColor.h, bestColor.s, bestColor.l).b;
              
              const dH = dequantize(Math.max(0, Math.min(255, dR + 128)), 0.25);
              const dS = dequantize(Math.max(0, Math.min(255, dG + 128)), 1.0);
              const dL = dequantize(Math.max(0, Math.min(255, dB + 128)), 1.0);
              
              let finalH = bestColor.h + dH;
              if (finalH < 0) finalH += 1.0;
              if (finalH >= 1.0) finalH -= 1.0;
              const finalS = Math.max(0, Math.min(1, bestColor.s + dS));
              const finalL = Math.max(0, Math.min(1, bestColor.l + dL));
              const rgb = hslToRgb(finalH, finalS, finalL);
              
              compositeData.data[idx] = rgb.r;
              compositeData.data[idx + 1] = rgb.g;
              compositeData.data[idx + 2] = rgb.b;
              compositeData.data[idx + 3] = 255;
            } else {
              compositeData.data[idx + 3] = 0;
            }
          }
        }
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.clip();
        ctx.putImageData(compositeData, 0, 0);
        ctx.restore();
      } else if (bgImageData) {
        ctx.putImageData(bgImageData, 0, 0);
      }
    }
    // 默认模式：只显示背景图
    else if (bgImageData) {
      ctx.putImageData(bgImageData, 0, 0);
    }

    // 提取模式提示
    if (isExtractMode) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      ctx.fillStyle = '#ff0000';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('提取模式 - 点击区域提取颜色', TEX_SIZE / 2, TEX_SIZE / 2);
      ctx.font = '12px Arial';
      ctx.fillText('虚线/贝塞尔曲线作为墙，BFS无法穿过', TEX_SIZE / 2, TEX_SIZE / 2 + 24);
      ctx.restore();
    }

    // 4. 已完成的多边形（虚线）
    ctx.save();
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    for (const poly of dashedPolygons) {
      if (poly.length < 2) continue;
      const pts = poly.map(p => worldToCanvas(p.x, p.y));
      if (poly.length === 3) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.quadraticCurveTo(pts[2].x, pts[2].y, pts[1].x, pts[1].y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    // 5. 正在绘制的多边形（含预览虚线）
    if (drawingPolygon && drawingPolygon.length >= 1) {
      ctx.save();
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const pts = drawingPolygon.map(p => worldToCanvas(p.x, p.y));
      
      if (currentTool === 'bezier' && drawingPolygon.length === 2) {
        if (previewPoint) {
          const previewCanvas = worldToCanvas(previewPoint.x, previewPoint.y);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.quadraticCurveTo(previewCanvas.x, previewCanvas.y, pts[1].x, pts[1].y);
          ctx.stroke();
          
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = '#888';
          ctx.beginPath();
          ctx.moveTo(pts[1].x, pts[1].y);
          ctx.lineTo(previewCanvas.x, previewCanvas.y);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        if (previewPoint) {
          const previewCanvas = worldToCanvas(previewPoint.x, previewPoint.y);
          ctx.lineTo(previewCanvas.x, previewCanvas.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 6. 多边形顶点和控制点
    ctx.save();
    for (const poly of dashedPolygons) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const cp = worldToCanvas(p.x, p.y);
        if (poly.length === 3 && i === 2) {
          ctx.fillStyle = '#ff4444';
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (drawingPolygon) {
      for (let i = 0; i < drawingPolygon.length; i++) {
        const p = drawingPolygon[i];
        const cp = worldToCanvas(p.x, p.y);
        if (currentTool === 'bezier' && drawingPolygon.length === 2 && i === 1) {
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // 7. 吸附点显示
    if (snapPoint) {
      ctx.save();
      ctx.fillStyle = '#52c41a';
      ctx.beginPath();
      const sp = worldToCanvas(snapPoint.x, snapPoint.y);
      ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 6. BBox 显示
    if (bbox) {
      ctx.save();
      ctx.strokeStyle = '#52c41a';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
      ctx.restore();
    }

    // 7. 画笔光标
    if (mousePos && (currentTool === 'paint' || currentTool === 'picker')) {
      ctx.save();
      ctx.strokeStyle = currentTool === 'picker' ? '#1890ff' : brushColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(mousePos.x, mousePos.y, brushSize / 2, 0, Math.PI * 2);
      ctx.stroke();
      if (currentTool === 'picker') {
        ctx.beginPath();
        ctx.arc(mousePos.x, mousePos.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#1890ff';
        ctx.fill();
      }
      ctx.restore();
    }

    console.log(`[DEBUG] RENDER #${renderCountRef.current} END`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bgImageData, baseTexture, residualTexture, mode, dashedPolygons, drawingPolygon, bbox, isExtractMode]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const octx = overlay.getContext('2d')!;

    octx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

    if (mode === 'base2' && highlightCanvasRef.current) {
      octx.drawImage(highlightCanvasRef.current, 0, 0);
    }

    if (!mousePos || (currentTool !== 'paint' && currentTool !== 'picker')) return;

    octx.save();
    octx.strokeStyle = currentTool === 'picker' ? '#1890ff' : brushColor;
    octx.lineWidth = 1;
    octx.setLineDash([]);
    octx.beginPath();
    octx.arc(mousePos.x, mousePos.y, brushSize / 2, 0, Math.PI * 2);
    octx.stroke();
    if (currentTool === 'picker') {
      octx.beginPath();
      octx.arc(mousePos.x, mousePos.y, 2, 0, Math.PI * 2);
      octx.fillStyle = '#1890ff';
      octx.fill();
    }
    octx.restore();
  }, [mousePos, currentTool, brushColor, brushSize, selectedBaseColorIndex, mode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.max(0.1, Math.min(10, prev * delta)));
    };
    container.addEventListener('wheel', wheelHandler, { passive: false });
    return () => container.removeEventListener('wheel', wheelHandler);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: '#fff' }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '8px 12px', borderBottom: '1px solid #e8e8e8', alignItems: 'center', background: '#fafafa' }}>
        <label style={{ fontSize: '11px', padding: '2px 6px', background: '#e6f7ff', borderRadius: '3px', cursor: 'pointer', border: '1px solid #91d5ff' }}>
          加载背景
          <input
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && handleLoadBackground(e.target.files[0])}
            style={{ display: 'none' }}
          />
        </label>
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', border: '1px solid #d9d9d9' }}
          title="Ctrl+Z"
        >
          ↩ 撤销
        </button>
        <button
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', border: '1px solid #d9d9d9' }}
          title="Ctrl+Shift+Z"
        >
          ↪ 重做
        </button>
        <button
          onClick={handleAutoExtract}
          disabled={!bgImageData || dashedPolygons.length === 0 || isExtractMode}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
        >
          {isExtractMode ? '提取中...' : '提取模式'}
        </button>
        {isExtractMode && (
          <button
            onClick={() => setIsExtractMode(false)}
            style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', background: '#ff4444', color: '#fff', border: 'none' }}
          >
            退出提取
          </button>
        )}
        <button
          onClick={() => { setCurrentTool('dashed'); setDrawingPolygon(null); }}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: currentTool === 'dashed' ? '#ffaa00' : '#f0f0f0',
            color: currentTool === 'dashed' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          虚线
        </button>
        <button
          onClick={() => { setCurrentTool('bezier'); setDrawingPolygon(null); }}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: currentTool === 'bezier' ? '#ff4444' : '#f0f0f0',
            color: currentTool === 'bezier' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          贝塞尔
        </button>
        <label style={{ fontSize: '11px', padding: '2px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
            style={{ margin: 0 }}
          />
          吸附
        </label>
        <button
          onClick={() => { setCurrentTool('paint'); setDrawingPolygon(null); }}
          disabled={!baseTexture}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: currentTool === 'paint' ? '#1890ff' : '#f0f0f0',
            color: currentTool === 'paint' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          画笔
        </button>
        <button
          onClick={() => { setCurrentTool('picker'); setDrawingPolygon(null); }}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: currentTool === 'picker' ? '#1890ff' : '#f0f0f0',
            color: currentTool === 'picker' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          取色
        </button>
        <input
          type="color"
          value={brushColor}
          onChange={(e) => setBrushColor(e.target.value)}
          style={{ width: '24px', height: '24px', padding: 0, border: 'none', cursor: 'pointer' }}
          title="画笔颜色"
        />
        <select
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          style={{ fontSize: '11px', padding: '1px 4px' }}
          title="笔刷大小"
        >
          {[2, 4, 6, 8, 12, 16, 24, 32].map(s => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>
        <button
          onClick={() => setMode('base')}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: mode === 'base' ? '#1890ff' : '#f0f0f0',
            color: mode === 'base' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          参考图
        </button>
        <button
          onClick={() => setMode('base2')}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: mode === 'base2' ? '#52c41a' : '#f0f0f0',
            color: mode === 'base2' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          基础色
        </button>
        <button
          onClick={() => setMode('residual')}
          disabled={!residualTexture}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: mode === 'residual' ? '#52c41a' : '#f0f0f0',
            color: mode === 'residual' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          残差
        </button>
        <button
          onClick={() => setMode('composite')}
          disabled={!baseTexture || !residualTexture}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: mode === 'composite' ? '#1890ff' : '#f0f0f0',
            color: mode === 'composite' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          叠加
        </button>
        <button
          onClick={() => {
            setBaseTexture(null);
            setResidualTexture(null);
            setBbox(null);
            setBaseColors([]);
          }}
          disabled={!baseTexture && !residualTexture}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
        >
          清除结果
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
        {/* 独立画布容器（支持滚轮缩放和拖拽平移） */}
        <div
          ref={containerRef}
          style={{
            position: 'relative', flex: 1, overflow: 'hidden',
            background: '#2a2a2a',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
          }}
          onMouseDown={handleContainerMouseDown}
          onMouseMove={handleContainerMouseMove}
          onMouseUp={handleContainerMouseUp}
          onMouseLeave={handleContainerMouseUp}
        >
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <canvas
              ref={canvasRef}
              width={TEX_SIZE}
              height={TEX_SIZE}
              style={{
                display: 'block',
                border: '1px solid #333',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                cursor: currentTool === 'dashed' ? 'crosshair' : isPanningRef.current ? 'grabbing' : 'default',
                boxShadow: '0 0 8px rgba(0,0,0,0.5)',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onContextMenu={handleContextMenu}
            />
            <canvas
              ref={webglCanvasRef}
              width={TEX_SIZE}
              height={TEX_SIZE}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: 'block',
                border: '1px solid #333',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            />
            <canvas
              ref={overlayRef}
              width={TEX_SIZE}
              height={TEX_SIZE}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: 'block',
                border: '1px solid #333',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
                zIndex: 10,
              }}
            />
          </div>
          {/* 缩放指示器 */}
          <div style={{
            position: 'absolute', bottom: 8, right: 8,
            background: 'rgba(0,0,0,0.7)', color: '#fff',
            padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
            pointerEvents: 'none',
          }}>
            {Math.round(zoom * 100)}% | Alt+拖拽平移 | 滚轮缩放
          </div>
        </div>

        {mode === 'base2' && baseColors.length > 0 && (
          <BaseColorList
            colors={baseColors}
            selectedIndex={selectedBaseColorIndex}
            pickingIndex={pickingIndex}
            onSelect={handleSelectBaseColor}
            onUpdate={updateBaseColor}
            onRecluster={handleRecluster}
            onPickColor={handlePickColor}
          />
        )}
      </div>

      {/* 状态信息 */}
      <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
        {bgImageData ? '背景已加载' : '未加载背景'} |
        多边形: {dashedPolygons.length}{drawingPolygon ? ` + 1(绘制中: ${drawingPolygon.length}点)` : ''}
        {bbox && ` | BBox: (${bbox.x},${bbox.y}) ${bbox.w}x${bbox.h}`}
      </div>
      <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
        虚线: 点击添加顶点, 右键/双击闭合 | 画笔: 拖拽涂抹 | 取色: 点击取样
      </div>
    </div>
  );
};