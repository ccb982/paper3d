import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useFluidSimulation } from './useFluidSimulation';

export interface FluidPreviewProps {
  visible?: boolean;
  initialLevelSet?: Float32Array;
  solidMask?: Uint8Array;
  onInitialized?: (adapter: any, material: THREE.ShaderMaterial) => void;
}

export function FluidPreview({
  visible = true,
  initialLevelSet,
  solidMask,
  onInitialized,
}: FluidPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const quadRef = useRef<THREE.Mesh | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const [isReady, setIsReady] = useState(false);

  // 使用 fluid simulation hook
  const {
    adapter,
    material,
    width,
    height,
    isInitialized,
    isRunning,
    update,
    explode,
    addVelocityImpulse,
  } = useFluidSimulation(rendererRef.current, {
    autoStart: false,
    initialLevelSet,
    solidMask,
  });

  // 初始化 Three.js 环境
  useEffect(() => {
    if (!containerRef.current) return;

    // 创建 WebGL 渲染器
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(1); // 固定分辨率，不缩放
    renderer.setClearColor(0x000000, 0);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 创建场景
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 创建正交相机
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cameraRef.current = camera;

    // 创建全屏四边形
    const geometry = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(geometry);
    scene.add(quad);
    quadRef.current = quad;

    console.log('[FluidPreview] Three.js 环境初始化完成');
    setIsReady(true);

    return () => {
      renderer.dispose();
      geometry.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      quadRef.current = null;
    };
  }, [width, height]);

  // 设置材质
  useEffect(() => {
    if (material && quadRef.current) {
      quadRef.current.material = material;
      console.log('[FluidPreview] 材质已设置');
    }
  }, [material]);

  // 通知父组件初始化完成
  useEffect(() => {
    if (isInitialized && adapter && material && onInitialized) {
      onInitialized(adapter, material);
    }
  }, [isInitialized, adapter, material, onInitialized]);

  // 渲染循环
  useEffect(() => {
    if (!isReady || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    let animationId: number;

    const render = () => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

      // 更新流体模拟
      update();

      // 渲染场景
      rendererRef.current.render(sceneRef.current, cameraRef.current);

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isReady, update]);

  // 鼠标交互：拖拽搅动流体
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const uvX = (e.clientX - rect.left) / rect.width;
    const uvY = 1.0 - (e.clientY - rect.top) / rect.height;

    // 根据鼠标移动速度添加脉冲
    // 这里简化处理，实际可以跟踪 mouse delta
    addVelocityImpulse(0.1, 0.1, 0.05, uvX, uvY);
  }, [addVelocityImpulse]);

  // 点击触发爆炸
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const uvX = (e.clientX - rect.left) / rect.width;
    const uvY = 1.0 - (e.clientY - rect.top) / rect.height;

    explode(uvX, uvY, 0.1, 25000, true, 0.2);
    console.log(`[FluidPreview] 点击爆炸: uv=(${uvX.toFixed(2)}, ${uvY.toFixed(2)})`);
  }, [explode]);

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'auto',
        cursor: 'crosshair',
        background: '#0a0a15',
        border: '2px solid #e94560',
        boxShadow: '0 0 20px rgba(233, 69, 96, 0.3)',
      }}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    />
  );
}