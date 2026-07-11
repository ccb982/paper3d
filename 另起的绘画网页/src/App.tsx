import { useEffect, useState } from 'react';
import { useAppStore } from './stores/useAppStore';
import { ImageImport } from './components/ImageImport';
import { LayerControl } from './components/LayerControl';
import { MainCanvas } from './components/MainCanvas';
import { Toolbar } from './components/Toolbar';
import { FluidPreview } from './fluid';
import { BaseColorEditor } from './components/BaseColorEditor';

function App() {
  const { layerVisibility, loadFromStorage } = useAppStore();
  const [showFluidPreview, setShowFluidPreview] = useState(false);
  const [showBaseColorEditor, setShowBaseColorEditor] = useState(false);

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

  // 基础色编辑器视图
  if (showBaseColorEditor) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f5f5f5',
      }}>
        {/* 顶部控制栏 */}
        <div style={{
          padding: '12px 24px',
          background: '#fff',
          borderBottom: '1px solid #e8e8e8',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
        }}>
          <h2 style={{ color: '#1890ff', margin: 0, fontSize: '18px' }}>基础色编辑器</h2>
          <button
            onClick={() => setShowBaseColorEditor(false)}
            style={{
              padding: '6px 16px',
              background: '#1890ff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            返回绘画视图
          </button>
          <span style={{ color: '#999', fontSize: '12px' }}>
            加载背景 → 虚线勾区域 → 自动提取 → 画笔补全 → 查看残差
          </span>
        </div>

        {/* 画布区域 */}
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '24px',
        }}>
          <BaseColorEditor />
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
        <div style={{ padding: '10px', borderTop: '1px solid #333' }}>
          <button
            onClick={() => setShowBaseColorEditor(true)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#1890ff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            打开基础色编辑器
          </button>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
            独立的基础色纹理编辑视图
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
