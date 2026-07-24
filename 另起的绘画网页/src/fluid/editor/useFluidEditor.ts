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
    enableLevelSet: false,
    gravity: 1000,
    injection: {
      enabled: true,
      position: { x: 0.5, y: 0.05 },
      radius: 0.1,
      rate: 15,
      velocity: { x: 0, y: 200 },
      color: [0.0, 0.8, 1.0, 1.0],
    },
    ...initialConfig,
  }));

  // ==================== 初始化编辑器 ====================
  useEffect(() => {
    if (!renderer) return;

    const ed = new FluidEditor(renderer, config);
    editorRef.current = ed;
    setEditor(ed);

    return () => {
      ed.dispose();
      editorRef.current = null;
      setEditor(null);
    };
  }, [renderer]); // eslint-disable-line react-hooks/exhaustive-deps

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
    (updates: Partial<FluidEditorConfig>) => {
      setConfig((prev) => {
        const next = { ...prev, ...updates };
        // 同步到 editor（分辨率变化会触发网格重建）
        editorRef.current?.updateConfig(updates);
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

  return {
    editor,
    config,
    updateConfig,
    viewMode,
    setView,
    getDisplayTexture,
  };
}
