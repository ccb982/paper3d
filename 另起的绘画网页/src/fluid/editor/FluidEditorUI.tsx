import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFluidEditor } from './useFluidEditor';
import type { ViewMode, FluidEditorConfig } from './FluidEditor';

// ============================================================
// 子组件：通用设置面板
// ============================================================
const GeneralPanel: React.FC<{
  config: FluidEditorConfig;
  viewMode: ViewMode;
  onConfigChange: (updates: Partial<FluidEditorConfig>) => void;
  onViewChange: (mode: ViewMode) => void;
}> = ({ config, viewMode, onConfigChange, onViewChange }) => {
  return (
    <div className="fluid-panel">
      <div className="panel-header">
        <span>⚙️ 通用设置</span>
      </div>
      <div className="panel-body">
        {/* 分辨率 */}
        <div className="control-group">
          <label>分辨率</label>
          <div className="row">
            <input
              type="number"
              min={16}
              max={1024}
              step={16}
              value={config.resolution.w}
              onChange={(e) => onConfigChange({
                resolution: { w: +e.target.value, h: +e.target.value }
              })}
            />
            <span className="hint">× {config.resolution.h}</span>
          </div>
        </div>

        {/* 通道选择 */}
        <div className="control-group">
          <label>平流通道</label>
          <div className="channel-row">
            {(['r', 'g', 'b', 'a'] as const).map((ch) => (
              <label key={ch} className="channel-label">
                <input
                  type="checkbox"
                  checked={config.channels[ch]}
                  onChange={() => onConfigChange({
                    channels: { ...config.channels, [ch]: !config.channels[ch] }
                  })}
                />
                <span className={ch === 'r' ? 'hue' : ch === 'g' ? 'sat' : ch === 'b' ? 'lum' : 'alpha'}>
                  {ch === 'r' ? 'H' : ch === 'g' ? 'S' : ch === 'b' ? 'L' : 'A'}
                </span>
                <span className="hint">
                  {ch === 'r' ? '色相' : ch === 'g' ? '饱和度' : ch === 'b' ? '明度' : '透明度'}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* 视图模式 */}
        <div className="control-group">
          <label>视图</label>
          <div className="btn-group">
            <button
              className={viewMode === 'color' ? 'active' : ''}
              onClick={() => onViewChange('color')}
            >
              🎨 颜色
            </button>
            <button
              className={viewMode === 'velocity' ? 'active' : ''}
              onClick={() => onViewChange('velocity')}
            >
              💨 速度
            </button>
          </div>
        </div>

        {/* 边界模式 */}
        <div className="control-group">
          <label>颜色边界</label>
          <select
            value={config.colorBoundaryMode || 'clamp'}
            onChange={(e) => onConfigChange({
              colorBoundaryMode: e.target.value as 'clamp' | 'repeat' | 'zero'
            })}
          >
            <option value="clamp">钳制</option>
            <option value="repeat">重复</option>
            <option value="zero">越界消失</option>
          </select>
        </div>

        {/* 重力 */}
        <div className="control-group">
          <label>重力</label>
          <div className="row">
            <input
              type="number"
              step={10}
              value={config.gravity}
              onChange={(e) => onConfigChange({ gravity: +e.target.value })}
            />
            <span className="hint">px/s²</span>
          </div>
        </div>

        {/* 注入源 */}
        <div className="control-group">
          <div className="row">
            <label>注入源</label>
            <input
              type="checkbox"
              checked={config.injection.enabled}
              onChange={(e) => onConfigChange({
                injection: { ...config.injection, enabled: e.target.checked }
              })}
            />
          </div>
          {config.injection.enabled && (
            <div className="nested-controls">
              <div className="row">
                <span>位置 X</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={config.injection.position.x}
                  onChange={(e) => onConfigChange({
                    injection: {
                      ...config.injection,
                      position: { x: +e.target.value, y: config.injection.position.y }
                    }
                  })}
                />
                <span className="hint">{config.injection.position.x.toFixed(2)}</span>
              </div>
              <div className="row">
                <span>位置 Y</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={config.injection.position.y}
                  onChange={(e) => onConfigChange({
                    injection: {
                      ...config.injection,
                      position: { x: config.injection.position.x, y: +e.target.value }
                    }
                  })}
                />
                <span className="hint">{config.injection.position.y.toFixed(2)}</span>
              </div>
              <div className="row">
                <span>半径</span>
                <input
                  type="range"
                  min={0.01}
                  max={0.5}
                  step={0.005}
                  value={config.injection.radius}
                  onChange={(e) => onConfigChange({
                    injection: { ...config.injection, radius: +e.target.value }
                  })}
                />
                <span className="hint">{config.injection.radius.toFixed(3)}</span>
              </div>
              <div className="row">
                <span>速率</span>
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={0.5}
                  value={config.injection.rate}
                  onChange={(e) => onConfigChange({
                    injection: { ...config.injection, rate: +e.target.value }
                  })}
                />
                <span className="hint">{config.injection.rate.toFixed(1)}</span>
              </div>
              <div className="row">
                <span>速度 Y</span>
                <input
                  type="number"
                  step={10}
                  value={config.injection.velocity.y}
                  onChange={(e) => onConfigChange({
                    injection: {
                      ...config.injection,
                      velocity: { x: config.injection.velocity.x, y: +e.target.value }
                    }
                  })}
                />
                <span className="hint">px/s</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：平流面板
// ============================================================
const AdvectionPanel: React.FC<{
  enabled: boolean;
  onToggle: () => void;
}> = ({ enabled, onToggle }) => {
  return (
    <div className="fluid-panel">
      <div className="panel-header">
        <span>🌊 平流</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span className="slider" />
        </label>
      </div>
      <div className="panel-body">
        <div className="control-group">
          <label>子步数</label>
          <div className="row">
            <input type="number" min={1} max={16} step={1} value={6} disabled />
            <span className="hint">固定 6 步</span>
          </div>
        </div>
        <div className="control-group">
          <label>速度自平流</label>
          <span className="hint">默认启用</span>
        </div>
        <div className="control-group">
          <label>颜色平流</label>
          <span className="hint">由通道开关控制</span>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：压力迭代面板
// ============================================================
const PressurePanel: React.FC<{
  enabled: boolean;
  iterations: number;
  overRelaxation: number;
  onToggle: () => void;
  onIterationsChange: (val: number) => void;
  onRelaxationChange: (val: number) => void;
}> = ({ enabled, iterations, overRelaxation, onToggle, onIterationsChange, onRelaxationChange }) => {
  return (
    <div className="fluid-panel">
      <div className="panel-header">
        <span>📊 压力迭代</span>
        <label className="toggle-switch" title="暂未实现">
          <input type="checkbox" checked={enabled} onChange={onToggle} disabled />
          <span className="slider" />
        </label>
      </div>
      <div className="panel-body">
        <div className="control-group">
          <label>迭代次数</label>
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={iterations}
            onChange={(e) => onIterationsChange(+e.target.value)}
          />
        </div>
        <div className="control-group">
          <label>过松弛因子 (SOR)</label>
          <div className="row">
            <input
              type="range"
              min={0.1}
              max={2.0}
              step={0.01}
              value={overRelaxation}
              onChange={(e) => onRelaxationChange(+e.target.value)}
            />
            <span className="hint">{overRelaxation.toFixed(2)}</span>
          </div>
        </div>
        <div className="control-group">
          <label>边界条件</label>
          <select>
            <option value="dirichlet">狄利克雷 (固定压力)</option>
            <option value="neumann">诺伊曼 (自由边界)</option>
          </select>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：Level Set 面板
// ============================================================
const LevelSetPanel: React.FC<{
  enabled: boolean;
  reinitInterval: number;
  narrowBandWidth: number;
  surfaceTension: number;
  onToggle: () => void;
  onReinitChange: (val: number) => void;
  onBandWidthChange: (val: number) => void;
  onTensionChange: (val: number) => void;
}> = ({ enabled, reinitInterval, narrowBandWidth, surfaceTension,
       onToggle, onReinitChange, onBandWidthChange, onTensionChange }) => {
  return (
    <div className="fluid-panel">
      <div className="panel-header">
        <span>🌀 Level Set</span>
        <label className="toggle-switch" title="暂未实现">
          <input type="checkbox" checked={enabled} onChange={onToggle} disabled />
          <span className="slider" />
        </label>
      </div>
      <div className="panel-body">
        <div className="control-group">
          <label>重新初始化间隔</label>
          <div className="row">
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={reinitInterval}
              onChange={(e) => onReinitChange(+e.target.value)}
            />
            <span className="hint">帧</span>
          </div>
        </div>
        <div className="control-group">
          <label>窄带宽度</label>
          <div className="row">
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={narrowBandWidth}
              onChange={(e) => onBandWidthChange(+e.target.value)}
            />
            <span className="hint">{narrowBandWidth.toFixed(1)}</span>
          </div>
        </div>
        <div className="control-group">
          <label>表面张力系数</label>
          <div className="row">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={surfaceTension}
              onChange={(e) => onTensionChange(+e.target.value)}
            />
            <span className="hint">{surfaceTension.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================
export const FluidEditorUI: React.FC = () => {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const displayRafRef = useRef<number>();

  const [rendererReady, setRendererReady] = useState(false);

  // 压力参数
  const [pressureParams, setPressureParams] = useState({
    iterations: 20,
    overRelaxation: 1.7,
    boundaryCondition: 'dirichlet' as 'dirichlet' | 'neumann',
  });

  // Level Set 参数
  const [levelsetParams, setLevelsetParams] = useState({
    reinitInterval: 10,
    narrowBandWidth: 5,
    surfaceTension: 0.1,
  });

  // ==================== 初始化隐藏渲染器 ====================
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    canvas.style.display = 'none';
    document.body.appendChild(canvas);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    rendererRef.current = renderer;
    setRendererReady(true);

    return () => {
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      rendererRef.current = null;
      setRendererReady(false);
    };
  }, []);

  // ==================== 流体编辑 Hook ====================
  const {
    editor,
    config,
    updateConfig,
    viewMode,
    setView,
  } = useFluidEditor(rendererRef.current, {
    resolution: { w: 256, h: 256 },
    channels: { r: true, g: true, b: true, a: true },
    enableAdvection: true,
    enablePressure: false,
    enableLevelSet: false,
    gravity: 1000,
    injection: {
      enabled: true,
      position: { x: 0.5, y: 0.05 },
      radius: 0.1,
      rate: 15,
      velocity: { x: 0, y: 200 },
      color: [0.0, 0.8, 1.0, 1.0],
    },
    colorBoundaryMode: 'clamp',
  });

  // ==================== 显示循环 ====================
  useEffect(() => {
    if (!rendererReady || !editor) return;

    const canvas = displayCanvasRef.current;
    if (!canvas) return;

    const loop = () => {
      const { w, h } = config.resolution;

      // 同步 canvas 尺寸
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      // 从 GPU 回读像素
      const pixels = viewMode === 'color'
        ? editor.readColorPixels()
        : editor.readVelocityPixels();

      // 绘制到 Canvas 2D
      const ctx = canvas.getContext('2d')!;
      const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), w, h);

      if (viewMode === 'velocity') {
        // 速度场可视化：将 RG 双通道映射为颜色
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const vx = d[i];
          const vy = d[i + 1];
          const mx = (vx - 128) * 2;
          const my = (vy - 128) * 2;
          d[i]     = Math.max(0, Math.min(255, 128 + mx));
          d[i + 1] = Math.max(0, Math.min(255, 128 + my));
          d[i + 2] = 64;
          d[i + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      displayRafRef.current = requestAnimationFrame(loop);
    };

    displayRafRef.current = requestAnimationFrame(loop);

    return () => {
      if (displayRafRef.current) {
        cancelAnimationFrame(displayRafRef.current);
      }
    };
  }, [rendererReady, editor, config.resolution, viewMode]);

  // ==================== 渲染 ====================
  return (
    <div className="fluid-editor-ui">
      {/* 左侧面板 */}
      <div className="fluid-sidebar">
        {/* 通用设置 */}
        <GeneralPanel
          config={config}
          viewMode={viewMode}
          onConfigChange={updateConfig}
          onViewChange={setView}
        />

        {/* 平流 */}
        <AdvectionPanel
          enabled={config.enableAdvection}
          onToggle={() => updateConfig({ enableAdvection: !config.enableAdvection })}
        />

        {/* 压力迭代 */}
        <PressurePanel
          enabled={config.enablePressure}
          iterations={pressureParams.iterations}
          overRelaxation={pressureParams.overRelaxation}
          onToggle={() => updateConfig({ enablePressure: !config.enablePressure })}
          onIterationsChange={(val) => setPressureParams(p => ({ ...p, iterations: val }))}
          onRelaxationChange={(val) => setPressureParams(p => ({ ...p, overRelaxation: val }))}
        />

        {/* Level Set */}
        <LevelSetPanel
          enabled={config.enableLevelSet}
          reinitInterval={levelsetParams.reinitInterval}
          narrowBandWidth={levelsetParams.narrowBandWidth}
          surfaceTension={levelsetParams.surfaceTension}
          onToggle={() => updateConfig({ enableLevelSet: !config.enableLevelSet })}
          onReinitChange={(val) => setLevelsetParams(p => ({ ...p, reinitInterval: val }))}
          onBandWidthChange={(val) => setLevelsetParams(p => ({ ...p, narrowBandWidth: val }))}
          onTensionChange={(val) => setLevelsetParams(p => ({ ...p, surfaceTension: val }))}
        />
      </div>

      {/* 视口 */}
      <div className="fluid-viewport">
        <canvas ref={displayCanvasRef} />
        <div className="viewport-info">
          <span>{config.resolution.w}×{config.resolution.h}</span>
          <span>{viewMode === 'color' ? '颜色场' : '速度场'}</span>
          <span>{config.enableAdvection ? '平流: ON' : '平流: OFF'}</span>
        </div>
      </div>

      {/* 样式 */}
      <style>{`
        .fluid-editor-ui {
          display: flex;
          flex: 1;
          width: 100%;
          background: #f5f5f5;
          color: #333;
          min-height: 0;
        }

        /* 左侧面板 */
        .fluid-sidebar {
          width: 260px;
          min-width: 260px;
          flex-shrink: 0;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          background: #ffffff;
          border-right: 1px solid #ddd;
          padding: 8px 12px;
          scrollbar-width: thin;
          scrollbar-color: #ccc #eee;
        }

        /* 面板间距替代 gap（block 布局用 margin） */
        .fluid-sidebar > .fluid-panel {
          margin-bottom: 8px;
        }

        .fluid-sidebar > .fluid-panel:last-child {
          margin-bottom: 0;
        }

        .fluid-sidebar::-webkit-scrollbar {
          width: 6px;
        }

        .fluid-sidebar::-webkit-scrollbar-track {
          background: #eee;
        }

        .fluid-sidebar::-webkit-scrollbar-thumb {
          background: #ccc;
          border-radius: 3px;
        }

        .fluid-sidebar::-webkit-scrollbar-thumb:hover {
          background: #999;
        }

        .fluid-panel {
          background: #fafafa;
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid #ddd;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: #f0f0f0;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          user-select: none;
          color: #444;
        }

        .panel-body {
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .control-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .control-group label {
          font-size: 11px;
          color: #666;
          font-weight: 500;
        }

        .control-group .row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .control-group input[type="number"],
        .control-group select {
          background: #ffffff;
          border: 1px solid #ccc;
          color: #333;
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 12px;
          width: 100%;
        }

        .control-group input[type="range"] {
          flex: 1;
          accent-color: #4fc3f7;
          background: transparent;
        }

        .control-group input[type="checkbox"] {
          margin: 0;
          cursor: pointer;
        }

        .control-group .hint {
          font-size: 10px;
          color: #999;
          min-width: 45px;
          text-align: right;
        }

        /* 通道行 */
        .channel-row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .channel-label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 4px;
          background: #f0f0f0;
          cursor: pointer;
          border: 1px solid #ddd;
        }

        .channel-label .hue { color: #d32f2f; }
        .channel-label .sat { color: #388e3c; }
        .channel-label .lum { color: #1976d2; }
        .channel-label .alpha { color: #888; }

        /* 切换开关 */
        .toggle-switch {
          position: relative;
          width: 36px;
          height: 20px;
          cursor: pointer;
        }

        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .toggle-switch .slider {
          position: absolute;
          inset: 0;
          background: #ddd;
          border-radius: 10px;
          transition: 0.3s;
        }

        .toggle-switch .slider::before {
          content: '';
          position: absolute;
          height: 16px;
          width: 16px;
          left: 2px;
          bottom: 2px;
          background: white;
          border-radius: 50%;
          transition: 0.3s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }

        .toggle-switch input:checked + .slider {
          background: #4fc3f7;
        }

        .toggle-switch input:checked + .slider::before {
          transform: translateX(16px);
        }

        /* 按钮组 */
        .btn-group {
          display: flex;
          gap: 4px;
        }

        .btn-group button {
          flex: 1;
          padding: 4px 8px;
          border: 1px solid #ccc;
          background: #fff;
          color: #666;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          transition: 0.2s;
        }

        .btn-group button.active {
          background: #4fc3f7;
          color: #fff;
          border-color: #29b6f6;
        }

        /* 嵌套控件 */
        .nested-controls {
          padding-left: 12px;
          border-left: 2px solid #ddd;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .nested-controls .row span {
          font-size: 11px;
          color: #666;
          min-width: 50px;
        }

        /* 视口 */
        .fluid-viewport {
          flex: 1;
          position: relative;
          background: #e8e8e8;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .fluid-viewport canvas {
          image-rendering: pixelated;
          max-width: 100%;
          max-height: 100%;
          border: 2px solid #ccc;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        .viewport-info {
          position: absolute;
          bottom: 12px;
          left: 12px;
          display: flex;
          gap: 16px;
          font-size: 11px;
          color: #666;
          background: rgba(255,255,255,0.8);
          padding: 4px 12px;
          border-radius: 4px;
          border: 1px solid #ddd;
        }
      `}</style>
    </div>
  );
};
