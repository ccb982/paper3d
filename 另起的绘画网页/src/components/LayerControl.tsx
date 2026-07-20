import { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { MaskEffectPanel } from './MaskEffectPanel';

export function LayerControl() {
  const {
    layers,
    activeLayerId,
    addLayer,
    removeLayer,
    updateLayer,
    setActiveLayer,
    toggleLayerVisibility,
    reorderLayers,
    layerVisibility,
    toggleLayer,
    axis,
    setAxis,
    resetAxis,
    grid,
    setGrid,
    mousePosition,
    zoom,
    setZoom,
    resetView,
    isPanMode,
    setPanMode,
    // 背景层控制
    imageState,
    setBackgroundOffset,
    setBackgroundScale,
    resetBackgroundTransform,
    setBackgroundDragging,
    // 画布尺寸
    canvasWidth,
    canvasHeight,
    setCanvasWidth,
    setCanvasHeight,
    // 区域色块图层
    regionLayerCanvas,
    // ===== 新增：多帧导入绑定 =====
    frameDataMap,
    bindFrameToLayer,
    getBindableRegions,
    regionEntities,
  } = useAppStore();

  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // 切换区域色块图层可见性时自动刷新区域实体
  const handleToggleRegionLayer = () => {
    const currentVisibility = layerVisibility?.regionLayer ?? false;
    toggleLayer('regionLayer');
    // 如果开启可见性，自动触发刷新
    if (!currentVisibility) {
      useAppStore.getState().refreshRegionEntities(activeLayerId || '');
    }
  };

  // ===== 新增：处理绑定变更 =====
  const handleBindChange = (layerId: string, regionId: string) => {
    const val = regionId === '' ? null : parseInt(regionId, 10);
    bindFrameToLayer(layerId, val);
  };

  // 判断图层是否有待绑定的帧数据
  const hasUnboundFrame = (layerId: string): boolean => {
    const frame = frameDataMap[layerId];
    return !!frame && !!frame.rawRegionIdTex && frame.boundRegionId === null;
  };

  // 判断图层是否已绑定
  const isBound = (layerId: string): boolean => {
    const frame = frameDataMap[layerId];
    return !!frame && frame.boundRegionId !== null;
  };

  // 获取图层当前绑定的区域名称
  const getBoundRegionName = (layerId: string): string => {
    const frame = frameDataMap[layerId];
    if (!frame || frame.boundRegionId === null) return '未绑定';
    const regions = getBindableRegions(layerId);
    const found = regions.find(r => r.id === frame.boundRegionId);
    return found ? found.name : `区域 ${frame.boundRegionId}`;
  };

  const handleAddLayer = () => {
    addLayer(`图层 ${layers.length + 1}`);
  };

  const handleRemoveLayer = (id: string) => {
    if (layers.length > 1) {
      removeLayer(id);
    }
  };

  const handleMoveUp = (index: number) => {
    if (index < layers.length - 1) {
      reorderLayers(index, index + 1);
    }
  };

  const handleMoveDown = (index: number) => {
    if (index > 0) {
      reorderLayers(index, index - 1);
    }
  };

  return (
    <>
      <div className="sidebar-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>图层管理</h3>
          <button
            onClick={handleAddLayer}
            className="btn btn-primary"
            style={{ fontSize: '12px', padding: '2px 8px' }}
          >
            + 添加
          </button>
        </div>
        <div style={{ marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
          {layers.map((layer, index) => {
            const frame = frameDataMap[layer.id];
            const hasFrame = !!frame?.rawRegionIdTex;
            const isLayerBound = isBound(layer.id);
            const isUnbound = hasUnboundFrame(layer.id);
            const bindableRegions = hasFrame ? getBindableRegions(layer.id) : [];

            const layerElement = (
              <div
                key={layer.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '4px',
                  marginBottom: '4px',
                  backgroundColor: activeLayerId === layer.id ? '#e6f7ff' : '#f5f5f5',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
                onClick={() => setActiveLayer(layer.id)}
              >
                {/* 第一行：图层基本信息 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerVisibility(layer.id);
                    }}
                    style={{
                      width: '20px',
                      height: '20px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    {layer.visible ? '👁' : '👁‍🗨'}
                  </button>
                  {editingLayerId === layer.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (editingName.trim()) {
                            updateLayer(layer.id, { name: editingName.trim() });
                          }
                          setEditingLayerId(null);
                        } else if (e.key === 'Escape') {
                          setEditingLayerId(null);
                        }
                      }}
                      onBlur={() => {
                        if (editingName.trim()) {
                          updateLayer(layer.id, { name: editingName.trim() });
                        }
                        setEditingLayerId(null);
                      }}
                      autoFocus
                      style={{
                        flex: 1,
                        fontSize: '12px',
                        border: '1px solid #1890ff',
                        borderRadius: '2px',
                        padding: '2px 4px',
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        flex: 1,
                        fontSize: '12px',
                        textDecoration: layer.visible ? 'none' : 'line-through',
                        color: layer.visible ? '#333' : '#999',
                      }}
                      onDoubleClick={() => {
                        setEditingLayerId(layer.id);
                        setEditingName(layer.name);
                      }}
                    >
                      {layer.displayId}. {layer.name}
                    </span>
                  )}
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.1"
                    value={layer?.opacity ?? 1}
                    onChange={(e) => {
                      e.stopPropagation();
                      updateLayer(layer.id, { opacity: parseFloat(e.target.value) });
                    }}
                    style={{
                      width: '40px',
                      height: '12px',
                      cursor: 'pointer',
                    }}
                    title={`透明度: ${((layer?.opacity ?? 1) * 100).toFixed(0)}%`}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveDown(index);
                    }}
                    disabled={index === 0}
                    style={{
                      width: '20px',
                      height: '20px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      fontSize: '12px',
                      cursor: index === 0 ? 'not-allowed' : 'pointer',
                      opacity: index === 0 ? 0.3 : 1,
                    }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveUp(index);
                    }}
                    disabled={index === layers.length - 1}
                    style={{
                      width: '20px',
                      height: '20px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      fontSize: '12px',
                      cursor: index === layers.length - 1 ? 'not-allowed' : 'pointer',
                      opacity: index === layers.length - 1 ? 0.3 : 1,
                    }}
                  >
                    ↓
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveLayer(layer.id);
                    }}
                    disabled={layers.length <= 1}
                    style={{
                      width: '20px',
                      height: '20px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      fontSize: '12px',
                      cursor: layers.length <= 1 ? 'not-allowed' : 'pointer',
                      opacity: layers.length <= 1 ? 0.3 : 1,
                      color: '#ff4d4f',
                    }}
                  >
                    ×
                  </button>
                </div>

                {/* 第二行：绑定控制 */}
                {hasFrame && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginTop: '4px',
                      paddingLeft: '24px',
                      fontSize: '11px',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span style={{ color: '#666', minWidth: '36px' }}>
                      {isLayerBound ? '✅ 已绑定' : '📦 待绑定'}
                    </span>
                    <select
                      value={frame.boundRegionId !== null ? String(frame.boundRegionId) : ''}
                      onChange={(e) => handleBindChange(layer.id, e.target.value)}
                      style={{
                        flex: 1,
                        fontSize: '11px',
                        padding: '2px 4px',
                        borderRadius: '3px',
                        border: isLayerBound ? '1px solid #52c41a' : '1px solid #faad14',
                        backgroundColor: isLayerBound ? '#f6ffed' : '#fffbe6',
                      }}
                    >
                      <option value="">-- 选择区域绑定 --</option>
                      {bindableRegions.length === 0 && (
                        <option value="" disabled>（暂无可用区域）</option>
                      )}
                      {bindableRegions.map(r => (
                        <option key={r.id} value={String(r.id)}>{r.name}</option>
                      ))}
                    </select>
                    {isLayerBound && (
                      <button
                        onClick={() => handleBindChange(layer.id, '')}
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          border: '1px solid #ff4d4f',
                          borderRadius: '3px',
                          background: '#fff',
                          color: '#ff4d4f',
                          cursor: 'pointer',
                        }}
                      >
                        解绑
                      </button>
                    )}
                    {isUnbound && bindableRegions.length > 0 && (
                      <span style={{ fontSize: '10px', color: '#faad14' }}>⚠️ 需绑定</span>
                    )}
                  </div>
                )}

                {/* 底图变换控制（仅已绑定的图层） */}
                {isLayerBound && (
                  <div
                    style={{
                      marginTop: '6px',
                      paddingLeft: '24px',
                      paddingRight: '4px',
                      fontSize: '10px',
                      borderTop: '1px dashed #e0e0e0',
                      paddingTop: '6px',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ color: '#666', fontWeight: 'bold' }}>底图变换</span>
                      <button
                        onClick={() => {
                          const { setFrameTextureTransform } = useAppStore.getState();
                          setFrameTextureTransform(layer.id, { x: 0, y: 0 }, { x: 1, y: 1 }, 0);
                        }}
                        style={{
                          fontSize: '9px',
                          padding: '1px 4px',
                          border: 'none',
                          borderRadius: '2px',
                          background: '#f0f0f0',
                          color: '#666',
                          cursor: 'pointer',
                        }}
                      >
                        重置
                      </button>
                    </div>
                    {/* 偏移 X */}
                    <div style={{ marginBottom: '3px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>偏移 X</span>
                        <span style={{ color: '#999' }}>{(frame.textureOffset?.x || 0).toFixed(3)}</span>
                      </div>
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={frame.textureOffset?.x || 0}
                        onChange={(e) => {
                          const { setFrameTextureTransform } = useAppStore.getState();
                          setFrameTextureTransform(layer.id, { x: parseFloat(e.target.value), y: frame.textureOffset?.y || 0 }, frame.textureScale || { x: 1, y: 1 }, frame.textureRotation || 0);
                        }}
                        style={{ width: '100%', marginTop: '2px' }}
                      />
                    </div>
                    {/* 偏移 Y */}
                    <div style={{ marginBottom: '3px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>偏移 Y</span>
                        <span style={{ color: '#999' }}>{(frame.textureOffset?.y || 0).toFixed(3)}</span>
                      </div>
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={frame.textureOffset?.y || 0}
                        onChange={(e) => {
                          const { setFrameTextureTransform } = useAppStore.getState();
                          setFrameTextureTransform(layer.id, { x: frame.textureOffset?.x || 0, y: parseFloat(e.target.value) }, frame.textureScale || { x: 1, y: 1 }, frame.textureRotation || 0);
                        }}
                        style={{ width: '100%', marginTop: '2px' }}
                      />
                    </div>
                    {/* 缩放 X */}
                    <div style={{ marginBottom: '3px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>缩放 X</span>
                        <span style={{ color: '#999' }}>{(frame.textureScale?.x || 1).toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="3"
                        step="0.05"
                        value={frame.textureScale?.x || 1}
                        onChange={(e) => {
                          const { setFrameTextureTransform } = useAppStore.getState();
                          setFrameTextureTransform(layer.id, frame.textureOffset || { x: 0, y: 0 }, { x: parseFloat(e.target.value), y: frame.textureScale?.y || 1 }, frame.textureRotation || 0);
                        }}
                        style={{ width: '100%', marginTop: '2px' }}
                      />
                    </div>
                    {/* 缩放 Y */}
                    <div style={{ marginBottom: '3px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>缩放 Y</span>
                        <span style={{ color: '#999' }}>{(frame.textureScale?.y || 1).toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="3"
                        step="0.05"
                        value={frame.textureScale?.y || 1}
                        onChange={(e) => {
                          const { setFrameTextureTransform } = useAppStore.getState();
                          setFrameTextureTransform(layer.id, frame.textureOffset || { x: 0, y: 0 }, { x: frame.textureScale?.x || 1, y: parseFloat(e.target.value) }, frame.textureRotation || 0);
                        }}
                        style={{ width: '100%', marginTop: '2px' }}
                      />
                    </div>
                    {/* 旋转 */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>旋转</span>
                        <span style={{ color: '#999' }}>{((frame.textureRotation || 0) * 180 / Math.PI).toFixed(0)}°</span>
                      </div>
                      <input
                        type="range"
                        min="-3.14"
                        max="3.14"
                        step="0.05"
                        value={frame.textureRotation || 0}
                        onChange={(e) => {
                          const { setFrameTextureTransform } = useAppStore.getState();
                          setFrameTextureTransform(layer.id, frame.textureOffset || { x: 0, y: 0 }, frame.textureScale || { x: 1, y: 1 }, parseFloat(e.target.value));
                        }}
                        style={{ width: '100%', marginTop: '2px' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
            return layerElement;
          })}
        </div>
      </div>

      <div className="sidebar-section">
        <h3>图层可见性</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={layerVisibility?.imageLayer ?? true}
            onChange={() => toggleLayer('imageLayer')}
          />
          图片图层
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
          <input
            type="checkbox"
            checked={layerVisibility?.frameLayer ?? true}
            onChange={() => toggleLayer('frameLayer')}
          />
          帧图层
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
          <input
            type="checkbox"
            checked={layerVisibility?.drawLayer ?? true}
            onChange={() => toggleLayer('drawLayer')}
          />
          绘制图层
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
          <input
            type="checkbox"
            checked={layerVisibility?.axisLayer ?? true}
            onChange={() => toggleLayer('axisLayer')}
          />
          坐标轴图层
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
          <input
            type="checkbox"
            checked={layerVisibility?.regionLayer ?? false}
            onChange={handleToggleRegionLayer}
          />
          区域色块图层
        </label>
      </div>

      <div className="sidebar-section">
        <h3>坐标轴范围</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <label>X最小</label>
            <input
              type="number"
              value={axis?.xMin ?? 0}
              onChange={(e) => setAxis({ xMin: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label>X最大</label>
            <input
              type="number"
              value={axis?.xMax ?? 1}
              onChange={(e) => setAxis({ xMax: parseFloat(e.target.value) || 1 })}
            />
          </div>
          <div>
            <label>Y最小</label>
            <input
              type="number"
              value={axis?.yMin ?? 0}
              onChange={(e) => setAxis({ yMin: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label>Y最大</label>
            <input
              type="number"
              value={axis?.yMax ?? 1}
              onChange={(e) => setAxis({ yMax: parseFloat(e.target.value) || 1 })}
            />
          </div>
        </div>
        <button
          onClick={resetAxis}
          className="btn btn-primary"
          style={{ marginTop: '12px', width: '100%' }}
        >
          重置坐标轴
        </button>
      </div>

      <div className="sidebar-section">
        <h3>格子设置</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={grid?.visible ?? true}
              onChange={() => setGrid({ visible: !(grid?.visible ?? true) })}
            />
            显示格子
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <label>列数（宽）</label>
            <input
              type="number"
              min={1}
              max={100}
              value={grid?.cols ?? 10}
              onChange={(e) => setGrid({ cols: Math.max(1, parseInt(e.target.value) || 10) })}
            />
          </div>
          <div>
            <label>行数（高）</label>
            <input
              type="number"
              min={1}
              max={100}
              value={grid?.rows ?? 10}
              onChange={(e) => setGrid({ rows: Math.max(1, parseInt(e.target.value) || 10) })}
            />
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h3>缩放与平移</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '12px', minWidth: '40px' }}>{Math.round((zoom ?? 1) * 100)}%</span>
          <input
            type="range"
            min={10}
            max={1000}
            value={(zoom ?? 1) * 100}
            onChange={(e) => setZoom(parseInt(e.target.value) / 100)}
            style={{ flex: 1 }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <button onClick={() => setZoom((zoom ?? 1) * 0.8)} className="btn btn-primary">-</button>
          <button onClick={() => setZoom(1.0)} className="btn btn-primary">100%</button>
          <button onClick={() => setZoom((zoom ?? 1) * 1.25)} className="btn btn-primary">+</button>
        </div>
        <button
          onClick={resetView}
          className="btn btn-primary"
          style={{ marginTop: '8px', width: '100%' }}
        >
          重置视图
        </button>
        <button
          onClick={() => setPanMode(!isPanMode)}
          className={`btn ${isPanMode ? 'btn-danger' : 'btn-primary'}`}
          style={{ marginTop: '8px', width: '100%' }}
        >
          {isPanMode ? '✓ 拖动模式' : '拖动模式'}
        </button>
        <p style={{ fontSize: '10px', color: '#888', marginTop: '8px' }}>
          滚轮缩放 | Alt+拖拽平移 | 中键拖拽平移
        </p>
      </div>

      <div className="sidebar-section">
        <h3>背景层控制</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '12px', minWidth: '40px' }}>{Math.round((imageState?.scale ?? 1) * 100)}%</span>
          <input
            type="range"
            min={10}
            max={500}
            value={(imageState?.scale ?? 1) * 100}
            onChange={(e) => setBackgroundScale(parseInt(e.target.value) / 100)}
            style={{ flex: 1 }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
          <button onClick={() => setBackgroundScale((imageState?.scale ?? 1) * 0.8)} className="btn btn-primary">-</button>
          <button onClick={() => setBackgroundScale(1.0)} className="btn btn-primary">100%</button>
          <button onClick={() => setBackgroundScale((imageState?.scale ?? 1) * 1.25)} className="btn btn-primary">+</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
          <div>
            <label style={{ fontSize: '11px' }}>偏移 X</label>
            <input
              type="number"
              step="1"
              value={Math.round(imageState?.offsetX ?? 0)}
              onChange={(e) => setBackgroundOffset(parseInt(e.target.value) || 0, imageState?.offsetY ?? 0)}
              style={{ fontSize: '11px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px' }}>偏移 Y</label>
            <input
              type="number"
              step="1"
              value={Math.round(imageState?.offsetY ?? 0)}
              onChange={(e) => setBackgroundOffset(imageState?.offsetX ?? 0, parseInt(e.target.value) || 0)}
              style={{ fontSize: '11px' }}
            />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
          <button
            onClick={() => setBackgroundDragging(!(imageState?.isBackgroundDragging ?? false))}
            className={`btn ${(imageState?.isBackgroundDragging ?? false) ? 'btn-danger' : 'btn-primary'}`}
          >
            {imageState?.isBackgroundDragging ? '✓ 拖动中' : '拖动背景'}
          </button>
          <button
            onClick={resetBackgroundTransform}
            className="btn btn-primary"
          >
            重置背景
          </button>
        </div>
        <p style={{ fontSize: '10px', color: '#888', marginTop: '8px' }}>
          开启拖动后，在画布上拖拽移动背景
        </p>
      </div>

      {/* 蒙版特效面板 */}
      <MaskEffectPanel />

      <div className="sidebar-section">
        <h3>画布尺寸</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <input
            type="number"
            min={64}
            max={4096}
            step={64}
            value={canvasWidth ?? 512}
            onChange={(e) => setCanvasWidth(parseInt(e.target.value) || 512)}
            style={{ width: '80px', fontSize: '12px' }}
          />
          <span style={{ fontSize: '12px' }}>x</span>
          <input
            type="number"
            min={64}
            max={4096}
            step={64}
            value={canvasHeight ?? 512}
            onChange={(e) => setCanvasHeight(parseInt(e.target.value) || 512)}
            style={{ width: '80px', fontSize: '12px' }}
          />
          <span style={{ fontSize: '12px' }}>px</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
          <button onClick={() => { setCanvasWidth(800); setCanvasHeight(600); }} className="btn btn-primary">4:3</button>
          <button onClick={() => { setCanvasWidth(1920); setCanvasHeight(1080); }} className="btn btn-primary">16:9</button>
          <button onClick={() => { setCanvasWidth(1024); setCanvasHeight(1024); }} className="btn btn-primary">1:1</button>
          <button onClick={() => { setCanvasWidth(1080); setCanvasHeight(1920); }} className="btn btn-primary">9:16</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
          <button onClick={() => { setCanvasWidth(512); setCanvasHeight(512); }} className="btn btn-secondary">512×512</button>
          <button onClick={() => { setCanvasWidth(1024); setCanvasHeight(1024); }} className="btn btn-secondary">1024×1024</button>
          <button onClick={() => { setCanvasWidth(800); setCanvasHeight(600); }} className="btn btn-secondary">800×600</button>
          <button onClick={() => { setCanvasWidth(1280); setCanvasHeight(720); }} className="btn btn-secondary">1280×720</button>
        </div>
        <p style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
          调整画布分辨率（64-4096）
        </p>
      </div>

      <div className="sidebar-section">
        <h3>鼠标坐标</h3>
        {mousePosition ? (
          <div className="coordinate-display">
            <div>X: {mousePosition.x.toFixed(4)}</div>
            <div>Y: {mousePosition.y.toFixed(4)}</div>
            <div style={{ marginTop: '4px', fontSize: '10px', color: '#888' }}>
              比例: ({(mousePosition.x / 1).toFixed(4)}, {(mousePosition.y / 1).toFixed(4)})
            </div>
          </div>
        ) : (
          <div className="coordinate-display" style={{ color: '#999' }}>
            移动鼠标查看坐标
          </div>
        )}
      </div>
    </>
  );
}
