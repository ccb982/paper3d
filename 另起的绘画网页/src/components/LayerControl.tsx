import { useAppStore } from '../stores/useAppStore';

export function LayerControl() {
  const { layerVisibility, toggleLayer, axis, setAxis, resetAxis, grid, setGrid, mousePosition, zoom, setZoom, resetView, isPanMode, setPanMode } = useAppStore();

  return (
    <>
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
