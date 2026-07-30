import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { FluidEditor } from './FluidEditor';
import type { FluidEditorConfig, ViewMode } from './FluidEditor';

export function useFluidEditor(
  renderer: THREE.WebGLRenderer | null,
  initialConfig?: Partial<FluidEditorConfig>,
) {
  const editorRef = useRef<FluidEditor | null>(null);
  const [editor, setEditor] = useState<FluidEditor | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('color');
  const animFrameRef = useRef<number>();
  const lastTimeRef = useRef<number>(performance.now());

  // 配置（和 FluidEditor.config 保持同一个对象引用，避免不同步）
  const [config, setConfig] = useState<FluidEditorConfig>(() => ({
    resolution: { w: 256, h: 256 },
    channels: { r: true, g: true, b: true, a: true },
    enableAdvection: true,
    enablePressure: false,
    pressureIterations: 20,
    pressureOmega: 1.7,
    pressureBoundaryMode: 'neumann',
    enableWarmStart: true,
    enableLevelSet: false,
    gravity: 250, // 正值向下（屏幕坐标系）
    velocityDataType: 'float', // 速度场数据类型：'float'(32位) 或 'half-float'(16位)
    injection: {
      enabled: true,
      position: { x: 0.5, y: 0.25 }, // Y向下为正，0.25 = 靠近顶部（25%位置）
      radius: 0.1,
      rate: 15,
      velocity: { x: 0, y: -50 }, // 负Y=向下
      color: [0.0, 0.8, 1.0, 1.0],
    },
    colorBoundaryMode: 'clamp',
    ...initialConfig,
  }));

  // ==================== 初始化编辑器 ====================
  // 只在 renderer 变化时创建/销毁编辑器，config 变化通过 updateConfig 同步
  useEffect(() => {
    if (!renderer) {
      return;
    }

    const ed = new FluidEditor(renderer, configRef.current);
    editorRef.current = ed;
    setEditor(ed);

    return () => {
      ed.dispose();
      editorRef.current = null;
      setEditor(null);
    };
  }, [renderer]);

  // config 变化时同步到已有编辑器（不重建）
  const configRef = useRef(config);
  configRef.current = config;
  useEffect(() => {
    editorRef.current?.updateConfig(config);
  }, [config]);

  // ==================== 动画循环 ====================
  useEffect(() => {
    if (!editor) return;

    lastTimeRef.current = performance.now();

    const step = (timestamp: number) => {
      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = timestamp;

      if (dt > 0) {
        editor.step(dt);
      }
      animFrameRef.current = requestAnimationFrame(step);
    };

    animFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [editor]);

  // ==================== 配置更新 ====================
  const updateConfig = useCallback(
    (updates: Partial<FluidEditorConfig> | ((prev: FluidEditorConfig) => Partial<FluidEditorConfig>)) => {
      setConfig((prev) => {
        const nextUpdates = typeof updates === 'function' ? updates(prev) : updates;
        const next = { ...prev, ...nextUpdates };
        // 同步到 editor（分辨率变化会触发网格重建）
        editorRef.current?.updateConfig(nextUpdates);
        return next;
      });
    },
    [],
  );

  // ==================== 视口模式 ====================
  const setView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  // ==================== 显示纹理 ====================
  const getDisplayTexture = useCallback((): THREE.Texture | null => {
    const ed = editorRef.current;
    if (!ed) return null;

    switch (viewMode) {
      case 'color':
        return ed.getColorTexture();
      case 'velocity':
        return ed.getVelocityTexture();
      default:
        return null;
    }
  }, [viewMode]);

  // ==================== 重置 ====================
  const reset = useCallback(() => {
    editorRef.current?.initFields();
  }, []);

  // ==================== 用户交互注入 ====================

  /**
   * 注入一滴水（颜色 + 速度）。
   * 水会带有向下的冲力，模拟真实水流。
   *
   * @param pos 归一化位置 (0~1, Y向下为正)
   * @param radius 归一化半径
   * @param color RGBA 颜色值 (0~1)
   * @param velocity 速度矢量 (像素/秒, Y向下为正)
   * @param strength 注入强度倍率 (1.0 = 默认)
   */
  const injectWater = useCallback((
    pos: { x: number; y: number },
    radius: number = 0.12,
    color: [number, number, number, number] = [0.0, 0.8, 1.0, 1.0],
    velocity: { x: number; y: number } = { x: 0, y: -80 },
    strength: number = 1.0,
  ) => {
    const ed = editorRef.current;
    if (!ed) return;

    ed.queueInjection({
      enabled: true,
      position: pos,
      radius,
      rate: 0.6 * strength, // 注入速率乘以强度倍率
      velocity: { x: velocity.x * strength, y: velocity.y * strength },
      color,
    });
  }, []);

  /**
   * 注入一泼颜色（无速度，纯颜料）。
   * 颜料会跟随现有的速度场流动扩散。
   *
   * @param pos 归一化位置 (0~1, Y向下为正)
   * @param radius 归一化半径
   * @param color RGBA 颜色值 (0~1)
   */
  const injectColorOnly = useCallback((
    pos: { x: number; y: number },
    radius: number = 0.1,
    color: [number, number, number, number] = [1.0, 0.2, 0.2, 1.0],
  ) => {
    const ed = editorRef.current;
    if (!ed) return;

    ed.queueInjection({
      enabled: true,
      position: pos,
      radius,
      rate: 0.5,
      velocity: { x: 0, y: 0 },
      color,
    });
  }, []);

  return {
    editor,
    config,
    updateConfig,
    viewMode,
    setView,
    getDisplayTexture,
    reset,
    // 暴露注入方法
    injectWater,
    injectColorOnly,
  };
}
