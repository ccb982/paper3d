import { useEffect, useState } from 'react';
import { useAppStore } from './stores/useAppStore';
import { ImageImport } from './components/ImageImport';
import { LayerControl } from './components/LayerControl';
import { MainCanvas } from './components/MainCanvas';
import { Toolbar } from './components/Toolbar';
import { FluidEditorUI } from './fluid';
import { BaseColorEditor } from './components/BaseColorEditor';
import { FluidPanel } from './components/FluidPanel';
import { EffectShapePanel } from './effectShape/EffectShapePanel';
import { exportMainCanvasAssetBundle } from './assetBundle/assetBundleExport';

function App() {
  const { layerVisibility, loadFromStorage } = useAppStore();
  const [showFluidEditor, setShowFluidEditor] = useState(false);
  const [showBaseColorEditor, setShowBaseColorEditor] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFileName, setExportFileName] = useState('scene_package');

  useEffect(() => {
    console.log('[App] 初始化加载数据...');
    loadFromStorage();
  }, [loadFromStorage]);

  const handleExportScenePackage = async () => {
    setExporting(true);
    try {
      const state = useAppStore.getState();
      const result = await exportMainCanvasAssetBundle(state, { enablePrediction: true });
      const blob = new Blob([result.bytes], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const name = exportFileName.trim() || 'scene_package';
      a.href = url;
      a.download = `${name}.scene.zip`;
      a.click();
      URL.revokeObjectURL(url);
      const msg = `素材包导出成功！${result.frameCount} 个图层（含 ${result.textureFrameCount} 个纹理帧），${result.paletteCount} 色${result.annotationCount > 0 ? `，${result.annotationCount} 个独立区域注释` : ''}`;
      alert(result.skippedLayers.length > 0
        ? `${msg}\n\n跳过的空图层/仅物理/仅注释层: ${result.skippedLayers.join(', ')}`
        : msg);
    } catch (err: any) {
      console.error('[场景包导出] 失败:', err);
      alert('导出失败: ' + (err.message || '未知错误'));
    } finally {
      setExporting(false);
    }
  };

  // 流体编辑器视图
  if (showFluidEditor) {
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
          <h2 style={{ color: '#e94560', margin: 0, fontSize: '16px' }}>2D 流体编辑器</h2>
          <button
            onClick={() => setShowFluidEditor(false)}
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
            逐通道平流 | 实时调控 | 模块化架构
          </span>
        </div>

        {/* 流体编辑器主体（视口 + 控制面板） */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <FluidEditorUI />
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
        {/* 流体特效控制面板（残差平流，直接绘制在区域实体模板缓冲之上） */}
        <FluidPanel />
        {/* ★ 程序化击中特效形状（独立模块：矢量形状 + 随机变体 + 预览） */}
        <EffectShapePanel />
        {/* 流体模拟控制按钮 */}
        <div style={{ padding: '10px', borderTop: '1px solid #333' }}>
          <button
            onClick={() => setShowFluidEditor(true)}
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
            打开流体编辑器
          </button>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
            进入 2D 流体编辑器（新架构）
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
        <div style={{ padding: '10px', borderTop: '1px solid #333' }}>
          <input
            type="text"
            value={exportFileName}
            onChange={(e) => setExportFileName(e.target.value)}
            placeholder="导出文件名"
            style={{
              width: '100%',
              padding: '6px 8px',
              marginBottom: '8px',
              background: '#222',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              fontSize: '13px',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleExportScenePackage}
            disabled={exporting}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: exporting ? '#555' : '#52c41a',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: exporting ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            {exporting ? '导出中...' : '导出素材包 (.scene.zip)'}
          </button>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
            导出特效播放器可用的场景包
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
