import { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
import { useAppStore } from '../stores/useAppStore';
import type { Point, Shape } from '../types';
import { AnnotationEditor } from './AnnotationEditor';
import { worldToCanvas, canvasToWorld, worldToAxis } from '../utils/transform';
import { computeRegionIdAtPoint, getDebugRegions, computeGridRegions, computeScanlineIntervals, computeRegionsExact, BFS_WORLD_BOUNDS, type DebugRegionData } from '../utils/regionDetectionExact';
import { findRegionByPoint, findRegionIndexByPoint, isPointInPolygonWithHoles } from '../utils/regionDetection';
import { drawCircleOnBuffer } from '../utils/paintBufferUtils';
import { bfsHueClustering, rasterizeRegionMask } from '../utils/colorCompressor';
import { computeAllDashedClosedRegions, findRegionAtPoint, findRegionById, DashedSubRegion } from '../utils/colorExtractionUtils';
import { processMaskRingCPU } from '../utils/gpuMaskProcessor';
import earcut from 'earcut';
import { useFluidSolver } from '../fluid/useFluidSolver';
const PAINT_BUFFER_SIZE = 512; // 绘制缓冲区固定尺寸

// ========== VAT 顶点着色器（读取预计算位移纹理，GPU自计算帧索引）==========
const VAT_VERTEX_SHADER = `
  uniform sampler2D uDisplacementTex;
  uniform float uTime;
  uniform float uFramesPerSecond;
  uniform float uTotalFrames;
  uniform float uVertexCount;

  varying vec2 vUv;
  varying vec2 vDisplacement;

  void main() {
    float frame = mod(uTime * uFramesPerSecond, uTotalFrames);
    float texY = frame / uTotalFrames;
    float texX = (float(gl_VertexID) + 0.5) / uVertexCount;

    vec2 displacement = texture2D(uDisplacementTex, vec2(texX, texY)).rg;

    vUv = uv;
    vDisplacement = displacement;

    vec3 pos = position + vec3(displacement, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// ========== 填充网格的片元着色器（用于模板缓冲）==========
const FILL_FRAGMENT_SHADER = `
  void main() {
    // 完全透明，仅写入模板缓冲，不显示颜色
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
`;

// ========== 边框的片元着色器 ==========
const BORDER_FRAGMENT_SHADER = `
  uniform vec3 uBorderColor;
  void main() {
    gl_FragColor = vec4(uBorderColor, 0.8);
  }
`;

// ========== 颜色纹理的片元着色器（带UV + 底图变换 + 旋转 + 呼吸式扭曲）==========
const COLOR_FRAGMENT_SHADER = `
  uniform sampler2D uColorTex;
  uniform vec2 uTexOffset;
  uniform vec2 uTexScale;
  uniform float uTexRotation;
  uniform float uTime;
  uniform float uDistortEnabled;
  uniform float uDistortAmplitude;
  uniform float uDistortFrequency;
  uniform float uDistortSpeed;
  uniform float uDistortRotation;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    
    // ==========================================
    // 1. 呼吸式扭曲（在屏幕空间，独立于底图变换）
    // ==========================================
    if (uDistortEnabled > 0.5) {
      float time = uTime;
      
      // 扭曲旋转：将UV旋转到扭曲坐标系
      float cosDR = cos(uDistortRotation);
      float sinDR = sin(uDistortRotation);
      vec2 dUv = uv - 0.5;
      vec2 rotUv = vec2(
        dUv.x * cosDR - dUv.y * sinDR,
        dUv.x * sinDR + dUv.y * cosDR
      );
      rotUv += 0.5;
      
      // 动态参数
      float amplitude = uDistortAmplitude * (0.5 + 0.5 * sin(time * 0.4));
      float frequency = uDistortFrequency;
      float phase = time * uDistortSpeed + 0.5 * sin(time * 0.3);
      
      // 水平偏移
      float offsetX = amplitude * sin(frequency * rotUv.y + phase);
      rotUv.x += offsetX;
      
      // 次级小波
      float secondaryAmp = amplitude * 0.3;
      float secondaryFreq = frequency * 1.8;
      float secondaryPhase = time * 2.5;
      rotUv.x += secondaryAmp * sin(secondaryFreq * rotUv.y + secondaryPhase);
      
      // 旋转回原始空间
      vec2 backUv = rotUv - 0.5;
      uv = vec2(
        backUv.x * cosDR + backUv.y * sinDR,
        -backUv.x * sinDR + backUv.y * cosDR
      );
      uv += 0.5;
    }
    
    // ==========================================
    // 2. 底图变换（旋转、偏移、缩放）
    // ==========================================
    float cosRot = cos(uTexRotation);
    float sinRot = sin(uTexRotation);
    
    uv -= 0.5;
    uv = vec2(uv.x * cosRot - uv.y * sinRot, uv.x * sinRot + uv.y * cosRot);
    uv += 0.5;
    
    uv = (uv - uTexOffset) / uTexScale;
    
    gl_FragColor = texture2D(uColorTex, uv);
  }
`;

// ========== HSL 到 RGB 转换 ==========
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  let r: number, g: number, b: number;
  
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
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
  
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

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
    fullPath.push(...curve.slice(1)); // 避免重复起点
  }
  fullPath.push(points[points.length - 1]);
  return fullPath;
}

// ========== 几何辅助函数 ==========
function distanceToLineSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const ax = px - x1, ay = py - y1;
  const bx = x2 - x1, by = y2 - y1;
  const dot = ax * bx + ay * by;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(ax, ay);
  let t = dot / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * bx;
  const projY = y1 + t * by;
  return Math.hypot(px - projX, py - projY);
}

function clipLineToCanvas(
  start: { x: number; y: number },
  end: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  let x = end.x;
  let y = end.y;
  
  // 如果端点在画布内，直接返回
  if (x >= 0 && x <= canvasWidth && y >= 0 && y <= canvasHeight) {
    return { x, y };
  }
  
  // 使用 Liang-Barsky 算法裁剪线段到画布边界
  const x0 = start.x, y0 = start.y;
  const x1 = end.x, y1 = end.y;
  const xmin = 0, ymin = 0, xmax = canvasWidth, ymax = canvasHeight;
  
  let t0 = 0, t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      // 线段平行于裁剪边界
      if (q[i] < 0) return { x: x0, y: y0 }; // 完全在边界外
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0 && t > t0) t0 = t;
      if (p[i] > 0 && t < t1) t1 = t;
    }
  }
  
  if (t0 > t1) return { x: x0, y: y0 }; // 线段完全在裁剪区域外
  
  // 返回裁剪后的端点
  return {
    x: x0 + t1 * dx,
    y: y0 + t1 * dy
  };
}

function sampleQuadraticCurve(p0: Point, p1: Point, ctrl: Point, segments = 30): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
    const y = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
    points.push({ x, y });
  }
  return points;
}

export function MainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  
  // WebGL 相关 refs（使用归一化坐标和 rootGroup）
  const webglRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const webglSceneRef = useRef<THREE.Scene | null>(null);
  const webglCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rootGroupRef = useRef<THREE.Group | null>(null); // 根Group，负责缩放归一化坐标到画布
  const regionUniformsMapRef = useRef<Array<{ regionId: number; uniforms: any }>>([]); // 存储每个区域的 uniforms
  const animationFrameIdRef = useRef<number | null>(null); // 动画循环 ID
  // ★ 流体集成：存储每个区域 COLOR mesh 的 uniforms，用于在 animate 循环中把
  //   uColorTex 从静态 boundBaseTexture 交换为 FluidSolver 的 compositeTexture。
  //   每次重建网格时清空并重新填充。
  const colorMeshUniformsRef = useRef<Array<{
    regionId: number;
    uniforms: any;
    staticColorTex: THREE.Texture;
  }>>([]);
  const {
    imageState,
    layerVisibility,
    axis,
    grid,
    zoom,
    panOffset,
    isPanMode,
    setZoom,
    setPanOffset,
    mousePosition,
    setMousePosition,
    currentTool,
    shapes,
    addShape,
    removeShape,
    activeGroupId,
    activeLayerId,
    layers,
    snapRadius,
    snapEnabled,
    lineWidth,
    pointAnnotations,
    addPointAnnotation,
    updatePointAnnotation,
    removePointAnnotation,
    regionAnnotations,
    addRegionAnnotation,
    updateRegionAnnotationWithRegionId,
    removeRegionAnnotation,
    saveToStorage,
    regionPolygonsCache,
    refreshRegionCache,
    colorBlockRegionsCache,
    refreshColorBlockCache,
    dashedSubRegionsCache,
    refreshDashedSubRegionsCache,
    saveHistory,
    currentColor,
    paintBrushSize,
    paintBuffers,
    initPaintBuffer,
    updatePaintBuffer,
    extractPolygonsFromPaintBuffer,
    addPixelToRegion,
    regionIdTexture,
    isRestoringHistory,
    // 背景拖动
    setBackgroundDragging,
    startBackgroundDrag,
    updateBackgroundDrag,
    endBackgroundDrag,
    // 画布尺寸
    canvasWidth,
    canvasHeight,
    // 颜色提取模式
    colorExtractMode,
    setColorExtractMode,
    colorExtractTool,
    colorExtractPoints,
    addColorExtractPoint,
    clearColorExtractPoints,
    colorExtractPreviewPoint,
    setColorExtractPreviewPoint,
    colorExtractWaitingFor,
    setColorExtractWaitingFor,
    colorExtractRegionId,
    setColorExtractRegionId,
    colorExtractCurves,
    addColorExtractCurve,
    colorExtractEraserMode,
    setColorExtractEraserMode,
    colorExtractWaiting,
    lastPolygonPoint,
    setLastPolygonPoint,
    setExtractedColorBlocks,
    pendingExtractPolygon,
    setPendingExtractPolygon,
    showColorExtractDebug,
    setShowColorExtractDebug,
    colorExtractDebugData,
    setColorExtractDebugData,
    // 区域色块图层纹理
    regionLayerTexture,
    generateRegionLayerTexture,
    // 新的区域色块图层缓存画布
    regionLayerCanvas,
    regionLayerTextureGPU,
    // 【重构】区域实体列表（存储 ftx 压缩数据）
    regionEntities,
    redrawTrigger,
    refreshRegionEntities,
    triggerCanvasRedraw,
    isVertexPinMode,
    vertexPinRadius,
    isVertexPinEraserMode,
    showRegionBorderWebGL,
    showRegionBorder2D,
    frameDataMap,
    bfsResolution,
  } = useAppStore();

  // ★ 流体解算器生命周期（创建/加载数据/障碍物/配置更新/销毁）。
  //   解算器直接作用在区域实体帧纹理的「残差」上：colorGrid = 残差（被平流），
  //   baseHsl 静态，composite = base + 平流(残差) → compositeTexture。
  //   animate 循环读取 solverRef.current 驱动 step+composite，并把
  //   绑定区域 COLOR mesh 的 uColorTex 交换为 compositeTexture。
  const fluidSolverRef = useFluidSolver(
    webglRendererRef,
    activeLayerId,
    frameDataMap[activeLayerId ?? ''],
    regionEntities[activeLayerId ?? ''] ?? [],
  );

  // 使用 ref 追踪恢复状态，避免触发 useEffect
  const isRestoringRef = useRef(false);
  useEffect(() => {
    isRestoringRef.current = isRestoringHistory;
  }, [isRestoringHistory]);

  // 存储 WebGL Mesh 实际使用的坐标（用于在 2D Canvas 上绘制）
  const webglMeshCornersRef = useRef<Array<{ id: number; corners: Array<{ x: number; y: number }>; center: { x: number; y: number } }>>([]);

  // 顶点固定节流定时器
  const pinRefreshThrottleRef = useRef<number | null>(null);

  // 边框 Group 和 uniforms 存储（用于 GPU 边框扭曲）
  const borderGroupRef = useRef<THREE.Group | null>(null);
  const borderUniformsMapRef = useRef<Map<number, { uniforms: any; mesh: THREE.Line }>>(new Map());
  
  // 纹理 Mesh 引用（用于清理）
  const textureMeshesRef = useRef<THREE.Mesh[]>([]);
  
  // 模板填充网格引用（用于模板缓冲裁剪）
  const stencilMeshesRef = useRef<Array<{
    regionId: number;
    mesh: THREE.Mesh;
    uniforms: any;
  }>>([]);

  // ========== WebGL 环境初始化（使用画布像素坐标，与 2D Canvas 一致）==========
  useEffect(() => {
    if (!canvasWrapperRef.current) return;

    // 创建 WebGL canvas 并插入到容器（覆盖在主 canvas 上方，居中对齐）
    const webglCanvas = document.createElement('canvas');
    webglCanvas.style.position = 'absolute';
    webglCanvas.style.top = '50%';
    webglCanvas.style.left = '50%';
    webglCanvas.style.transform = 'translate(-50%, -50%)';
    webglCanvas.style.width = `${canvasWidth}px`;
    webglCanvas.style.height = `${canvasHeight}px`;
    webglCanvas.style.pointerEvents = 'none';
    webglCanvas.style.display = 'block';
    canvasWrapperRef.current.appendChild(webglCanvas);

    // 创建 WebGL 渲染器（启用模板缓冲）
    const renderer = new THREE.WebGLRenderer({
      canvas: webglCanvas,
      alpha: true,
      antialias: false,
      stencil: true,
    });
    renderer.setSize(canvasWidth, canvasHeight);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    // ★ 关键：设置输出颜色空间为线性，禁用 Three.js 的 linear→sRGB 自动转换
    //   因为所有自定义着色器（hsl2rgb、位移着色器等）输出的是 sRGB 值，
    //   如果再做一次 linear→sRGB 转换，会导致双重 sRGB → 画面发亮/色偏
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    webglRendererRef.current = renderer;

    // 创建场景
    const scene = new THREE.Scene();
    webglSceneRef.current = scene;

    // 创建正交相机：画布像素坐标（0~canvasWidth, 0~canvasHeight），Y向下（与 Canvas 一致）
    const camera = new THREE.OrthographicCamera(0, canvasWidth, 0, canvasHeight, -1, 1);
    webglCameraRef.current = camera;

    // 创建根 Group（应用与 2D Canvas 相同的视图变换）
    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    rootGroupRef.current = rootGroup;

    // 创建边框 Group（用于 GPU 边框扭曲）
    const borderGroup = new THREE.Group();
    rootGroup.add(borderGroup);
    borderGroupRef.current = borderGroup;

    return () => {
      renderer.dispose();
      if (webglCanvas.parentNode) webglCanvas.parentNode.removeChild(webglCanvas);
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, []);

  // ========== 同步视图变换（响应 zoom 和 panOffset）==========
  useEffect(() => {
    const rootGroup = rootGroupRef.current;
    if (!rootGroup) return;
    
    // 与 2D Canvas 的变换一致：T(cx+panX, cy+panY) * S(zoom) * T(-cx, -cy)
    // 等价于 rootGroup.position = (cx*(1-zoom) + panX, cy*(1-zoom) + panY)
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    rootGroup.position.set(cx * (1 - zoom) + panOffset.x, cy * (1 - zoom) + panOffset.y, 0);
    rootGroup.scale.set(zoom, zoom, 1);
  }, [zoom, panOffset, canvasWidth, canvasHeight]);

  // ========== 同步画布尺寸（响应 canvasWidth/canvasHeight）==========
  useEffect(() => {
    const renderer = webglRendererRef.current;
    const camera = webglCameraRef.current;
    if (!renderer || !camera) return;
    
    renderer.setSize(canvasWidth, canvasHeight);
    // 更新 WebGL canvas 的 CSS 尺寸（保持居中对齐）
    renderer.domElement.style.width = `${canvasWidth}px`;
    renderer.domElement.style.height = `${canvasHeight}px`;
    
    // 相机使用画布像素坐标，Y向下（与 Canvas 一致）
    camera.left = 0;
    camera.right = canvasWidth;
    camera.top = 0;
    camera.bottom = canvasHeight;
    camera.updateProjectionMatrix();
  }, [canvasWidth, canvasHeight]);

  // ========== 同步可见性和透明度（响应 layerVisibility.regionLayer 和图层属性）==========
  useEffect(() => {
    const renderer = webglRendererRef.current;
    const scene = webglSceneRef.current;
    const camera = webglCameraRef.current;
    if (!renderer || !scene || !camera) return;
    
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const visible = layerVisibility.regionLayer && (activeLayer?.visible ?? true);
    const opacity = activeLayer?.opacity ?? 1;
    
    renderer.domElement.style.display = visible ? 'block' : 'none';
    renderer.domElement.style.opacity = opacity.toString();
    
    // 启动/停止动画循环
    if (visible) {
      let lastTime = 0;
      let frameCounter = 0;
      const animate = (time: number) => {
        const currentActiveLayer = useAppStore.getState().layers.find(l => l.id === useAppStore.getState().activeLayerId);
        const currentVisible = useAppStore.getState().layerVisibility.regionLayer && (currentActiveLayer?.visible ?? true);
        if (!currentVisible) return;

        const delta = lastTime ? (time - lastTime) / 1000 : 0;
        lastTime = time;

        const speed = useAppStore.getState().regionAnimationSpeed || 0.5;
        let currentTime = useAppStore.getState().regionAnimationTime + delta * speed;
        currentTime = currentTime % 1000;
        useAppStore.getState().setRegionAnimationTime(currentTime);

        const group = rootGroupRef.current;
        if (group) {
          // 每帧更新 uniforms
          group.children.forEach(child => {
            if (child instanceof THREE.Mesh || child instanceof THREE.LineLoop) {
              const mat = child.material as THREE.ShaderMaterial;
              if (mat && mat.uniforms && mat.uniforms.uTime) {
                mat.uniforms.uTime.value = currentTime * 2;
              }
            }
          });
        }

        // ===== 流体解算器驱动 =====
        // 流体直接作用在区域实体帧纹理的「残差」上：step 平流残差，composite 产出
        // compositeTexture，再把绑定区域 COLOR mesh 的 uColorTex 换成它。
        // 复用模板缓冲裁剪（stencilTest=Equal）+ VAT 位移 + textureOffset/Scale/Rotation，
        // 故流体仅在区域内部可见，且随区域一起扭曲/变换。
        const solver = fluidSolverRef.current;
        const st = useAppStore.getState();
        const aLayerId = st.activeLayerId;
        const fd = aLayerId ? st.frameDataMap[aLayerId] : undefined;
        const rt = fd?.fluidRuntime;
        if (solver && fd) {
          // 重置标志：resetFluid() 置位 → 此处执行 solver.reset() 并清除
          if (rt?._needsReset) {
            solver.reset();
            useAppStore.setState({
              frameDataMap: {
                ...st.frameDataMap,
                [aLayerId!]: {
                  ...fd,
                  fluidRuntime: { ...rt, _needsReset: false, currentTime: 0, frameCount: 0 },
                },
              },
            } as any);
          }
          if (rt?.isPlaying) {
            // dt 限幅，避免切标签页后大步长导致爆炸
            const fluidDt = Math.min(delta, 1 / 30) * (rt.speed ?? 1);
            if (fluidDt > 0) {
              solver.step(fluidDt);
              if (rt) rt.currentTime += fluidDt;
            }
          }
          // 始终 composite，使暂停态也能显示当前帧（含重置后的初始残差）
          solver.composite();
          const compTex = solver.getCompositeTexture();
          const boundId = fd.boundRegionId;
          for (const entry of colorMeshUniformsRef.current) {
            if (compTex && entry.regionId === boundId) {
              entry.uniforms.uColorTex.value = compTex;
            } else {
              entry.uniforms.uColorTex.value = entry.staticColorTex;
            }
          }
        } else {
          // 无流体：恢复静态纹理
          for (const entry of colorMeshUniformsRef.current) {
            entry.uniforms.uColorTex.value = entry.staticColorTex;
          }
        }

        renderer.clear(true, true, true);
        renderer.render(scene, camera);

        frameCounter++;

        animationFrameIdRef.current = requestAnimationFrame(animate);
      };
      animationFrameIdRef.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
    }
    
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
    };
  }, [layerVisibility.regionLayer, layers, activeLayerId]);

  const frameIndexRef = useRef<number>(0);
const TOTAL_FRAMES = 60;

// ========== 更新区域Mesh（VAT方案）==========
useEffect(() => {
  const group = rootGroupRef.current;
  if (!group) return;

  while (group.children.length > 0) {
    const child = group.children[0];
    if (child instanceof THREE.Mesh || child instanceof THREE.LineLoop) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material.dispose();
      }
    }
    group.remove(child);
  }

  // ★ 清空流体 uniforms 注册表（即将重建，animate 循环会读取最新内容）
  colorMeshUniformsRef.current = [];

  const entities = regionEntities[activeLayerId] || [];
  if (entities.length === 0) return;

  const regionAnnotationsForLayer = regionAnnotations.filter(a => a.layerId === activeLayerId);
  
  let meshCount = 0, texCount = 0;

  for (const entity of entities) {
    try {
    const anno = regionAnnotationsForLayer.find(a => Number(a.regionId) === entity.id);
    const hasMaskEffect = anno?.maskEffect?.enabled;

    const bbox = entity.worldBbox;
    if (!bbox) { continue; }

    const displacementTex = entity.getDisplacementTexture(canvasWidth, canvasHeight);
    if (!displacementTex) {
      continue;
    }
    const vertexCount = entity.getTotalVertices();
    const numFrames = entity.getNumFrames();

    // --- 1. 将所有环转换为 Vector2（像素坐标） ---
    const allRingsVec = entity.boundary.map(ring =>
      ring.map(p => new THREE.Vector2(
        p.x * canvasWidth,
        (1 - p.y) * canvasHeight
      ))
    );

    if (allRingsVec.length === 0 || allRingsVec[0].length < 3) {
      continue;
    }

    // --- 2. 三角剖分（使用 earcut，支持孔洞） ---
    const allPoints = allRingsVec.flat();
    
    // 构建扁平坐标数组 [x0,y0, x1,y1, ...] 和每个环的长度
    const flatCoords: number[] = [];
    const ringLengths: number[] = [];
    for (const ring of allRingsVec) {
      ringLengths.push(ring.length);
      for (const v of ring) {
        flatCoords.push(v.x, v.y);
      }
    }
    
    // ★ 数据清洗：过滤 NaN/Infinity
    for (let i = 0; i < flatCoords.length; i++) {
      if (!isFinite(flatCoords[i])) {
        flatCoords[i] = 0;
      }
    }
    // 去除连续重复点
    for (let ri = 0; ri < ringLengths.length; ri++) {
      const start = ringLengths.slice(0, ri).reduce((s, l) => s + l, 0);
      const len = ringLengths[ri];
      const keep: number[] = [];
      for (let vi = 0; vi < len; vi++) {
        const idx = (start + vi) * 2;
        const prevIdx = (start + ((vi - 1 + len) % len)) * 2;
        if (vi > 0 && flatCoords[idx] === flatCoords[prevIdx] && flatCoords[idx + 1] === flatCoords[prevIdx + 1]) {
          continue; // 跳过与上一个相同的点
        }
        keep.push(vi);
      }
      if (keep.length < 3) {
        continue;
      }
      // 重写该环数据，只保留 keep 中的顶点
      const keptCoords: number[] = [];
      for (const vi of keep) {
        keptCoords.push(flatCoords[(start + vi) * 2], flatCoords[(start + vi) * 2 + 1]);
      }
      // 替换 flatCoords 中对应段
      const before = flatCoords.slice(0, start * 2);
      const after = flatCoords.slice((start + len) * 2);
      flatCoords.length = 0;
      flatCoords.push(...before, ...keptCoords, ...after);
      ringLengths[ri] = keep.length;
    }
    // ★ 重新计算 allPoints（与清洗后的 flatCoords 保持一致）
    allPoints.length = 0;
    for (let i = 0; i < flatCoords.length; i += 2) {
      allPoints.push(new THREE.Vector2(flatCoords[i], flatCoords[i + 1]));
    }
    
    // 构建 holeIndices：earcut 需要每个孔洞在顶点数组中的起始索引（累计和）
    const holeIndices: number[] | null = ringLengths.length > 1
      ? (() => {
          const indices: number[] = [];
          let cumSum = ringLengths[0]; // 第一个环是外环
          for (let i = 1; i < ringLengths.length; i++) {
            indices.push(cumSum);
            cumSum += ringLengths[i];
          }
          return indices;
        })()
      : null;
    
    let indices: number[];
    try {
      indices = earcut(flatCoords, holeIndices, 2);
    } catch (e) {
      indices = [];
    }
    
    console.log(`[三角剖分诊断] 区域#${entity.id} 顶点数=${flatCoords.length/2} 环数=${ringLengths.length} holeIndices=${holeIndices?.length??0} 索引数=${indices.length} 三角形数=${indices.length/3}`);
    
    // 验证索引有效性
    if (indices.length === 0 || indices.length % 3 !== 0) {
      console.warn(`[三角剖分诊断] ⚠️ earcut失败，回退到仅外环`);
      // 回退：仅外环剖分（无孔洞 → holeIndices=null）
      const outerLen = ringLengths[0];
      const outerFlat = flatCoords.slice(0, outerLen * 2);
      try {
        indices = earcut(outerFlat, null, 2);
      } catch (e2) {
        indices = [];
      }
      if (indices.length === 0 || indices.length % 3 !== 0) {
        console.warn(`[三角剖分诊断] ⚠️ 外环剖分也失败，跳过该区域`);
        continue;
      }
    }

    // --- 3. 构建填充网格（带洞） ---
    const fillGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(allPoints.length * 3);
    allPoints.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = 0;
    });
    fillGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    fillGeom.setIndex(indices);
    fillGeom.computeVertexNormals();
    
    // --- 4. UV 生成（像素坐标 → 归一化 UV，正确映射到 canvasWidth x canvasHeight 纹理）---
    const texWidth = canvasWidth;
    const texHeight = canvasHeight;
    const uv = new Float32Array(allPoints.length * 2);
    allPoints.forEach((p, i) => {
      uv[i * 2] = p.x / texWidth;
      uv[i * 2 + 1] = p.y / texHeight;
    });
    fillGeom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    

    // --- 5. 填充网格材质（模板缓冲奇偶填充） ---
    const fillMat = new THREE.ShaderMaterial({
      uniforms: {
        uDisplacementTex: { value: displacementTex },
        uTime: { value: 0 },
        uFramesPerSecond: { value: 30 },
        uTotalFrames: { value: numFrames },
        uVertexCount: { value: vertexCount },
      },
      vertexShader: VAT_VERTEX_SHADER,
      fragmentShader: FILL_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,  // ★ earcut生成的三角形方向可能不一致，DoubleSide确保都能渲染
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.InvertStencilOp,  // 奇偶翻转：三角形重叠区域抵消
      stencilZFail: THREE.InvertStencilOp,
      stencilZPass: THREE.InvertStencilOp,
    });
    fillMat.depthTest = false;
    fillMat.depthWrite = false;
    fillMat.colorWrite = false;
    const fillMesh = new THREE.Mesh(fillGeom, fillMat);
    fillMesh.renderOrder = 0;
    fillMesh.frustumCulled = false;

    // --- 6. 颜色纹理网格（使用 frameDataMap 绑定的纹理）---
    const frameData = frameDataMap[activeLayerId];
    const boundTex = frameData?.boundRegionId === entity.id ? frameData.boundBaseTexture : null;
    let colorMesh: THREE.Mesh | null = null;
    if (boundTex) {
      // 统计 boundTex 中 alpha>0 的像素数
      let validPx = 0;
      const bd = boundTex.data;
      for (let i = 3; i < bd.length; i += 4) { if (bd[i] > 0) validPx++; }
      
      // 检查纹理前几个像素的颜色值（确认数据有效）
      let firstPixel = 'N/A';
      if (bd.length >= 4) {
        firstPixel = `RGBA=(${bd[0]},${bd[1]},${bd[2]},${bd[3]})`;
      }
      
      // 分析 UV 范围
      let uvMinX = Infinity, uvMaxX = -Infinity, uvMinY = Infinity, uvMaxY = -Infinity;
      const uvArray = fillGeom.attributes.uv.array as Float32Array;
      for (let i = 0; i < uvArray.length; i += 2) {
        if (uvArray[i] < uvMinX) uvMinX = uvArray[i];
        if (uvArray[i] > uvMaxX) uvMaxX = uvArray[i];
        if (uvArray[i + 1] < uvMinY) uvMinY = uvArray[i + 1];
        if (uvArray[i + 1] > uvMaxY) uvMaxY = uvArray[i + 1];
      }
      
      if (uvMinX < 0 || uvMaxX > 1 || uvMinY < 0 || uvMaxY > 1) {
        console.warn(`[COLOR] 区域#${entity.id} UV超出[0,1]范围！纹理采样可能异常`);
      }

      // 将 ImageData 转换为 Three.js DataTexture
      const colorTexture = new THREE.DataTexture(
        new Uint8ClampedArray(boundTex.data),
        boundTex.width,
        boundTex.height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );
      colorTexture.needsUpdate = true;
      colorTexture.flipY = false; // 保持与模板缓冲一致的坐标系，不翻转
      colorTexture.minFilter = THREE.LinearFilter;
      colorTexture.magFilter = THREE.LinearFilter;
      colorTexture.wrapS = THREE.ClampToEdgeWrapping;
      colorTexture.wrapT = THREE.ClampToEdgeWrapping;
      
      const texMat = new THREE.ShaderMaterial({
        uniforms: {
          uDisplacementTex: { value: displacementTex },
          uTime: { value: 0 },
          uFramesPerSecond: { value: 30 },
          uTotalFrames: { value: numFrames },
          uVertexCount: { value: vertexCount },
          uColorTex: { value: colorTexture },
          uTexOffset: { value: new THREE.Vector2(frameData.textureOffset?.x || 0, frameData.textureOffset?.y || 0) },
          uTexScale: { value: new THREE.Vector2(frameData.textureScale?.x || 1, frameData.textureScale?.y || 1) },
          uTexRotation: { value: frameData.textureRotation || 0 },
          uDistortEnabled: { value: frameData.distortEnabled ? 1 : 0 },
          uDistortAmplitude: { value: frameData.distortAmplitude ?? 0.06 },
          uDistortFrequency: { value: frameData.distortFrequency ?? 5.0 },
          uDistortSpeed: { value: frameData.distortSpeed ?? 1.2 },
          uDistortRotation: { value: frameData.distortRotation ?? 0 },
        },
        vertexShader: VAT_VERTEX_SHADER,
        fragmentShader: COLOR_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,  // ★ earcut生成的三角形方向可能不一致，DoubleSide确保都能渲染
      });
      texMat.stencilWrite = false;
      texMat.stencilRef = 1;
      texMat.stencilFunc = THREE.EqualStencilFunc;
      // 共享 fillGeom，确保 GPU 按 gl_VertexID 索引的顶点顺序完全一致
      colorMesh = new THREE.Mesh(fillGeom, texMat);
      colorMesh.renderOrder = 1;
      colorMesh.frustumCulled = false;

      // ★ 注册到流体 uniforms 表：animate 循环据此把 uColorTex 交换为
      //   FluidSolver 的 compositeTexture（流体直接绘制在残差之上，复用模板裁剪 +
      //   VAT 位移 + textureOffset/Scale/Rotation）。无流体时保持静态 colorTexture。
      colorMeshUniformsRef.current.push({
        regionId: entity.id,
        uniforms: texMat.uniforms,
        staticColorTex: colorTexture,
      });
    }

    // --- 7. 边框：为每个环单独创建 LineLoop ---
    const borderLines: THREE.LineLoop[] = [];
    for (const ring of allRingsVec) {
      if (ring.length < 3) continue;
      const borderGeom = new THREE.BufferGeometry();
      const borderPos = new Float32Array(ring.length * 3);
      ring.forEach((p, i) => {
        borderPos[i * 3] = p.x;
        borderPos[i * 3 + 1] = p.y;
        borderPos[i * 3 + 2] = 0;
      });
      borderGeom.setAttribute('position', new THREE.BufferAttribute(borderPos, 3));

      const borderMat = new THREE.ShaderMaterial({
        uniforms: {
          uDisplacementTex: { value: displacementTex },
          uTime: { value: 0 },
          uFramesPerSecond: { value: 30 },
          uTotalFrames: { value: numFrames },
          uVertexCount: { value: vertexCount },
          uBorderColor: { value: new THREE.Color(0xffaa00) },
        },
        vertexShader: VAT_VERTEX_SHADER,
        fragmentShader: BORDER_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
      });
      const lineLoop = new THREE.LineLoop(borderGeom, borderMat);
      lineLoop.renderOrder = 2;
      borderLines.push(lineLoop);
    }

    // --- 8. 无需应用网格变换（变换已烘焙到位移纹理中）---
    // processMaskRingCPU 已完整应用了 maskEffect.transform（锚点、位移、旋转、缩放）
    // 网格保持单位矩阵，由位移纹理承载所有变换

    group.add(fillMesh);
    if (colorMesh) { group.add(colorMesh); texCount++; }
    meshCount++;
    if (showRegionBorderWebGL) {
      for (const line of borderLines) group.add(line);
    }
  } catch (e: any) {
    console.warn(`[VAT网格构建] 区域#${entity.id} 构建异常:`, e);
  }
  }

  // ===== 位移纹理诊断数据（存入 group.userData，供动画循环读取）=====
  if (entities.length > 0) {
    const firstEntity = entities[0];
    const dt = firstEntity.getDisplacementTexture(canvasWidth, canvasHeight);
    if (dt && (dt as any).image && (dt as any).image.data) {
      const img = (dt as any).image;
      const d = img.data;
      const tw = img.width || 0;
      const numFrames = firstEntity.getNumFrames();
      const vc = firstEntity.getTotalVertices();
      let nonZeroPixels = 0, maxDisp = 0, minDisp = Infinity;
      for (let i = 0; i < d.length; i += 4) {
        const mag = Math.abs(d[i]) + Math.abs(d[i + 1]);
        if (mag > 0) {
          nonZeroPixels++;
          if (mag > maxDisp) maxDisp = mag;
          if (mag < minDisp) minDisp = mag;
        }
      }
      if (minDisp === Infinity) minDisp = 0;
      
      const th = img.height || 0;
      group.userData['dispTexInfo'] =
        `位移纹理: ${tw}x${th} 总帧=${numFrames} 顶点数=${vc} ` +
        `非零像素=${nonZeroPixels}/${d.length/4} 最大位移=${maxDisp.toFixed(1)} 最小非零=${minDisp.toFixed(1)}`;
    } else {
      console.warn('[VAT] 位移纹理为空或无数据！maskEffect 可能为 null');
      group.userData['dispTexInfo'] = '⚠️ 位移纹理为空';
    }
  }
}, [regionEntities, activeLayerId, canvasWidth, canvasHeight, regionAnnotations, showRegionBorderWebGL, frameDataMap]);

  const [isPanning, setIsPanning] = useState(false);
  const [isPinning, setIsPinning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  // 使用全局画布尺寸
  const [showDebugRegions, setShowDebugRegions] = useState(false);
  const debugRegionsCache = useRef<DebugRegionData[] | null>(null);
  const [showGridCells, setShowGridCells] = useState(false);
  const [debugRegionId, setDebugRegionId] = useState(0);
  const [debugOutsideId, setDebugOutsideId] = useState(-1);
  const [debugShowOriginal, setDebugShowOriginal] = useState(true);
  const [debugDistanceThreshold, setDebugDistanceThreshold] = useState(1.2);
  const [debugRadialThreshold, setDebugRadialThreshold] = useState(2);
  const [debugDownsampleFactor, setDebugDownsampleFactor] = useState(0.5);
  const [debugRingDistanceThreshold, setDebugRingDistanceThreshold] = useState(2);
  const [debugRingRadialThreshold, setDebugRingRadialThreshold] = useState(2);
  const [debugShowEndpoints, setDebugShowEndpoints] = useState(false);
  const [debugShowRings, setDebugShowRings] = useState(false);
  const [debugShowSegments, setDebugShowSegments] = useState(false);
  const [debugShowWallGrouped, setDebugShowWallGrouped] = useState(false);
  
  // 上色画笔状态
  const [isPainting, setIsPainting] = useState(false);
  const lastPaintPointRef = useRef<Point | null>(null);

  // 移动工具状态
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [moveShapeIds, setMoveShapeIds] = useState<string[]>([]);
  const [moveStartWorld, setMoveStartWorld] = useState<Point | null>(null);
  const [moveRegionId, setMoveRegionId] = useState<number | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  // 动画循环相关
  const animationFrameRef = useRef<number>();
  const lastBakeTimeRef = useRef<number>(0);
  const BAKE_INTERVAL_MS = Number.MAX_SAFE_INTEGER; // 彻底关闭自动烘焙
  // 持续重绘循环（用于动画效果）
  const renderFrameRef = useRef<number>();
  const lastRenderTimeRef = useRef<number>(0);
  const RENDER_INTERVAL_MS = 16; // 约每秒60帧
  // 状态变化检测
  const lastMaskEffectRef = useRef<string>('');
  const CHECK_INTERVAL_FRAMES = 2; // 每2帧检查一次状态变化

  // 记录圆内所有像素坐标到对应区域（使用预计算的区域ID纹理快速查询）
  const recordCirclePixelsToRegions = useCallback((
    centerWorld: Point,
    radiusWorld: number
  ) => {
    const centerX = centerWorld.x * PAINT_BUFFER_SIZE;
    const centerY = (1 - centerWorld.y) * PAINT_BUFFER_SIZE;
    const radiusPx = radiusWorld * PAINT_BUFFER_SIZE;
    const radiusSq = radiusPx * radiusPx;
    const minX = Math.max(0, Math.floor(centerX - radiusPx));
    const maxX = Math.min(PAINT_BUFFER_SIZE - 1, Math.ceil(centerX + radiusPx));
    const minY = Math.max(0, Math.floor(centerY - radiusPx));
    const maxY = Math.min(PAINT_BUFFER_SIZE - 1, Math.ceil(centerY + radiusPx));

    // 获取当前图层的区域ID纹理
    const layerId = activeLayerId || layers[0]?.id;
    if (!layerId) return;
    const texture = regionIdTexture.get(layerId);
    if (!texture) return;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy <= radiusSq) {
          // 从纹理中快速查询区域ID（O(1)操作）
          const regionId = texture[y * PAINT_BUFFER_SIZE + x];
          if (regionId !== 0) {
            addPixelToRegion(regionId, x, y);
          }
        }
      }
    }
  }, [activeLayerId, layers, regionIdTexture, addPixelToRegion]);
  
  const generateEditorId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const [pointAnnotationEditor, setPointAnnotationEditor] = useState<{
    editorId: string;
    x: number;
    y: number;
    annotationId: string | null;
    existingText: string;
    position: Point;
  } | null>(null);

  const [regionAnnotationEditor, setRegionAnnotationEditor] = useState<{
    editorId: string;
    x: number;
    y: number;
    annotationId: string | null;
    existingText: string;
    polygon: Point[][];
    regionId: string;
  } | null>(null);

  const currentEditorIdRef = useRef<string | null>(null);

  const closeCurrentEditor = useCallback(() => {
    setPointAnnotationEditor(null);
    setRegionAnnotationEditor(null);
  }, []);

  // 同步当前编辑器ID到ref
  useEffect(() => {
    currentEditorIdRef.current = pointAnnotationEditor?.editorId || regionAnnotationEditor?.editorId || null;
  }, [pointAnnotationEditor, regionAnnotationEditor]);

  // ========== 橡皮擦专用状态 ==========
  const [isErasing, setIsErasing] = useState(false);
  const erasedShapesThisSessionRef = useRef<Set<string>>(new Set()); // 用 ref 避免不必要的重渲染
  const erasedAnnotationsThisSessionRef = useRef<Set<string>>(new Set()); // 擦除的注释 ID

  // ========== 视图尺寸自适应（已移除，改用全局画布尺寸）==========

  // ========== Escape 键取消临时图形和注释编辑器 ==========
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'd') {
        setShowDebugRegions(prev => {
          const newState = !prev;
          if (newState) {
            const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
            if (currentLayerShapes.length > 0) {
              const worldBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }; // 调试可视化用画布范围 [0,1]（区域注释/查询用 BFS_WORLD_BOUNDS 识别边缘环）
              debugRegionsCache.current = getDebugRegions(currentLayerShapes, worldBounds, bfsResolution);
            }
          } else {
            debugRegionsCache.current = null;
          }
          return newState;
        });
        return;
      }
      if (e.ctrlKey && e.key === 'g') {
        setShowGridCells(prev => !prev);
        return;
      }
      if (e.ctrlKey && e.key === 'G') {
        const newValue = !showColorExtractDebug;
        console.log(`[颜色提取] 调试模式 ${newValue ? '开启' : '关闭'}`);
        setShowColorExtractDebug(newValue);
        return;
      }
      if (e.key === 'Escape') {
        if (tempPoints.length > 0) {
          useAppStore.setState((s) => ({
            shapes: s.shapes.filter(sh => sh.id !== 'current_shape'),
          }));
          setTempPoints([]);
          setPreviewPoint(null);
        }
        if (pointAnnotationEditor || regionAnnotationEditor) {
          setPointAnnotationEditor(null);
          setRegionAnnotationEditor(null);
        }
        // 颜色提取模式：ESC 退出
        if (colorExtractMode) {
          console.log('[颜色提取] ESC 退出模式，已清除控制点');
          clearColorExtractPoints();
          setColorExtractMode(false);
          useAppStore.setState({ colorExtractTool: null });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tempPoints, pointAnnotationEditor, regionAnnotationEditor, colorExtractMode, clearColorExtractPoints, setColorExtractMode, shapes, activeLayerId, debugDistanceThreshold, debugRadialThreshold, debugDownsampleFactor, debugRingDistanceThreshold, debugRingRadialThreshold, bfsResolution]);

  // ========== 形状或图层变化时更新调试缓存 ==========
  useEffect(() => {
    if (showDebugRegions) {
      const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
      if (currentLayerShapes.length > 0) {
        const worldBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }; // 调试可视化用画布范围 [0,1]
        debugRegionsCache.current = getDebugRegions(currentLayerShapes, worldBounds, bfsResolution);
      }
    }
  }, [showDebugRegions, shapes, activeLayerId, bfsResolution]);

  // ========== 切换工具时清理临时图形 ==========
  const prevToolRef = useRef(currentTool);
  useEffect(() => {
    if (prevToolRef.current !== currentTool) {
      if (tempPoints.length > 0) {
        useAppStore.setState((s) => ({
          shapes: s.shapes.filter(sh => sh.id !== 'current_shape'),
        }));
        setTempPoints([]);
        setPreviewPoint(null);
      }
      // 切换到非 select 工具时才退出颜色提取模式
      if (colorExtractMode && currentTool !== 'select') {
        clearColorExtractPoints();
        setColorExtractMode(false);
        useAppStore.setState({ colorExtractTool: null });
      }
    }
    prevToolRef.current = currentTool;
  }, [currentTool, tempPoints, colorExtractMode, clearColorExtractPoints, setColorExtractMode]);

  // ========== 次级BFS区域颜色提取函数 ==========
  
  // 辅助函数：将世界坐标多边形光栅化为掩码（Uint8Array，1=内部，0=外部）
  const rasterizePolygonMask = useCallback((
    polygon: Point[],
    width: number,
    height: number
  ): Uint8Array => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    ctx.beginPath();
    const pxPoints = polygon.map(p => ({ x: p.x * width, y: (1 - p.y) * height }));
    ctx.moveTo(pxPoints[0].x, pxPoints[0].y);
    for (let i = 1; i < pxPoints.length; i++) {
      ctx.lineTo(pxPoints[i].x, pxPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = 'black';
    ctx.fill();
    const imageData = ctx.getImageData(0, 0, width, height);
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i] === 0 && imageData.data[i+1] === 0 && imageData.data[i+2] === 0) {
        mask[i/4] = 1;
      }
    }
    return mask;
  }, []);

  // 新增：将区域多边形光栅化为掩码（包含边界像素，支持内外环）
  const rasterizeRegionMask = useCallback((
    region: Point[][],
    width: number,
    height: number
  ): Uint8Array => {
    const mask = new Uint8Array(width * height);
    const offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;
    const ctx = offCanvas.getContext('2d')!;

    // 1. 用黑色填充整个 canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);

    // 2. 绘制所有环（外环 + 内环），使用白色填充内部（evenodd 规则）
    ctx.fillStyle = 'white';
    for (const ring of region) {
      if (ring.length < 3) continue;
      ctx.beginPath();
      const pxPoints = ring.map(p => ({ x: p.x * width, y: (1 - p.y) * height }));
      ctx.moveTo(pxPoints[0].x, pxPoints[0].y);
      for (let i = 1; i < pxPoints.length; i++) ctx.lineTo(pxPoints[i].x, pxPoints[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // 3. 绘制环的边框（宽度 1 像素），以确保边界像素也被包含
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    for (const ring of region) {
      if (ring.length < 3) continue;
      ctx.beginPath();
      const pxPoints = ring.map(p => ({ x: p.x * width, y: (1 - p.y) * height }));
      ctx.moveTo(pxPoints[0].x, pxPoints[0].y);
      for (let i = 1; i < pxPoints.length; i++) ctx.lineTo(pxPoints[i].x, pxPoints[i].y);
      ctx.closePath();
      ctx.stroke();
    }

    // 4. 读取像素，白色（或接近白色）的像素标记为 1
    const imgData = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      if (imgData.data[i] > 200 && imgData.data[i+1] > 200 && imgData.data[i+2] > 200) {
        mask[i / 4] = 1;
      }
    }
    return mask;
  }, []);

  // 新增辅助函数：获取虚线所在区域的完整多边形
  const getRegionPolygonFromPoints = useCallback((points: Point[]): Point[][] | null => {
    if (points.length < 3) return null;
    
    // 计算重心（或使用第一个点）
    let cx = 0, cy = 0;
    for (const p of points) { cx += p.x; cy += p.y; }
    cx /= points.length; cy /= points.length;
    
    const worldBounds = BFS_WORLD_BOUNDS;
    // 获取当前图层的所有图形（排除正在绘制的临时图形）
    const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
    
    const regionId = computeRegionIdAtPoint({ x: cx, y: cy }, currentLayerShapes, worldBounds, bfsResolution);
    if (regionId === null) {
      console.log('[颜色提取] 无法定位到有效区域');
      return null;
    }
    
    const regionsCache = regionPolygonsCache[activeLayerId];
    if (!regionsCache || regionId >= regionsCache.length) {
      console.log('[颜色提取] 区域缓存不存在或索引超出范围');
      return null;
    }
    
    console.log(`[颜色提取] 找到区域 ID: ${regionId}`);
    return regionsCache[regionId];
  }, [shapes, activeLayerId, regionPolygonsCache]);

  // 新增辅助函数：通过区域ID获取区域多边形
  const getRegionPolygonById = useCallback((regionId: number): Point[][] | null => {
    const regionsCache = regionPolygonsCache[activeLayerId];
    if (!regionsCache || regionId < 0 || regionId >= regionsCache.length) {
      console.log('[颜色提取] 区域缓存不存在或索引超出范围，regionId:', regionId);
      return null;
    }
    
    console.log(`[颜色提取] 通过 ID 获取区域多边形: ${regionId}`);
    return regionsCache[regionId];
  }, [activeLayerId, regionPolygonsCache]);

  // 获取当前画布的世界坐标颜色数据（不应用视图变换）
  const getWorldColorImageData = useCallback((): ImageData | null => {
    console.log('[颜色提取] 开始获取画布颜色数据...');
    const startTime = performance.now();
    
    const offCanvas = document.createElement('canvas');
    offCanvas.width = canvasWidth;
    offCanvas.height = canvasHeight;
    const offCtx = offCanvas.getContext('2d')!;

    // 1. 绘制背景图片（应用背景层变换，与主画布绘制逻辑保持一致）
    if (imageState.originalImage && imageState.imageSrc) {
      const img = imageState.originalImage;
      const bgOffsetX = imageState.offsetX ?? 0;
      const bgOffsetY = imageState.offsetY ?? 0;
      const bgScale = imageState.scale ?? 1;
      
      console.log(`[颜色提取] 背景变换参数: offsetX=${bgOffsetX.toFixed(2)}, offsetY=${bgOffsetY.toFixed(2)}, scale=${bgScale.toFixed(2)}`);

      if (imageState.selectionRect) {
        const sel = imageState.selectionRect;
        const scaleX = canvasWidth / sel.width;
        const scaleY = canvasHeight / sel.height;
        const fitScale = Math.min(scaleX, scaleY);
        const drawWidth = sel.width * fitScale * bgScale;
        const drawHeight = sel.height * fitScale * bgScale;
        const offsetX = (canvasWidth - drawWidth) / 2 + bgOffsetX;
        const offsetY = (canvasHeight - drawHeight) / 2 + bgOffsetY;
        offCtx.drawImage(img, sel.x, sel.y, sel.width, sel.height, offsetX, offsetY, drawWidth, drawHeight);
      } else {
        const fitScale = Math.min(canvasWidth / img.width, canvasHeight / img.height);
        const drawWidth = img.width * fitScale * bgScale;
        const drawHeight = img.height * fitScale * bgScale;
        const offsetX = (canvasWidth - drawWidth) / 2 + bgOffsetX;
        const offsetY = (canvasHeight - drawHeight) / 2 + bgOffsetY;
        offCtx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
      }
    }

    // 2. 绘制像素缓冲区
    const layerId = activeLayerId || layers[0]?.id;
    const buffer = paintBuffers[layerId];
    if (buffer && layerVisibility.drawLayer) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = buffer.width;
      tempCanvas.height = buffer.height;
      tempCanvas.getContext('2d')!.putImageData(buffer, 0, 0);
      offCtx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight);
    }

    const colorData = offCtx.getImageData(0, 0, canvasWidth, canvasHeight);
    const endTime = performance.now();
    console.log(`[颜色提取] 获取颜色数据完成，耗时: ${(endTime - startTime).toFixed(2)}ms, 数据大小: ${colorData.data.length} bytes`);
    return colorData;
  }, [canvasWidth, canvasHeight, imageState, activeLayerId, layers, paintBuffers, layerVisibility]);

  // 连通区域标记，返回色块列表
  const extractConnectedComponents = useCallback((
    mask: Uint8Array,
    colorData: ImageData,
    width: number,
    height: number
  ): Array<{ id: number; avgColor: { r: number; g: number; b: number }; pixels: Array<{ x: number; y: number }> }> => {
    console.log(`[颜色提取] 开始连通区域标记，尺寸: ${width}x${height}, 颜色阈值: 30`);
    const startTime = performance.now();
    
    // 统计掩码内的像素情况
    let maskPixels = 0;
    let opaquePixels = 0;
    let sampleColors: string[] = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 1) {
        maskPixels++;
        const srcIdx = i * 4;
        if (colorData.data[srcIdx + 3] >= 128) {
          opaquePixels++;
          if (sampleColors.length < 5) {
            const r = colorData.data[srcIdx];
            const g = colorData.data[srcIdx + 1];
            const b = colorData.data[srcIdx + 2];
            sampleColors.push(`rgb(${r},${g},${b})`);
          }
        }
      }
    }
    console.log(`[颜色提取] 掩码内像素数: ${maskPixels}, 不透明像素数: ${opaquePixels}`);
    console.log(`[颜色提取] 掩码内前5个不透明像素颜色示例: ${sampleColors.join(', ')}`);
    
    const visited = new Uint8Array(width * height);
    const components: Array<{ pixels: Array<{ x: number; y: number }>; sumR: number; sumG: number; sumB: number }> = [];

    // 颜色阈值（可调）
    const colorThreshold = 30;

    const isSimilar = (c1: Uint8ClampedArray | number[], c2: Uint8ClampedArray | number[]) => {
      return (Math.abs(c1[0] - c2[0]) < colorThreshold &&
              Math.abs(c1[1] - c2[1]) < colorThreshold &&
              Math.abs(c1[2] - c2[2]) < colorThreshold);
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] === 0 || visited[idx]) continue;

        // BFS
        const queue: [number, number][] = [[x, y]];
        const regionPixels: Array<{ x: number; y: number }> = [];
        let sumR = 0, sumG = 0, sumB = 0;
        visited[idx] = 1;

        while (queue.length) {
          const [cx, cy] = queue.shift()!;
          const pixelIdx = cy * width + cx;
          const srcIdx = pixelIdx * 4;
          const r = colorData.data[srcIdx];
          const g = colorData.data[srcIdx+1];
          const b = colorData.data[srcIdx+2];
          if (colorData.data[srcIdx+3] < 128) continue;
          regionPixels.push({ x: cx / width, y: 1 - cy / height });
          sumR += r; sumG += g; sumB += b;

          // 8邻域
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
              const nIdx = ny * width + nx;
              if (mask[nIdx] === 0 || visited[nIdx]) continue;
              const nSrcIdx = nIdx * 4;
              const nr = colorData.data[nSrcIdx];
              const ng = colorData.data[nSrcIdx+1];
              const nb = colorData.data[nSrcIdx+2];
              if (isSimilar([r,g,b], [nr,ng,nb])) {
                visited[nIdx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }

        if (regionPixels.length > 0) {
          components.push({
            pixels: regionPixels,
            sumR, sumG, sumB,
          });
        }
      }
    }

    // 计算平均色并生成色块
    const result = components.map((comp, idx) => {
      const pixelCount = comp.pixels.length;
      const avgR = comp.sumR / pixelCount;
      const avgG = comp.sumG / pixelCount;
      const avgB = comp.sumB / pixelCount;
      return {
        id: idx + 1,
        avgColor: { r: avgR, g: avgG, b: avgB },
        pixels: comp.pixels,
      };
    });
    
    const endTime = performance.now();
    console.log(`[颜色提取] 连通区域标记完成，耗时: ${(endTime - startTime).toFixed(2)}ms, 提取到 ${result.length} 个色块`);
    if (result.length > 0) {
      console.log('[颜色提取] 色块详情:');
      result.forEach((block, idx) => {
        console.log(`  色块 ${idx + 1}: 像素数=${block.pixels.length}, 平均颜色=rgb(${Math.round(block.avgColor.r)}, ${Math.round(block.avgColor.g)}, ${Math.round(block.avgColor.b)})`);
      });
    }
    
    // 收集调试数据（用于 Ctrl+G 调试显示）
    const debugMaskPixels: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 1) {
        const x = (i % width) / width;
        const y = Math.floor(i / width) / height;
        debugMaskPixels.push({ x, y });
      }
    }
    
    const debugBlocks = result.map((block, idx) => ({
      id: idx + 1,
      color: `rgb(${Math.round(block.avgColor.r)}, ${Math.round(block.avgColor.g)}, ${Math.round(block.avgColor.b)})`,
      pixels: block.pixels,
    }));
    
    setColorExtractDebugData({ maskPixels: debugMaskPixels, blocks: debugBlocks });
    
    return result;
  }, []);

  // 主提取函数（将提取的颜色写入 paintBuffers）
  const performColorExtraction = useCallback((polygon: Point[]) => {
    console.log('[颜色提取] ==================== 开始颜色提取 ====================');
    const startTime = performance.now();
    
    if (polygon.length < 3) {
      console.warn('[颜色提取] 多边形点数不足3，无法提取');
      return;
    }

    // 1. 生成掩码
    const mask = rasterizePolygonMask(polygon, canvasWidth, canvasHeight);
    const maskPixelCount = mask.reduce((sum, val) => sum + val, 0);
    
    // 2. 获取当前画布颜色数据（背景 + 已有 buffer）
    const colorData = getWorldColorImageData();
    if (!colorData) {
      console.error('[颜色提取] 无法获取画布颜色数据');
      return;
    }

    // 3. 连通区域标记
    const blocks = extractConnectedComponents(mask, colorData, canvasWidth, canvasHeight);

    if (blocks.length === 0) {
      console.log('[颜色提取] 未提取到任何色块');
      return;
    }

    // 4. 将每个色块填充到 paintBuffer 中
    const layerId = activeLayerId || layers[0]?.id;
    if (!layerId) {
      console.error('[颜色提取] 没有活动图层');
      return;
    }

    // 确保 paintBuffer 存在
    if (!paintBuffers[layerId]) {
      initPaintBuffer(layerId);
    }

    // 统计总像素数
    const totalPixels = blocks.reduce((sum, block) => sum + block.pixels.length, 0);

    // 批量更新 buffer
    let writtenPixels = 0;
    updatePaintBuffer(layerId, (imgData) => {
      for (const block of blocks) {
        const { r, g, b } = block.avgColor;
        for (const pixel of block.pixels) {
          const px = Math.floor(pixel.x * PAINT_BUFFER_SIZE);
          const py = Math.floor((1 - pixel.y) * PAINT_BUFFER_SIZE);
          if (px >= 0 && px < PAINT_BUFFER_SIZE && py >= 0 && py < PAINT_BUFFER_SIZE) {
            const idx = (py * PAINT_BUFFER_SIZE + px) * 4;
            imgData.data[idx] = r;
            imgData.data[idx + 1] = g;
            imgData.data[idx + 2] = b;
            imgData.data[idx + 3] = 255;
            writtenPixels++;
          }
        }
      }
    });

    // 5. 保存历史，以便撤销
    saveHistory();

    // 6. 清空临时色块显示（不再需要覆盖层）
    setExtractedColorBlocks([]);

    // 7. 更新区域色块图层（使用 RegionEntity）
    if (layerId) {
      useAppStore.getState().refreshRegionEntities(layerId);
    }
  }, [canvasWidth, canvasHeight, rasterizePolygonMask, getWorldColorImageData, extractConnectedComponents, activeLayerId, layers, paintBuffers, initPaintBuffer, updatePaintBuffer, saveHistory, setExtractedColorBlocks, layerVisibility]);

  // 精确颜色提取：直接将区域内的每个像素颜色复制到 paintBuffer（不合并连通域）
  const performColorExtractionOnRegion = useCallback((regionPolygon: Point[][]) => {
    if (!regionPolygon || regionPolygon.length === 0) {
      console.warn('[颜色提取] 区域多边形为空，无法提取');
      return;
    }

    const startTime = performance.now();

    // 1. 生成掩码（包含边界）
    const mask = rasterizeRegionMask(regionPolygon, canvasWidth, canvasHeight);
    const maskPixelCount = mask.reduce((sum, val) => sum + val, 0);

    if (maskPixelCount === 0) {
      console.log('[颜色提取] 掩码内无像素');
      return;
    }

    // 2. 获取当前画布颜色数据（背景 + 已有 buffer）
    const colorData = getWorldColorImageData();
    if (!colorData) {
      console.error('[颜色提取] 无法获取画布颜色数据');
      return;
    }

    // 3. 精确复制像素到 paintBuffer（不再做连通域合并）
    const layerId = activeLayerId || layers[0]?.id;
    if (!layerId) {
      console.error('[颜色提取] 没有活动图层');
      return;
    }

    // 确保 paintBuffer 存在
    if (!paintBuffers[layerId]) {
      initPaintBuffer(layerId);
    }

    let writtenPixels = 0;
    updatePaintBuffer(layerId, (imgData) => {
      // 遍历所有像素，只处理掩码内的点
      for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
          const maskIdx = y * canvasWidth + x;
          if (mask[maskIdx] !== 1) continue;

          // 从 colorData 中获取精确颜色
          const colorIdx = maskIdx * 4;
          const r = colorData.data[colorIdx];
          const g = colorData.data[colorIdx + 1];
          const b = colorData.data[colorIdx + 2];
          const a = colorData.data[colorIdx + 3];
          if (a < 128) continue; // 忽略透明像素

          // 将当前像素的世界坐标映射到 paintBuffer 坐标（512x512）
          const worldX = x / canvasWidth;
          const worldY = 1 - y / canvasHeight; // Y轴翻转
          const px = Math.floor(worldX * PAINT_BUFFER_SIZE);
          const py = Math.floor((1 - worldY) * PAINT_BUFFER_SIZE);
          if (px >= 0 && px < PAINT_BUFFER_SIZE && py >= 0 && py < PAINT_BUFFER_SIZE) {
            const bufIdx = (py * PAINT_BUFFER_SIZE + px) * 4;
            imgData.data[bufIdx] = r;
            imgData.data[bufIdx + 1] = g;
            imgData.data[bufIdx + 2] = b;
            imgData.data[bufIdx + 3] = 255; // 完全不透明
            writtenPixels++;
          }
        }
      }
    });

    // 4. 保存历史，以便撤销
    saveHistory();

    // 5. 清空临时色块显示
    setExtractedColorBlocks([]);

    // 6. 更新区域色块图层（使用 RegionEntity）
    const currentLayerId = activeLayerId || layers[0]?.id;
    if (currentLayerId) {
      useAppStore.getState().refreshRegionEntities(currentLayerId);
    }
  }, [canvasWidth, canvasHeight, rasterizeRegionMask, getWorldColorImageData, activeLayerId, layers, paintBuffers, initPaintBuffer, updatePaintBuffer, saveHistory, setExtractedColorBlocks]);

  // 获取所有虚线形状（从全局 shapes 中筛选）
  const getDashedShapes = useCallback(() => {
    return shapes.filter((s: Shape) =>
      s.color === '#ffaa00' &&
      (s.type === 'polyline' || s.type === 'quadratic')
    );
  }, [shapes]);

  // 虚线添加/删除后同步刷新区域的函数
  const syncRefreshRegion = useCallback(async (layerId: string) => {
    if (!layerId) return;
    // ★ refreshRegionCache 已异步化（BFS 在 Worker），await 后 regionPolygonsCache + regionIdTexture
    //   均已在 refreshRegionCache 内部更新（flatRegionGrid 降采样，i+1 方案与旧 generateRegionIdTexture 一致）。
    //   不再外部调用 generateRegionIdTexture（点测试 50~100ms 主线程开销），BFS 降采样在 800+ 分辨率下边界误差 <1px。
    await refreshRegionCache(layerId, { clearPaintData: false });
  }, [refreshRegionCache]);

  // 监听虚线添加后的区域刷新
  useEffect(() => {
    // 每当 colorExtractCurves 变化时，延迟刷新区域以确保 shapes 已更新
    const timer = setTimeout(() => {
      const layerId = activeLayerId || layers[0]?.id;
      if (layerId && colorExtractCurves.length > 0) {
        syncRefreshRegion(layerId);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [colorExtractCurves, activeLayerId, layers, syncRefreshRegion]);

  // 监听手动触发颜色提取（必须在 performColorExtractionOnRegion 定义之后）
  useEffect(() => {
    if (pendingExtractPolygon && pendingExtractPolygon.length >= 3) {
      console.log('[颜色提取] 监听到手动提取请求，多边形点数:', pendingExtractPolygon.length);

      // 虚线已经永久保存在 shapes 中，直接获取 BFS 区域多边形
      const regionPoly = getRegionPolygonFromPoints(pendingExtractPolygon);
      if (regionPoly) {
        // 执行颜色提取
        performColorExtractionOnRegion(regionPoly);
        console.log('[颜色提取] BFS 区域颜色提取完成');
      } else {
        console.warn('[颜色提取] 无法定位到有效 BFS 区域，放弃提取');
        alert('当前虚线未落在任何有效闭合区域内，请确保虚线位于已有图形围成的封闭区域中。');
      }

      setPendingExtractPolygon(null);  // 清空触发器
    }
  }, [pendingExtractPolygon, performColorExtractionOnRegion, getRegionPolygonFromPoints, setPendingExtractPolygon]);

  // ========== 颜色提取：贝塞尔曲线提取函数 ==========
  const performBezierColorExtract = useCallback((points: Point[]) => {
    if (points.length !== 3) return;
    if (!activeLayerId) return;
    const [start, end, ctrl] = points;
    console.log('[颜色提取] 贝塞尔曲线已保存');
    console.log('  起点:', `(${start.x.toFixed(4)}, ${start.y.toFixed(4)})`);
    console.log('  终点:', `(${end.x.toFixed(4)}, ${end.y.toFixed(4)})`);
    console.log('  控制点:', `(${ctrl.x.toFixed(4)}, ${ctrl.y.toFixed(4)})`);

    // 永久保存贝塞尔曲线到 shapes（作为墙参与 BFS 区域划分）
    const shapeId = `extract_bezier_${Date.now()}`;
    const shape = {
      id: shapeId,
      groupId: activeGroupId || 'default',
      layerId: activeLayerId,
      type: 'quadratic' as const,
      points: [start, end, ctrl],
      color: '#ffaa00',
    };
    addShape(shape);

    // 保存曲线用于显示
    addColorExtractCurve({ type: 'bezier', start, end, control: ctrl, shapeId });
    console.log('[颜色提取] 贝塞尔曲线已保存到 shapes，虚线将持续存在');
    // 不触发提取，用户可以继续绘制多条贝塞尔曲线拼接，最后点击"提取颜色"按钮

    // 清空当前正在绘制的点，准备下一条
    clearColorExtractPoints();
    setColorExtractWaitingFor('start');
  }, [addShape, activeGroupId, activeLayerId, addColorExtractCurve, clearColorExtractPoints, setColorExtractWaitingFor]);

  // ========== 坐标转换函数 ==========
  const canvasToWorldFn = useCallback((canvasX: number, canvasY: number): Point => {
    return canvasToWorld(canvasX, canvasY, canvasWidth, canvasHeight, zoom, panOffset);
  }, [canvasWidth, canvasHeight, zoom, panOffset]);

  const worldToCanvasFn = useCallback((worldX: number, worldY: number): Point => {
    return worldToCanvas(worldX, worldY, canvasWidth, canvasHeight, { applyViewTransform: false });
  }, [canvasWidth, canvasHeight]);

  const worldToCanvasForSnap = useCallback((worldX: number, worldY: number): Point => {
    return worldToCanvas(worldX, worldY, canvasWidth, canvasHeight, { applyViewTransform: true }, zoom, panOffset);
  }, [canvasWidth, canvasHeight, zoom, panOffset]);

  // ========== 点吸附 ==========
  const snapToExistingPoint = useCallback((
    point: Point,
    toolType: string,
    currentPointCount: number
  ): Point => {
    if (!snapEnabled) return point;
    const shouldSnapNow = (() => {
      if (toolType === 'quadratic' && currentPointCount >= 2) return false;
      if (toolType === 'rectangle' && currentPointCount >= 2) return false;
      return true;
    })();
    if (!shouldSnapNow) return point;

    const canvasPoint = worldToCanvasForSnap(point.x, point.y);
    let bestMatch: Point | null = null;
    let bestDist = snapRadius;

    const candidateMap = new Map<string, Point>();
    const addCandidate = (p: Point) => {
      const key = `${Math.round(p.x * 1e6)}_${Math.round(p.y * 1e6)}`;
      if (!candidateMap.has(key)) candidateMap.set(key, p);
    };

    for (const shape of shapes) {
      if (shape.id === 'current_shape') continue;
      shape.points.forEach(p => addCandidate(p));
      if (shape.type === 'rectangle' && shape.points.length >= 2) {
        const p1 = shape.points[0];
        const p2 = shape.points[1];
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        addCandidate({ x: minX, y: minY });
        addCandidate({ x: maxX, y: minY });
        addCandidate({ x: maxX, y: maxY });
        addCandidate({ x: minX, y: maxY });
      }
    }

    if (toolType !== 'rectangle') {
      tempPoints.forEach(p => addCandidate(p));
    }

    for (const p of candidateMap.values()) {
      const pCanvas = worldToCanvasForSnap(p.x, p.y);
      const dist = Math.hypot(canvasPoint.x - pCanvas.x, canvasPoint.y - pCanvas.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = p;
      }
    }
    return bestMatch || point;
  }, [snapEnabled, snapRadius, shapes, tempPoints, worldToCanvasForSnap]);

  // ========== 颜色提取模式预览专用吸附（只吸附到虚线顶点）==========
  const snapColorExtractPreview = useCallback((point: Point, currentPointCount: number): Point => {
    if (!snapEnabled) return point;
    
    const canvasPoint = worldToCanvasForSnap(point.x, point.y);
    let bestMatch: Point | null = null;
    let bestDist = snapRadius;

    const candidateMap = new Map<string, Point>();
    const addCandidate = (p: Point) => {
      const key = `${Math.round(p.x * 1e6)}_${Math.round(p.y * 1e6)}`;
      if (!candidateMap.has(key)) candidateMap.set(key, p);
    };

    // 吸附到已绘制的颜色提取曲线顶点
    for (const curve of colorExtractCurves) {
      if (curve.type === 'bezier') {
        // 贝塞尔曲线：吸附到起点、终点、控制点
        addCandidate(curve.start);
        addCandidate(curve.end);
        addCandidate(curve.control);
      } else if (curve.type === 'polyline') {
        // 折线：吸附到所有顶点
        for (const p of curve.points) {
          addCandidate(p);
        }
      }
    }

    // 吸附到当前正在绘制的点（折线和贝塞尔模式都支持）
    // 这样第一个点也能吸附到已有虚线顶点，后续点也能吸附到当前正在绘制的点
    for (const p of colorExtractPoints) {
      addCandidate(p);
    }

    for (const p of candidateMap.values()) {
      const pCanvas = worldToCanvasForSnap(p.x, p.y);
      const dist = Math.hypot(canvasPoint.x - pCanvas.x, canvasPoint.y - pCanvas.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = p;
      }
    }
    return bestMatch || point;
  }, [snapEnabled, snapRadius, colorExtractCurves, colorExtractPoints, worldToCanvasForSnap]);

  // ========== 查找图形上的点/边（用于注释）==========
  const findShapeAtPoint = useCallback((x: number, y: number) => {
    const hitRadius = snapRadius / zoom;
    for (const shape of shapes) {
      if (shape.id === 'current_shape') continue;
      for (let i = 0; i < shape.points.length; i++) {
        const p = shape.points[i];
        const distance = Math.hypot(x - p.x, y - p.y);
        if (distance < hitRadius) return { shape, pointIndex: i };
      }
      if (shape.points.length >= 2) {
        const p1 = shape.points[0];
        const p2 = shape.points[shape.points.length - 1];
        const lineLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (lineLength > 0) {
          const t = Math.max(0, Math.min(1, 
            ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / (lineLength * lineLength)
          ));
          const closestX = p1.x + t * (p2.x - p1.x);
          const closestY = p1.y + t * (p2.y - p1.y);
          const distance = Math.hypot(x - closestX, y - closestY);
          if (distance < hitRadius) return { shape, pointIndex: undefined };
        }
      }
    }
    return null;
  }, [shapes, snapRadius, zoom]);

  // ========== 区域检测（用于注释闭合区域）==========
  const getShapeBounds = (shape: Shape) => {
    if (shape.points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of shape.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  };

  const isClosedShape = (shape: Shape): boolean => {
    if (['circle', 'rectangle', 'triangle'].includes(shape.type)) return true;
    if (['line', 'brush', 'quadratic'].includes(shape.type) && shape.points.length >= 3) {
      const first = shape.points[0], last = shape.points[shape.points.length - 1];
      return Math.hypot(first.x - last.x, first.y - last.y) < 10;
    }
    return false;
  };

  const isPointInPolygon = (point: Point, vertices: Point[]): boolean => {
    let inside = false;
    const n = vertices.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = vertices[i].x, yi = vertices[i].y;
      const xj = vertices[j].x, yj = vertices[j].y;
      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };

  const getShapeVertices = (shape: Shape): Point[] => {
    switch (shape.type) {
      case 'circle': {
        const cx = shape.points[0].x, cy = shape.points[0].y;
        const radius = Math.hypot(shape.points[1].x - cx, shape.points[1].y - cy);
        const vertices: Point[] = [];
        const segments = 32;
        for (let i = 0; i < segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          vertices.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
        }
        return vertices;
      }
      case 'rectangle': {
        const p1 = shape.points[0], p2 = shape.points[1];
        return [{ x: p1.x, y: p1.y }, { x: p2.x, y: p1.y }, { x: p2.x, y: p2.y }, { x: p1.x, y: p2.y }];
      }
      case 'triangle': return shape.points.slice(0, 3);
      default: return shape.points;
    }
  };

  const getShapeArea = (shape: Shape): number => {
    switch (shape.type) {
      case 'circle': {
        const cx = shape.points[0].x, cy = shape.points[0].y;
        const radius = Math.hypot(shape.points[1].x - cx, shape.points[1].y - cy);
        return Math.PI * radius * radius;
      }
      case 'rectangle': {
        const p1 = shape.points[0], p2 = shape.points[1];
        return Math.abs(p2.x - p1.x) * Math.abs(p2.y - p1.y);
      }
      case 'triangle': {
        if (shape.points.length < 3) return 0;
        const [a, b, c] = shape.points;
        return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
      }
      default: {
        const vertices = getShapeVertices(shape);
        if (vertices.length < 3) return 0;
        let area = 0;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
          area += vertices[j].x * vertices[i].y - vertices[j].y * vertices[i].x;
        }
        return Math.abs(area / 2);
      }
    }
  };

  const isPointInsideShape = (point: Point, shape: Shape): boolean => {
    switch (shape.type) {
      case 'circle': {
        const center = shape.points[0];
        const radius = Math.hypot(shape.points[1].x - center.x, shape.points[1].y - center.y);
        return Math.hypot(point.x - center.x, point.y - center.y) <= radius;
      }
      case 'rectangle': {
        const p1 = shape.points[0], p2 = shape.points[1];
        const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
        return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
      }
      case 'triangle': {
        if (shape.points.length < 3) return false;
        const [a, b, c] = shape.points;
        const v1 = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        const v2 = (c.x - b.x) * (point.y - b.y) - (c.y - b.y) * (point.x - b.x);
        const v3 = (a.x - c.x) * (point.y - c.y) - (a.y - c.y) * (point.x - c.x);
        const hasNeg = (v1 < 0) || (v2 < 0) || (v3 < 0);
        const hasPos = (v1 > 0) || (v2 > 0) || (v3 > 0);
        return !(hasNeg && hasPos);
      }
      default: return isPointInPolygon(point, getShapeVertices(shape));
    }
  };

  const detectRegionAtPoint = useCallback((worldX: number, worldY: number) => {
    const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
    const closedShapes = currentLayerShapes.filter(s => isClosedShape(s));
    if (closedShapes.length === 0) return null;
    const hitShapes: Shape[] = [];
    for (const shape of closedShapes) {
      if (isPointInsideShape({ x: worldX, y: worldY }, shape)) hitShapes.push(shape);
    }
    if (hitShapes.length === 0) return null;
    hitShapes.sort((a, b) => getShapeArea(a) - getShapeArea(b));
    const targetShape = hitShapes[0];
    return { shapeIds: [targetShape.id], bounds: getShapeBounds(targetShape), type: 'closed' as const, shape: targetShape };
  }, [shapes, activeLayerId]);

  // ========== 橡皮擦核心：检测给定画布像素坐标下需要擦除的图形ID ==========
  const getShapesToEraseAtPoint = useCallback((canvasX: number, canvasY: number): string[] => {
    const state = useAppStore.getState();
    const currentLayerId = state.activeLayerId || state.layers[0]?.id;
    if (!currentLayerId) return [];

    const shapesInLayer = state.shapes.filter(
      s => s.layerId === currentLayerId && s.id !== 'current_shape'
    );
    const toEraseIds: string[] = [];

    for (const shape of shapesInLayer) {
      // 如果本次会话已经删除过则跳过
      if (erasedShapesThisSessionRef.current.has(shape.id)) continue;

      const pointsCanvas = shape.points.map(p => worldToCanvasForSnap(p.x, p.y));
      let hit = false;

      switch (shape.type) {
        case 'point':
          if (pointsCanvas.length > 0) {
            const dist = Math.hypot(canvasX - pointsCanvas[0].x, canvasY - pointsCanvas[0].y);
            if (dist < snapRadius) hit = true;
          }
          break;
        case 'line':
          if (pointsCanvas.length >= 2) {
            const [p1, p2] = pointsCanvas;
            const dist = distanceToLineSegment(canvasX, canvasY, p1.x, p1.y, p2.x, p2.y);
            if (dist < snapRadius) hit = true;
          }
          break;
        case 'rectangle':
          if (pointsCanvas.length >= 2) {
            const [p1, p2] = pointsCanvas;
            const left = Math.min(p1.x, p2.x), right = Math.max(p1.x, p2.x);
            const top = Math.min(p1.y, p2.y), bottom = Math.max(p1.y, p2.y);
            if (distanceToLineSegment(canvasX, canvasY, left, top, right, top) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, right, top, right, bottom) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, right, bottom, left, bottom) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, left, bottom, left, top) < snapRadius) {
              hit = true;
            }
          }
          break;
        case 'circle':
          if (pointsCanvas.length >= 2) {
            const center = pointsCanvas[0], edge = pointsCanvas[1];
            const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
            const distToCenter = Math.hypot(canvasX - center.x, canvasY - center.y);
            if (Math.abs(distToCenter - radius) < snapRadius) hit = true;
          }
          break;
        case 'triangle':
          if (pointsCanvas.length >= 3) {
            const [p1, p2, p3] = pointsCanvas;
            if (distanceToLineSegment(canvasX, canvasY, p1.x, p1.y, p2.x, p2.y) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, p2.x, p2.y, p3.x, p3.y) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, p3.x, p3.y, p1.x, p1.y) < snapRadius) {
              hit = true;
            }
          }
          break;
        case 'quadratic':
          if (shape.points.length >= 3) {
            const [p0, p1, ctrl] = shape.points;
            const samples = sampleQuadraticCurve(p0, p1, ctrl, 30);
            const sampleCanvas = samples.map(p => worldToCanvasForSnap(p.x, p.y));
            for (let i = 0; i < sampleCanvas.length - 1; i++) {
              const a = sampleCanvas[i], b = sampleCanvas[i+1];
              const dist = distanceToLineSegment(canvasX, canvasY, a.x, a.y, b.x, b.y);
              if (dist < snapRadius) { hit = true; break; }
            }
          }
          break;
        case 'brush':
          if (pointsCanvas.length >= 2) {
            for (let i = 0; i < pointsCanvas.length - 1; i++) {
              const a = pointsCanvas[i], b = pointsCanvas[i+1];
              const dist = distanceToLineSegment(canvasX, canvasY, a.x, a.y, b.x, b.y);
              if (dist < snapRadius) { hit = true; break; }
            }
          } else if (pointsCanvas.length === 1) {
            const dist = Math.hypot(canvasX - pointsCanvas[0].x, canvasY - pointsCanvas[0].y);
            if (dist < snapRadius) hit = true;
          }
          break;
      }

      if (hit) toEraseIds.push(shape.id);
    }
    return toEraseIds;
  }, [snapRadius, worldToCanvasForSnap]);

  // 执行擦除（更新 store 和本地会话记录）
  const eraseShapes = useCallback((idsToErase: string[]) => {
    if (idsToErase.length === 0) return;
    useAppStore.setState(state => ({
      shapes: state.shapes.filter(s => !idsToErase.includes(s.id)),
    }));
    // 记录已删除的ID，防止同一会话中重复检测
    idsToErase.forEach(id => erasedShapesThisSessionRef.current.add(id));
  }, []);

  // 点-多边形包含测试（射线法）
  const pointInPolygon = useCallback((px: number, py: number, polygon: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }, []);

  // 获取鼠标位置下可擦除的注释
  const getAnnotationsToEraseAtPoint = useCallback((canvasX: number, canvasY: number): string[] => {
    const state = useAppStore.getState();
    const currentLayerId = state.activeLayerId || state.layers[0]?.id;
    if (!currentLayerId) return [];

    const toEraseIds: string[] = [];

    // 检测点注释
    for (const anno of state.pointAnnotations) {
      if (anno.layerId !== currentLayerId) continue;
      if (erasedAnnotationsThisSessionRef.current.has(anno.id)) continue;
      const canvasPos = worldToCanvasForSnap(anno.position.x, anno.position.y);
      const dist = Math.hypot(canvasX - canvasPos.x, canvasY - canvasPos.y);
      if (dist < snapRadius) {
        toEraseIds.push(anno.id);
      }
    }

    // 检测区域注释
    for (const anno of state.regionAnnotations) {
      if (anno.layerId !== currentLayerId) continue;
      if (erasedAnnotationsThisSessionRef.current.has(anno.id)) continue;
      const worldPt = canvasToWorldFn(canvasX, canvasY);
      // 检查外环
      const outerRing = anno.polygon[0];
      if (!outerRing || outerRing.length < 3) continue;
      if (pointInPolygon(worldPt.x, worldPt.y, outerRing)) {
        toEraseIds.push(anno.id);
      }
    }

    return toEraseIds;
  }, [snapRadius, worldToCanvasForSnap, canvasToWorldFn, pointInPolygon]);

  // 执行擦除注释
  const eraseAnnotations = useCallback((idsToErase: string[]) => {
    if (idsToErase.length === 0) return;
    useAppStore.setState(state => ({
      pointAnnotations: state.pointAnnotations.filter(a => !idsToErase.includes(a.id)),
      regionAnnotations: state.regionAnnotations.filter(a => !idsToErase.includes(a.id)),
    }));
    idsToErase.forEach(id => erasedAnnotationsThisSessionRef.current.add(id));
  }, []);

  // ========== 绘图函数 ==========
  const drawShapeHighlight = (ctx: CanvasRenderingContext2D, shape: Shape) => {
    const points = shape.points;
    switch (shape.type) {
      case 'circle':
        if (points.length >= 2) {
          const center = worldToCanvasFn(points[0].x, points[0].y);
          const edge = worldToCanvasFn(points[1].x, points[1].y);
          const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
          ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        break;
      case 'rectangle':
        if (points.length >= 2) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y);
          ctx.fillRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
          ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
        }
        break;
      case 'triangle':
        if (points.length >= 3) {
          ctx.beginPath();
          const p1 = worldToCanvasFn(points[0].x, points[0].y); ctx.moveTo(p1.x, p1.y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y); ctx.lineTo(p2.x, p2.y);
          const p3 = worldToCanvasFn(points[2].x, points[2].y); ctx.lineTo(p3.x, p3.y); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
        break;
      case 'quadratic':
        if (points.length >= 3) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y);
          const ctrl = worldToCanvasFn(points[2].x, points[2].y);
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y);
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y);
          ctx.lineTo(p2.x, p2.y); ctx.lineTo(p1.x, p1.y); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
        break;
      default:
        if (points.length >= 2) {
          ctx.beginPath();
          const p1 = worldToCanvasFn(points[0].x, points[0].y); ctx.moveTo(p1.x, p1.y);
          for (let i = 1; i < points.length; i++) {
            const p = worldToCanvasFn(points[i].x, points[i].y); ctx.lineTo(p.x, p.y);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        break;
    }
  };

  const drawShape = useCallback((ctx: CanvasRenderingContext2D, shape: Shape, isPreview = false) => {
    const points = shape.points;
    const color = isPreview ? '#666' : (shape.color || '#ff0000');
    
    // 虚线形状（颜色 '#ffaa00'）需要设置虚线样式
    const isDashed = color === '#ffaa00';
    
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    
    // 设置虚线样式
    if (isDashed) {
      ctx.setLineDash([8, 6]);
    } else {
      ctx.setLineDash([]);
    }

    switch (shape.type) {
      case 'point':
        if (points.length > 0) {
          const p = worldToCanvasFn(points[0].x, points[0].y);
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'line':
        if (points.length >= 2 && lineWidth > 0.01) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y);
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
        break;
      case 'rectangle':
        if (points.length >= 2 && lineWidth > 0.01) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y);
          ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
        }
        break;
      case 'circle':
        if (points.length >= 2 && lineWidth > 0.01) {
          const center = worldToCanvasFn(points[0].x, points[0].y);
          const edge = worldToCanvasFn(points[1].x, points[1].y);
          const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
          ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2); ctx.stroke();
        }
        break;
      case 'triangle':
        if (points.length >= 1) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          if (points.length === 1) { ctx.beginPath(); ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2); ctx.fill(); }
          else if (points.length === 2 && lineWidth > 0.01) {
            const p2 = worldToCanvasFn(points[1].x, points[1].y);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          } else if (lineWidth > 0.01) {
            const p2 = worldToCanvasFn(points[1].x, points[1].y);
            const p3 = worldToCanvasFn(points[2].x, points[2].y);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath(); ctx.stroke();
          }
        }
        break;
      case 'quadratic':
        if (points.length >= 1) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          if (points.length === 1) { ctx.beginPath(); ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2); ctx.fill(); }
          else if (points.length === 2 && lineWidth > 0.01) {
            const p2 = worldToCanvasFn(points[1].x, points[1].y);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          } else if (lineWidth > 0.01) {
            const p2 = worldToCanvasFn(points[1].x, points[1].y);
            const ctrl = worldToCanvasFn(points[2].x, points[2].y);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y); ctx.stroke();
          }
        }
        break;
      case 'brush':
        if (points.length >= 2 && lineWidth > 0.01) {
          ctx.beginPath();
          const start = worldToCanvasFn(points[0].x, points[0].y); ctx.moveTo(start.x, start.y);
          for (let i = 1; i < points.length; i++) {
            const p = worldToCanvasFn(points[i].x, points[i].y); ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        } else if (points.length === 1) {
          const p = worldToCanvasFn(points[0].x, points[0].y);
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'polygon':
        if (points.length >= 3) {
          const canvasPoints = points.map(p => worldToCanvasFn(p.x, p.y));
          ctx.beginPath();
          ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
          for (let i = 1; i < canvasPoints.length; i++) {
            ctx.lineTo(canvasPoints[i].x, canvasPoints[i].y);
          }
          ctx.closePath();
          if (shape.fillOnly) {
            ctx.fillStyle = color;
            ctx.fill();
            if (lineWidth > 0.01) {
              ctx.strokeStyle = color;
              ctx.stroke();
            }
          } else {
            ctx.fillStyle = color + '20';
            ctx.fill();
            if (lineWidth > 0.01) ctx.stroke();
          }
        }
        break;
    }

    // 恢复实线样式，避免影响其他绘制
    ctx.setLineDash([]);
  }, [worldToCanvasFn, lineWidth, currentColor]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 使用全局画布尺寸
    const currentWidth = canvasWidth;
    const currentHeight = canvasHeight;

    ctx.clearRect(0, 0, currentWidth, currentHeight);
    ctx.save();
    ctx.translate(currentWidth / 2 + panOffset.x, currentHeight / 2 + panOffset.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-currentWidth / 2, -currentHeight / 2);

    // 绘制图片图层
    if (layerVisibility.imageLayer && imageState.originalImage && imageState.imageSrc) {
      const imageLayer = layers.find(l => l.id === imageState.imageLayerId);
      const isImageLayerVisible = imageLayer?.visible ?? false;
      if (isImageLayerVisible) {
        ctx.globalAlpha = imageLayer?.opacity ?? 0.5;
        const img = imageState.originalImage;
        
        // 保存当前状态
        ctx.save();
        
        // 应用背景层变换
        const bgOffsetX = imageState.offsetX ?? 0;
        const bgOffsetY = imageState.offsetY ?? 0;
        const bgScale = imageState.scale ?? 1;
        
        // 计算图片绘制位置（居中基础上应用变换）
        let drawWidth: number, drawHeight: number, offsetX: number, offsetY: number;
        
        if (imageState.selectionRect) {
          const sel = imageState.selectionRect;
          const scaleX = currentWidth / sel.width, scaleY = currentHeight / sel.height;
          const fitScale = Math.min(scaleX, scaleY);
          drawWidth = sel.width * fitScale * bgScale;
          drawHeight = sel.height * fitScale * bgScale;
          offsetX = (currentWidth - drawWidth) / 2 + bgOffsetX;
          offsetY = (currentHeight - drawHeight) / 2 + bgOffsetY;
          ctx.drawImage(img, sel.x, sel.y, sel.width, sel.height, offsetX, offsetY, drawWidth, drawHeight);
        } else {
          const fitScale = Math.min(currentWidth / img.width, currentHeight / img.height);
          drawWidth = img.width * fitScale * bgScale;
          drawHeight = img.height * fitScale * bgScale;
          offsetX = (currentWidth - drawWidth) / 2 + bgOffsetX;
          offsetY = (currentHeight - drawHeight) / 2 + bgOffsetY;
          ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        }
        
        // 恢复状态
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // ===== 2. 绘制帧图层（位于图片图层之上，绘制图层之下）=====
    const layerId = activeLayerId || layers[0]?.id;
    const activeLayer = layers.find(l => l.id === layerId);
    
    if (layerVisibility.frameLayer && activeLayer?.visible) {
      const frameData = layerId ? frameDataMap[layerId] : null;
      if (frameData) {
        // ★ 优先使用绑定后的纹理
        let textureToDraw = frameData.boundBaseTexture || frameData.baseTexture;

        // 如果两者都为空但有原始数据，显示占位提示
        if (!textureToDraw && frameData.rawRegionIdTex) {
          ctx.save();
          ctx.fillStyle = 'rgba(40, 40, 60, 0.8)';
          ctx.fillRect(0, 0, currentWidth, currentHeight);
          ctx.fillStyle = '#aaa';
          ctx.font = '16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const status = frameData.boundRegionId !== null ? '已绑定但纹理为空' : '未绑定区域';
          ctx.fillText(`📦 帧数据已导入，${status}`, currentWidth / 2, currentHeight / 2 - 10);
          ctx.font = '12px sans-serif';
          ctx.fillStyle = '#888';
          ctx.fillText('请在图层面板中选择区域进行绑定', currentWidth / 2, currentHeight / 2 + 24);
          ctx.restore();
        }

        if (textureToDraw) {
          ctx.save();
          ctx.globalAlpha = (layers.find(l => l.id === layerId)?.opacity ?? 1);

          // ★ 关键修复：已绑定时，使用 drawImage 替代 putImageData，使纹理跟随视图变换
          if (frameData.boundRegionId !== null) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = textureToDraw.width;
            tempCanvas.height = textureToDraw.height;
            tempCanvas.getContext('2d')!.putImageData(textureToDraw, 0, 0);
            ctx.drawImage(tempCanvas, 0, 0, currentWidth, currentHeight);
          } else {
            // 未绑定或预览，使用 drawImage 拉伸
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = textureToDraw.width;
            tempCanvas.height = textureToDraw.height;
            tempCanvas.getContext('2d')!.putImageData(textureToDraw, 0, 0);

            // 如果未绑定且存在 rawBbox，则只绘制 bbox 区域（画布尺寸已等于 bbox 尺寸）
            if (frameData.rawBbox) {
              const bbox = frameData.rawBbox;
              ctx.drawImage(
                tempCanvas,
                bbox.x, bbox.y, bbox.w, bbox.h,  // source
                0, 0, currentWidth, currentHeight  // dest（画布 = bbox 尺寸，1:1 映射）
              );
            } else {
              ctx.drawImage(tempCanvas, 0, 0, currentWidth, currentHeight);
            }
          }

          ctx.restore();

          // 绘制 bbox 边框作为视觉提示
          if (frameData.rawBbox) {
            const b = frameData.rawBbox;
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            // 画布尺寸已等于 bbox 尺寸，直接全画布绘制边框
            ctx.strokeRect(0, 0, currentWidth, currentHeight);
            ctx.restore();
          }

          // 绑定状态标签
          if (frameData.boundRegionId !== null) {
            ctx.save();
            ctx.fillStyle = 'rgba(82, 196, 26, 0.9)';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(`✅ 已绑定区域 #${frameData.boundRegionId}`, 8, 8);
            ctx.restore();
          } else {
            ctx.save();
            ctx.fillStyle = 'rgba(250, 173, 20, 0.9)';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText('📦 预览模式 (未绑定)', 8, 8);
            ctx.restore();
          }
        }
      }
    }

    // ===== 3. 绘制绘制图层（像素缓冲区）=====
    const buffer = paintBuffers[layerId];
    if (buffer && layerVisibility.drawLayer) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = buffer.width;
      tempCanvas.height = buffer.height;
      tempCanvas.getContext('2d')!.putImageData(buffer, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0, currentWidth, currentHeight);
    }

    // 坐标轴与格子
    if (layerVisibility.axisLayer && grid.visible) {
      ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1;
      for (let i = 0; i <= grid.cols; i++) {
        // 将网格位置从世界坐标 [0,1] 映射到画布
        const worldX = i / grid.cols;
        const pos = worldX * currentWidth;
        ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, currentHeight); ctx.stroke();
        
        // 绘制网格标签（使用 axis 范围显示）
        const axisPos = worldToAxis(worldX, 0, axis);
        ctx.fillStyle = '#999'; ctx.font = '10px monospace';
        ctx.fillText(axisPos.x.toFixed(1), pos - 15, 12);
      }
      for (let i = 0; i <= grid.rows; i++) {
        // 将网格位置从世界坐标 [0,1] 映射到画布
        const worldY = i / grid.rows;
        const pos = worldY * currentHeight;
        ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(currentWidth, pos); ctx.stroke();
        
        // 绘制网格标签（使用 axis 范围显示）
        const axisPos = worldToAxis(0, worldY, axis);
        ctx.fillStyle = '#999'; ctx.font = '10px monospace';
        ctx.fillText(axisPos.y.toFixed(1), 2, pos + 4);
      }
      
      // 中心十字线（世界坐标 0.5 对应画布中心）
      const centerX = currentWidth / 2;
      const centerY = currentHeight / 2;
      ctx.strokeStyle = '#000000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, centerY); ctx.lineTo(currentWidth, centerY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(centerX, 0); ctx.lineTo(centerX, currentHeight); ctx.stroke();
      
      // 轴标签（显示 axis 范围）
      ctx.fillStyle = '#666'; ctx.font = '12px monospace';
      ctx.fillText(`X: ${axis.xMin.toFixed(2)}`, 5, 18);
      ctx.fillText(`X: ${axis.xMax.toFixed(2)}`, currentWidth - 45, 18);
      ctx.fillText(`Y: ${axis.yMax.toFixed(2)}`, 5, 30);
      ctx.fillText(`Y: ${axis.yMin.toFixed(2)}`, 5, currentHeight - 5);
    }

    // 绘制普通图形（按图层分组，应用可见性和透明度）
    if (layerVisibility.drawLayer) {
      layers.forEach(layer => {
        if (!layer.visible) return;
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        shapes.forEach(shape => {
          if (shape.layerId === layer.id && shape.id !== 'current_shape') {
            drawShape(ctx, shape);
          }
        });
        ctx.restore();
      });

      ctx.globalAlpha = 1;
      // 绘制临时图形（绘制中）
      if (tempPoints.length > 0) {
        const tempShape: Shape = { id: 'temp', groupId: 'temp', layerId: activeLayerId!, type: currentTool as any, points: tempPoints, color: '#666' };
        drawShape(ctx, tempShape, true);
        if (previewPoint) {
          const previewShape: Shape = { id: 'preview', groupId: 'temp', layerId: activeLayerId!, type: currentTool as any, points: [...tempPoints, previewPoint], color: '#999' };
          drawShape(ctx, previewShape, true);
        }
      }
    }

    // 绘制点注释
    if (layerVisibility.drawLayer) {
      pointAnnotations.forEach(anno => {
        if (anno.layerId !== activeLayerId) return;
        const canvasPos = worldToCanvasFn(anno.position.x, anno.position.y);
        ctx.save();
        // 使用注释的颜色
        const color = anno.color || '#ff4d4f';
        ctx.fillStyle = color;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📍', canvasPos.x, canvasPos.y);
        ctx.fillStyle = color;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(anno.text.length > 15 ? anno.text.slice(0, 12) + '...' : anno.text, canvasPos.x + 10, canvasPos.y - 5);
        ctx.restore();
      });
    }

    // 绘制区域注释（受 activeLayer 可见性和透明度控制）
    if (layerVisibility.drawLayer && activeLayer?.visible) {
      regionAnnotations.forEach(anno => {
        if (anno.layerId !== activeLayerId) return;
        
        // 如果启用了蒙版特效且区域色块图层可见，跳过（边框在 regionLayer 中绘制）
        if (anno.maskEffect?.enabled && layerVisibility.regionLayer) return;
        
        ctx.save();
        ctx.globalAlpha = activeLayer.opacity;
        
        // 【调试】输出 2D Canvas 绘制坐标信息
        const outerRing = anno.polygon[0];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of outerRing) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        const color = anno.color || '#1890ff';
        ctx.fillStyle = color.replace(/rgb\(|#/, '').length === 6 
          ? `rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, 0.2)` 
          : 'rgba(24, 144, 255, 0.2)';
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        
        // 不应用扭曲（原始形状）
        for (const ring of anno.polygon) {
          if (ring.length < 3) continue;
          const canvasRing = ring.map(p => worldToCanvasFn(p.x, p.y));
          ctx.moveTo(canvasRing[0].x, canvasRing[0].y);
          for (let i = 1; i < canvasRing.length; i++) {
            ctx.lineTo(canvasRing[i].x, canvasRing[i].y);
          }
          ctx.closePath();
        }
        ctx.fill('evenodd');
        if (lineWidth > 0.01 && showRegionBorder2D) {
          ctx.stroke();
        }
        
        // 计算标签位置
        let labelMinX = Infinity, labelMinY = Infinity;
        for (const p of outerRing) {
          if (p.x < labelMinX) labelMinX = p.x;
          if (p.y < labelMinY) labelMinY = p.y;
        }
        const labelPos = worldToCanvasFn(labelMinX, labelMinY);
        ctx.fillStyle = color;
        ctx.font = '12px sans-serif';
        ctx.shadowBlur = 0;
        ctx.fillText(anno.text.length > 20 ? anno.text.slice(0, 17) + '...' : anno.text, labelPos.x + 5, labelPos.y - 5);
        ctx.restore();
      });
    }

    // ========== 区域色块图层已由 WebGL VAT+模板缓冲渲染，2D Canvas 不再负责 ==========

    // ========== 调试：BFS区域绘制（使用缓存数据）==========
    if (showDebugRegions && layerVisibility.drawLayer) {
      const debugRegions = debugRegionsCache.current;
      if (!debugRegions || debugRegions.length === 0) return;

      const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da'];

      debugRegions.forEach((region, idx) => {
          if (debugRegionId !== 0 && region.id !== debugRegionId) return;
          ctx.save();
          const color = colors[idx % colors.length];

          // 绘制边界点（不按 outsideId 分组，统一颜色）
          const hasPoints = region.boundaryPoints && region.boundaryPoints.length > 0;
          if (hasPoints && !debugShowRings) {
            ctx.fillStyle = color;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;

            for (const bp of region.boundaryPoints) {
              const canvasPoint = worldToCanvasFn(bp.point.x, bp.point.y);
              ctx.beginPath();
              ctx.arc(canvasPoint.x, canvasPoint.y, 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }

            if (region.centroid) {
              const centroidCanvas = worldToCanvasFn(region.centroid.x, region.centroid.y);
              ctx.fillStyle = '#ff0000';
              ctx.beginPath();
              ctx.arc(centroidCanvas.x, centroidCanvas.y, 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.font = 'bold 10px monospace';
              ctx.fillText('重心', centroidCanvas.x + 8, centroidCanvas.y - 8);
            }
          }

          // 绘制环（与正式区域注释算法一致的环）
          if (debugShowRings) {
            if (region.rings && region.rings.length > 0) {
              const ringColors = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff', '#ff8800', '#8800ff', '#ffff00'];
              region.rings.forEach((ring, ringIdx) => {
                if (ring.length < 3) return;
                const ringColor = ringColors[ringIdx % ringColors.length];
                ctx.strokeStyle = ringColor;
                ctx.fillStyle = ringColor + '30';
                ctx.lineWidth = 3;
                ctx.beginPath();
                for (let i = 0; i < ring.length; i++) {
                  const cp = worldToCanvasFn(ring[i].x, ring[i].y);
                  if (i === 0) ctx.moveTo(cp.x, cp.y);
                  else ctx.lineTo(cp.x, cp.y);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                const midIdx = Math.floor(ring.length / 2);
                const midPoint = worldToCanvasFn(ring[midIdx].x, ring[midIdx].y);
                ctx.fillStyle = ringColor;
                ctx.font = 'bold 12px monospace';
                ctx.fillText(`环${ringIdx}(${ring.length})`, midPoint.x, midPoint.y);
              });
            }
          }

          ctx.restore();
        });
    }

    // ========== 调试：绘制原始网格单元格（BFS搜索范围）==========
    if (showGridCells && layerVisibility.drawLayer) {
      const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
      if (currentLayerShapes.length > 0) {
        // 调试网格可视化用画布范围 [0,1]（扩大范围会导致背景大区域填充变黑）
        const worldBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
        const gridData = computeGridRegions(currentLayerShapes, worldBounds, 100);
        const { regionIdGrid, stepX, stepY, xMin, yMin, resolution, regions, wallRegions } = gridData;

        const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da'];
        const wallColors = ['#8b0000', '#006400', '#00008b', '#8b008b', '#8b4513', '#2f4f4f', '#556b2f', '#483d8b', '#008080', '#800000'];

        // 绘制所有墙区域的单元格（负ID）
        if (wallRegions && wallRegions.length > 0) {
          wallRegions.forEach(wallRegion => {
            ctx.save();
            const colorIdx = Math.abs(wallRegion.id + 1) % wallColors.length;
            const color = wallColors[colorIdx];
            ctx.fillStyle = color + 'cc'; // 较高不透明度

            wallRegion.cells.forEach(cell => {
              const worldX = xMin + cell.j * stepX;
              const worldY = yMin + cell.i * stepY;
              const canvasTL = worldToCanvasFn(worldX, worldY);
              const canvasBR = worldToCanvasFn(worldX + stepX, worldY + stepY);

              ctx.fillRect(canvasTL.x, canvasTL.y, canvasBR.x - canvasTL.x, canvasBR.y - canvasTL.y);
            });
            ctx.restore();
          });
        }

        // 绘制所有区域的单元格
        regions.forEach(region => {
          ctx.save();
          const color = colors[region.id % colors.length];
          ctx.fillStyle = color + '60'; // 60%透明度

          region.cells.forEach(cell => {
            const worldX = xMin + cell.j * stepX;
            const worldY = yMin + cell.i * stepY;
            const canvasTL = worldToCanvasFn(worldX, worldY);
            const canvasBR = worldToCanvasFn(worldX + stepX, worldY + stepY);

            ctx.fillRect(canvasTL.x, canvasTL.y, canvasBR.x - canvasTL.x, canvasBR.y - canvasTL.y);
          });
          ctx.restore();
        });

        // 绘制扫描线区间（左右范围）
        const scanlineCache = computeScanlineIntervals(gridData);
        
        regions.forEach(region => {
          ctx.save();
          const color = colors[region.id % colors.length];
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);

          const spans = scanlineCache[region.id] || [];
          spans.forEach(span => {
            const leftCanvas = worldToCanvasFn(span.xMin, span.y);
            const rightCanvas = worldToCanvasFn(span.xMax, span.y);
            
            // 绘制左边界线（向下延伸一小段）
            ctx.beginPath();
            ctx.moveTo(leftCanvas.x, leftCanvas.y - 5);
            ctx.lineTo(leftCanvas.x, leftCanvas.y + 5);
            ctx.stroke();
            
            // 绘制右边界线（向下延伸一小段）
            ctx.beginPath();
            ctx.moveTo(rightCanvas.x, rightCanvas.y - 5);
            ctx.lineTo(rightCanvas.x, rightCanvas.y + 5);
            ctx.stroke();
            
            // 绘制左右范围连线
            ctx.beginPath();
            ctx.moveTo(leftCanvas.x, leftCanvas.y);
            ctx.lineTo(rightCanvas.x, rightCanvas.y);
            ctx.stroke();
          });
          ctx.setLineDash([]);
          ctx.restore();
        });
      }
    }

    // 橡皮擦光标效果
    if (currentTool === 'eraser' && mousePosition) {
      ctx.save();
      ctx.strokeStyle = '#ff0000'; ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'; ctx.lineWidth = 2 / zoom;
      const eraserCanvasPos = worldToCanvasFn(mousePosition.x, mousePosition.y);
      ctx.beginPath(); ctx.arc(eraserCanvasPos.x, eraserCanvasPos.y, snapRadius / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // 颜色提取橡皮模式光标效果
    if (colorExtractMode && colorExtractEraserMode && mousePosition) {
      ctx.save();
      ctx.strokeStyle = '#ff0000'; 
      ctx.fillStyle = 'rgba(255, 0, 0, 0.15)'; 
      ctx.lineWidth = 2 / zoom;
      const eraserCanvasPos = worldToCanvasFn(mousePosition.x, mousePosition.y);
      // 擦除半径固定为0.02世界坐标
      const eraserRadiusCanvas = (0.02 / zoom) * canvasWidth;
      ctx.beginPath(); 
      ctx.arc(eraserCanvasPos.x, eraserCanvasPos.y, eraserRadiusCanvas, 0, Math.PI * 2); 
      ctx.fill(); 
      ctx.stroke();
      ctx.restore();
    }

    // ========== 绘制固定顶点 ==========
    if (isVertexPinMode || layerVisibility.regionLayer) {
      const entities = regionEntities[activeLayerId] || [];
      for (const entity of entities) {
        if (entity.fixedVertices.size === 0) continue;
        let globalIdx = 0;
        for (const ring of entity.boundary) {
          for (const p of ring) {
            if (entity.fixedVertices.has(globalIdx)) {
              const canvasPos = worldToCanvasFn(p.x, p.y);
              ctx.save();
              ctx.strokeStyle = '#ff0000';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(canvasPos.x, canvasPos.y, 6, 0, Math.PI * 2);
              ctx.stroke();
              ctx.fillStyle = '#ff0000';
              ctx.beginPath();
              ctx.arc(canvasPos.x, canvasPos.y, 2, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
            globalIdx++;
          }
        }
      }
    }

    // 顶点固定模式光标效果
    if (isVertexPinMode && mousePosition) {
      const canvasPos = worldToCanvasFn(mousePosition.x, mousePosition.y);
      const radiusPx = vertexPinRadius * canvasWidth / zoom;
      ctx.save();
      ctx.strokeStyle = isVertexPinEraserMode ? '#ffaa00' : '#ff0000';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(canvasPos.x, canvasPos.y, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ========== 绘制已保存的颜色提取曲线 ==========
    if (colorExtractMode && colorExtractCurves.length > 0) {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;

      // 绘制所有已保存的曲线
      for (const curve of colorExtractCurves) {
        if (curve.type === 'bezier') {
          // 贝塞尔曲线：采样绘制
          const sampledCurve = sampleQuadraticCurve(curve.start, curve.end, curve.control, 30);
          if (sampledCurve.length >= 2) {
            ctx.beginPath();
            const first = worldToCanvasFn(sampledCurve[0].x, sampledCurve[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < sampledCurve.length; i++) {
              const p = worldToCanvasFn(sampledCurve[i].x, sampledCurve[i].y);
              ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
          }
        } else if (curve.type === 'polyline') {
          // 折线：直接绘制直线段
          if (curve.points.length >= 2) {
            ctx.beginPath();
            const first = worldToCanvasFn(curve.points[0].x, curve.points[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < curve.points.length; i++) {
              const p = worldToCanvasFn(curve.points[i].x, curve.points[i].y);
              ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // ========== 绘制当前正在绘制的颜色提取虚线 ==========
    if (colorExtractMode && colorExtractTool === 'bezier') {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;

      const points = colorExtractPoints;
      const hasPreview = colorExtractPreviewPoint && colorExtractWaitingFor !== null;

      // 0个点：无预览
      // 1个点：显示起点，鼠标移动时显示从起点到鼠标位置的虚线（等待终点）
      if (points.length === 1 && hasPreview) {
        const startCanvas = worldToCanvasFn(points[0].x, points[0].y);
        const previewCanvas = worldToCanvasFn(colorExtractPreviewPoint!.x, colorExtractPreviewPoint!.y);
        ctx.beginPath();
        ctx.moveTo(startCanvas.x, startCanvas.y);
        ctx.lineTo(previewCanvas.x, previewCanvas.y);
        ctx.stroke();
        // 绘制起点圆点
        ctx.beginPath();
        ctx.arc(startCanvas.x, startCanvas.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffaa00';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('S', startCanvas.x - 4, startCanvas.y + 4);
      }
      // 2个点：起点和终点已定，鼠标移动时实时绘制以当前鼠标位置为控制点的贝塞尔曲线
      else if (points.length === 2 && hasPreview) {
        const start = points[0];
        const end = points[1];
        const ctrl = colorExtractPreviewPoint!;
        const curve = sampleQuadraticCurve(start, end, ctrl, 50);
        if (curve.length >= 2) {
          ctx.beginPath();
          const first = worldToCanvasFn(curve[0].x, curve[0].y);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < curve.length; i++) {
            const p = worldToCanvasFn(curve[i].x, curve[i].y);
            ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
        // 绘制起点和终点圆点
        const startCanvas = worldToCanvasFn(start.x, start.y);
        const endCanvas = worldToCanvasFn(end.x, end.y);
        ctx.beginPath();
        ctx.arc(startCanvas.x, startCanvas.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffaa00';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('S', startCanvas.x - 4, startCanvas.y + 4);
        ctx.beginPath();
        ctx.arc(endCanvas.x, endCanvas.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ff6600';
        ctx.fill();
        ctx.fillText('E', endCanvas.x - 4, endCanvas.y + 4);
        // 移除红色虚线辅助线和控制点预览
      }
      // 3个点：三个点完整，绘制最终曲线
      else if (points.length === 3) {
        const [start, end, ctrl] = points;
        const curve = sampleQuadraticCurve(start, end, ctrl, 50);
        ctx.beginPath();
        const first = worldToCanvasFn(curve[0].x, curve[0].y);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < curve.length; i++) {
          const p = worldToCanvasFn(curve[i].x, curve[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      ctx.restore();
    }
    // 折线模式：累加点绘制
    else if (colorExtractMode && colorExtractTool === 'polygon' && colorExtractPoints.length > 0) {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;

      // 绘制连线
      if (colorExtractPoints.length >= 2) {
        ctx.beginPath();
        const firstCanvas = worldToCanvasFn(colorExtractPoints[0].x, colorExtractPoints[0].y);
        ctx.moveTo(firstCanvas.x, firstCanvas.y);
        for (let i = 1; i < colorExtractPoints.length; i++) {
          const pCanvas = worldToCanvasFn(colorExtractPoints[i].x, colorExtractPoints[i].y);
          ctx.lineTo(pCanvas.x, pCanvas.y);
        }
        ctx.stroke();
      }

      // 绘制控制点（橙色圆点）
      for (const p of colorExtractPoints) {
        const cp = worldToCanvasFn(p.x, p.y);
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffaa00';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('•', cp.x - 2, cp.y + 3);
      }

      // 绘制从最后一个控制点到鼠标预览点的虚线
      if (colorExtractPoints.length > 0 && colorExtractPreviewPoint) {
        const lastPoint = colorExtractPoints[colorExtractPoints.length - 1];
        const previewCanvas = worldToCanvasFn(colorExtractPreviewPoint.x, colorExtractPreviewPoint.y);
        const lastCanvas = worldToCanvasFn(lastPoint.x, lastPoint.y);

        ctx.beginPath();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 2;
        ctx.moveTo(lastCanvas.x, lastCanvas.y);
        ctx.lineTo(previewCanvas.x, previewCanvas.y);
        ctx.stroke();
      }

      ctx.restore();
    }

    // ========== 颜色提取调试模式绘制（Ctrl+G）==========
    if (showColorExtractDebug && colorExtractDebugData) {
      ctx.save();
      
      // 绘制掩码区域（半透明红色）
      ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.beginPath();
      for (const pixel of colorExtractDebugData.maskPixels) {
        const p = worldToCanvasFn(pixel.x, pixel.y);
        ctx.rect(p.x, p.y, 1, 1);
      }
      ctx.fill();
      
      // 绘制每个色块（不同颜色）
      for (const block of colorExtractDebugData.blocks) {
        ctx.fillStyle = `${block.color}80`; // 添加50%透明度
        ctx.beginPath();
        for (const pixel of block.pixels) {
          const p = worldToCanvasFn(pixel.x, pixel.y);
          ctx.rect(p.x, p.y, 1, 1);
        }
        ctx.fill();
        
        // 绘制色块标签
        if (block.pixels.length > 0) {
          const centerPixel = block.pixels[Math.floor(block.pixels.length / 2)];
          const center = worldToCanvasFn(centerPixel.x, centerPixel.y);
          ctx.fillStyle = 'black';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`#${block.id}`, center.x, center.y);
        }
      }
      
      ctx.restore();
    }

    ctx.restore();

    // WebGL 渲染已由动画循环处理，此处无需手动渲染
  }, [imageState, layerVisibility, axis, grid, zoom, panOffset, shapes, tempPoints, previewPoint, currentTool, drawShape, layers, worldToCanvasFn, mousePosition, snapRadius, showDebugRegions, debugRegionId, debugOutsideId, debugShowOriginal, debugDistanceThreshold, debugRadialThreshold, debugDownsampleFactor, debugRingDistanceThreshold, debugRingRadialThreshold, debugShowEndpoints, debugShowRings, debugShowSegments, debugShowWallGrouped, isPainting, paintBrushSize, colorBlockRegionsCache, activeLayerId, paintBuffers, canvasWidth, canvasHeight, colorExtractMode, colorExtractTool, colorExtractPoints, colorExtractPreviewPoint, colorExtractWaitingFor, colorExtractCurves, colorExtractEraserMode, showColorExtractDebug, colorExtractDebugData, redrawTrigger, regionAnnotations, showRegionBorder2D, frameDataMap]);

  useEffect(() => { drawCanvas(); }, [drawCanvas]);

  useEffect(() => {
    if (!activeLayerId) return;
    // ★ refreshRegionCache 异步化（BFS 在 Worker），内部已刷新 refreshColorBlockCache，无需外部同步再调（那样会读到 stale cache）。
    void refreshRegionCache(activeLayerId);
    // 确保 paintBuffer 被初始化
    if (!paintBuffers[activeLayerId]) {
      initPaintBuffer(activeLayerId);
    }
  }, [activeLayerId]);

  // 当图层切换时，确保 colorBlockRegionsCache 被刷新
  useEffect(() => {
    if (activeLayerId) {
      refreshColorBlockCache(activeLayerId);
    }
  }, [activeLayerId, shapes]);



  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(Math.max(0.1, Math.min(10, zoom * delta)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, setZoom]);

  const getCanvasCoords = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // 直接读取 canvas 的像素尺寸（绘图缓冲区大小）
    const canvasPixelWidth = canvas.width;
    const canvasPixelHeight = canvas.height;
    const scaleX = canvasPixelWidth / rect.width;
    const scaleY = canvasPixelHeight / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []); // 无依赖，每次调用都从 DOM 获取最新值

  // 获取世界坐标点所在的区域 ID
  const getRegionIdAtWorldPoint = useCallback((world: Point): number => {
    const layerId = activeLayerId || layers[0]?.id;
    if (!layerId) return 0;
    const texture = regionIdTexture.get(layerId);
    if (!texture) return 0;
    const x = Math.floor(world.x * PAINT_BUFFER_SIZE);
    const y = Math.floor((1 - world.y) * PAINT_BUFFER_SIZE);
    return texture[y * PAINT_BUFFER_SIZE + x] ?? 0;
  }, [activeLayerId, layers, regionIdTexture]);

  // 检测点是否靠近贝塞尔曲线或直线
  const isPointNearCurve = useCallback((point: Point, start: Point, end: Point, control: Point, radius: number): boolean => {
    // 采样曲线上的多个点进行检测
    const samples = 20; // 采样点数
    const radiusSquared = radius * radius; // 使用平方比较，避免开方
    
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      // 计算贝塞尔曲线上的点
      const x = Math.pow(1 - t, 2) * start.x + 2 * (1 - t) * t * control.x + Math.pow(t, 2) * end.x;
      const y = Math.pow(1 - t, 2) * start.y + 2 * (1 - t) * t * control.y + Math.pow(t, 2) * end.y;
      
      // 计算距离的平方
      const dx = point.x - x;
      const dy = point.y - y;
      const distSquared = dx * dx + dy * dy;
      
      if (distSquared < radiusSquared) {
        return true;
      }
    }
    
    return false;
  }, []);

  // ========== 鼠标事件 ==========
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPinning && isVertexPinMode) {
      if (!activeLayerId) return;
      const coords = getCanvasCoords(e);
      const worldCoords = canvasToWorldFn(coords.x, coords.y);

      const entities = regionEntities[activeLayerId] || [];
      let anyToggled = false;

      for (const entity of entities) {
        const hits = entity.getVerticesNearPoint(worldCoords.x, worldCoords.y, vertexPinRadius);
        if (hits.length > 0) {
          entity.setFixedVertices(hits.map(h => h.globalIndex), !isVertexPinEraserMode);
          anyToggled = true;
        }
      }

      if (anyToggled) {
        if (pinRefreshThrottleRef.current === null) {
          refreshRegionEntities(activeLayerId);
          triggerCanvasRedraw();
          pinRefreshThrottleRef.current = window.setTimeout(() => {
            pinRefreshThrottleRef.current = null;
          }, 100);
        }
      }
      return;
    }

    // 优先处理背景拖动模式
    if (imageState.isBackgroundDragging && imageState.backgroundDragStart) {
      updateBackgroundDrag(e.clientX, e.clientY);
      // 立即触发重绘
      requestAnimationFrame(() => {
        drawCanvas();
      });
      return;
    }

    // ========== 移动工具：拖拽移动 ==========
    if (isMoving && moveShapeIds.length > 0 && moveStartWorld) {
      const coords = getCanvasCoords(e);
      const currentWorld = canvasToWorldFn(coords.x, coords.y);
      const dx = currentWorld.x - moveStartWorld.x;
      const dy = currentWorld.y - moveStartWorld.y;
      if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return;

      useAppStore.setState(state => ({
        shapes: state.shapes.map(s => {
          if (moveShapeIds.includes(s.id)) {
            const newPoints = s.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
            return { ...s, points: newPoints };
          }
          return s;
        }),
      }));
      setMoveStartWorld(currentWorld);
      requestAnimationFrame(() => { drawCanvas(); });
      return;
    }

    if (isPanning) {
      // 更新鼠标位置（用于橡皮光标跟随）
      const coords = getCanvasCoords(e);
      const worldCoords = canvasToWorldFn(coords.x, coords.y);
      setMousePosition(worldCoords);
      
      if (colorExtractEraserMode && colorExtractMode) {
        // 橡皮模式下的拖动：擦除经过的曲线
        const eraseRadius = 0.03; // 增大擦除半径（世界坐标）
        
        // 找出所有需要删除的曲线索引
        const toDelete: number[] = [];
        for (let i = colorExtractCurves.length - 1; i >= 0; i--) {
          const curve = colorExtractCurves[i];
          
          let isNearCurve = false;
          
          if (curve.type === 'bezier') {
            // 贝塞尔曲线：检测鼠标是否靠近曲线的任何部分
            isNearCurve = isPointNearCurve(worldCoords, curve.start, curve.end, curve.control, eraseRadius);
          } else if (curve.type === 'polyline') {
            // 折线：检测鼠标是否靠近任何线段
            for (let j = 0; j < curve.points.length - 1; j++) {
              const p1 = curve.points[j];
              const p2 = curve.points[j + 1];
              // 使用中点作为控制点来检测直线段
              const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
              if (isPointNearCurve(worldCoords, p1, p2, mid, eraseRadius)) {
                isNearCurve = true;
                break;
              }
            }
          }
          
          if (isNearCurve) {
            toDelete.push(i);
          }
        }
        
        // 删除曲线（同时删除对应的 shape）
        const removeCurve = useAppStore.getState().removeColorExtractCurve;
        const curves = useAppStore.getState().colorExtractCurves;
        for (const index of toDelete) {
          console.log('[颜色提取橡皮] 删除曲线 #', index);
          // 如果有对应的 shapeId，也要删除 shape
          const curve = curves[index];
          if (curve && curve.shapeId) {
            removeShape(curve.shapeId);
            console.log('[颜色提取橡皮] 同时删除 shape:', curve.shapeId);
          }
          removeCurve(index);
        }
        
        // 删除曲线（可能多条）后，同步刷新区域
        if (toDelete.length > 0 && activeLayerId) {
          syncRefreshRegion(activeLayerId);
        }
        
        // 触发重绘（更新橡皮光标位置）
        requestAnimationFrame(() => {
          drawCanvas();
        });
      } else {
        // 正常平移
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        setPanOffset({ x: panOffset.x + dx, y: panOffset.y + dy });
      }
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const coords = getCanvasCoords(e);
    const worldCoords = canvasToWorldFn(coords.x, coords.y);
    setMousePosition(worldCoords);

    // 颜色提取模式下的预览点（带吸附和区域限制）
    if (colorExtractMode) {
      const snappedPreview = snapColorExtractPreview(worldCoords, colorExtractPoints.length);
      
      // 贝塞尔曲线的控制点预览不受区域限制
      const isBezierControlPreview = colorExtractTool === 'bezier' && 
        colorExtractWaitingFor === 'control' && 
        colorExtractPoints.length === 2;
      
      if (isBezierControlPreview) {
        // 控制点预览：可以在任何地方
        setColorExtractPreviewPoint(snappedPreview);
      } else {
        // 起点和终点预览：检查区域合法性
        const regionId = getRegionIdAtWorldPoint(snappedPreview);
        let previewValid = (regionId !== 0);
        if (previewValid && colorExtractRegionId !== null) {
          previewValid = (regionId === colorExtractRegionId);
        }
        if (previewValid) {
          setColorExtractPreviewPoint(snappedPreview);
        } else {
          setColorExtractPreviewPoint(null);
        }
      }
    } else if (colorExtractPreviewPoint) {
      setColorExtractPreviewPoint(null);
    }

    if (isErasing && currentTool === 'eraser') {
      const idsToErase = getShapesToEraseAtPoint(coords.x, coords.y);
      if (idsToErase.length > 0) eraseShapes(idsToErase);
      const annoIds = getAnnotationsToEraseAtPoint(coords.x, coords.y);
      if (annoIds.length > 0) eraseAnnotations(annoIds);
      return;
    }

    if (isPainting && currentTool === 'paintBrush') {
      const layerId = activeLayerId || layers[0]?.id;
      if (!layerId) return;

      // 使用预计算的区域ID纹理快速查询区域ID
      const texture = regionIdTexture.get(layerId);
      if (!texture) return;

      // 使用固定缓冲区尺寸进行纹理索引（纹理固定为512x512）
      const canvasX = Math.floor(worldCoords.x * PAINT_BUFFER_SIZE);
      const canvasY = Math.floor((1 - worldCoords.y) * PAINT_BUFFER_SIZE);
      
      // 从纹理中获取区域ID（O(1)操作）
      const regionId = texture[canvasY * PAINT_BUFFER_SIZE + canvasX];
      if (regionId !== 0) {
        // 记录圆内所有像素到对应区域（使用纹理快速查询）
        recordCirclePixelsToRegions(worldCoords, paintBrushSize);

        if (!paintBuffers[layerId]) {
          initPaintBuffer(layerId);
        }

        updatePaintBuffer(layerId, (imgData) => {
          drawCircleOnBuffer(imgData, worldCoords, paintBrushSize, currentColor, PAINT_BUFFER_SIZE);
        });

        if (lastPaintPointRef.current) {
          const dist = Math.hypot(worldCoords.x - lastPaintPointRef.current.x,
                                  worldCoords.y - lastPaintPointRef.current.y);
          const step = paintBrushSize * 0.5;
          if (dist > step) {
            const steps = Math.ceil(dist / step);
            for (let i = 1; i < steps; i++) {
              const t = i / steps;
              const interpX = lastPaintPointRef.current.x + (worldCoords.x - lastPaintPointRef.current.x) * t;
              const interpY = lastPaintPointRef.current.y + (worldCoords.y - lastPaintPointRef.current.y) * t;
              
              // 插值点使用纹理查询区域ID（缓冲区固定512x512）
              const interpCanvasX = Math.floor(interpX * PAINT_BUFFER_SIZE);
              const interpCanvasY = Math.floor((1 - interpY) * PAINT_BUFFER_SIZE);
              const interpRegionId = texture[interpCanvasY * PAINT_BUFFER_SIZE + interpCanvasX];
              
              if (interpRegionId !== 0) {
                // 记录插值点圆内像素（使用纹理快速查询）
                recordCirclePixelsToRegions({ x: interpX, y: interpY }, paintBrushSize);
                
                updatePaintBuffer(layerId, (imgData) => {
                  drawCircleOnBuffer(imgData, { x: interpX, y: interpY }, paintBrushSize, currentColor, PAINT_BUFFER_SIZE);
                });
              }
            }
          }
        }
        lastPaintPointRef.current = worldCoords;
      }
      return;
    }

    if (tempPoints.length > 0 && currentTool !== 'select') {
      setPreviewPoint(worldCoords);
    }
  }, [isPanning, panStart, panOffset, getCanvasCoords, canvasToWorldFn, setMousePosition, setPanOffset, isErasing, currentTool, getShapesToEraseAtPoint, eraseShapes, getAnnotationsToEraseAtPoint, eraseAnnotations, tempPoints, isPainting, paintBrushSize, activeLayerId, layers, currentColor, paintBuffers, initPaintBuffer, updatePaintBuffer, recordCirclePixelsToRegions, regionIdTexture, imageState, updateBackgroundDrag, drawCanvas, colorExtractMode, colorExtractPoints, colorExtractPreviewPoint, setColorExtractPreviewPoint, snapColorExtractPreview, colorExtractEraserMode, colorExtractCurves, isPointNearCurve, getRegionIdAtWorldPoint, colorExtractRegionId]);

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setMousePosition(null);
    setPreviewPoint(null);
    setColorExtractPreviewPoint(null);
  }, [setMousePosition, setColorExtractPreviewPoint]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isVertexPinMode && e.button === 0) {
      if (!activeLayerId) return;
      const coords = getCanvasCoords(e);
      const worldCoords = canvasToWorldFn(coords.x, coords.y);
      setIsPinning(true);

      const entities = regionEntities[activeLayerId] || [];
      let anyToggled = false;

      for (const entity of entities) {
        const hits = entity.getVerticesNearPoint(worldCoords.x, worldCoords.y, vertexPinRadius);
        if (hits.length > 0) {
          entity.setFixedVertices(hits.map(h => h.globalIndex), !isVertexPinEraserMode);
          anyToggled = true;
        }
      }

      if (anyToggled) {
        refreshRegionEntities(activeLayerId);
        triggerCanvasRedraw();
      }
      return;
    }

    // 优先处理背景拖动模式
    if (imageState.isBackgroundDragging && e.button === 0) {
      startBackgroundDrag(e.clientX, e.clientY);
      return;
    }

    // ========== 移动工具 ==========
    if (currentTool === 'move' && e.button === 0) {
      const coords = getCanvasCoords(e);
      const worldCoords = canvasToWorldFn(coords.x, coords.y);
      
      const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
      
      // 1. 寻找命中的封闭实线图形（非虚线 #ffaa00）
      let targetShape: typeof currentLayerShapes[0] | null = null;
      for (const shape of currentLayerShapes) {
        if (shape.color === '#ffaa00') continue;
        if (!isClosedShape(shape)) continue;
        if (isPointInsideShape(worldCoords, shape)) {
          targetShape = shape;
          break;
        }
      }
      if (!targetShape) return;

      // 2. 收集内部虚线：着色#ffaa00且所有顶点都在主图形内部的图形
      const movingIds: string[] = [targetShape.id];
      for (const shape of currentLayerShapes) {
        if (shape.color !== '#ffaa00') continue;
        const allInside = shape.points.every(p => isPointInsideShape(p, targetShape!));
        if (allInside) movingIds.push(shape.id);
      }

      // 3. 获取区域ID（取主图形中心点查询 regionIdTexture）
      const centerX = targetShape.points.reduce((s, p) => s + p.x, 0) / targetShape.points.length;
      const centerY = targetShape.points.reduce((s, p) => s + p.y, 0) / targetShape.points.length;
      const regionId = getRegionIdAtWorldPoint({ x: centerX, y: centerY });

      // 4. 记录状态
      setMoveTargetId(targetShape.id);
      setMoveShapeIds(movingIds);
      setMoveStartWorld(worldCoords);
      setMoveRegionId(regionId);
      setIsMoving(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // 颜色提取橡皮模式：长按拖动擦除
    if (colorExtractMode && colorExtractEraserMode && e.button === 0) {
      // 长按开始，记录起始位置
      setIsPanning(true); // 使用 panning 状态来标记正在拖动
      setPanStart({ x: e.clientX, y: e.clientY });
      console.log('[颜色提取橡皮] 开始擦除模式');
      return;
    }

    // 颜色提取模式：左键添加点
    if (colorExtractMode && e.button === 0) {
      // 等待点击实线区域模式下不允许绘制
      if (colorExtractWaiting) {
        console.log('[颜色提取] 等待点击实线区域模式下，不允许绘制');
        return;
      }
      console.log('[颜色提取] 进入颜色提取处理');
      const coords = getCanvasCoords(e);
      const worldCoords = canvasToWorldFn(coords.x, coords.y);
      // 点吸附：使用预览吸附函数，第一个点也能吸附到已有虚线顶点
      let snapped = worldCoords;
      if (snapEnabled) {
        snapped = snapColorExtractPreview(worldCoords, colorExtractPoints.length);
      }

      // 区域检查：获取当前点的区域 ID
      const regionId = getRegionIdAtWorldPoint(snapped);
      
      // 贝塞尔曲线的控制点（第三个点）不受区域限制
      const isBezierControlPoint = colorExtractTool === 'bezier' && 
        colorExtractWaitingFor === 'control' && 
        colorExtractPoints.length === 2;
      
      if (!isBezierControlPoint) {
        // 有效性检查：不能在无效区域（空气/固体）上绘制（起点和终点）
        if (regionId === 0) {
          console.warn('[颜色提取] 无法在无效区域（空气/固体）上绘制');
          return;
        }
        
        // 跨区域检查：如果已有区域，新点必须在同一区域（起点和终点）
        if (colorExtractRegionId !== null && regionId !== colorExtractRegionId) {
          console.warn('[颜色提取] 不能跨区域绘制');
          // 清空当前点集并重置状态
          clearColorExtractPoints();
          setColorExtractRegionId(null);
          return;
        }
      }

      // 如果是第一个点，记录区域 ID
      if (colorExtractPoints.length === 0) {
        setColorExtractRegionId(regionId);
      }

      if (colorExtractTool === 'bezier') {
        // 贝塞尔曲线独立绘制模式：起点 → 终点 → 控制点
        const waiting = colorExtractWaitingFor;
        if (waiting === 'start' || colorExtractPoints.length === 0) {
          // 第一个点：起点
          addColorExtractPoint(snapped);
          setColorExtractWaitingFor('end');
          console.log(`[颜色提取] 添加起点: (${snapped.x.toFixed(4)}, ${snapped.y.toFixed(4)})`);
        } else if (waiting === 'end' && colorExtractPoints.length === 1) {
          // 第二个点：终点
          addColorExtractPoint(snapped);
          setColorExtractWaitingFor('control');
          console.log(`[颜色提取] 添加终点: (${snapped.x.toFixed(4)}, ${snapped.y.toFixed(4)})`);
        } else if (waiting === 'control' && colorExtractPoints.length === 2) {
          // 第三个点：控制点 -> 立即提取
          addColorExtractPoint(snapped);
          console.log(`[颜色提取] 添加控制点: (${snapped.x.toFixed(4)}, ${snapped.y.toFixed(4)})`);
          // 执行颜色提取
          performBezierColorExtract([...colorExtractPoints, snapped]);
          // 清空状态，准备下一条
          clearColorExtractPoints();
          setColorExtractWaitingFor('start');
        }
      } else if (colorExtractTool === 'polygon') {
        // 折线模式：检测是否点击了同一个点（结束绘制）
        const isSamePoint = lastPolygonPoint !== null && 
          Math.abs(snapped.x - lastPolygonPoint.x) < 0.001 && 
          Math.abs(snapped.y - lastPolygonPoint.y) < 0.001;
        
        if (isSamePoint) {
          // 点击了同一个点，结束折线绘制
          console.log('[颜色提取] 双击同一点，结束折线绘制');
          if (colorExtractPoints.length >= 2) {
            // 永久保存折线到 shapes（作为墙参与 BFS 区域划分）
            const shapeId = `extract_polyline_${Date.now()}`;
            const shape = {
              id: shapeId,
              groupId: activeGroupId || 'default',
              layerId: activeLayerId!,
              type: 'polyline' as const,
              points: [...colorExtractPoints],
              color: '#ffaa00',
            };
            addShape(shape);

            // 保存折线用于显示
            addColorExtractCurve({ type: 'polyline', points: [...colorExtractPoints], shapeId });
            console.log('[颜色提取] 折线已保存到 shapes，虚线将持续存在');
            // 不触发提取，用户可以继续绘制多条虚线拼接，最后点击"提取颜色"按钮
          }
          // 清空状态
          clearColorExtractPoints();
          setLastPolygonPoint(null);
          return;
        }
        
        // 正常添加点
        const newIndex = colorExtractPoints.length;
        addColorExtractPoint(snapped);
        setLastPolygonPoint(snapped); // 记录当前点
      }
      return;
    } else if (e.button === 0) {
    }

    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && isPanMode)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const coords = getCanvasCoords(e);
    const worldCoords = canvasToWorldFn(coords.x, coords.y);

    if (currentTool === 'pointAnnotation') {
      // 检测附近是否已有点注释（距离阈值：世界坐标 0.08，约画布的 8%）
      const proximityThreshold = 0.08;
      let existingAnnotation = null;
      let minDistance = Infinity;

      for (const anno of pointAnnotations) {
        if (anno.layerId !== activeLayerId) continue;
        const dx = anno.position.x - worldCoords.x;
        const dy = anno.position.y - worldCoords.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < proximityThreshold && distance < minDistance) {
          minDistance = distance;
          existingAnnotation = anno;
        }
      }

      if (existingAnnotation) {
        setPointAnnotationEditor({
          editorId: generateEditorId(),
          x: e.clientX,
          y: e.clientY,
          annotationId: existingAnnotation.id,
          existingText: existingAnnotation.text,
          position: existingAnnotation.position, // 使用已有注释的位置
        });
      } else {
        // 创建新注释
        setPointAnnotationEditor({
          editorId: generateEditorId(),
          x: e.clientX,
          y: e.clientY,
          annotationId: null,
          existingText: '',
          position: worldCoords,
        });
      }
      return;
    }

    if (currentTool === 'regionAnnotation') {
      // ⚠️ 重要备注：区域注释绑定的是 BFS 算法生成的区域 ID
      // 每次绘制新图形后，BFS 网格会重新计算，区域 ID 可能会发生变化
      // 因此建议在完成所有图形绘制后再添加区域注释
      // 如果在绘制过程中添加注释，后续绘制新图形可能导致注释绑定的区域不再匹配
      const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
      if (currentLayerShapes.length === 0) return;

      // 获取BFS区域ID（正数）
      // ★ 以调试页面（Ctrl+D）的环检测算法为准：实时调用 getDebugRegions，
      //   内部即 computeRegionsExact（排除虚线 #ffaa00），与调试模式看到的环完全一致，
      //   避免 regionPolygonsCache 过期导致"调试能看到但区域注释识别不到"
      const worldBounds = BFS_WORLD_BOUNDS;
      const debugRegions = getDebugRegions(currentLayerShapes, worldBounds, bfsResolution);
      const regions = debugRegions.map(d => d.rings).filter((r): r is Point[][] => !!r);
      
      // 使用区域索引作为 regionId（确保与 bakeRegionLayerTexture 中的索引一致）
      const regionIndex = findRegionIndexByPoint(worldCoords, regions);
      
      if (regionIndex === -1) {
        return;
      }

      // 获取区域多边形用于显示
      const hitRegion = regions[regionIndex];

      // 通过区域索引查找已有注释
      const existingAnnotation = regionAnnotations.find(
        anno => anno.layerId === activeLayerId && String(anno.regionId) === String(regionIndex)
      );

      if (existingAnnotation) {
        // 编辑已有注释
        setRegionAnnotationEditor({
          editorId: generateEditorId(),
          x: e.clientX,
          y: e.clientY,
          annotationId: existingAnnotation.id,
          existingText: existingAnnotation.text,
          polygon: hitRegion || existingAnnotation.polygon,
          regionId: String(regionIndex),
        });
      } else {
        if (!hitRegion) {
          return;
        }
        // 创建新注释
        setRegionAnnotationEditor({
          editorId: generateEditorId(),
          x: e.clientX,
          y: e.clientY,
          annotationId: null,
          existingText: '',
          polygon: hitRegion,
          regionId: String(regionIndex),
        });
      }
      return;
    }

    if (currentTool === 'eraser') {
      setIsErasing(true);
      erasedShapesThisSessionRef.current.clear();
      erasedAnnotationsThisSessionRef.current.clear();
      const idsToErase = getShapesToEraseAtPoint(coords.x, coords.y);
      if (idsToErase.length > 0) eraseShapes(idsToErase);
      const annoIds = getAnnotationsToEraseAtPoint(coords.x, coords.y);
      if (annoIds.length > 0) eraseAnnotations(annoIds);
      return;
    }

    if (currentTool === 'paintBrush') {
      setIsPainting(true);
      lastPaintPointRef.current = null;
      const layerId = activeLayerId || layers[0]?.id;
      if (layerId) {
        // 使用预计算的区域ID纹理快速查询区域ID
        const texture = regionIdTexture.get(layerId);
        if (texture) {
          // 将世界坐标转换为缓冲区像素坐标（缓冲区固定512x512）
          const canvasX = Math.floor(worldCoords.x * PAINT_BUFFER_SIZE);
          const canvasY = Math.floor((1 - worldCoords.y) * PAINT_BUFFER_SIZE); // Y轴翻转
          
          // 从纹理中获取区域ID（O(1)操作）
          const regionId = texture[canvasY * PAINT_BUFFER_SIZE + canvasX];
          if (regionId !== 0) {
            // 记录圆内所有像素到对应区域
            recordCirclePixelsToRegions(worldCoords, paintBrushSize);
            
            if (!paintBuffers[layerId]) initPaintBuffer(layerId);
            updatePaintBuffer(layerId, (imgData) => {
              drawCircleOnBuffer(imgData, worldCoords, paintBrushSize, currentColor, PAINT_BUFFER_SIZE);
            });
            
            // 绘制后刷新区域实体（如果已开启可见性）
            if (layerVisibility?.regionLayer) {
              useAppStore.getState().refreshRegionEntities(layerId);
            }
          }
        }
      }
      return;
    }
  }, [
    isPanMode,
    currentTool,
    getCanvasCoords,
    canvasToWorldFn,
    activeLayerId,
    regionPolygonsCache,
    getShapesToEraseAtPoint,
    eraseShapes,
    getAnnotationsToEraseAtPoint,
    eraseAnnotations,
    setIsPanning,
    setPanStart,
    setIsErasing,
    regionAnnotations,
    updateRegionAnnotationWithRegionId,
    paintBuffers,
    initPaintBuffer,
    updatePaintBuffer,
    layerVisibility,
    paintBrushSize,
    currentColor,
    layers,
    recordCirclePixelsToRegions,
    regionIdTexture,
    colorExtractMode,
    colorExtractTool,
    colorExtractPoints,
    colorExtractPreviewPoint,
    setColorExtractPreviewPoint,
    colorExtractWaitingFor,
    setColorExtractWaitingFor,
    colorExtractCurves,
    colorExtractEraserMode,
    performBezierColorExtract,
    snapColorExtractPreview,
    lastPolygonPoint,
    setLastPolygonPoint,
    addColorExtractCurve,
    clearColorExtractPoints,
  ]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isVertexPinMode) {
      setIsPinning(false);
      return;
    }

    // 处理背景拖动结束
    if (imageState.isBackgroundDragging) {
      endBackgroundDrag(); // 重置拖动起始位置
      return;
    }

    // ========== 移动工具：松开鼠标 ==========
    if (isMoving) {
      // 删除区域注释
      if (moveRegionId !== null && moveRegionId > 0) {
        const layerId = activeLayerId || layers[0]?.id;
        if (layerId) {
          useAppStore.setState(state => ({
            regionAnnotations: state.regionAnnotations.filter(
              a => !(a.layerId === layerId && String(a.regionId) === String(moveRegionId))
            ),
          }));
        }
      }

      // 清空移动状态
      setIsMoving(false);
      setMoveTargetId(null);
      setMoveShapeIds([]);
      setMoveStartWorld(null);
      setMoveRegionId(null);

      // 保存历史 & 刷新区域缓存
      saveHistory();
      const layerId = activeLayerId || layers[0]?.id;
      if (layerId) {
        // ★ refreshRegionCache 异步化（BFS 在 Worker），内部已刷新 refreshColorBlockCache，无需外部同步再调。
        void refreshRegionCache(layerId);
      }
      drawCanvas();
      return;
    }

    if (isErasing && currentTool === 'eraser') {
      // 确保最后一次擦除（如果 mouseup 时还有未被 Move 覆盖的位置，但一般 Move 已覆盖，这步可省略，保留以保万无一失）
      const coords = getCanvasCoords(e);
      const finalIds = getShapesToEraseAtPoint(coords.x, coords.y);
      if (finalIds.length > 0) eraseShapes(finalIds);
      const finalAnnoIds = getAnnotationsToEraseAtPoint(coords.x, coords.y);
      if (finalAnnoIds.length > 0) eraseAnnotations(finalAnnoIds);
      // 如果有任何图形或注释被删除，保存历史
      if (erasedShapesThisSessionRef.current.size > 0 || erasedAnnotationsThisSessionRef.current.size > 0) {
        useAppStore.getState().saveHistory();
      }
      setIsErasing(false);
      erasedShapesThisSessionRef.current.clear();
      erasedAnnotationsThisSessionRef.current.clear();
    }

    if (isPainting && currentTool === 'paintBrush') {
      setIsPainting(false);
      
      // 使用区域ID纹理清除不在任何精确区域内的像素
      const layerId = activeLayerId || layers[0]?.id;
      if (layerId && paintBuffers[layerId]) {
        const texture = regionIdTexture.get(layerId);
        if (texture) {
          updatePaintBuffer(layerId, (imgData) => {
            const data = imgData.data;
            
            for (let y = 0; y < PAINT_BUFFER_SIZE; y++) {
              for (let x = 0; x < PAINT_BUFFER_SIZE; x++) {
                // 从纹理中快速查询区域ID（O(1)操作）
                const regionId = texture[y * PAINT_BUFFER_SIZE + x];
                
                // 如果不在任何区域内且该像素有颜色，则清除
                if (regionId === 0) {
                  const idx = (y * PAINT_BUFFER_SIZE + x) * 4;
                  if (data[idx + 3] > 0) { // 检查 alpha 通道
                    data[idx] = 0;     // R
                    data[idx + 1] = 0; // G
                    data[idx + 2] = 0; // B
                    data[idx + 3] = 0; // A
                  }
                }
              }
            }
          });
        }
      }
      
      saveHistory();
    }

    setIsPanning(false);
  }, [isErasing, currentTool, getCanvasCoords, getShapesToEraseAtPoint, eraseShapes, isPainting, saveHistory, activeLayerId, layers, paintBuffers, updatePaintBuffer, regionIdTexture, isMoving, moveRegionId, refreshRegionCache, refreshColorBlockCache, drawCanvas]);

  // 单击绘图逻辑（非擦除、非平移、非选择工具时）
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (currentTool === 'picker') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const imageData = ctx.getImageData(x, y, 1, 1);
      const [r, g, b] = imageData.data;
      const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      
      useAppStore.getState().setCurrentColor(hexColor);
      return;
    }
    
    // 颜色提取等待状态：点击区域提取颜色（使用与 Ctrl+G 相同的区域算法）
    const { colorExtractWaiting, setColorExtractWaiting } = useAppStore.getState();
    if (colorExtractWaiting) {
      const coords = getCanvasCoords(e);
      const worldCoords = canvasToWorldFn(coords.x, coords.y);
      
      console.log('[颜色提取] 点击位置:', worldCoords);
      
      // 1. 获取当前图层的所有形状
      const allShapesInLayer = shapes.filter(s => s.layerId === activeLayerId);
      console.log('[颜色提取] 当前图层图形数:', allShapesInLayer.length);
      
      if (allShapesInLayer.length === 0) {
        alert('当前图层没有图形');
        setColorExtractWaiting(false);
        return;
      }
      
      // 2. 直接计算纯虚线闭合区域（不依赖缓存）
      const regions = computeAllDashedClosedRegions(
        allShapesInLayer,
        canvasWidth,
        canvasHeight
      );
      console.log('[颜色提取] 计算出的区域数:', regions.length);
      
      if (regions.length === 0) {
        alert('当前图层没有由虚线围成的闭合区域');
        setColorExtractWaiting(false);
        return;
      }
      
      // 3. 使用 findRegionAtPoint 查找点击位置对应的区域
      const clickedRegion = findRegionAtPoint(worldCoords, regions);
      
      if (!clickedRegion) {
        alert('请点击一个虚线闭合区域内部');
        setColorExtractWaiting(false);
        return;
      }
      
      console.log('[颜色提取] 找到区域 ID:', clickedRegion.id);
      console.log('[颜色提取] 区域顶点数:', clickedRegion.polygon[0]?.length);
      console.log('[颜色提取] 区域像素数:', clickedRegion.pixelCount);
      console.log('[颜色提取] 区域中心点:', clickedRegion.centroid);
      
      // 4. 根据区域多边形提取颜色
      performColorExtractionOnRegion(clickedRegion.polygon);
      
      // 5. 保持颜色提取模式和等待状态，支持连续提取多个区域
      // 不退出模式，用户可以继续点击其他区域
      // setColorExtractWaiting(false);
      // setColorExtractMode(false);
      return;
    }
    
    if (isPanning || isPanMode || currentTool === 'select' || currentTool === 'eraser' || currentTool === 'pointAnnotation' || currentTool === 'regionAnnotation' || currentTool === 'paintBrush' || currentTool === 'move') return;
    const coords = getCanvasCoords(e);
    const worldCoords = canvasToWorldFn(coords.x, coords.y);
    const snappedCoords = snapToExistingPoint(worldCoords, currentTool, tempPoints.length);
    const toolPointsRequired: Record<string, number> = { point: 1, line: 2, rectangle: 2, circle: 2, triangle: 3, quadratic: 3, brush: Infinity };
    const requiredPoints = toolPointsRequired[currentTool] || 1;

    if (currentTool === 'brush') {
      setTempPoints(prev => [...prev, snappedCoords]);
    } else {
      const newPoints = [...tempPoints, snappedCoords];
      setTempPoints(newPoints);
      if (newPoints.length >= requiredPoints) {
        const toolToType: Record<string, string> = { point: 'point', line: 'line', rectangle: 'rectangle', circle: 'circle', triangle: 'triangle', quadratic: 'quadratic', brush: 'brush' };
        const finalShape: Shape = {
          id: `shape_${Date.now()}`,
          groupId: activeGroupId || 'default',
          layerId: activeLayerId || layers[0]?.id,
          type: toolToType[currentTool] as any,
          points: newPoints,
          color: currentColor,
        };
        addShape(finalShape);
        saveHistory();
        setTempPoints([]);
        setPreviewPoint(null);
      }
    }
  }, [isPanning, isPanMode, currentTool, getCanvasCoords, canvasToWorldFn, snapToExistingPoint, tempPoints, activeGroupId, activeLayerId, layers, currentColor, performColorExtractionOnRegion, getRegionPolygonById, shapes]);

  // 同步临时图形到 store
  useEffect(() => {
    if (currentTool === 'brush' && tempPoints.length > 0) {
      const toolToType: Record<string, string> = { point: 'point', line: 'line', rectangle: 'rectangle', circle: 'circle', triangle: 'triangle', quadratic: 'quadratic', brush: 'brush' };
      const newShape: Shape = {
        id: 'current_shape',
        groupId: activeGroupId || 'default',
        layerId: activeLayerId || layers[0]?.id,
        type: toolToType[currentTool] as any,
        points: tempPoints,
        color: currentColor,
      };
      useAppStore.setState(state => ({ shapes: state.shapes.filter(s => s.id !== 'current_shape').concat(newShape) }));
    }
  }, [tempPoints, currentTool, activeGroupId, activeLayerId, layers, currentColor]);

  const handleDoubleClick = useCallback(() => {
    if (currentTool === 'brush' && tempPoints.length >= 2) {
      const finalShape: Shape = {
        id: `shape_${Date.now()}`,
        groupId: activeGroupId || 'default',
        layerId: activeLayerId || layers[0]?.id,
        type: 'brush',
        points: tempPoints,
        color: currentColor,
      };
      useAppStore.setState(state => ({ shapes: state.shapes.filter(s => s.id !== 'current_shape').concat(finalShape) }));
      useAppStore.getState().saveHistory();
      setTempPoints([]);
      setPreviewPoint(null);
    }
  }, [currentTool, tempPoints, activeGroupId, activeLayerId, layers, currentColor]);

  // 点注释保存
  const handlePointAnnotationSave = useCallback((text: string) => {
    const editor = pointAnnotationEditor;
    if (!editor || editor.editorId !== currentEditorIdRef.current) return;
    if (editor.annotationId) {
      updatePointAnnotation(editor.annotationId, text);
    } else {
      addPointAnnotation({
        text,
        position: editor.position,
        layerId: activeLayerId || layers[0]?.id || '',
        color: '#1890ff',
      });
    }
    saveHistory();
    setPointAnnotationEditor(null);
  }, [pointAnnotationEditor, updatePointAnnotation, addPointAnnotation, saveHistory, activeLayerId, layers]);

  // 区域注释保存
  const handleRegionAnnotationSave = useCallback((text: string) => {
    const editor = regionAnnotationEditor;
    
    if (!editor || editor.editorId !== currentEditorIdRef.current) {
      return;
    }
    
    // 直接更新 store
    if (editor.annotationId) {
      updateRegionAnnotationWithRegionId(editor.annotationId, text, editor.regionId);
    } else {
      addRegionAnnotation({
        text,
        polygon: editor.polygon,
        layerId: activeLayerId || layers[0]?.id || '',
        regionId: editor.regionId,
        color: '#1890ff',
      });
    }
    
    setRegionAnnotationEditor(null);
  }, [regionAnnotationEditor, updateRegionAnnotationWithRegionId, addRegionAnnotation, activeLayerId, layers]);

  // 监听区域注释变化，保存到历史快照（不保存到 localStorage）
  // 使用 ref 标志阻止撤销/重做后的循环保存
  useEffect(() => {
    if (isRestoringRef.current) {
      // 如果是撤销/重做恢复，不保存
      return;
    }
    saveHistory();
  }, [regionAnnotations, saveHistory]);

  // ========== 区域色块图层自动动画循环 ==========
  useEffect(() => {
    // 检查条件：区域色块图层可见且存在启用蒙版特效的注释
    const hasActiveMask = regionAnnotations.some(
      (a) => a.layerId === activeLayerId && a.maskEffect?.enabled
    );
    const isRegionLayerVisible = layerVisibility.regionLayer;

    if (!isRegionLayerVisible || !hasActiveMask || !activeLayerId) {
      // 不满足条件时停止动画循环
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      return;
    }

    const animate = (timestamp: number) => {
      // 节流：按固定间隔烘焙区域色块图层
      if (timestamp - lastBakeTimeRef.current >= BAKE_INTERVAL_MS) {
        // 重新检查条件（防止循环启动后条件变化）
        const currentHasActiveMask = regionAnnotations.some(
          (a) => a.layerId === activeLayerId && a.maskEffect?.enabled
        );
        const currentIsVisible = layerVisibility.regionLayer;

        if (currentHasActiveMask && currentIsVisible && activeLayerId) {
          useAppStore.getState().refreshRegionEntities(activeLayerId);
          lastBakeTimeRef.current = timestamp;
        } else {
          // 条件不再满足，停止循环
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = undefined;
          }
          return;
        }
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // 启动循环
    animationFrameRef.current = requestAnimationFrame(animate);

    // 清理
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [
    regionAnnotations,
    activeLayerId,
    layerVisibility.regionLayer,
  ]);

  // ========== 持续重绘画布循环（用于动画效果实时更新） ==========
  useEffect(() => {
    // 检查条件：区域色块图层可见且存在启用蒙版特效的注释
    const hasActiveMask = regionAnnotations.some(
      (a) => a.layerId === activeLayerId && a.maskEffect?.enabled
    );
    const isRegionLayerVisible = layerVisibility.regionLayer;

    if (!isRegionLayerVisible || !hasActiveMask || !activeLayerId) {
      // 不满足条件时停止重绘循环
      if (renderFrameRef.current) {
        cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = undefined;
      }
      return;
    }

    let frameCount = 0;

    const animateRender = (timestamp: number) => {
      frameCount++;

      // 重新检查条件（防止循环启动后条件变化）
      const currentHasActiveMask = regionAnnotations.some(
        (a) => a.layerId === activeLayerId && a.maskEffect?.enabled
      );
      const currentIsVisible = layerVisibility.regionLayer;

      if (!currentHasActiveMask || !currentIsVisible || !activeLayerId) {
        // 条件不再满足，停止循环
        if (renderFrameRef.current) {
          cancelAnimationFrame(renderFrameRef.current);
          renderFrameRef.current = undefined;
        }
        return;
      }

      // 状态变化检测：每 CHECK_INTERVAL_FRAMES 帧检查一次
      if (frameCount % CHECK_INTERVAL_FRAMES === 0) {
        // 获取当前蒙版特效状态的字符串表示
        const currentLayerAnnotations = regionAnnotations.filter(a => a.layerId === activeLayerId);
        const currentMaskEffectStr = JSON.stringify(currentLayerAnnotations.map(a => a.maskEffect));

        // 如果状态发生变化，立即更新区域色块图层
        if (currentMaskEffectStr !== lastMaskEffectRef.current) {
          useAppStore.getState().refreshRegionEntities(activeLayerId);
          lastMaskEffectRef.current = currentMaskEffectStr;
        }
      }

      // 节流：按固定间隔重绘画布
      if (timestamp - lastRenderTimeRef.current >= RENDER_INTERVAL_MS) {
        drawCanvas();
        lastRenderTimeRef.current = timestamp;
      }

      renderFrameRef.current = requestAnimationFrame(animateRender);
    };

    // 初始化状态
    const initialLayerAnnotations = regionAnnotations.filter(a => a.layerId === activeLayerId);
    lastMaskEffectRef.current = JSON.stringify(initialLayerAnnotations.map(a => a.maskEffect));

    // 启动重绘循环
    renderFrameRef.current = requestAnimationFrame(animateRender);

    // 清理
    return () => {
      if (renderFrameRef.current) {
        cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = undefined;
      }
    };
  }, [
    regionAnnotations,
    activeLayerId,
    layerVisibility.regionLayer,
    drawCanvas,
  ]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: currentTool === 'move' ? 'move' : (isPanning ? 'grabbing' : (isPanMode ? 'grab' : 'default')) }}>
      <div style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {showDebugRegions && (
          <div style={{
            background: 'rgba(0,0,0,0.9)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
          }}>
            {/* 第一行：区域选择、外部ID选择、原始模式 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>区域:</span>
              <input
                type="number"
                min="0"
                value={debugRegionId}
                onChange={e => setDebugRegionId(Math.max(0, parseInt(e.target.value) || 0))}
                style={{ width: 50, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugRegionId(prev => prev - 1)} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugRegionId(prev => prev + 1)} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ fontSize: 10, opacity: 0.7 }}>(0=全部)</span>
              <span style={{ marginLeft: 12 }}>外部ID:</span>
              <input
                type="number"
                value={debugOutsideId}
                onChange={e => setDebugOutsideId(parseInt(e.target.value) || -1)}
                style={{ width: 50, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugOutsideId(prev => prev - 1)} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugOutsideId(prev => prev + 1)} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ fontSize: 10, opacity: 0.7 }}>(-1=全部)</span>
              <span style={{ marginLeft: 12 }}>原始:</span>
              <button
                onClick={() => setDebugShowOriginal(prev => !prev)}
                style={{
                  padding: '2px 6px',
                  background: debugShowOriginal ? '#4CAF50' : '#666',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  fontSize: 11,
                }}
              >{debugShowOriginal ? '是' : '否'}</button>
            </div>
            {/* 第二行：距离阈值、降采样、端点信息 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>欧式距离:</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.01"
                value={debugDistanceThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugDistanceThreshold(Math.max(0, Math.min(5, val)));
                }}
                style={{ width: 60, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugDistanceThreshold(prev => Math.max(0, prev - 0.1))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugDistanceThreshold(prev => Math.min(5, prev + 0.1))} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ marginLeft: 12 }}>径向距离:</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.01"
                value={debugRadialThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugRadialThreshold(Math.max(0, Math.min(5, val)));
                }}
                style={{ width: 60, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugRadialThreshold(prev => Math.max(0, prev - 0.1))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugRadialThreshold(prev => Math.min(5, prev + 0.1))} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ marginLeft: 12 }}>降采样:</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={debugDownsampleFactor}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugDownsampleFactor(Math.max(0, Math.min(1, val)));
                }}
                style={{ width: 60, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugDownsampleFactor(prev => Math.max(0, prev - 0.05))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugDownsampleFactor(prev => Math.min(1, prev + 0.05))} style={{ padding: '2px 6px' }}>+</button>
            </div>
            {/* 第三行：环拼接阈值 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span>环拼接:</span>
              <span style={{ fontSize: 11 }}>欧氏</span>
              <input
                type="number"
                min="0"
                max="20"
                step="0.1"
                value={debugRingDistanceThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugRingDistanceThreshold(Math.max(0, Math.min(20, val)));
                }}
                style={{ width: 50, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugRingDistanceThreshold(prev => Math.max(0, prev - 0.5))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugRingDistanceThreshold(prev => Math.min(20, prev + 0.5))} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ fontSize: 11 }}>径向</span>
              <input
                type="number"
                min="0"
                max="20"
                step="0.1"
                value={debugRingRadialThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugRingRadialThreshold(Math.max(0, Math.min(20, val)));
                }}
                style={{ width: 50, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugRingRadialThreshold(prev => Math.max(0, prev - 0.5))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugRingRadialThreshold(prev => Math.min(20, prev + 0.5))} style={{ padding: '2px 6px' }}>+</button>
              <div style={{ marginLeft: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={debugShowEndpoints}
                    onChange={(e) => setDebugShowEndpoints(e.target.checked)}
                  />
                  <span>端点信息</span>
                </label>
              </div>
              <div style={{ marginLeft: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={debugShowRings}
                    onChange={(e) => setDebugShowRings(e.target.checked)}
                  />
                  <span>绘制环</span>
                </label>
              </div>
              <div style={{ marginLeft: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={debugShowSegments}
                    onChange={(e) => setDebugShowSegments(e.target.checked)}
                  />
                  <span>绘制片段</span>
                </label>
              </div>
              <div style={{ marginLeft: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={debugShowWallGrouped}
                    onChange={(e) => setDebugShowWallGrouped(e.target.checked)}
                  />
                  <span>墙分组点</span>
                </label>
              </div>
            </div>
          </div>
        )}
        <div ref={canvasWrapperRef} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', position: 'relative', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            style={{
              imageRendering: 'auto',
              display: 'block',
              maxWidth: '100%',
              maxHeight: '100%',
              cursor: colorExtractWaiting ? 'crosshair' : (currentTool === 'move' ? 'move' : (isPanning ? 'grabbing' : (isPanMode ? 'grab' : 'default'))),
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={handleCanvasClick}
            onDoubleClick={handleDoubleClick}
          />
        </div>
      </div>
      {pointAnnotationEditor && (
        <AnnotationEditor
          x={pointAnnotationEditor.x}
          y={pointAnnotationEditor.y}
          annotationId={pointAnnotationEditor.annotationId}
          existingText={pointAnnotationEditor.existingText}
          onSave={handlePointAnnotationSave}
          onCancel={() => setPointAnnotationEditor(null)}
        />
      )}
      {regionAnnotationEditor && (
        <AnnotationEditor
          x={regionAnnotationEditor.x}
          y={regionAnnotationEditor.y}
          annotationId={regionAnnotationEditor.annotationId}
          existingText={regionAnnotationEditor.existingText}
          onSave={handleRegionAnnotationSave}
          onCancel={() => setRegionAnnotationEditor(null)}
        />
      )}
    </div>
  );
}