import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFluidEditor } from './useFluidEditor';
import type { ViewMode, FluidEditorConfig } from './FluidEditor';
import { useAppStore } from '../../stores/useAppStore';
import { getAdaptiveBlockIndex, getRangeForBlock, unpackRGB565 } from '../../core/ftxCore';
import { hslToRgb } from '../../utils/colorCompressor';

// ============================================================
// 子组件：操作面板（新增 - 点击注入测试）
// ============================================================
const OperationsPanel: React.FC<{
  onInjectWater: (pos: { x: number; y: number }) => void;
  onInjectColor: (pos: { x: number; y: number }) => void;
}> = ({ onInjectWater, onInjectColor }) => {
  return (
    <div className="fluid-panel">
      <div className="panel-header">
        <span>💧 操作模块</span>
      </div>
      <div className="panel-body">
        <div className="control-group">
          <label>点击注入</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              onClick={() => onInjectWater({ x: 0.5, y: 0.3 })}
              style={{
                width: '100%', padding: '6px',
                background: '#29b6f6', color: '#fff', border: 'none',
                borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
              }}
            >
              🌊 生成水（中心）
            </button>
            <button
              onClick={() => onInjectWater({ x: 0.2, y: 0.7 })}
              style={{
                width: '100%', padding: '6px',
                background: '#4dd0e1', color: '#fff', border: 'none',
                borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
              }}
            >
              🌊 生成水（左下）
            </button>
            <button
              onClick={() => onInjectWater({ x: 0.8, y: 0.2 })}
              style={{
                width: '100%', padding: '6px',
                background: '#4dd0e1', color: '#fff', border: 'none',
                borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
              }}
            >
              🌊 生成水（右上）
            </button>
            <button
              onClick={() => onInjectColor({ x: 0.5, y: 0.6 })}
              style={{
                width: '100%', padding: '6px',
                background: '#ef5350', color: '#fff', border: 'none',
                borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
              }}
            >
              🔴 红色颜料（中心偏下）
            </button>
          </div>
        </div>
        <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
          点击按钮向流体中添加颜色和速度
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：通用设置面板
// ============================================================
const GeneralPanel: React.FC<{
  config: FluidEditorConfig;
  viewMode: ViewMode;
  onConfigChange: (updates: Partial<FluidEditorConfig>) => void;
  onViewChange: (mode: ViewMode) => void;
  onReset: () => void;
  onExport: () => void;
}> = ({ config, viewMode, onConfigChange, onViewChange, onReset, onExport }) => {
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
            <button
              className={viewMode === 'composite' ? 'active' : ''}
              onClick={() => onViewChange('composite')}
            >
              🖼️ 合成
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

        {/* 刷新按钮 */}
        <div className="control-group">
          <button
            onClick={onReset}
            style={{
              width: '100%',
              padding: '6px 12px',
              background: '#4fc3f7',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            🔄 重置流体场
          </button>
        </div>

        {/* 导出按钮 */}
        <div className="control-group">
          <button
            onClick={onExport}
            style={{
              width: '100%',
              padding: '6px 12px',
              background: '#66bb6a',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              marginTop: '4px',
            }}
          >
            📤 导出状态 JSON
          </button>
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
  boundaryMode: 'dirichlet' | 'neumann';
  warmStart: boolean;
  onToggle: () => void;
  onIterationsChange: (val: number) => void;
  onRelaxationChange: (val: number) => void;
  onBoundaryModeChange: (mode: 'dirichlet' | 'neumann') => void;
  onWarmStartChange: (enabled: boolean) => void;
}> = ({ enabled, iterations, overRelaxation, boundaryMode, warmStart,
       onToggle, onIterationsChange, onRelaxationChange, onBoundaryModeChange, onWarmStartChange }) => {
  return (
    <div className="fluid-panel">
      <div className="panel-header">
        <span>📊 压力迭代</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
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
          <select
            value={boundaryMode}
            onChange={(e) => onBoundaryModeChange(e.target.value as 'dirichlet' | 'neumann')}
          >
            <option value="dirichlet">狄利克雷 (固定压力=0)</option>
            <option value="neumann">诺伊曼 (自由边界)</option>
          </select>
        </div>
        <div className="control-group">
          <label className="row">
            <span>🔥 热启动</span>
            <span className="hint" title="用上一帧压力作为初始猜测，迭代次数可大幅降低">
              ({warmStart ? '开' : '关'})
            </span>
          </label>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={warmStart}
              onChange={(e) => onWarmStartChange(e.target.checked)}
            />
            <span className="slider" />
          </label>
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
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null); // 唯一的渲染器：计算 + 显示
  const [rendererState, setRendererState] = useState<THREE.WebGLRenderer | null>(null); // 用于传递给 useFluidEditor
  const displayRafRef = useRef<number>();
  /** 缓存的底图纹理 + 上一次的 activeLayerId，避免每帧重建 */
  const baseTexRef = useRef<THREE.DataTexture | null>(null);
  const baseLayerIdRef = useRef<string | null>(null);
  /** 残差量化范围（可调，后续可加 UI 控制） */
  const residualRangeHRef = useRef(0.5);
  const residualRangeSLRef = useRef(0.5);
  /** 导入时 stash 的原始帧数据（供像素比较器使用） */
  const stashedBaseRef = useRef<ImageData | null>(null);
  const stashedBaseHslRef = useRef<Float32Array | null>(null); // ★ 新增：浮点 HSL 数据
  const stashedResidualRef = useRef<ImageData | null>(null);
  const stashedResidualWRef = useRef(0);
  const stashedResidualHRef = useRef(0);
  const stashedBaseWRef = useRef(0);
  const stashedBaseHRef = useRef(0);

  const [rendererReady, setRendererReady] = useState(false);

  // ==================== 辅助函数：双层级比较器 ====================
  /** RGB(0~1) → HSL(0~1) */
  const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h, s, l };
  };

  /** 合成公式（与合成着色器一致） */
  const computeCompositeHsl = (
    baseHsl: { h: number; s: number; l: number },
    residual: { r: number; g: number; b: number },
    rangeH: number,
    rangeSL: number,
  ): { h: number; s: number; l: number } => {
    const dH = (residual.r * 2.0 - 1.0) * rangeH;
    const dS = (residual.g * 2.0 - 1.0) * rangeSL;
    const dL = (residual.b * 2.0 - 1.0) * rangeSL;
    let finalH = baseHsl.h + dH;
    finalH = finalH - Math.floor(finalH); // fract
    const finalS = Math.max(0, Math.min(1, baseHsl.s + dS));
    const finalL = Math.max(0, Math.min(1, baseHsl.l + dL));
    return { h: finalH, s: finalS, l: finalL };
  };
  // ================================================================

  // 采样信息（点击 canvas 时填充）
  const [sampleInfo, setSampleInfo] = useState<{
    px: number; py: number;
    // 层级1：残差保真度
    simResidual: { h: number; s: number; l: number };
    origResidual: { h: number; s: number; l: number };
    deltaResidual: { h: number; s: number; l: number };
    // 层级2：合成正确性
    simComposite: { h: number; s: number; l: number };
    origComposite: { h: number; s: number; l: number };
    deltaComposite: { h: number; s: number; l: number };
    // 基础色（参考）
    baseColor: { h: number; s: number; l: number } | null;
    // 速度
    velX: number; velY: number; velMag: number;
  } | null>(null);

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

  // ==================== 初始化渲染器（计算 + 显示共用） ====================
  useEffect(() => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 1);
    rendererRef.current = renderer;
    setRendererState(renderer); // 用状态传递，触发 useFluidEditor 重新计算
    setRendererReady(true);


    return () => {
      renderer.dispose();
      rendererRef.current = null;
      setRendererState(null);
      setRendererReady(false);
    };
  }, []);

  // ==================== 流体编辑 Hook（使用主渲染器） ====================
  const {
    editor,
    config,
    updateConfig,
    viewMode,
    setView,
    reset,
    injectWater,
    injectColorOnly,
  } = useFluidEditor(rendererState, {
    resolution: { w: 256, h: 256 },
    channels: { r: true, g: true, b: true, a: true },
    enableAdvection: true,
    enablePressure: false,
    enableLevelSet: false,
    gravity: 250, // 正值向下（屏幕坐标系）
    injection: {
      enabled: true,
      position: { x: 0.5, y: 0.25 }, // Y向下为正，0.25 = 靠近顶部（25%位置）
      radius: 0.1,
      rate: 15,
      velocity: { x: 0, y: -50 }, // 负Y=向下
      color: [0.0, 0.8, 1.0, 1.0],
    },
    colorBoundaryMode: 'clamp',
  });

  // ==================== 显示循环（计算 + 显示共用一个渲染器） ====================
  useEffect(() => {
    if (!rendererReady || !editor) return;

    // ===== 暴露 editor 到 window 供控制台调试 =====
    (window as any).fluidEditor = editor;
    console.log(`[FluidEditorUI] editor 已暴露到 window.fluidEditor`);

    const canvas = displayCanvasRef.current;
    if (!canvas) return;

    const renderer = rendererRef.current!;

    // 共享相机（正交相机，全屏覆盖）
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // 颜色场景：HSL → RGB 转换后直接显示
    const colorScene = new THREE.Scene();
    const colorQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const colorMat = new THREE.ShaderMaterial({
      uniforms: { 
        uColor: { value: editor.getColorTexture() },
        uDebugMode: { value: 0 }, // 0=正常显示, 1=显示R通道, 2=显示G通道, 3=显示B通道, 4=显示A通道
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = vec2(uv.x, 1.0 - uv.y); // flipY=false: 补偿平面几何UV(0,0)=底部
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uColor;
        uniform int uDebugMode;
        varying vec2 vUv;
        
        vec3 hsl_to_rgb(float h, float s, float l) {
          vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
        }
        
        void main() {
          vec4 hsl = texture2D(uColor, vUv);
          
          // 调试模式：显示各通道原始值
          if (uDebugMode == 1) {
            gl_FragColor = vec4(hsl.r, hsl.r, hsl.r, 1.0);
          } else if (uDebugMode == 2) {
            gl_FragColor = vec4(hsl.g, hsl.g, hsl.g, 1.0);
          } else if (uDebugMode == 3) {
            gl_FragColor = vec4(hsl.b, hsl.b, hsl.b, 1.0);
          } else if (uDebugMode == 4) {
            gl_FragColor = vec4(hsl.a, hsl.a, hsl.a, 1.0);
          } else {
            // 正常模式：HSL转RGB
            vec3 rgb = hsl_to_rgb(hsl.r, hsl.g, hsl.b);
            gl_FragColor = vec4(rgb, hsl.a);
          }
        }
      `,
      transparent: true,
    });
    colorQuad.material = colorMat;
    colorScene.add(colorQuad);

    // 速度场景：方向色可视化
    const velScene = new THREE.Scene();
    const velQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const velMat = new THREE.ShaderMaterial({
      uniforms: {
        uVel: { value: editor.getVelocityTexture() },
        uMaxVel: { value: 1000 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = vec2(uv.x, 1.0 - uv.y); // flipY=false: 补偿平面几何UV(0,0)=底部
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uVel;
        uniform float uMaxVel;
        varying vec2 vUv;
        
        void main() {
          vec2 vel = texture2D(uVel, vUv).rg;
          float len = length(vel);
          float normalizedLen = min(len / uMaxVel, 1.0);
          
          // 速度可视化：红色=X正方向, 绿色=Y正方向, 蓝色=低速
          vec3 color = vec3(
            0.5 + vel.x * 0.002,
            0.5 + vel.y * 0.002,
            0.5 - (vel.x + vel.y) * 0.001
          );
          
          color *= normalizedLen;
          color += (1.0 - normalizedLen) * 0.1;
          
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    velQuad.material = velMat;
    velScene.add(velQuad);

    // 合成场景：底图（baseTexture）+ 平流残差（fluid residual）实时混合
    const compositeScene = new THREE.Scene();
    const compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        uBaseTexture: { value: null as THREE.Texture | null },
        uResidual: { value: editor.getColorTexture() },
        uResidualRangeH: { value: residualRangeHRef.current },
        uResidualRangeSL: { value: residualRangeSLRef.current },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = vec2(uv.x, 1.0 - uv.y); // flipY=false: 补偿平面几何UV(0,0)=底部
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uBaseTexture;   // FloatType，存储 [H, S, L, A]，范围 0~1
        uniform sampler2D uResidual;     // Uint8Type，存储量化残差值 [qH, qS, qL, 255]
        uniform float uResidualRangeH;
        uniform float uResidualRangeSL;
        varying vec2 vUv;

        vec3 hsl_to_rgb(vec3 hsl) {
          float h = hsl.x, s = hsl.y, l = hsl.z;
          vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
        }

        void main() {
          // ★ 直接读取 HSL 浮点纹理（不再需要 rgb_to_hsl 转换）
          vec4 baseHSLA = texture2D(uBaseTexture, vUv);
          vec4 residual = texture2D(uResidual, vUv);

          // 反量化残差（恢复 HSL 增量）
          // 编码公式：qH = round(((dH + range) / (2 * range)) * 255)
          // 解码公式：dH = (qH/255 * 2 - 1) * range = (residual.r * 2.0 - 1.0) * range
          float dH = (residual.r * 2.0 - 1.0) * uResidualRangeH;
          float dS = (residual.g * 2.0 - 1.0) * uResidualRangeSL;
          float dL = (residual.b * 2.0 - 1.0) * uResidualRangeSL;

          // ★ HSL 直接加法（色相需要 fract 包裹）
          float finalH = fract(baseHSLA.r + dH);
          float finalS = clamp(baseHSLA.g + dS, 0.0, 1.0);
          float finalL = clamp(baseHSLA.b + dL, 0.0, 1.0);

          // 只在最后一步转 RGB 用于显示
          vec3 finalRGB = hsl_to_rgb(vec3(finalH, finalS, finalL));
          gl_FragColor = vec4(finalRGB, baseHSLA.a);
        }
      `,
      transparent: true,
    });
    compositeQuad.material = compositeMat;
    compositeScene.add(compositeQuad);

    // 底图纹理更新函数（同步读取 Store，缓存避免每帧重建）
    const updateBaseTexture = () => {
      const state = useAppStore.getState();
      const layerId = state.activeLayerId;
      if (!layerId) { baseTexRef.current = null; baseLayerIdRef.current = null; return; }

      const frameData = state.frameDataMap[layerId];
      
      // ★ 优先使用 baseHslData（Float32 HSL，用于 GPU 合成）
      const baseHsl = frameData?.baseHslData;
      if (baseHsl) {
        // 只在图层切换或首次加载时重建纹理
        if (baseLayerIdRef.current === layerId && baseTexRef.current) return;

        // 释放旧纹理
        baseTexRef.current?.dispose();

        const tex = new THREE.DataTexture(
          baseHsl.data,
          baseHsl.width,
          baseHsl.height,
          THREE.RGBAFormat,
          THREE.FloatType,  // ★ 关键：32位浮点存储 HSL
        );
        tex.needsUpdate = true;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.flipY = false; // 统一坐标系：顶部=UV(0,0)
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.colorSpace = THREE.LinearSRGBColorSpace; // 不重要，因为存的不是 RGB 颜色

        baseTexRef.current = tex;
        baseLayerIdRef.current = layerId;
        console.log(`[FluidEditorUI.updateBaseTexture] 使用 FloatType HSL 纹理: ${baseHsl.width}x${baseHsl.height}`);
        return;
      }

      // 降级：使用 baseTexture（RGB ImageData，仅用于 UI 预览）
      const baseImageData = frameData?.baseTexture;
      if (!baseImageData) { baseTexRef.current = null; baseLayerIdRef.current = null; return; }

      if (baseLayerIdRef.current === layerId && baseTexRef.current) return;

      baseTexRef.current?.dispose();

      const tex = new THREE.DataTexture(
        new Uint8Array(baseImageData.data.buffer, baseImageData.data.byteOffset, baseImageData.data.byteLength),
        baseImageData.width,
        baseImageData.height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      tex.needsUpdate = true;
      tex.minFilter = THREE.LinearFilter;
      tex.flipY = false;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.colorSpace = THREE.LinearSRGBColorSpace;

      baseTexRef.current = tex;
      baseLayerIdRef.current = layerId;
      console.log(`[FluidEditorUI.updateBaseTexture] 使用 Uint8 RGB 纹理: ${baseImageData.width}x${baseImageData.height}`);
    };

    let frameCount = 0;
    const loop = () => {
      frameCount++;
      const { w, h } = config.resolution;

      // 同步 canvas 尺寸
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        renderer.setSize(w, h);
      }

      // 更新纹理引用
      colorMat.uniforms.uColor.value = editor.getColorTexture();
      velMat.uniforms.uVel.value = editor.getVelocityTexture();

      // 合成模式：更新底图纹理和残差范围
      if (viewMode === 'composite') {
        updateBaseTexture();
        compositeMat.uniforms.uBaseTexture.value = baseTexRef.current;
        compositeMat.uniforms.uResidual.value = editor.getColorTexture();
        compositeMat.uniforms.uResidualRangeH.value = residualRangeHRef.current;
        compositeMat.uniforms.uResidualRangeSL.value = residualRangeSLRef.current;
      }

      // 根据视图模式选择渲染场景
      let targetScene: THREE.Scene;
      if (viewMode === 'color') targetScene = colorScene;
      else if (viewMode === 'velocity') targetScene = velScene;
      else targetScene = compositeScene;
      renderer.render(targetScene, camera);

      // 检查 WebGL 错误
      const gl = renderer.getContext();
      const error = gl.getError();
      if (error !== 0) {
        console.error(`[FluidEditorUI] WebGL 错误: ${error} (0x${error.toString(16)})`);
      }

      displayRafRef.current = requestAnimationFrame(loop);
    };

    displayRafRef.current = requestAnimationFrame(loop);

    return () => {
      if (displayRafRef.current) {
        cancelAnimationFrame(displayRafRef.current);
      }
      colorMat.dispose();
      colorQuad.geometry.dispose();
      velMat.dispose();
      velQuad.geometry.dispose();
      compositeMat.dispose();
      compositeQuad.geometry.dispose();
      baseTexRef.current?.dispose();
      baseTexRef.current = null;
      baseLayerIdRef.current = null;
    };
  }, [rendererReady, editor, config.resolution, viewMode]);

  // ==================== 残差量化范围预调整 ====================
  /**
   * 根据 blockFlags 将残差纹理中 range=0.25 的像素值预调整为 range=0.5 兼容格式。
   * 
   * 基础色编辑器使用自适应量化：每个 8×8 块可能是 range=0.25 或 0.5。
   * 流体解算器统一使用 range=0.5 反量化公式：d = (val * 2 - 1) * 0.5
   * 
   * 对于 range=0.25 的块：原始反量化 d = (val * 2 - 1) * 0.25
   * 调整后：val' = val * 0.5，解算器反量化 d' = (val' * 2 - 1) * 0.5 = (val - 1) * 0.5
   * 两者在量化误差范围内等价，确保合成效果与基础色编辑器一致。
   * 
   * @param residualImageData 原始残差纹理（ImageData）
   * @param bbox 残差纹理的边界框
   * @param blockFlags 分块范围标志（bigint）
   * @returns 调整后的 ImageData（共享原始数据引用，直接修改）
   */
  const adjustResidualForUniformRange = (
    residualImageData: ImageData,
    bbox: { x: number; y: number; w: number; h: number },
    blockFlags: bigint,
  ): ImageData => {
    const { x: offsetX, y: offsetY, w, h } = bbox;
    const data = residualImageData.data;
    const texSize = residualImageData.width; // 全尺寸图像的宽度

    // 统计调整的像素数和块数
    let adjustedPixelCount = 0;
    const smallRangeBlocks = new Set<number>();

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        // 计算该像素所属的自适应分块索引（使用局部坐标，正确）
        const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
        // 判断该块的量化范围
        const range = getRangeForBlock(blockFlags, blockIdx);

        if (range === 0.25) {
          // 记录小范围块
          smallRangeBlocks.add(blockIdx);
          // ✅ 修正：使用全局坐标索引 ImageData（与 buildFluidTexturesFromRawFrame 一致）
          // 原始反量化: dH = (val * 2 - 1) * 0.25
          // 解算器反量化: dH' = (val' * 2 - 1) * 0.5
          // 令 dH = dH'，解得: val' = val * 0.5 + 0.25
          const globalX = offsetX + px;
          const globalY = offsetY + py;
          const idx = (globalY * texSize + globalX) * 4;
          data[idx] = Math.round(data[idx] * 0.5 + 64);       // R (H): 255*0.25=64
          data[idx + 1] = Math.round(data[idx + 1] * 0.5 + 64); // G (S)
          data[idx + 2] = Math.round(data[idx + 2] * 0.5 + 64); // B (L)
          // Alpha 不变
          adjustedPixelCount++;
        }
      }
    }

    console.log(`[FTX导入] 残差调整: bbox=${w}x${h}, blockFlags=${blockFlags.toString(2).padStart(64, '0')}`);
    console.log(`[FTX导入] 残差调整: 小范围块数=${smallRangeBlocks.size}, 调整像素数=${adjustedPixelCount}`);
    
    return residualImageData;
  };

  // ==================== 独立解析 FTX 帧数据 ====================
  /** 
   * 从原始 FTX 数据独立生成流体编辑器所需的基础色和残差纹理。
   * 
   * ★ 关键改动：
   *   - baseHslData: Float32Array [H, S, L, A]，直接存储浮点 HSL（用于 GPU 合成）
   *   - baseTexture: ImageData RGB（仅用于 UI 预览）
   *   - residualTexture: ImageData 存储量化值（R=qH, G=qS, B=qL）
   */
  const buildFluidTexturesFromRawFrame = (
    rawData: {
      rawRegionIdTex: Uint8Array;
      rawDeltaPacked: Uint16Array | null;
      rawBbox: { x: number; y: number; w: number; h: number };
      rawBlockFlags: bigint;
      sourceResolution: number;
    },
    palette: { h: number; s: number; l: number; id: number }[],
  ): { baseHslData: { data: Float32Array; width: number; height: number }; baseTexture: ImageData; residualTexture: ImageData } => {
    const { rawRegionIdTex, rawDeltaPacked, rawBbox, sourceResolution } = rawData;
    const bbox = rawBbox;
    const texSize = sourceResolution;
    const totalPixels = bbox.w * bbox.h;

    // 1. 基础色 HSL 浮点数据（用于 GPU 合成，直接存储 H/S/L）
    const hslFloat = new Float32Array(texSize * texSize * 4);
    hslFloat.fill(0);

    // 2. 基础色 RGB 图像（仅用于 UI 预览）
    const baseImageData = new ImageData(texSize, texSize);
    const baseData = baseImageData.data;

    // 3. 残差纹理（量化值）
    const resImageData = new ImageData(texSize, texSize);
    const resData = resImageData.data;

    if (totalPixels === 0 || !rawDeltaPacked || rawDeltaPacked.length === 0) {
      return { 
        baseHslData: { data: hslFloat, width: texSize, height: texSize },
        baseTexture: baseImageData, 
        residualTexture: resImageData 
      };
    }

    // 构建调色板映射
    const colorMap = new Map<number, { h: number; s: number; l: number }>();
    for (const c of palette) {
      colorMap.set(c.id, { h: c.h, s: c.s, l: c.l });
    }

    for (let i = 0; i < totalPixels; i++) {
      const colorId = rawRegionIdTex[i] || 0;
      if (colorId === 0) continue;
      const baseColor = colorMap.get(colorId);
      if (!baseColor) continue;

      const px = i % bbox.w;
      const py = Math.floor(i / bbox.w);
      const packed = rawDeltaPacked[i];
      const { s: qS, h: qH, l: qL } = unpackRGB565(packed);

      const globalX = bbox.x + px;
      const globalY = bbox.y + py;
      const idx = (globalY * texSize + globalX) * 4;

      // ★ baseHslData: 直接存储浮点 HSL，不转 RGB（GPU 合成用）
      hslFloat[idx]     = baseColor.h;
      hslFloat[idx + 1] = baseColor.s;
      hslFloat[idx + 2] = baseColor.l;
      hslFloat[idx + 3] = 1.0;  // Alpha

      // baseTexture: HSL→RGB（仅用于 UI 预览）
      const baseRgb = hslToRgb(baseColor.h, baseColor.s, baseColor.l);
      baseData[idx] = baseRgb.r;
      baseData[idx + 1] = baseRgb.g;
      baseData[idx + 2] = baseRgb.b;
      baseData[idx + 3] = 255;

      // ★ residualTexture: 存储原始量化残差值
      // R = qH/63 * 255, G = qS/31 * 255, B = qL/31 * 255
      resData[idx] = Math.round((qH / 63) * 255);
      resData[idx + 1] = Math.round((qS / 31) * 255);
      resData[idx + 2] = Math.round((qL / 31) * 255);
      resData[idx + 3] = 255;
    }

    return { 
      baseHslData: { data: hslFloat, width: texSize, height: texSize },
      baseTexture: baseImageData, 
      residualTexture: resImageData 
    };
  };

  // ==================== FTX 帧数据 → 流体编辑器加载 ====================
  /** 从原始 FTX 数据独立生成纹理并加载到流体编辑器 */
  const loadFrameResidual = () => {
    if (!editor) return;

    const state = useAppStore.getState();
    const layerId = state.activeLayerId;
    if (!layerId) {
      alert('没有活动图层，请先在主画布导入 FTX 帧数据');
      return;
    }

    const frameData = state.frameDataMap[layerId];
    if (!frameData?.rawRegionIdTex || !frameData?.rawDeltaPacked || !frameData?.rawBbox) {
      alert(`图层 "${layerId}" 没有完整的 FTX 原始数据`);
      return;
    }

    // ★★★ 关键修复：同步流体分辨率与帧数据尺寸 ★★★
    // 基础色纹理尺寸 = 帧数据原始尺寸（通常512），流体编辑器默认256，尺寸不匹配会导致UV采样错位
    const texSize = frameData.sourceResolution || 512;
    console.log(`[FTX导入] 同步分辨率: 帧数据=${texSize}x${texSize}, 当前流体=${config.resolution.w}x${config.resolution.h}`);
    if (config.resolution.w !== texSize || config.resolution.h !== texSize) {
      updateConfig({ resolution: { w: texSize, h: texSize } });
      console.log(`[FTX导入] 已更新分辨率为 ${texSize}x${texSize}`);
    }

    console.log(`\n========== [FTX导入] 独立解析帧数据 ==========`);
    console.log(`[FTX导入] 活动图层: ${layerId}`);
    console.log(`[FTX导入] 原始数据: bbox=(${frameData.rawBbox.x},${frameData.rawBbox.y},${frameData.rawBbox.w}x${frameData.rawBbox.h}), texSize=${frameData.sourceResolution}`);
    console.log(`[FTX导入] regionIdTex大小=${frameData.rawRegionIdTex.length}, deltaPacked大小=${frameData.rawDeltaPacked.length}`);

    // ★ 读取共享调色板
    const palette = state.skillGroupEditor.sharedBaseColors;
    console.log(`[FTX导入] 调色板色块数: ${palette.length}`);

    // ★ 独立生成正确的纹理（残差 = 量化值，而非合成RGB）
    const { baseHslData, baseTexture: newBase, residualTexture: newResidual } = buildFluidTexturesFromRawFrame(
      {
        rawRegionIdTex: frameData.rawRegionIdTex,
        rawDeltaPacked: frameData.rawDeltaPacked,
        rawBbox: frameData.rawBbox,
        rawBlockFlags: frameData.rawBlockFlags,
        sourceResolution: frameData.sourceResolution,
      },
      palette,
    );

    // 基础色 HSL 统计
    console.log(`[FTX导入] 基础色 HSL 数据: ${baseHslData.width}x${baseHslData.height}, 数据长度=${baseHslData.data.length}`);
    console.log(`[FTX导入] 基础色前10个 HSL 值: ${Array.from(baseHslData.data.slice(0, 30)).join(',')}`);

    // 残差统计
    const rd = newResidual.data;
    let resNonZero = 0;
    for (let i = 0; i < rd.length; i += 4) {
      if (rd[i] !== 0 || rd[i+1] !== 0 || rd[i+2] !== 0) resNonZero++;
    }
    console.log(`[FTX导入] 生成的残差纹理: ${newResidual.width}x${newResidual.height}, 非零像素=${resNonZero}/${newResidual.width*newResidual.height}`);
    console.log(`[FTX导入] 残差前10像素 RGB: ${Array.from(rd.slice(0, 30)).join(',')}`);

    // ===== stash 原始数据，供像素比较器使用 =====
    stashedResidualRef.current = new ImageData(
      new Uint8ClampedArray(newResidual.data),
      newResidual.width,
      newResidual.height,
    );
    stashedResidualWRef.current = newResidual.width;
    stashedResidualHRef.current = newResidual.height;

    // ★ stash 浮点 HSL 数据（用于精确比较）
    stashedBaseHslRef.current = new Float32Array(baseHslData.data);

    stashedBaseRef.current = new ImageData(
      new Uint8ClampedArray(newBase.data),
      newBase.width,
      newBase.height,
    );
    stashedBaseWRef.current = newBase.width;
    stashedBaseHRef.current = newBase.height;
    console.log(`[FTX导入] stash 完成: base=${newBase.width}x${newBase.height}, residual=${newResidual.width}x${newResidual.height}, baseHsl=${baseHslData.data.length} floats`);

    // ===== 导入前状态日志 =====
    const solverRes = config.resolution;
    console.log(`[FTX导入] 求解器分辨率: ${solverRes.w}x${solverRes.h}`);
    console.log(`[FTX导入] 尺寸匹配: ${newResidual.width === solverRes.w && newResidual.height === solverRes.h}`);
    console.log(`[FTX导入] 导入前配置: advection=${config.enableAdvection}, pressure=${config.enablePressure}, gravity=${config.gravity}, colorBoundary=${config.colorBoundaryMode}, injection=${config.injection.enabled}`);

    // ===== 步骤 1：更新 frameDataMap（合成视图依赖） =====
    // ★ 关键修复：必须同时更新 baseHslData（GPU合成用）和 baseTexture（UI预览用）
    console.log(`[FTX导入] 步骤1: 更新 frameDataMap.baseHslData + baseTexture...`);
    useAppStore.setState({
      frameDataMap: {
        ...useAppStore.getState().frameDataMap,
        [layerId]: {
          ...frameData,
          baseHslData,           // ★ GPU合成用：Float32 HSL
          baseTexture: newBase,  // UI预览用：RGB ImageData
        },
      },
    });

    // ===== 步骤 2：强制重置所有物理场 =====
    console.log(`[FTX导入] 步骤2: initFields() 重置物理场...`);
    editor.initFields();

    // ===== 步骤 3：残差模式配置 + 临时关闭平流 =====
    console.log(`[FTX导入] 步骤3: 配置残差模式 (关闭注入/重力/平流, 边界=clamp)...`);
    updateConfig({
      injection: { ...config.injection, enabled: false },
      gravity: 0,
      enableAdvection: false,
      colorBoundaryMode: 'clamp',
    });

    // ===== 步骤 4：根据 blockFlags 预调整残差量化值 =====
    console.log(`[FTX导入] 步骤4: 根据 blockFlags 预调整残差量化值...`);
    const adjustedResidual = adjustResidualForUniformRange(
      newResidual,
      frameData.rawBbox,
      frameData.rawBlockFlags,
    );
    console.log(`[FTX导入] 残差调整完成`);

    // ===== 步骤 5：上传残差 =====
    console.log(`[FTX导入] 步骤5: initializeColorFromImageData() 上传残差...`);
    editor.initializeColorFromImageData(adjustedResidual);

    // ===== 步骤 6：延迟恢复平流（先让合成视图渲染一帧正确结果） =====
    setTimeout(() => {
      console.log(`[FTX导入] 延迟恢复平流...`);
      updateConfig({ enableAdvection: true });
    }, 100);

    // ===== 步骤 7：切到颜色视图 =====
    console.log(`[FTX导入] 步骤7: 切换到颜色视图`);
    setView('color');
    console.log(`========== [FTX导入] 加载完成 ==========\n`);
  };

  // ==================== 渲染 ====================
  return (
    <div className="fluid-editor-ui">
      {/* 左侧面板 */}
      <div className="fluid-sidebar">
        {/* 操作模块（置顶） */}
        <OperationsPanel
          onInjectWater={injectWater}
          onInjectColor={injectColorOnly}
        />

        {/* FTX 帧数据加载 */}
        <div className="fluid-panel">
          <div className="panel-header">
            <span>📥 FTX 帧导入</span>
          </div>
          <div className="panel-body">
            <button
              onClick={loadFrameResidual}
              style={{
                width: '100%', padding: '8px',
                background: '#52c41a', color: '#fff', border: 'none',
                borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
              }}
            >
              🔄 加载当前帧残差
            </button>
            <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
              从主画布当前活动图层加载残差纹理，切换到「合成」视图查看效果
            </div>
          </div>
        </div>

        {/* 通用设置 */}
        <GeneralPanel
          config={config}
          viewMode={viewMode}
          onConfigChange={updateConfig}
          onViewChange={setView}
          onReset={reset}
          onExport={() => {
            if (!editor) return;
            const json = editor.exportState();
            // 下载文件
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fluid-state-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
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
          boundaryMode={config.pressureBoundaryMode}
          warmStart={config.enableWarmStart}
          onToggle={() => updateConfig({ enablePressure: !config.enablePressure })}
          onIterationsChange={(val) => { setPressureParams(p => ({ ...p, iterations: val })); updateConfig({ pressureIterations: val }); }}
          onRelaxationChange={(val) => { setPressureParams(p => ({ ...p, overRelaxation: val })); updateConfig({ pressureOmega: val }); }}
          onBoundaryModeChange={(mode) => updateConfig({ pressureBoundaryMode: mode })}
          onWarmStartChange={(enabled) => updateConfig({ enableWarmStart: enabled })}
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
        <canvas
          ref={displayCanvasRef}
          onClick={(e) => {
            if (!editor) return;
            const canvas = displayCanvasRef.current;
            if (!canvas) return;

            // 计算 canvas 在屏幕上的边界
            const rect = canvas.getBoundingClientRect();
            // 鼠标相对 canvas 左上角的偏移（CSS 像素）
            const cssX = e.clientX - rect.left;
            const cssY = e.clientY - rect.top;

            // canvas 显示尺寸（CSS）与像素尺寸的缩放
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            // 转换为 canvas 像素坐标（左上为原点，Y 向下）
            const pixX = cssX * scaleX;
            const pixY = cssY * scaleY;

            // flipY=false: UV(0,0)=顶部=左上, 与 canvas 坐标一致，无需翻转
            const texX = pixX;
            const texY = pixY;

            // 1. 采样模拟器颜色场（残差）
            const simSample = editor.samplePixel(texX, texY);
            const simResidual = { h: simSample.residualH, s: simSample.residualS, l: simSample.residualL };
            const velMag = Math.sqrt(simSample.velX * simSample.velX + simSample.velY * simSample.velY);

            // 2. 从 stash 的原始帧数据读取（loadFrameResidual 时深拷贝存储）
            const origBaseImg = stashedBaseRef.current;
            const origBaseHsl = stashedBaseHslRef.current; // ★ 浮点 HSL 数据
            const origResImg = stashedResidualRef.current;
            const solverW = config.resolution.w;
            const solverH = config.resolution.h;

            let origResidual = { h: 0, s: 0, l: 0 };
            let baseColor: { h: number; s: number; l: number } | null = null;
            let origComposite = { h: 0, s: 0, l: 0 };
            let simComposite = { h: 0, s: 0, l: 0 };

            // 原始残差纹理（从 stash 读取，尺寸可能与解算器不同）
            if (origResImg) {
              const resW = stashedResidualWRef.current;
              const resH = stashedResidualHRef.current;
              // 坐标映射：(texX,texY) 在解算器空间 → 原始纹理空间
              const resX = Math.floor(Math.min(Math.max(texX / solverW * resW, 0), resW - 1));
              const resY = Math.floor(Math.min(Math.max(texY / solverH * resH, 0), resH - 1));
              const idx = (resY * resW + resX) * 4;
              origResidual = {
                h: origResImg.data[idx] / 255,
                s: origResImg.data[idx + 1] / 255,
                l: origResImg.data[idx + 2] / 255,
              };
            }

            // ★ 原始基础色（优先使用浮点 HSL 数据，避免 RGB 转换损失）
            if (origBaseHsl) {
              const baseW = stashedBaseWRef.current;
              const baseH = stashedBaseHRef.current;
              const baseX = Math.floor(Math.min(Math.max(texX / solverW * baseW, 0), baseW - 1));
              const baseY = Math.floor(Math.min(Math.max(texY / solverH * baseH, 0), baseH - 1));
              const idx = (baseY * baseW + baseX) * 4;
              baseColor = {
                h: origBaseHsl[idx],
                s: origBaseHsl[idx + 1],
                l: origBaseHsl[idx + 2],
              };
            } else if (origBaseImg) {
              // 降级：使用 RGB ImageData（会有转换损失）
              const baseW = stashedBaseWRef.current;
              const baseH = stashedBaseHRef.current;
              const baseX = Math.floor(Math.min(Math.max(texX / solverW * baseW, 0), baseW - 1));
              const baseY = Math.floor(Math.min(Math.max(texY / solverH * baseH, 0), baseH - 1));
              const idx = (baseY * baseW + baseX) * 4;
              const br = origBaseImg.data[idx] / 255;
              const bg = origBaseImg.data[idx + 1] / 255;
              const bb = origBaseImg.data[idx + 2] / 255;
              baseColor = rgbToHsl(br, bg, bb);
            }

            // 如果有基础色，计算合成值
            if (baseColor) {
              // 层级2：模拟器残差 + 基础色
              simComposite = computeCompositeHsl(
                baseColor,
                { r: simResidual.h, g: simResidual.s, b: simResidual.l },
                residualRangeHRef.current,
                residualRangeSLRef.current,
              );
              // 层级2：原始残差 + 基础色（原始残差是未调整的，需同样应用 blockFlags 调整）
              origComposite = computeCompositeHsl(
                baseColor,
                { r: origResidual.h, g: origResidual.s, b: origResidual.l },
                residualRangeHRef.current,
                residualRangeSLRef.current,
              );
            }

            // 计算差值
            const deltaResidual = {
              h: simResidual.h - origResidual.h,
              s: simResidual.s - origResidual.s,
              l: simResidual.l - origResidual.l,
            };
            const deltaComposite = {
              h: simComposite.h - origComposite.h,
              s: simComposite.s - origComposite.s,
              l: simComposite.l - origComposite.l,
            };

            setSampleInfo({
              px: Math.floor(texX),
              py: Math.floor(texY),
              simResidual,
              origResidual,
              deltaResidual,
              simComposite,
              origComposite,
              deltaComposite,
              baseColor,
              velX: simSample.velX,
              velY: simSample.velY,
              velMag,
            });

          }}
          style={{ cursor: 'crosshair' }}
        />
        <div className="viewport-info">
          <span>{config.resolution.w}×{config.resolution.h}</span>
          <span>{viewMode === 'color' ? '颜色场' : '速度场'}</span>
          <span>{config.enableAdvection ? '平流: ON' : '平流: OFF'}</span>
        </div>

        {/* 采样信息浮窗（双层级比较器） */}
        {sampleInfo && (
          <div className="sample-info">
            <div className="sample-header">
              <span>🔬 像素比较器</span>
              <button
                onClick={() => setSampleInfo(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '14px',
                  padding: '0 4px',
                }}
              >
                ×
              </button>
            </div>
            <div className="sample-row">
              <span className="sample-label">坐标</span>
              <span className="sample-value">({sampleInfo.px}, {sampleInfo.py})</span>
            </div>
            <div className="sample-row">
              <span className="sample-label">数据源</span>
              <span className="sample-value" style={{ fontSize: '10px' }}>
                残差: {stashedResidualRef.current ? `${stashedResidualWRef.current}x${stashedResidualHRef.current}` : '❌ 未加载'} | 
                基础色: {stashedBaseRef.current ? `${stashedBaseWRef.current}x${stashedBaseHRef.current}` : '❌ 未加载'}
              </span>
            </div>

            {/* 基础色（参考） */}
            {sampleInfo.baseColor && (
              <div style={{ marginTop: '4px', padding: '4px 6px', background: '#f0f0f0', borderRadius: '4px' }}>
                <div style={{ fontSize: '10px', color: '#666' }}>基础色 (参考)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '4px', border: '1px solid #ddd',
                    backgroundColor: `hsl(${sampleInfo.baseColor.h * 360}, ${sampleInfo.baseColor.s * 100}%, ${sampleInfo.baseColor.l * 100}%)`
                  }} />
                  <span style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                    H: {sampleInfo.baseColor.h.toFixed(3)} S: {sampleInfo.baseColor.s.toFixed(3)} L: {sampleInfo.baseColor.l.toFixed(3)}
                  </span>
                </div>
              </div>
            )}

            {/* 层级1：残差保真度 */}
            <div style={{ marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
              <div style={{ fontWeight: 'bold', fontSize: '11px', color: '#1976d2', marginBottom: '4px' }}>
                📊 层级1：残差保真度（颜色视口 vs 原始残差）
              </div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '4px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: '#666' }}>模拟器残差</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #ddd',
                      backgroundColor: `hsl(${sampleInfo.simResidual.h * 360}, ${sampleInfo.simResidual.s * 100}%, ${sampleInfo.simResidual.l * 100}%)`
                    }} />
                    <span style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                      H:{sampleInfo.simResidual.h.toFixed(3)} S:{sampleInfo.simResidual.s.toFixed(3)} L:{sampleInfo.simResidual.l.toFixed(3)}
                    </span>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: '#666' }}>原始残差</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #ddd',
                      backgroundColor: `hsl(${sampleInfo.origResidual.h * 360}, ${sampleInfo.origResidual.s * 100}%, ${sampleInfo.origResidual.l * 100}%)`
                    }} />
                    <span style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                      H:{sampleInfo.origResidual.h.toFixed(3)} S:{sampleInfo.origResidual.s.toFixed(3)} L:{sampleInfo.origResidual.l.toFixed(3)}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '10px', color: '#333', background: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>
                ΔH: <span style={{ color: Math.abs(sampleInfo.deltaResidual.h) > 0.01 ? '#d32f2f' : '#388e3c' }}>{sampleInfo.deltaResidual.h.toFixed(4)}</span>
                ΔS: <span style={{ color: Math.abs(sampleInfo.deltaResidual.s) > 0.01 ? '#d32f2f' : '#388e3c' }}>{sampleInfo.deltaResidual.s.toFixed(4)}</span>
                ΔL: <span style={{ color: Math.abs(sampleInfo.deltaResidual.l) > 0.01 ? '#d32f2f' : '#388e3c' }}>{sampleInfo.deltaResidual.l.toFixed(4)}</span>
              </div>
            </div>

            {/* 层级2：合成正确性 */}
            <div style={{ marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
              <div style={{ fontWeight: 'bold', fontSize: '11px', color: '#388e3c', marginBottom: '4px' }}>
                📊 层级2：合成正确性（模拟器合成 vs 理论合成）
              </div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '4px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: '#666' }}>模拟器合成</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #ddd',
                      backgroundColor: `hsl(${sampleInfo.simComposite.h * 360}, ${sampleInfo.simComposite.s * 100}%, ${sampleInfo.simComposite.l * 100}%)`
                    }} />
                    <span style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                      H:{sampleInfo.simComposite.h.toFixed(3)} S:{sampleInfo.simComposite.s.toFixed(3)} L:{sampleInfo.simComposite.l.toFixed(3)}
                    </span>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: '#666' }}>理论合成</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #ddd',
                      backgroundColor: `hsl(${sampleInfo.origComposite.h * 360}, ${sampleInfo.origComposite.s * 100}%, ${sampleInfo.origComposite.l * 100}%)`
                    }} />
                    <span style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                      H:{sampleInfo.origComposite.h.toFixed(3)} S:{sampleInfo.origComposite.s.toFixed(3)} L:{sampleInfo.origComposite.l.toFixed(3)}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '10px', color: '#333', background: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>
                ΔH: <span style={{ color: Math.abs(sampleInfo.deltaComposite.h) > 0.01 ? '#d32f2f' : '#388e3c' }}>{sampleInfo.deltaComposite.h.toFixed(4)}</span>
                ΔS: <span style={{ color: Math.abs(sampleInfo.deltaComposite.s) > 0.01 ? '#d32f2f' : '#388e3c' }}>{sampleInfo.deltaComposite.s.toFixed(4)}</span>
                ΔL: <span style={{ color: Math.abs(sampleInfo.deltaComposite.l) > 0.01 ? '#d32f2f' : '#388e3c' }}>{sampleInfo.deltaComposite.l.toFixed(4)}</span>
              </div>
            </div>

            {/* 速度信息 */}
            <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #eee', fontSize: '10px', color: '#666' }}>
              速度: ({sampleInfo.velX.toFixed(2)}, {sampleInfo.velY.toFixed(2)}) | 速率: {sampleInfo.velMag.toFixed(2)} px/s
            </div>
          </div>
        )}
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

        /* 采样信息浮窗 */
        .sample-info {
          position: absolute;
          top: 12px;
          right: 12px;
          background: rgba(255,255,255,0.95);
          border: 1px solid #ccc;
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 11px;
          color: #333;
          min-width: 200px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          backdrop-filter: blur(4px);
          z-index: 10;
        }

        .sample-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 600;
          font-size: 12px;
          color: #1976d2;
          margin-bottom: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid #eee;
        }

        .sample-section {
          font-weight: 600;
          font-size: 11px;
          color: #888;
          margin-top: 8px;
          margin-bottom: 4px;
          padding-bottom: 2px;
          border-bottom: 1px dashed #eee;
        }

        .sample-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 2px 0;
        }

        .sample-label {
          color: #666;
          min-width: 70px;
        }

        .sample-value {
          color: #333;
          font-family: 'Consolas', 'Monaco', monospace;
          font-weight: 500;
          text-align: right;
        }
      `}</style>
    </div>
  );
};
