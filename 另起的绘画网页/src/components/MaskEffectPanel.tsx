import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { RegionAnnotation } from '../types';

export function MaskEffectPanel() {
  const {
    regionAnnotations,
    activeLayerId,
    updateRegionDisplacementOnly,
    layerVisibility,
    triggerCanvasRedraw,
    forceCPUMode,
    regionAnimationSpeed,
    setRegionAnimationSpeed,
    isVertexPinMode,
    setVertexPinMode,
    vertexPinRadius,
    setVertexPinRadius,
    isVertexPinEraserMode,
    setVertexPinEraserMode,
    showRegionBorderWebGL,
    setShowRegionBorderWebGL,
    showRegionBorder2D,
    setShowRegionBorder2D,
    refreshRegionEntities,
    refreshRegionCache,
  } = useAppStore();

  // 用 useMemo 缓存当前图层注释，并过滤掉无效 regionId
  const layerAnnotations = useMemo(() => {
    if (!activeLayerId) return [];
    return regionAnnotations.filter((a: RegionAnnotation) =>
      a.layerId === activeLayerId && a.regionId !== undefined && a.regionId !== null
    );
  }, [regionAnnotations, activeLayerId]);

  // 当 activeLayerId 变化时，重置选中状态，并刷新区域实体
  useEffect(() => {
    setSelectedAnnotationId(null);
    setEditingAnno(null);
    if (activeLayerId) {
      refreshRegionCache(activeLayerId);
      refreshRegionEntities(activeLayerId);
    }
  }, [activeLayerId, refreshRegionCache, refreshRegionEntities]);

  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [editingAnno, setEditingAnno] = useState<RegionAnnotation | null>(null);

  const [isRandomizing, setIsRandomizing] = useState(false);
  const [randomIntervalSeconds, setRandomIntervalSeconds] = useState(30);
  const randomIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseMaskEffectRef = useRef<any>(null);

  const [randomRanges, setRandomRanges] = useState({
    positionX: 0.02,
    positionY: 0.02,
    scaleX: 0.1,
    scaleY: 0.1,
    rotation: 0.2,
    amplitude: 0.01,
    frequency: 0.4,
    speed: 0.4,
    phase: 0.2,
    falloffRadius: 0.04,
    seed: 20,
  });

  // 当选择变化时更新编辑状态
  useEffect(() => {
    if (selectedAnnotationId) {
      const anno = regionAnnotations.find((a: RegionAnnotation) => a.id === selectedAnnotationId);
      setEditingAnno(anno ? JSON.parse(JSON.stringify(anno)) : null);
    } else {
      setEditingAnno(null);
    }
  }, [selectedAnnotationId, regionAnnotations]);

  // 初始化选中第一个有maskEffect的注释
  useEffect(() => {
    if (!selectedAnnotationId && layerAnnotations.length > 0) {
      const annoWithMask = layerAnnotations.find((a: RegionAnnotation) => a.maskEffect?.enabled);
      if (annoWithMask) {
        setSelectedAnnotationId(annoWithMask.id);
      } else {
        setSelectedAnnotationId(layerAnnotations[0].id);
      }
    }
  }, [layerAnnotations, selectedAnnotationId]);

  // 更新maskEffect启用状态
  const handleToggleEnabled = () => {
    if (!editingAnno) return;
    const currentEnabled = editingAnno.maskEffect?.enabled;
    const currentLayerId = activeLayerId;
    
    // 如果当前未启用或没有maskEffect，创建新的maskEffect
    if (!currentEnabled) {
      const newMaskEffect = createDefaultMaskEffect();
      const updated = {
        ...editingAnno,
        maskEffect: newMaskEffect,
        updatedAt: Date.now(),
      };
      // 更新store
      const store = useAppStore.getState();
      const idx = store.regionAnnotations.findIndex((a: RegionAnnotation) => a.id === editingAnno.id);
      if (idx >= 0) {
        const newAnnotations = [...store.regionAnnotations];
        newAnnotations[idx] = updated;
        useAppStore.setState({ regionAnnotations: newAnnotations });
      }
      setEditingAnno(updated);
      // 立即更新位移纹理（不重建实体）
      if (currentLayerId) {
        updateRegionDisplacementOnly(currentLayerId);
      }
      // 触发画布重绘（更新实时预览边框）
      triggerCanvasRedraw();
    } else {
      // 如果当前已启用，禁用它（移除maskEffect）
      const updated = {
        ...editingAnno,
        maskEffect: undefined,
        updatedAt: Date.now(),
      };
      // 更新store
      const store = useAppStore.getState();
      const idx = store.regionAnnotations.findIndex((a: RegionAnnotation) => a.id === editingAnno.id);
      if (idx >= 0) {
        const newAnnotations = [...store.regionAnnotations];
        newAnnotations[idx] = updated;
        useAppStore.setState({ regionAnnotations: newAnnotations });
      }
      setEditingAnno(updated);
      // 立即更新位移纹理（不重建实体）
      if (currentLayerId) {
        updateRegionDisplacementOnly(currentLayerId);
      }
      // 触发画布重绘（更新实时预览边框）
      triggerCanvasRedraw();
    }
  };

  // 创建默认maskEffect
  const createDefaultMaskEffect = () => ({
    enabled: true,
    transform: {
      position: { x: 0, y: 0 },
      anchor: null,
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    distortions: [],
  });

  // 添加扭曲效果
  const handleAddDistortion = (type: 'wave' | 'turbulent' | 'twirl') => {
    if (!editingAnno) return;
    const newDistortion = {
      id: `distortion_${Date.now()}`,
      type,
      enabled: true,
      amplitude: 0.05,
      frequency: 1,
      speed: 1,
      phase: 0,
      direction: 'normal' as const,
      center: { x: 0.5, y: 0.5 },
      falloffRadius: 0.5,
      seed: Math.random() * 1000,
      octaves: 3,
    };
    const maskEffect = editingAnno.maskEffect || createDefaultMaskEffect();
    const updated = {
      ...editingAnno,
      maskEffect: {
        ...maskEffect,
        distortions: [...(maskEffect.distortions || []), newDistortion],
      },
      updatedAt: Date.now(),
    };
    // 更新store
    const store = useAppStore.getState();
    const idx = store.regionAnnotations.findIndex((a: RegionAnnotation) => a.id === editingAnno.id);
    if (idx >= 0) {
      const newAnnotations = [...store.regionAnnotations];
      newAnnotations[idx] = updated;
      useAppStore.setState({ regionAnnotations: newAnnotations });
    }
    setEditingAnno(updated);
    // 立即更新位移纹理（不重建实体）
      if (activeLayerId) {
        updateRegionDisplacementOnly(activeLayerId);
      }
    // 触发画布重绘（更新实时预览边框）
    triggerCanvasRedraw();
  };

  // 删除扭曲效果
  const handleRemoveDistortion = (distortionId: string) => {
    if (!editingAnno || !editingAnno.maskEffect) return;
    const updated = {
      ...editingAnno,
      maskEffect: {
        ...editingAnno.maskEffect,
        distortions: editingAnno.maskEffect.distortions.filter(d => d.id !== distortionId),
      },
      updatedAt: Date.now(),
    };
    const store = useAppStore.getState();
    const idx = store.regionAnnotations.findIndex((a: RegionAnnotation) => a.id === editingAnno.id);
    if (idx >= 0) {
      const newAnnotations = [...store.regionAnnotations];
      newAnnotations[idx] = updated;
      useAppStore.setState({ regionAnnotations: newAnnotations });
    }
    setEditingAnno(updated);
    // 立即更新位移纹理（不重建实体）
      if (activeLayerId) {
        updateRegionDisplacementOnly(activeLayerId);
      }
    // 触发画布重绘（更新实时预览边框）
    triggerCanvasRedraw();
  };

  // 更新扭曲效果参数
  const handleUpdateDistortion = (distortionId: string, updates: Partial<{
    id: string;
    type: 'wave' | 'turbulent' | 'twirl';
    enabled: boolean;
    amplitude: number;
    frequency: number;
    speed: number;
    phase: number;
    direction?: 'normal' | 'tangent' | 'xy';
    center?: { x: number; y: number };
    falloffRadius?: number;
    seed?: number;
    octaves?: number;
  }>) => {
    if (!editingAnno || !editingAnno.maskEffect) return;
    const updated = {
      ...editingAnno,
      maskEffect: {
        ...editingAnno.maskEffect,
        distortions: editingAnno.maskEffect.distortions.map(d =>
          d.id === distortionId ? { ...d, ...updates } : d
        ),
      },
      updatedAt: Date.now(),
    };
    const store = useAppStore.getState();
    const idx = store.regionAnnotations.findIndex((a: RegionAnnotation) => a.id === editingAnno.id);
    if (idx >= 0) {
      const newAnnotations = [...store.regionAnnotations];
      newAnnotations[idx] = updated;
      useAppStore.setState({ regionAnnotations: newAnnotations });
    }
    setEditingAnno(updated);
    // 立即更新位移纹理（不重建实体）
      if (activeLayerId) {
        updateRegionDisplacementOnly(activeLayerId);
      }
    // 触发画布重绘（更新实时预览边框）
    triggerCanvasRedraw();
  };

  // 更新变换参数
  const handleUpdateTransform = (updates: Partial<{
    position: { x: number; y: number };
    anchor: { x: number; y: number } | null;
    rotation: number;
    scale: { x: number; y: number };
  }>) => {
    if (!editingAnno) return;
    const maskEffect = editingAnno.maskEffect || createDefaultMaskEffect();
    const updated = {
      ...editingAnno,
      maskEffect: {
        ...maskEffect,
        transform: { ...maskEffect.transform, ...updates },
      },
      updatedAt: Date.now(),
    };
    const store = useAppStore.getState();
    const idx = store.regionAnnotations.findIndex((a: RegionAnnotation) => a.id === editingAnno.id);
    if (idx >= 0) {
      const newAnnotations = [...store.regionAnnotations];
      newAnnotations[idx] = updated;
      useAppStore.setState({ regionAnnotations: newAnnotations });
    }
    setEditingAnno(updated);
    // 立即更新位移纹理（不重建实体）
      if (activeLayerId) {
        updateRegionDisplacementOnly(activeLayerId);
      }
    // 触发画布重绘（更新实时预览边框）
    triggerCanvasRedraw();
  };

  const randomizeParameters = useCallback(() => {
    const base = baseMaskEffectRef.current;
    if (!base || !editingAnno) return;

    const newMaskEffect = JSON.parse(JSON.stringify(base));
    const trans = newMaskEffect.transform;
    const baseTrans = base.transform;

    trans.position.x = Math.max(-0.5, Math.min(0.5, baseTrans.position.x + (Math.random() - 0.5) * randomRanges.positionX * 2));
    trans.position.y = Math.max(-0.5, Math.min(0.5, baseTrans.position.y + (Math.random() - 0.5) * randomRanges.positionY * 2));

    trans.scale.x = Math.max(0.1, Math.min(3.0, baseTrans.scale.x + (Math.random() - 0.5) * randomRanges.scaleX * 2));
    trans.scale.y = Math.max(0.1, Math.min(3.0, baseTrans.scale.y + (Math.random() - 0.5) * randomRanges.scaleY * 2));

    trans.rotation = baseTrans.rotation + (Math.random() - 0.5) * randomRanges.rotation * 2;

    if (newMaskEffect.distortions && base.distortions) {
      for (let i = 0; i < newMaskEffect.distortions.length; i++) {
        const dist = newMaskEffect.distortions[i];
        const baseDist = base.distortions[i];
        if (!baseDist) continue;

        dist.amplitude = Math.max(0, Math.min(0.3, baseDist.amplitude + (Math.random() - 0.5) * randomRanges.amplitude * 2));
        dist.frequency = Math.max(0.1, Math.min(10, baseDist.frequency + (Math.random() - 0.5) * randomRanges.frequency * 2));
        dist.speed = Math.max(-5, Math.min(5, baseDist.speed + (Math.random() - 0.5) * randomRanges.speed * 2));
        dist.phase = Math.max(0, Math.min(6.28, baseDist.phase + (Math.random() - 0.5) * randomRanges.phase * 2));

        if (dist.falloffRadius !== undefined && baseDist.falloffRadius !== undefined) {
          dist.falloffRadius = Math.max(0.01, Math.min(1, baseDist.falloffRadius + (Math.random() - 0.5) * randomRanges.falloffRadius * 2));
        }
        if (dist.seed !== undefined && baseDist.seed !== undefined) {
          dist.seed = Math.max(0, Math.min(1000, baseDist.seed + (Math.random() - 0.5) * randomRanges.seed * 2));
        }
      }
    }

    const store = useAppStore.getState();
    const idx = store.regionAnnotations.findIndex((a: RegionAnnotation) => a.id === editingAnno.id);
    if (idx >= 0) {
      const updatedAnno = {
        ...store.regionAnnotations[idx],
        maskEffect: newMaskEffect,
        updatedAt: Date.now(),
      };
      const newAnnotations = [...store.regionAnnotations];
      newAnnotations[idx] = updatedAnno;
      useAppStore.setState({ regionAnnotations: newAnnotations });

      if (activeLayerId) {
        updateRegionDisplacementOnly(activeLayerId);
      }
      triggerCanvasRedraw();

      setEditingAnno(updatedAnno);
    }
  }, [editingAnno, activeLayerId, updateRegionDisplacementOnly, triggerCanvasRedraw, randomRanges]);

  const toggleRandomizing = useCallback(() => {
    if (isRandomizing) {
      if (randomIntervalRef.current) {
        clearInterval(randomIntervalRef.current);
        randomIntervalRef.current = null;
      }
      setIsRandomizing(false);
      baseMaskEffectRef.current = null;
    } else {
      if (editingAnno?.maskEffect) {
        baseMaskEffectRef.current = JSON.parse(JSON.stringify(editingAnno.maskEffect));
      } else {
        return;
      }
      setIsRandomizing(true);
      randomIntervalRef.current = setInterval(() => {
        randomizeParameters();
      }, randomIntervalSeconds * 1000);
    }
  }, [isRandomizing, randomizeParameters, randomIntervalSeconds, editingAnno]);

  useEffect(() => {
    return () => {
      if (randomIntervalRef.current) {
        clearInterval(randomIntervalRef.current);
        randomIntervalRef.current = null;
      }
    };
  }, []);

  // 如果没有区域注释，不显示面板
  if (layerAnnotations.length === 0) {
    return (
      <div className="sidebar-section">
        <h3>蒙版特效</h3>
        <div style={{ marginTop: '12px', padding: '12px', background: '#fff3cd', borderRadius: '4px', fontSize: '11px', color: '#856404' }}>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ fontWeight: 'bold' }}>⚠️ 未检测到区域注释</span>
          </div>
          <div style={{ marginBottom: '8px', fontSize: '10px', color: '#666' }}>
            当前图层没有区域注释。请先绘制闭合实线区域，然后添加区域注释。
          </div>
          <button
            onClick={() => {
              console.log('[蒙版特效] 强制刷新并检测区域...');
              if (activeLayerId) {
                refreshRegionCache(activeLayerId);
                refreshRegionEntities(activeLayerId);
                const currentAnnotations = useAppStore.getState().regionAnnotations.filter((a: RegionAnnotation) => a.layerId === activeLayerId);
                const currentEntities = useAppStore.getState().regionEntities[activeLayerId] || [];
                console.log(`[蒙版特效] 检测结果：区域实体=${currentEntities.length}个，区域注释=${currentAnnotations.length}个`);
                if (currentAnnotations.length === 0) {
                  console.warn('[蒙版特效] 仍未检测到区域注释，请检查：');
                  console.warn('  1. 是否绘制了闭合实线区域？');
                  console.warn('  2. 是否添加了区域注释（🗺️ 区域注释工具）？');
                  console.warn('  3. 当前选中的图层是否正确？');
                }
              } else {
                console.warn('[蒙版特效] 未选中任何图层');
              }
              triggerCanvasRedraw();
            }}
            className="btn btn-primary"
            style={{ width: '100%', fontSize: '11px', padding: '6px' }}
          >
            🔄 强制刷新并检测区域
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>蒙版特效</h3>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {/* 强制刷新按钮 */}
          <button
            onClick={() => {
              console.log('[蒙版特效] 强制刷新并检测区域...');
              if (activeLayerId) {
                refreshRegionCache(activeLayerId);
                refreshRegionEntities(activeLayerId);
                const currentAnnotations = useAppStore.getState().regionAnnotations.filter((a: RegionAnnotation) => a.layerId === activeLayerId);
                const currentEntities = useAppStore.getState().regionEntities[activeLayerId] || [];
                console.log(`[蒙版特效] 检测结果：区域实体=${currentEntities.length}个，区域注释=${currentAnnotations.length}个`);
                if (currentEntities.length === 0) {
                  console.warn('[蒙版特效] 未检测到区域实体，请检查是否绘制了闭合实线区域');
                }
              } else {
                console.warn('[蒙版特效] 未选中任何图层');
              }
              triggerCanvasRedraw();
            }}
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              background: '#f0f0f0',
              color: '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
            title="强制刷新区域缓存和实体"
          >
            🔄
          </button>
          {/* GPU/CPU 切换按钮 */}
          <button
            onClick={() => {
              const { forceCPUMode, setForceCPUMode, refreshRegionEntities } = useAppStore.getState();
              setForceCPUMode(!forceCPUMode);
              if (layerVisibility.regionLayer && activeLayerId) {
                refreshRegionEntities(activeLayerId);
              }
            }}
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              background: forceCPUMode ? '#FF9800' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
            title="切换 GPU/CPU 渲染模式"
          >
            {forceCPUMode ? '💻 CPU' : '🚀 GPU'}
          </button>
          {editingAnno && (
            <button
              onClick={handleToggleEnabled}
              className={`btn ${editingAnno.maskEffect?.enabled ? 'btn-danger' : 'btn-primary'}`}
              style={{ fontSize: '11px', padding: '2px 8px' }}
            >
              {editingAnno.maskEffect?.enabled ? '关闭' : '启用'}
            </button>
          )}
        </div>
      </div>

      {/* 选择区域注释 */}
      <div style={{ marginTop: '8px' }}>
        <label style={{ fontSize: '11px', color: '#666' }}>选择区域</label>
        <select
          value={selectedAnnotationId || ''}
          onChange={(e) => setSelectedAnnotationId(e.target.value || null)}
          style={{
            width: '100%',
            fontSize: '12px',
            padding: '4px',
            marginTop: '4px',
          }}
        >
          {layerAnnotations.map((anno: RegionAnnotation) => (
            <option key={anno.id} value={anno.id}>
              {anno.text || `区域 ${anno.regionId}`}
            </option>
          ))}
        </select>
      </div>

      {editingAnno && editingAnno.maskEffect?.enabled && (
        <>
          {/* 随机微调 */}
          <div style={{ marginTop: '12px', padding: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <button
                onClick={toggleRandomizing}
                className={`btn ${isRandomizing ? 'btn-warning' : 'btn-primary'}`}
                style={{ flex: 1, fontSize: '11px', padding: '4px' }}
              >
                {isRandomizing ? '⏹ 停止随机微调' : '🎲 随机微调'}
              </button>
              <span style={{ fontSize: '10px', color: '#888' }}>
                {isRandomizing ? `每 ${randomIntervalSeconds} 秒微调一次` : '点击开启持续抖动'}
              </span>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span>微调间隔</span>
                <span>{randomIntervalSeconds} 秒</span>
              </div>
              <input
                type="range"
                min={1}
                max={120}
                step={1}
                value={randomIntervalSeconds}
                onChange={(e) => setRandomIntervalSeconds(parseInt(e.target.value))}
                style={{ width: '100%', marginTop: '4px' }}
              />
            </div>

            {/* 随机范围设置 */}
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #ddd' }}>
              <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '6px' }}>随机范围</div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '10px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>位置X</span>
                    <span style={{ color: '#666' }}>±{randomRanges.positionX.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.2}
                    step={0.005}
                    value={randomRanges.positionX}
                    onChange={(e) => setRandomRanges(r => ({ ...r, positionX: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>位置Y</span>
                    <span style={{ color: '#666' }}>±{randomRanges.positionY.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.2}
                    step={0.005}
                    value={randomRanges.positionY}
                    onChange={(e) => setRandomRanges(r => ({ ...r, positionY: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>缩放X</span>
                    <span style={{ color: '#666' }}>±{randomRanges.scaleX.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={randomRanges.scaleX}
                    onChange={(e) => setRandomRanges(r => ({ ...r, scaleX: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>缩放Y</span>
                    <span style={{ color: '#666' }}>±{randomRanges.scaleY.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={randomRanges.scaleY}
                    onChange={(e) => setRandomRanges(r => ({ ...r, scaleY: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>旋转</span>
                    <span style={{ color: '#666' }}>±{(randomRanges.rotation * 180 / Math.PI).toFixed(1)}°</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.PI}
                    step={0.01}
                    value={randomRanges.rotation}
                    onChange={(e) => setRandomRanges(r => ({ ...r, rotation: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>幅度</span>
                    <span style={{ color: '#666' }}>±{randomRanges.amplitude.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.3}
                    step={0.005}
                    value={randomRanges.amplitude}
                    onChange={(e) => setRandomRanges(r => ({ ...r, amplitude: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>频率</span>
                    <span style={{ color: '#666' }}>±{randomRanges.frequency.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={randomRanges.frequency}
                    onChange={(e) => setRandomRanges(r => ({ ...r, frequency: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>速度</span>
                    <span style={{ color: '#666' }}>±{randomRanges.speed.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={randomRanges.speed}
                    onChange={(e) => setRandomRanges(r => ({ ...r, speed: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>相位</span>
                    <span style={{ color: '#666' }}>±{(randomRanges.phase * 180 / Math.PI).toFixed(1)}°</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.PI}
                    step={0.01}
                    value={randomRanges.phase}
                    onChange={(e) => setRandomRanges(r => ({ ...r, phase: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>衰减半径</span>
                    <span style={{ color: '#666' }}>±{randomRanges.falloffRadius.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.5}
                    step={0.01}
                    value={randomRanges.falloffRadius}
                    onChange={(e) => setRandomRanges(r => ({ ...r, falloffRadius: parseFloat(e.target.value) }))}
                    style={{ width: '100%', marginTop: '2px' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 变换参数 */}
          <div style={{ marginTop: '12px', padding: '8px', background: '#f5f5f5', borderRadius: '4px' }}>
            <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '8px' }}>变换</div>

            {/* 旋转 */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span>旋转</span>
                <span>{((editingAnno.maskEffect.transform.rotation * 180) / Math.PI).toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={(editingAnno.maskEffect.transform.rotation * 180) / Math.PI}
                onChange={(e) => handleUpdateTransform({ rotation: (parseFloat(e.target.value) * Math.PI) / 180 })}
                style={{ width: '100%' }}
              />
            </div>

            {/* 缩放 */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span>缩放 X</span>
                <span>{editingAnno.maskEffect.transform.scale.x.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={3}
                step={0.01}
                value={editingAnno.maskEffect.transform.scale.x}
                onChange={(e) => handleUpdateTransform({ scale: { ...editingAnno.maskEffect!.transform.scale, x: parseFloat(e.target.value) } })}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span>缩放 Y</span>
                <span>{editingAnno.maskEffect.transform.scale.y.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={3}
                step={0.01}
                value={editingAnno.maskEffect.transform.scale.y}
                onChange={(e) => handleUpdateTransform({ scale: { ...editingAnno.maskEffect!.transform.scale, y: parseFloat(e.target.value) } })}
                style={{ width: '100%' }}
              />
            </div>

            {/* 位置偏移 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '10px' }}>偏移 X</label>
                <input
                  type="number"
                  step="0.01"
                  value={editingAnno.maskEffect.transform.position.x.toFixed(2)}
                  onChange={(e) => handleUpdateTransform({ position: { ...editingAnno.maskEffect!.transform.position, x: parseFloat(e.target.value) || 0 } })}
                  style={{ width: '100%', fontSize: '11px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '10px' }}>偏移 Y</label>
                <input
                  type="number"
                  step="0.01"
                  value={editingAnno.maskEffect.transform.position.y.toFixed(2)}
                  onChange={(e) => handleUpdateTransform({ position: { ...editingAnno.maskEffect!.transform.position, y: parseFloat(e.target.value) || 0 } })}
                  style={{ width: '100%', fontSize: '11px' }}
                />
              </div>
            </div>
          </div>

          {/* 动画速度控制 */}
          <div style={{ marginTop: '12px', padding: '8px', background: '#f5f5f5', borderRadius: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
              <span>动画速度</span>
              <span>{regionAnimationSpeed.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={regionAnimationSpeed}
              onChange={(e) => setRegionAnimationSpeed(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          {/* 扭曲效果列表 */}
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '8px' }}>扭曲效果</div>

            {/* 添加扭曲按钮 */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
              <button
                onClick={() => handleAddDistortion('wave')}
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: '11px', padding: '4px' }}
              >
                + 波形
              </button>
              <button
                onClick={() => handleAddDistortion('turbulent')}
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: '11px', padding: '4px' }}
              >
                + 湍流
              </button>
              <button
                onClick={() => handleAddDistortion('twirl')}
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: '11px', padding: '4px' }}
              >
                + 漩涡
              </button>
            </div>

            {/* 扭曲效果参数 */}
            {editingAnno.maskEffect.distortions.map((dist) => (
              <div
                key={dist.id}
                style={{
                  marginBottom: '12px',
                  padding: '8px',
                  background: '#fff',
                  borderRadius: '4px',
                  border: '1px solid #e8e8e8',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 'bold' }}>
                    {dist.type === 'wave' ? '波形' : dist.type === 'turbulent' ? '湍流' : '漩涡'}
                  </span>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={dist.enabled}
                      onChange={(e) => handleUpdateDistortion(dist.id, { enabled: e.target.checked })}
                    />
                    <button
                      onClick={() => handleRemoveDistortion(dist.id)}
                      className="btn btn-danger"
                      style={{ fontSize: '10px', padding: '2px 6px' }}
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* 幅度 */}
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                    <span>幅度</span>
                    <span>{dist.amplitude.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.3}
                    step={0.001}
                    value={dist.amplitude}
                    onChange={(e) => handleUpdateDistortion(dist.id, { amplitude: parseFloat(e.target.value) })}
                    style={{ width: '100%' }}
                    disabled={!dist.enabled}
                  />
                </div>

                {/* 频率 */}
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                    <span>频率</span>
                    <span>{dist.frequency.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={dist.frequency}
                    onChange={(e) => handleUpdateDistortion(dist.id, { frequency: parseFloat(e.target.value) })}
                    style={{ width: '100%' }}
                    disabled={!dist.enabled}
                  />
                </div>

                {/* 速度 */}
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                    <span>速度</span>
                    <span>{dist.speed.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={-5}
                    max={5}
                    step={0.1}
                    value={dist.speed}
                    onChange={(e) => handleUpdateDistortion(dist.id, { speed: parseFloat(e.target.value) })}
                    style={{ width: '100%' }}
                    disabled={!dist.enabled}
                  />
                </div>

                {/* 相位 */}
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                    <span>相位</span>
                    <span>{dist.phase.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={6.28}
                    step={0.01}
                    value={dist.phase}
                    onChange={(e) => handleUpdateDistortion(dist.id, { phase: parseFloat(e.target.value) })}
                    style={{ width: '100%' }}
                    disabled={!dist.enabled}
                  />
                </div>

                {/* 波形特有参数 */}
                {dist.type === 'wave' && (
                  <div style={{ marginBottom: '6px' }}>
                    <label style={{ fontSize: '10px' }}>方向</label>
                    <select
                      value={dist.direction || 'normal'}
                      onChange={(e) => handleUpdateDistortion(dist.id, { direction: e.target.value as 'normal' | 'tangent' | 'xy' })}
                      style={{ width: '100%', fontSize: '11px' }}
                      disabled={!dist.enabled}
                    >
                      <option value="normal">法线</option>
                      <option value="tangent">切线</option>
                      <option value="xy">XY</option>
                    </select>
                  </div>
                )}

                {/* 漩涡特有参数 */}
                {dist.type === 'twirl' && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '6px' }}>
                      <div>
                        <label style={{ fontSize: '10px' }}>中心 X</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          value={(dist.center?.x || 0.5).toFixed(2)}
                          onChange={(e) => handleUpdateDistortion(dist.id, { center: { ...dist.center!, x: parseFloat(e.target.value) || 0 } })}
                          style={{ width: '100%', fontSize: '11px' }}
                          disabled={!dist.enabled}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px' }}>中心 Y</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          value={(dist.center?.y || 0.5).toFixed(2)}
                          onChange={(e) => handleUpdateDistortion(dist.id, { center: { ...dist.center!, y: parseFloat(e.target.value) || 0 } })}
                          style={{ width: '100%', fontSize: '11px' }}
                          disabled={!dist.enabled}
                        />
                      </div>
                    </div>
                    <div style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                        <span>衰减半径</span>
                        <span>{dist.falloffRadius?.toFixed(2) || 0.5}</span>
                      </div>
                      <input
                        type="range"
                        min={0.01}
                        max={1}
                        step={0.01}
                        value={dist.falloffRadius || 0.5}
                        onChange={(e) => handleUpdateDistortion(dist.id, { falloffRadius: parseFloat(e.target.value) })}
                        style={{ width: '100%' }}
                        disabled={!dist.enabled}
                      />
                    </div>
                  </>
                )}

                {/* 湍流特有参数 */}
                {dist.type === 'turbulent' && (
                  <>
                    <div style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                        <span>种子</span>
                        <span>{dist.seed?.toFixed(0) || 42}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1000}
                        step={1}
                        value={dist.seed || 42}
                        onChange={(e) => handleUpdateDistortion(dist.id, { seed: parseFloat(e.target.value) })}
                        style={{ width: '100%' }}
                        disabled={!dist.enabled}
                      />
                    </div>
                    <div style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                        <span>八度数</span>
                        <span>{dist.octaves || 3}</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={6}
                        step={1}
                        value={dist.octaves || 3}
                        onChange={(e) => handleUpdateDistortion(dist.id, { octaves: parseInt(e.target.value) })}
                        style={{ width: '100%' }}
                        disabled={!dist.enabled}
                      />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {editingAnno && !editingAnno.maskEffect?.enabled && (
        <div style={{ marginTop: '12px', textAlign: 'center', color: '#888', fontSize: '11px' }}>
          蒙版特效已禁用。点击上方"启用"按钮开启。
        </div>
      )}

      {/* ===== 边框控制 ===== */}
      <div style={{ marginTop: '12px', padding: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setShowRegionBorder2D(!showRegionBorder2D)}
            className={`btn ${showRegionBorder2D ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, fontSize: '11px', padding: '4px' }}
          >
            {showRegionBorder2D ? '隐藏' : '显示'} 2D实线
          </button>
          <button
            onClick={() => setShowRegionBorderWebGL(!showRegionBorderWebGL)}
            className={`btn ${showRegionBorderWebGL ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, fontSize: '11px', padding: '4px' }}
          >
            {showRegionBorderWebGL ? '隐藏' : '显示'} WebGL边框
          </button>
        </div>
      </div>

      {/* ===== 顶点固定控制 ===== */}
      <div style={{ marginTop: '16px', padding: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold' }}>顶点固定</span>
          <button
            onClick={() => {
              const enabled = !isVertexPinMode;
              setVertexPinMode(enabled);
              if (enabled) {
                useAppStore.getState().setCurrentTool('vertexPin');
              } else {
                useAppStore.getState().setCurrentTool('select');
              }
            }}
            className={`btn ${isVertexPinMode ? 'btn-danger' : 'btn-primary'}`}
            style={{ fontSize: '11px', padding: '2px 8px' }}
          >
            {isVertexPinMode ? '退出' : '启用'}
          </button>
        </div>
        {isVertexPinMode && (
          <>
            <div style={{ marginTop: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span>画笔半径</span>
                <span>{(vertexPinRadius * 100).toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={5}
                step={0.1}
                value={vertexPinRadius * 100}
                onChange={(e) => setVertexPinRadius(parseFloat(e.target.value) / 100)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginTop: '8px', display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setVertexPinEraserMode(false)}
                className={`btn ${!isVertexPinEraserMode ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, fontSize: '11px', padding: '4px' }}
              >
                固定笔
              </button>
              <button
                onClick={() => setVertexPinEraserMode(true)}
                className={`btn ${isVertexPinEraserMode ? 'btn-warning' : 'btn-secondary'}`}
                style={{ flex: 1, fontSize: '11px', padding: '4px' }}
              >
                橡皮擦
              </button>
            </div>
            <p style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
              {isVertexPinEraserMode ? '红色圆点表示已固定，涂抹取消固定' : '点击或涂抹顶点，红色圆点表示固定（不参与扭动）'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
