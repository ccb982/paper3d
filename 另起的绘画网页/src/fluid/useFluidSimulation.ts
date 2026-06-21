import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { FluidSimulatorAdapter } from './FluidSimulatorAdapter';
import type { FluidParams } from '@fluid/fluid-simulator/FluidSimulator';

export interface UseFluidSimulationOptions {
  width?: number;
  height?: number;
  autoStart?: boolean;
  initialLevelSet?: Float32Array;
  solidMask?: Uint8Array;
}

export interface UseFluidSimulationReturn {
  adapter: FluidSimulatorAdapter | null;
  material: THREE.ShaderMaterial | null;
  width: number;
  height: number;
  isInitialized: boolean;
  isRunning: boolean;
  start: () => void;
  stop: () => void;
  update: (delta?: number) => void;
  explode: (
    cx: number,
    cy: number,
    radius: number,
    strength: number,
    createWater?: boolean,
    duration?: number
  ) => void;
  addVelocityImpulse: (
    dvx: number,
    dvy: number,
    radius: number,
    cx: number,
    cy: number
  ) => void;
  setSolidMask: (mask: Uint8Array) => void;
}

export function useFluidSimulation(
  renderer: THREE.WebGLRenderer | null,
  options: UseFluidSimulationOptions = {}
): UseFluidSimulationReturn {
  const {
    width = 512,
    height = 256,
    autoStart = true,
    initialLevelSet,
    solidMask,
  } = options;

  const adapterRef = useRef<FluidSimulatorAdapter | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());

  // 初始化流体模拟器
  useEffect(() => {
    if (!renderer) return;

    // 创建适配器参数
    const params: Partial<FluidParams> = {
      width,
      height,
    };

    // 创建初始 level set 纹理
    if (initialLevelSet) {
      const dataTexture = new THREE.DataTexture(
        initialLevelSet,
        width,
        height,
        THREE.RedFormat,
        THREE.FloatType
      );
      dataTexture.needsUpdate = true;
      params.initialLevelSet = dataTexture;
    }

    // 使用适配器创建流体模拟
    const adapter = new FluidSimulatorAdapter(renderer, params);

    // 设置固体掩码
    if (solidMask) {
      const maskTexture = new THREE.DataTexture(
        solidMask,
        width,
        height,
        THREE.RedFormat,
        THREE.UnsignedByteType
      );
      maskTexture.needsUpdate = true;
      adapter.setSolidMaskTexture(maskTexture);
    }

    adapterRef.current = adapter;
    materialRef.current = adapter.getMaterial();
    setIsInitialized(true);

    console.log('[useFluidSimulation] 流体适配器初始化完成:', { width, height });

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      adapter.dispose();
      adapterRef.current = null;
      materialRef.current = null;
      setIsInitialized(false);
      setIsRunning(false);
    };
  }, [renderer, width, height, initialLevelSet, solidMask]);

  // 启动模拟循环
  const start = useCallback(() => {
    if (!adapterRef.current || isRunning) return;

    setIsRunning(true);
    lastTimeRef.current = performance.now();

    const loop = () => {
      if (!adapterRef.current) return;

      const now = performance.now();
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      adapterRef.current.update(delta);
      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    console.log('[useFluidSimulation] 模拟已启动');
  }, [isRunning]);

  // 停止模拟
  const stop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsRunning(false);
    console.log('[useFluidSimulation] 模拟已停止');
  }, []);

  // 手动更新（由外部调用）
  const update = useCallback((delta?: number) => {
    if (!adapterRef.current) return;
    adapterRef.current.update(delta);
  }, []);

  // 爆炸效果
  const explode = useCallback((
    cx: number,
    cy: number,
    radius: number,
    strength: number,
    createWater: boolean = true,
    duration: number = 0.1
  ) => {
    if (!adapterRef.current) return;
    adapterRef.current.explode(cx, cy, radius, strength, createWater, duration);
  }, []);

  // 添加速度脉冲
  const addVelocityImpulse = useCallback((
    dvx: number,
    dvy: number,
    radius: number,
    cx: number,
    cy: number
  ) => {
    if (!adapterRef.current) return;
    adapterRef.current.addVelocityImpulse(dvx, dvy, radius, cx, cy);
  }, []);

  // 设置固体掩码
  const setSolidMask = useCallback((mask: Uint8Array) => {
    if (!adapterRef.current) return;
    const maskTexture = new THREE.DataTexture(
      mask,
      width,
      height,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    maskTexture.needsUpdate = true;
    adapterRef.current.setSolidMaskTexture(maskTexture);
  }, [width, height]);

  // 自动启动
  useEffect(() => {
    if (autoStart && isInitialized && !isRunning) {
      start();
    }
  }, [autoStart, isInitialized, isRunning, start]);

  return {
    adapter: adapterRef.current,
    material: materialRef.current,
    width: adapterRef.current?.width ?? 512,
    height: adapterRef.current?.height ?? 512,
    isInitialized,
    isRunning,
    start,
    stop,
    update,
    explode,
    addVelocityImpulse,
    setSolidMask,
  };
}