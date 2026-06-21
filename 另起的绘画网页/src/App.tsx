import { useEffect, useState } from 'react';
import { useAppStore } from './stores/useAppStore';
import { ImageImport } from './components/ImageImport';
import { LayerControl } from './components/LayerControl';
import { MainCanvas } from './components/MainCanvas';
import { Toolbar } from './components/Toolbar';
import { FluidPreview } from './fluid';

function App() {
  const { layerVisibility, loadFromStorage } = useAppStore();
  const [showFluidPreview, setShowFluidPreview] = useState(false);

  useEffect(() => {
    console.log('[App] 初始化加载数据...');
    loadFromStorage();
  }, [loadFromStorage]);

  // 流体独立视图
  if (showFluidPreview) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#1a1a2e',
      }}>
        {/* 顶部控制栏 */}
        <div style={{
          padding: '10px 20px',
          background: '#16213e',
          borderBottom: '1px solid #0f3460',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
        }}>
          <h2 style={{ color: '#e94560', margin: 0 }}>流体模拟视图</h2>
          <button
            onClick={() => setShowFluidPreview(false)}
            style={{
              padding: '8px 16px',
              background: '#e94560',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            返回绘画视图
          </button>
          <span style={{ color: '#666', fontSize: '12px' }}>
            点击画布触发爆炸 | 鼠标移动搅动流体
          </span>
        </div>
        
        {/* 流体画布区域 */}
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <FluidPreview visible={true} />
        </div>
      </div>
    );
  }

  // 绘画视图
  return (
    <div className="app-container">
      <aside className="sidebar">
        <ImageImport />
        <LayerControl />
        {/* 流体模拟控制按钮 */}
        <div style={{ padding: '10px', borderTop: '1px solid #333' }}>
          <button
            onClick={() => setShowFluidPreview(true)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#e94560',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            打开流体模拟视图
          </button>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
            进入独立的流体模拟视图
          </p>
        </div>
      </aside>
      <div className="canvas-container" style={{ position: 'relative' }}>
        <Toolbar />
        <MainCanvas />
      </div>
    </div>
  );
}

export default App;
