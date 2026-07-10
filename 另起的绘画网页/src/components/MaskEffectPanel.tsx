import { useState, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { RegionAnnotation } from '../types';

export function MaskEffectPanel() {
  const {
    regionAnnotations,
    updateRegionAnnotation,
    activeLayerId,
    refreshRegionEntities,
    layerVisibility,
    triggerCanvasRedraw,
    forceCPUMode,
    regionAnimationSpeed,
    setRegionAnimationSpeed,
  } = useAppStore();

  // 获取当前选中图层的区域注释
  const layerAnnotations = regionAnnotations.filter(a => a.layerId === activeLayerId);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [editingAnno, setEditingAnno] = useState<RegionAnnotation | null>(null);

  // 当选择变化时更新编辑状态
  useEffect(() => {
    if (selectedAnnotationId) {
      const anno = regionAnnotations.find(a => a.id === selectedAnnotationId);
      setEditingAnno(anno ? JSON.parse(JSON.stringify(anno)) : null);
    } else {
      setEditingAnno(null);
    }
  }, [selectedAnnotationId, regionAnnotations]);

  // 初始化选中第一个有maskEffect的注释
  useEffect(() => {
    if (!selectedAnnotationId && layerAnnotations.length > 0) {
      const annoWithMask = layerAnnotations.find(a => a.maskEffect?.enabled);
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
      const idx = store.regionAnnotations.findIndex(a => a.id === editingAnno.id);
      if (idx >= 0) {
        const newAnnotations = [...store.regionAnnotations];
        newAnnotations[idx] = updated;
        useAppStore.setState({ regionAnnotations: newAnnotations });
      }
      setEditingAnno(updated);
      // 立即更新区域色块图层（如果可见）
      if (layerVisibility.regionLayer && currentLayerId) {
        refreshRegionEntities(currentLayerId);
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
      const idx = store.regionAnnotations.findIndex(a => a.id === editingAnno.id);
      if (idx >= 0) {
        const newAnnotations = [...store.regionAnnotations];
        newAnnotations[idx] = updated;
        useAppStore.setState({ regionAnnotations: newAnnotations });
      }
      setEditingAnno(updated);
      // 立即更新区域色块图层（如果可见）
      if (layerVisibility.regionLayer && currentLayerId) {
        refreshRegionEntities(currentLayerId);
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
    const idx = store.regionAnnotations.findIndex(a => a.id === editingAnno.id);
    if (idx >= 0) {
      const newAnnotations = [...store.regionAnnotations];
      newAnnotations[idx] = updated;
      useAppStore.setState({ regionAnnotations: newAnnotations });
    }
    setEditingAnno(updated);
    // 立即更新区域色块图层（如果可见）
    if (layerVisibility.regionLayer && activeLayerId) {
      refreshRegionEntities(activeLayerId);
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
    const idx = store.regionAnnotations.findIndex(a => a.id === editingAnno.id);
    if (idx >= 0) {
      const newAnnotations = [...store.regionAnnotations];
      newAnnotations[idx] = updated;
      useAppStore.setState({ regionAnnotations: newAnnotations });
    }
    setEditingAnno(updated);
    // 立即更新区域色块图层（如果可见）
    if (layerVisibility.regionLayer && activeLayerId) {
      refreshRegionEntities(activeLayerId);
    }
    // 触发画布重绘（更新实时预览边框）
    triggerCanvasRedraw();
  };

  // 更新扭曲效果参数
  const handleUpdateDistortion = (distortionId: string, updates: Partial<typeof editingAnno.maskEffect.distortions[0]>) => {
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
    const idx = store.regionAnnotations.findIndex(a => a.id === editingAnno.id);
    if (idx >= 0) {
      const newAnnotations = [...store.regionAnnotations];
      newAnnotations[idx] = updated;
      useAppStore.setState({ regionAnnotations: newAnnotations });
    }
    setEditingAnno(updated);
    // 立即更新区域色块图层（如果可见）
    if (layerVisibility.regionLayer && activeLayerId) {
      refreshRegionEntities(activeLayerId);
    }
    // 触发画布重绘（更新实时预览边框）
    triggerCanvasRedraw();
  };

  // 更新变换参数
  const handleUpdateTransform = (updates: Partial<typeof editingAnno.maskEffect.transform>) => {
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
    const idx = store.regionAnnotations.findIndex(a => a.id === editingAnno.id);
    if (idx >= 0) {
      const newAnnotations = [...store.regionAnnotations];
      newAnnotations[idx] = updated;
      useAppStore.setState({ regionAnnotations: newAnnotations });
    }
    setEditingAnno(updated);
    // 立即更新区域色块图层（如果可见）
    if (layerVisibility.regionLayer && activeLayerId) {
      refreshRegionEntities(activeLayerId);
    }
    // 触发画布重绘（更新实时预览边框）
    triggerCanvasRedraw();
  };

  // 如果没有区域注释，不显示面板
  if (layerAnnotations.length === 0) {
    return null;
  }

  return (
    <div className="sidebar-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>蒙版特效</h3>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {/* GPU/CPU 切换按钮 */}
          <button
            onClick={() => {
              const { forceCPUMode, setForceCPUMode, refreshRegionEntities } = useAppStore.getState();
              setForceCPUMode(!forceCPUMode);
              // 切换后立即刷新区域实体
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
          {layerAnnotations.map(anno => (
            <option key={anno.id} value={anno.id}>
              {anno.text || `区域 ${anno.regionId}`}
            </option>
          ))}
        </select>
      </div>

      {editingAnno && editingAnno.maskEffect?.enabled && (
        <>
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
            {editingAnno.maskEffect.distortions.map((dist, idx) => (
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
    </div>
  );
}
