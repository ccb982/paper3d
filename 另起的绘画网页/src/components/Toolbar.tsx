import { useAppStore } from '../stores/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useState, useCallback } from 'react';
import type { ToolType } from '../types';

// 预设颜色
const presetColors = [
  '#ff0000', '#ff6b6b', '#ffa502', '#ffd93d', '#26de81', 
  '#00b894', '#00cec9', '#74b9ff', '#0984e3', '#6c5ce7',
  '#a29bfe', '#fd79a8', '#e84393', '#636e72', '#2d3436'
];

export function Toolbar() {
  const {
    currentTool,
    setCurrentTool,
    snapRadius,
    setSnapRadius,
    snapEnabled,
    setSnapEnabled,
    lineWidth,
    setLineWidth,
    bfsResolution,
    setBfsResolution,
    undo,
    saveToStorage,
    loadFromStorage,
    exportToJson,
    currentColor,
    setCurrentColor,
    paintBrushSize,
    setPaintBrushSize,
    colorExtractMode,
    setColorExtractMode,
    colorExtractTool,
    setColorExtractTool,
    clearColorExtractPoints,
    setColorExtractPreviewPoint,
    setColorExtractWaitingFor,
    colorExtractCurves,
    clearColorExtractCurvesAndShapes,
    colorExtractEraserMode,
    setColorExtractEraserMode,
    colorExtractWaiting,
    setColorExtractWaiting,
    clearExtractedColorBlocks,
    refreshRegionCache,
    activeLayerId,
    setEnableFramePrediction,
  } = useAppStore(useShallow(s => ({
    currentTool: s.currentTool,
    setCurrentTool: s.setCurrentTool,
    snapRadius: s.snapRadius,
    setSnapRadius: s.setSnapRadius,
    snapEnabled: s.snapEnabled,
    setSnapEnabled: s.setSnapEnabled,
    lineWidth: s.lineWidth,
    setLineWidth: s.setLineWidth,
    bfsResolution: s.bfsResolution,
    setBfsResolution: s.setBfsResolution,
    undo: s.undo,
    saveToStorage: s.saveToStorage,
    loadFromStorage: s.loadFromStorage,
    exportToJson: s.exportToJson,
    currentColor: s.currentColor,
    setCurrentColor: s.setCurrentColor,
    paintBrushSize: s.paintBrushSize,
    setPaintBrushSize: s.setPaintBrushSize,
    colorExtractMode: s.colorExtractMode,
    setColorExtractMode: s.setColorExtractMode,
    colorExtractTool: s.colorExtractTool,
    setColorExtractTool: s.setColorExtractTool,
    clearColorExtractPoints: s.clearColorExtractPoints,
    setColorExtractPreviewPoint: s.setColorExtractPreviewPoint,
    setColorExtractWaitingFor: s.setColorExtractWaitingFor,
    colorExtractCurves: s.colorExtractCurves,
    clearColorExtractCurvesAndShapes: s.clearColorExtractCurvesAndShapes,
    colorExtractEraserMode: s.colorExtractEraserMode,
    setColorExtractEraserMode: s.setColorExtractEraserMode,
    colorExtractWaiting: s.colorExtractWaiting,
    setColorExtractWaiting: s.setColorExtractWaiting,
    clearExtractedColorBlocks: s.clearExtractedColorBlocks,
    refreshRegionCache: s.refreshRegionCache,
    activeLayerId: s.activeLayerId,
    setEnableFramePrediction: s.setEnableFramePrediction,
  })));

  // 获取帧间预测状态
  const enableFramePrediction = useAppStore((state) => state.skillGroupEditor.enableFramePrediction);

  const [showColorExtractMenu, setShowColorExtractMenu] = useState(false);
  const [showShapeMenu, setShowShapeMenu] = useState(false);

  const shapeTools = [
    { type: 'point' as ToolType, icon: '•', label: '点' },
    { type: 'line' as ToolType, icon: '/', label: '线段' },
    { type: 'rectangle' as ToolType, icon: '□', label: '矩形' },
    { type: 'circle' as ToolType, icon: '○', label: '圆形' },
    { type: 'triangle' as ToolType, icon: '△', label: '三角形' },
    { type: 'quadratic' as ToolType, icon: '⌒', label: '贝塞尔' },
    { type: 'brush' as ToolType, icon: '✎', label: '画笔' },
  ];

  const mainTools = [
    { type: 'select' as ToolType, icon: '⬚', label: '选择' },
    { type: 'paintBrush' as ToolType, icon: '🖌️', label: '上色画笔', hint: '拖拽涂抹，自动提取区域' },
    { type: 'picker' as ToolType, icon: '🎨', label: '取色器', hint: '点击画布取色' },
    { type: 'move' as ToolType, icon: '✋', label: '移动', hint: '拖拽移动封闭图形' },
    { type: 'eraser' as ToolType, icon: '✕', label: '橡皮' },
    { type: 'pointAnnotation' as ToolType, icon: '📍', label: '点注释' },
    { type: 'regionAnnotation' as ToolType, icon: '🗺️', label: '区域注释', hint: '完成绘图后再添加' },
  ];

  // 统一退出颜色提取模式的函数（保留虚线，不清除）
  const exitColorExtractMode = useCallback(() => {
    if (colorExtractMode) {
      clearColorExtractPoints();
      setColorExtractMode(false);
      setColorExtractTool(null);
      setColorExtractPreviewPoint(null);
      setColorExtractEraserMode(false);
      // 不移除虚线，虚线只能通过手动删除或点击"清空虚线"按钮删除
      // clearColorExtractCurves();
      clearExtractedColorBlocks();
    }
  }, [colorExtractMode, clearColorExtractPoints, setColorExtractMode, setColorExtractTool, setColorExtractPreviewPoint, setColorExtractEraserMode, clearExtractedColorBlocks]);

  const handleSave = () => {
    exitColorExtractMode();
    saveToStorage();
    alert('已保存');
  };

  const handleLoad = () => {
    exitColorExtractMode();
    loadFromStorage();
    alert('已加载');
  };

  const handleExport = () => {
    exitColorExtractMode();
    exportToJson();
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: '10px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
        maxHeight: '80vh',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {/* 1. 选择工具 */}
      <button
        key="select"
        onClick={() => {
          exitColorExtractMode();
          setCurrentTool('select');
        }}
        title="选择"
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: currentTool === 'select' ? '#1890ff' : 'transparent',
          color: currentTool === 'select' ? '#fff' : '#333',
          fontSize: '18px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s',
          position: 'relative',
        }}
      >
        ⬚
      </button>

      {/* 2. 形状次级菜单（第二位）*/}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => {
            setShowShapeMenu(!showShapeMenu);
            setShowColorExtractMenu(false);
          }}
          title="形状工具"
          style={{
            width: '36px',
            height: '36px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: showShapeMenu ? '#1890ff' : 'transparent',
            color: showShapeMenu ? '#fff' : '#333',
            fontSize: '18px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
          }}
        >
          ⬜
        </button>

        {showShapeMenu && (
          <div style={{
            position: 'fixed',
            left: '56px',
            top: '50%',
            marginTop: '-140px',
            backgroundColor: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: '6px',
            padding: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}>
            {shapeTools.map((tool) => (
              <button
                key={tool.type}
                onClick={() => {
                  exitColorExtractMode();
                  setCurrentTool(tool.type);
                }}
                title={tool.label}
                style={{
                  width: '36px',
                  height: '36px',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: currentTool === tool.type ? '#1890ff' : 'transparent',
                  color: currentTool === tool.type ? '#fff' : '#333',
                  fontSize: '18px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {tool.icon}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. 其他主工具 */}
      {mainTools.slice(1).map((tool) => (
        <button
          key={tool.type}
          onClick={() => {
            exitColorExtractMode();
            setCurrentTool(tool.type);
          }}
          title={tool.hint ? `${tool.label}\n${tool.hint}` : tool.label}
          style={{
            width: '36px',
            height: '36px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: currentTool === tool.type ? '#1890ff' : 'transparent',
            color: currentTool === tool.type ? '#fff' : '#333',
            fontSize: '18px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
            position: 'relative',
          }}
        >
          {tool.icon}
          {tool.hint && currentTool === tool.type && (
            <div
              style={{
                position: 'absolute',
                left: '100%',
                marginLeft: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                backgroundColor: '#333',
                color: '#fff',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                whiteSpace: 'nowrap',
                zIndex: 200,
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              ⚠️ {tool.hint}
            </div>
          )}
        </button>
      ))}

      <div style={{ height: '8px' }} />

      {/* 颜色提取按钮 */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowColorExtractMenu(!showColorExtractMenu)}
          title="颜色提取"
          style={{
            width: '36px',
            height: '36px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: colorExtractMode ? '#faad14' : 'transparent',
            color: colorExtractMode ? '#fff' : '#333',
            fontSize: '18px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          🎨
        </button>

        {showColorExtractMenu && (
          <div style={{
            position: 'fixed',  // 改为 fixed，避免被 overflow 裁剪
            left: '56px',      // 相对于视口定位，稍微偏移
            top: '50%',        // 垂直居中
            marginTop: '-40px',// 向上偏移一点，让菜单居中
            backgroundColor: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: '6px',
            padding: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 2000,      // 最高层级
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}>
            <button
              onClick={() => {
                setColorExtractTool('polygon');
                setColorExtractMode(true);
                clearColorExtractPoints();
                setColorExtractWaitingFor('start');  // 折线模式：累加点
                setColorExtractEraserMode(false);  // 退出橡皮模式
                // 保持菜单打开，不关闭
                setCurrentTool('select');  // 确保当前工具是 select，避免被强制退出
                console.log('[颜色提取] 进入折线模式，准备添加控制点');
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: colorExtractTool === 'polygon' && colorExtractMode ? '#1890ff' : '#f5f5f5',
                color: colorExtractTool === 'polygon' && colorExtractMode ? '#fff' : '#333',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              折线
            </button>
            <button
              onClick={() => {
                setColorExtractTool('bezier');
                setColorExtractMode(true);
                clearColorExtractPoints();
                setColorExtractWaitingFor('start');  // 贝塞尔曲线：起点 → 终点 → 控制点
                setColorExtractEraserMode(false);  // 退出橡皮模式
                // 保持菜单打开，不关闭
                setCurrentTool('select');  // 确保当前工具是 select，避免被强制退出
                console.log('[颜色提取] 进入贝塞尔曲线模式，准备添加控制点');
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: colorExtractTool === 'bezier' && colorExtractMode ? '#1890ff' : '#f5f5f5',
                color: colorExtractTool === 'bezier' && colorExtractMode ? '#fff' : '#333',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              贝塞尔曲线
            </button>
            <button
              onClick={() => {
                // 检查是否有已绘制的虚线
                if (colorExtractCurves.length === 0) {
                  alert('请先绘制至少一条虚线');
                  return;
                }
                
                // 进入等待状态，等待用户点击实线区域
                setColorExtractWaiting(true);
                console.log('[颜色提取] 进入等待状态，请点击实线闭合区域');
                // 保持菜单打开，不关闭
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: colorExtractWaiting ? '#1890ff' : '#52c41a',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {colorExtractWaiting ? '点击实线区域...' : '提取颜色'}
            </button>
            <button
              onClick={() => {
                if (colorExtractCurves.length === 0) {
                  alert('没有可删除的曲线');
                } else {
                  setColorExtractEraserMode(!colorExtractEraserMode);
                  // 保持菜单打开，不关闭
                }
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: colorExtractEraserMode ? '#ff4d4f' : '#f5f5f5',
                color: colorExtractEraserMode ? '#fff' : '#333',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {colorExtractEraserMode ? '退出橡皮' : '橡皮模式'}
            </button>
            <button
              onClick={() => {
                if (colorExtractCurves.length === 0) {
                  alert('没有可删除的虚线');
                } else if (confirm(`确定要清空所有 ${colorExtractCurves.length} 条虚线吗？`)) {
                  clearColorExtractCurvesAndShapes();
                  console.log('[颜色提取] 已清空所有虚线和对应的 shapes');
                  // 清空后同步刷新区域
                  if (activeLayerId) {
                    // ★ refreshRegionCache 异步化（BFS 在 Worker），内部已生成 regionIdTexture（i+1 方案），无需外部再调 generateRegionIdTexture。
                    void refreshRegionCache(activeLayerId, { clearPaintData: false }).then(() => {
                      console.log('[颜色提取] 已重新计算区域');
                    });
                  }
                }
                // 保持菜单打开，不关闭
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: '#f5f5f5',
                color: '#333',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              清空虚线
            </button>
            <button
              onClick={() => {
                const result = useAppStore.getState().compressLayerColorsForExport();
                if (result) {
                  console.log('[压缩结果]', result);
                  // 下载 JSON 文件
                  const json = JSON.stringify(result, null, 2);
                  const blob = new Blob([json], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `color_compression_${Date.now()}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  alert(`压缩完成！共 ${result.regionCount} 个区域`);
                  // 新增：刷新区域实体
                  useAppStore.getState().refreshRegionEntities(activeLayerId!);
                } else {
                  alert('压缩失败，请确保有虚线围成的闭合区域');
                }
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: '#722ed1',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              压缩颜色
            </button>
            <button
              onClick={async () => {
                setShowColorExtractMenu(false);
                try {
                  const { compressToBinary, compressToGzip } = await import('../utils/binaryCompression');

                  const result = useAppStore.getState().compressLayerColorsForExport();
                  if (!result) {
                    alert('压缩失败，请确保有虚线围成的闭合区域');
                    return;
                  }

                  // 1. 转为二进制
                  const binaryData = compressToBinary(result);

                  // 2. Gzip 压缩
                  const gzippedBlob = await compressToGzip(binaryData);

                  // 3. 下载
                  const url = URL.createObjectURL(gzippedBlob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `color_compression_${Date.now()}.ftx.gz`;
                  a.click();
                  URL.revokeObjectURL(url);

                  console.log('[极致压缩] 导出成功', result);
                  alert(`极致压缩完成！共 ${result.regionCount} 个区域`);
                } catch (err) {
                  console.error('[极致压缩] 导出失败:', err);
                  alert('极致压缩失败: ' + (err as Error).message);
                }
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: '#089981',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              导出极致压缩
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
              <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={enableFramePrediction}
                  onChange={(e) => setEnableFramePrediction(e.target.checked)}
                />
                帧间预测
              </label>
            </div>
            <button
              onClick={async () => {
                const state = useAppStore.getState();
                const { frames, sharedBaseColors } = state.skillGroupEditor;
                const { frameDataMap } = state;

                // ★ 只导出已绑定的帧
                const validFrames = frames.filter(f => {
                  const frameData = frameDataMap[f.id];
                  return f.bbox && frameData?.boundRegionId !== null && frameData?.boundBaseTexture !== null;
                });

                if (validFrames.length === 0) {
                  alert('没有可导出的帧。请先在图层管理中为导入的帧绑定区域。');
                  return;
                }

                // 收集所有已绑定帧使用的调色板颜色（扫描 rawRegionIdTex 中的全局 ID）
                const usedColorIds = new Set<number>();
                for (const frame of validFrames) {
                  const fd = frameDataMap[frame.id];
                  const raw = fd?.rawRegionIdTex;
                  if (raw) {
                    for (let i = 0; i < raw.length; i++) {
                      if (raw[i] !== 0) usedColorIds.add(raw[i]);
                    }
                  }
                }

                // 导出调色板 = 共享调色板 ∩ 被使用的颜色
                const exportedPalette = sharedBaseColors.filter(c => usedColorIds.has(c.id));

                if (exportedPalette.length === 0) {
                  alert('绑定的区域没有颜色数据，请确保区域已正确提取颜色。');
                  return;
                }

                try {
                  const { packMultiFrameToBinary } = await import('../utils/multiFrameExport');
                  // 构建导出帧数据
                  const idToIndex = new Map<number, number>();
                  exportedPalette.forEach((c, idx) => idToIndex.set(c.id, idx));

                  // ===== 导出前 blockFlags 日志 =====
                  console.log('========================================');
                  console.log('[多帧导出] 准备导出，原始帧数据 blockFlags:');
                  console.log('========================================');
                  for (let i = 0; i < validFrames.length; i++) {
                    const frame = validFrames[i];
                    const frameData = frameDataMap[frame.id];
                    console.log(`[多帧导出] 帧 ${i} "${frame.name}"`);
                    console.log(`  - bbox: x=${frame.bbox!.x}, y=${frame.bbox!.y}, w=${frame.bbox!.w}, h=${frame.bbox!.h}`);
                    console.log(`  - rawBlockFlags = 0x${(frameData.rawBlockFlags ?? 0n).toString(16).padStart(16, '0')}`);
                    console.log(`  - 帧数据存在: ${!!frameData}`);
                    console.log(`  - deltaPacked 长度: ${frameData.rawDeltaPacked?.length ?? 0}`);
                    console.log(`  - regionIdTex 长度: ${frameData.rawRegionIdTex?.length ?? 0}`);
                  }
                  console.log('========================================');

                  const exportFrames = validFrames.map(frame => {
                    const frameData = frameDataMap[frame.id];
                    const raw = frameData.rawRegionIdTex!;
                    const newRegionIdTex = new Uint16Array(raw.length);
                    for (let i = 0; i < raw.length; i++) {
                      const globalId = raw[i];
                      if (globalId === 0) {
                        newRegionIdTex[i] = 0;
                      } else {
                        const idx = idToIndex.get(globalId);
                        newRegionIdTex[i] = idx !== undefined ? idx + 1 : 0;
                      }
                    }

                    return {
                      name: frame.name || '未命名',
                      width: 512,
                      height: 512,
                      bbox: frame.bbox!,
                      regionIdTex: newRegionIdTex,
                      deltaPacked: frameData.rawDeltaPacked || new Uint16Array(0),
                      blockFlags: BigInt(frameData.rawBlockFlags ?? 0),
                    };
                  });

                  // ★ 传入帧间预测参数
                  const binary = packMultiFrameToBinary(exportedPalette, exportFrames, enableFramePrediction);
                  const compressToGzip = (await import('../utils/binaryCompression')).compressToGzip;
                  const gzipped = await compressToGzip(binary);
                  const url = URL.createObjectURL(gzipped);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `multiframe_export_${Date.now()}.ftx3.gz`;
                  a.click();
                  URL.revokeObjectURL(url);
                  alert(`导出成功！${exportFrames.length} 帧，${exportedPalette.length} 色，预测: ${enableFramePrediction ? '启用' : '禁用'}`);
                } catch (err) {
                  console.error('[多帧导出] 失败:', err);
                  alert('导出失败: ' + (err as Error).message);
                }
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                background: '#13c2c2',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              导出多帧纹理（仅已绑定）
            </button>
            <button
              onClick={() => {
                setShowColorExtractMenu(false);
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: '#f5f5f5',
                color: '#333',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              关闭菜单
            </button>
          </div>
        )}
      </div>

      <div style={{ height: '8px' }} />

      <button
        onClick={() => {
          exitColorExtractMode();
          undo();
        }}
        title="撤销"
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: '#333',
          fontSize: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ↩
      </button>

      <button
        onClick={handleSave}
        title="保存"
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: '#333',
          fontSize: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        💾
      </button>

      <button
        onClick={handleLoad}
        title="加载"
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: '#333',
          fontSize: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        📂
      </button>

      <button
        onClick={handleExport}
        title="导出JSON"
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: '#333',
          fontSize: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        📥
      </button>

      <div style={{ height: '8px' }} />

      <button
        onClick={() => setSnapEnabled(!snapEnabled)}
        title={snapEnabled ? '关闭吸附' : '开启吸附'}
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: snapEnabled ? '#52c41a' : '#ddd',
          color: snapEnabled ? '#fff' : '#666',
          fontSize: '14px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s',
        }}
      >
        ◉
      </button>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          padding: '4px 0',
        }}
      >
        <span style={{ fontSize: '10px', color: '#666' }}>吸附半径</span>
        <input
          type="range"
          min="1"
          max="50"
          value={snapRadius}
          onChange={(e) => setSnapRadius(parseInt(e.target.value))}
          disabled={!snapEnabled}
          style={{
            width: '32px',
            height: '6px',
            cursor: snapEnabled ? 'pointer' : 'not-allowed',
          }}
        />
        <span style={{ fontSize: '10px', color: '#666' }}>{snapRadius}px</span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          padding: '4px 0',
        }}
      >
        <span style={{ fontSize: '10px', color: '#666' }}>线条粗细</span>
        <input
          type="range"
          min="0"
          max="5"
          step="0.1"
          value={lineWidth}
          onChange={(e) => setLineWidth(parseFloat(e.target.value))}
          style={{
            width: '32px',
            height: '6px',
            cursor: 'pointer',
          }}
        />
        <span style={{ fontSize: '10px', color: '#666' }}>{lineWidth === 0 ? '无' : lineWidth + 'px'}</span>
      </div>

      {/* BFS 光栅化分辨率 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          padding: '4px 0',
        }}
      >
        <span style={{ fontSize: '9px', color: '#999' }}>BFS精度</span>
        <input
          type="range"
          min="200"
          max="3000"
          step="100"
          value={bfsResolution}
          onChange={(e) => setBfsResolution(parseInt(e.target.value))}
          style={{
            width: '32px',
            height: '6px',
            cursor: 'pointer',
          }}
        />
        <span style={{ fontSize: '9px', color: '#666' }}>{bfsResolution}</span>
      </div>

      {/* 颜色选择器 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 0',
        }}
      >
        <span style={{ fontSize: '10px', color: '#666' }}>颜色</span>
        {/* 当前颜色预览 */}
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: currentColor,
            border: '2px solid #ccc',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
          title="点击选择颜色"
        />
        {/* 预设颜色网格 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '2px',
            padding: '2px',
          }}
        >
          {presetColors.map((color) => (
            <button
              key={color}
              onClick={() => setCurrentColor(color)}
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '3px',
                backgroundColor: color,
                border: currentColor === color ? '2px solid #333' : '1px solid #ddd',
                cursor: 'pointer',
                padding: '0',
              }}
              title={color}
            />
          ))}
        </div>
        {/* 自定义颜色输入 */}
        <input
          type="color"
          value={currentColor}
          onChange={(e) => setCurrentColor(e.target.value)}
          style={{
            width: '32px',
            height: '20px',
            cursor: 'pointer',
            border: 'none',
            borderRadius: '4px',
          }}
          title="自定义颜色"
        />
      </div>

      {/* 上色画笔大小（仅在上色画笔工具时显示） */}
      {currentTool === 'paintBrush' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            padding: '4px 0',
          }}
        >
          <span style={{ fontSize: '10px', color: '#666' }}>画笔大小</span>
          <input
            type="range"
            min="0.002"
            max="0.2"
            step="0.001"
            value={paintBrushSize}
            onChange={(e) => setPaintBrushSize(parseFloat(e.target.value))}
            style={{
              width: '32px',
              height: '6px',
              cursor: 'pointer',
            }}
          />
          <span style={{ fontSize: '10px', color: '#666' }}>{(paintBrushSize * 100).toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}
