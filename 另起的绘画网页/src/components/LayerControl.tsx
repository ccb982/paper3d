import { useAppStore } from '../stores/useAppStore';

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
  } = useAppStore();

  const handleAddLayer = () => {
    const existingNumbers: number[] = [];
    layers.forEach((l) => {
      const match = l.name.match(/^图层\s*(\d+)$/);
      if (match) {
        existingNumbers.push(parseInt(match[1], 10));
      }
    });
    let newNumber = 1;
    while (existingNumbers.includes(newNumber)) {
      newNumber++;
    }
    addLayer(`图层 ${newNumber}`);
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
          {layers.map((layer, index) => (
            <div
              key={layer.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px',
                marginBottom: '4px',
                backgroundColor: activeLayerId === layer.id ? '#e6f7ff' : '#f5f5f5',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              onClick={() => setActiveLayer(layer.id)}
            >
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
              <span
                style={{
                  flex: 1,
                  fontSize: '12px',
                  textDecoration: layer.visible ? 'none' : 'line-through',
                  color: layer.visible ? '#333' : '#999',
                }}
              >
                {layer.name}
              </span>
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
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <h3>图层可见性</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={layerVisibility.imageLayer}
            onChange={() => toggleLayer('imageLayer')}
          />
          图片图层
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
          <input
            type="checkbox"
            checked={layerVisibility.drawLayer}
            onChange={() => toggleLayer('drawLayer')}
          />
          绘制图层
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
          <input
            type="checkbox"
            checked={layerVisibility.axisLayer}
            onChange={() => toggleLayer('axisLayer')}
          />
          坐标轴图层
        </label>
      </div>

      <div className="sidebar-section">
        <h3>坐标轴范围</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <label>X最小</label>
            <input
              type="number"
              value={axis.xMin}
              onChange={(e) => setAxis({ xMin: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label>X最大</label>
            <input
              type="number"
              value={axis.xMax}
              onChange={(e) => setAxis({ xMax: parseFloat(e.target.value) || 1 })}
            />
          </div>
          <div>
            <label>Y最小</label>
            <input
              type="number"
              value={axis.yMin}
              onChange={(e) => setAxis({ yMin: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label>Y最大</label>
            <input
              type="number"
              value={axis.yMax}
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
              checked={grid.visible}
              onChange={() => setGrid({ visible: !grid.visible })}
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
              value={grid.cols}
              onChange={(e) => setGrid({ cols: Math.max(1, parseInt(e.target.value) || 10) })}
            />
          </div>
          <div>
            <label>行数（高）</label>
            <input
              type="number"
              min={1}
              max={100}
              value={grid.rows}
              onChange={(e) => setGrid({ rows: Math.max(1, parseInt(e.target.value) || 10) })}
            />
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h3>缩放与平移</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '12px', minWidth: '40px' }}>{Math.round(zoom * 100)}%</span>
          <input
            type="range"
            min={10}
            max={1000}
            value={zoom * 100}
            onChange={(e) => setZoom(parseInt(e.target.value) / 100)}
            style={{ flex: 1 }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <button onClick={() => setZoom(zoom * 0.8)} className="btn btn-primary">-</button>
          <button onClick={() => setZoom(1.0)} className="btn btn-primary">100%</button>
          <button onClick={() => setZoom(zoom * 1.25)} className="btn btn-primary">+</button>
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
