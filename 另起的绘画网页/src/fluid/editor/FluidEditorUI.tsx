import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useFluidEditor } from './useFluidEditor';
import type { ViewMode, FluidEditorConfig } from './FluidEditor';
import { useAppStore } from '../../stores/useAppStore';
import { getAdaptiveBlockIndex, getRangeForBlock, unpackRGB565, uint8ToBase64 } from '../../core/ftxCore';
import { hslToRgb } from '../../utils/colorCompressor';

// ============================================================
// 子组件：操作面板（鼠标点击注入模式）
// ============================================================
type InjectMode = 'water' | 'color' | 'velocity' | 'stamp';

// 持续注入源快照类型
type WaveConfig = {
  enabled: boolean;
  amplitude: number;   // 弧度
  frequency: number;   // Hz
  phase?: number;      // 弧度
};

type WaypointMode = 'forward' | 'backward' | 'pingpong';

type ContinuousSourceSnapshot = {
  id: number;
  position: { x: number; y: number };
  radius: number;
  velocity: { x: number; y: number };
  color: [number, number, number, number];
  rate: number;
  enabled: boolean;
  density?: number;   // ★ 标量模式核心参数：浓度值
  wave?: WaveConfig;
  waypoints?: { x: number; y: number }[];
  waypointMode?: WaypointMode;
  waypointSpeed?: number;
};

// ★ 爆发倍率：单次注入（非持续模式）瞬间放大速度，冲破重力束缚
const BOOST_MULTIPLIER = 5;

const OperationsPanel: React.FC<{
  config: FluidEditorConfig;
  onConfigChange: (updates: Partial<FluidEditorConfig>) => void;
  injectMode: InjectMode;
  setInjectMode: (mode: InjectMode) => void;
  injectRadius: number;
  setInjectRadius: (r: number) => void;
  injectStrength: number;
  setInjectStrength: (s: number) => void;
  continuousMode: boolean;
  setContinuousMode: (v: boolean) => void;
  // ★ 方向（归一化矢量，仅显示）+ 速度大小（标量）
  //   方向设定改为画布摇杆交互，面板只读显示当前方向
  directionX: number;
  directionY: number;
  speedMagnitude: number;
  setSpeedMagnitude: (v: number) => void;
  // ★ 收藏方向列表（保存/复用方向）
  savedDirections: Array<{ x: number; y: number; label: string }>;
  onSaveDirection: () => void;
  onApplyDirection: (dir: { x: number; y: number }) => void;
  // ★ 多源列表管理
  sources: ContinuousSourceSnapshot[];
  onRemoveSource: (id: number) => void;
  onClearAllSources: () => void;
  // ★ 点击列表项时高亮画布上对应的源
  onHighlightSource: (id: number) => void;
  // ★ 更新源的波形参数
  onUpdateSourceWave: (id: number, wave: WaveConfig) => void;
  // ★ 路径点控制
  recordingWaypointSourceId: number | null;
  onStartWaypointRecording: (id: number) => void;
  onStopWaypointRecording: () => void;
  onClearWaypoints: (id: number) => void;
  onUpdateWaypointMode: (id: number, mode: WaypointMode) => void;
  onUpdateWaypointSpeed: (id: number, speed: number) => void;
  // ★ 手动暂停/恢复持续注入（不影响源队列，也不受持续模式开关影响）
  continuousPaused: boolean;
  onTogglePaused: () => void;
}> = ({
  config,
  onConfigChange,
  injectMode,
  setInjectMode,
  injectRadius,
  setInjectRadius,
  injectStrength,
  setInjectStrength,
  continuousMode,
  setContinuousMode,
  directionX,
  directionY,
  speedMagnitude,
  setSpeedMagnitude,
  savedDirections,
  onSaveDirection,
  onApplyDirection,
  sources,
  onRemoveSource,
  onClearAllSources,
  onHighlightSource,
  onUpdateSourceWave,
  recordingWaypointSourceId,
  onStartWaypointRecording,
  onStopWaypointRecording,
  onClearWaypoints,
  onUpdateWaypointMode,
  onUpdateWaypointSpeed,
  continuousPaused,
  onTogglePaused,
}) => {
  const modes: { key: InjectMode; label: string; desc: string }[] = [
    { key: 'water', label: '💧 水', desc: '蓝色颜料 + 方向速度' },
    { key: 'color', label: '🎨 颜料', desc: '红色颜料（无速度）' },
    { key: 'velocity', label: '💨 速度', desc: '仅方向速度（无色）' },
    { key: 'stamp', label: '📎 残差印章', desc: '从FTX残差纹理采样噪点块注入' },
  ];

  const currentMode = modes.find((m) => m.key === injectMode)!;

  // ★ 源列表展开状态：记录当前展开的源 ID（null = 全部折叠）
  const [expandedSourceId, setExpandedSourceId] = useState<number | null>(null);

  // ★ 全局力（原重力）摇杆：方向 + 大小，替换旧的标量重力输入
  const joystickCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localDir, setLocalDir] = useState({ x: 0, y: 1 }); // 归一化方向，默认向下
  const [gravityMag, setGravityMag] = useState(5); // 标量大小 (px/s²)

  // 从 config 同步初始值（外部更新 config.gravity 时回填）
  useEffect(() => {
    const g = config.gravity || { x: 0, y: 5 };
    const mag = Math.sqrt(g.x * g.x + g.y * g.y);
    if (mag > 0.001) {
      setLocalDir({ x: g.x / mag, y: g.y / mag });
      setGravityMag(mag);
    } else {
      setLocalDir({ x: 0, y: 1 });
      setGravityMag(0);
    }
  }, [config.gravity]);

  // 摇杆绘制
  useEffect(() => {
    const canvas = joystickCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = (dirX: number, dirY: number) => {
      const w = canvas.width, h = canvas.height;
      const cx = w / 2, cy = h / 2;
      const radius = Math.min(w, h) / 2 - 6;
      ctx.clearRect(0, 0, w, h);

      // 外圈
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = '#aaa';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 十字参考线
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1;
      ctx.stroke();

      // ★ 摇杆=纯方向指示：手柄固定在外圈边缘，与力的大小完全无关
      const handleX = cx + dirX * radius;
      const handleY = cy + dirY * radius;

      // 连线（中心 → 手柄）
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(handleX, handleY);
      ctx.strokeStyle = '#f44336';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 手柄圆点
      ctx.beginPath();
      ctx.arc(handleX, handleY, 8, 0, 2 * Math.PI);
      ctx.fillStyle = '#f44336';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 手柄中心小点
      ctx.beginPath();
      ctx.arc(handleX, handleY, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#fff';
      ctx.fill();
    };

    draw(localDir.x, localDir.y);
  }, [localDir]);

  // 摇杆交互：拖拽设定方向 + 实时更新 config.gravity
  const updateJoystick = useCallback((clientX: number, clientY: number) => {
    const canvas = joystickCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const rawX = (clientX - rect.left) * scaleX - cx;
    const rawY = (clientY - rect.top) * scaleY - cy;
    const dist = Math.sqrt(rawX * rawX + rawY * rawY);
    // ★ 死区：仅当指针离开中心足够远才更新方向，否则保持当前方向（不归零）
    if (dist > 2) {
      // ★ 方向始终归一化为单位向量（模长=1），强度完全由滑块控制，不受拖动距离影响
      const normX = rawX / dist;
      const normY = rawY / dist;
      setLocalDir({ x: normX, y: normY });
      // 实时更新 config（保留当前大小）
      onConfigChange({
        gravity: { x: normX * gravityMag, y: normY * gravityMag },
      });
    }
  }, [gravityMag, onConfigChange]);

  const handleJoystickDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    updateJoystick(e.clientX, e.clientY);
  };
  const handleJoystickMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) updateJoystick(e.clientX, e.clientY);
  };
  const handleJoystickUp = () => setIsDragging(false);
  const handleJoystickLeave = () => setIsDragging(false);

  // ★ 计算实际速度矢量（方向 × 大小）和可视化参数
  const velX = directionX * speedMagnitude;
  const velY = directionY * speedMagnitude;
  const velMag = Math.sqrt(velX * velX + velY * velY);
  const velAngleDeg = velMag > 0 ? (Math.atan2(velY, velX) * 180) / Math.PI : 0;
  const arrowLen = Math.min(velMag / 1000, 1); // 归一化箭头长度 (0~1, 适配最大3000px/s)

  return (
    <div className="fluid-panel">
      <div className="panel-header">
        <span>🖱️ 鼠标注入</span>
      </div>
      <div className="panel-body">
        {/* 模式选择 */}
        <div className="control-group" style={{ marginBottom: '8px' }}>
          <label>注入模式</label>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {modes.map((mode) => (
              <button
                key={mode.key}
                onClick={() => setInjectMode(mode.key)}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  fontSize: '11px',
                  border: injectMode === mode.key ? '2px solid #29b6f6' : '1px solid #ddd',
                  background: injectMode === mode.key ? '#e3f2fd' : '#fff',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: injectMode === mode.key ? '#1565c0' : '#333',
                  fontWeight: injectMode === mode.key ? 'bold' : 'normal',
                }}
                title={mode.desc}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
            {currentMode.desc}
          </div>
        </div>

        {/* 持续注入开关 */}
        <div className="control-group" style={{ marginBottom: '12px' }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <label style={{ margin: 0 }}>⚡ 持续注入</label>
            <input
              type="checkbox"
              checked={continuousMode}
              onChange={(e) => setContinuousMode(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
          </div>
          {continuousMode && (
            <div
              style={{
                fontSize: '10px',
                color: '#1976d2',
                marginTop: '4px',
                padding: '4px 6px',
                background: '#e3f2fd',
                borderRadius: '4px',
                border: '1px solid #90caf9',
              }}
            >
              💡 开启后，按下画布出现摇杆，拖动定方向并新增源
            </div>
          )}
        </div>

        {/* 半径滑块 */}
        <div className="control-group" style={{ marginBottom: '12px' }}>
          <label>半径: {injectRadius.toFixed(3)}</label>
          <input
            type="range"
            min="0.01"
            max="0.3"
            step="0.005"
            value={injectRadius}
            onChange={(e) => setInjectRadius(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {/* 强度滑块 */}
        <div className="control-group" style={{ marginBottom: '12px' }}>
          <label>强度: {injectStrength.toFixed(1)}x</label>
          <input
            type="range"
            min="0.1"
            max="3.0"
            step="0.1"
            value={injectStrength}
            onChange={(e) => setInjectStrength(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {/* 速度控制：方向（归一化矢量）+ 速度大小（标量） */}
        <div className="control-group" style={{ marginBottom: '12px', padding: '8px', background: '#fafafa', borderRadius: '6px', border: '1px solid #e0e0e0' }}>
          <label style={{ marginBottom: '6px' }}>初速度</label>

          {/* ★ 方向：点击画布拖动摇杆设定 + 当前方向显示 + 收藏列表 */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px' }}>
              方向（🎮 点击画布拖动摇杆设定）
            </div>

            {/* 当前方向可视化罗盘 + 矢量/角度 */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '6px', background: '#fff', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
              <div style={{ width: '44px', height: '44px', position: 'relative', borderRadius: '50%', background: 'radial-gradient(circle, #fff8e1 0%, #ffe0b2 100%)', border: '2px solid #ff9800', flexShrink: 0 }}>
                {velMag > 0 ? (
                  <svg width="44" height="44" style={{ position: 'absolute', left: 0, top: 0, transform: `rotate(${-(velAngleDeg)}deg)` }}>
                    <line x1="22" y1="22" x2="40" y2="22" stroke="#e65100" strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="40,22 35,19 35,25" fill="#e65100" />
                  </svg>
                ) : (
                  <div style={{ position: 'absolute', left: '50%', top: '50%', width: '6px', height: '6px', marginLeft: '-3px', marginTop: '-3px', background: '#9e9e9e', borderRadius: '50%' }} />
                )}
              </div>
              <div style={{ flex: 1, fontSize: '10px', color: '#666' }}>
                <div>矢量: ({directionX.toFixed(2)}, {directionY.toFixed(2)})</div>
                <div>角度: {velMag > 0 ? `${(((velAngleDeg % 360) + 360) % 360).toFixed(0)}°` : '— (无方向)'}</div>
              </div>
            </div>

            {/* 保存当前方向按钮 */}
            <button
              onClick={onSaveDirection}
              style={{ width: '100%', marginTop: '6px', padding: '5px 8px', fontSize: '11px', background: '#4caf50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              title="保存当前方向到收藏列表（下次可点击复用）"
            >
              💾 保存当前方向
            </button>

            {/* 收藏方向列表（点击复用） */}
            {savedDirections.length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px' }}>收藏方向（点击复用为当前方向）</div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {savedDirections.map((d, i) => {
                    const mag = Math.sqrt(d.x * d.x + d.y * d.y);
                    const deg = mag > 0 ? (((Math.atan2(d.y, d.x) * 180 / Math.PI) % 360) + 360) % 360 : 0;
                    const isSelected = Math.abs(directionX - d.x) < 0.01 && Math.abs(directionY - d.y) < 0.01;
                    return (
                      <button
                        key={i}
                        onClick={() => onApplyDirection({ x: d.x, y: d.y })}
                        title={`${d.label}\n矢量: (${d.x.toFixed(2)}, ${d.y.toFixed(2)})\n角度: ${deg.toFixed(0)}°`}
                        style={{
                          width: '36px', height: '36px', padding: 0,
                          border: isSelected ? '2px solid #29b6f6' : '1px solid #ccc',
                          background: isSelected ? '#e3f2fd' : '#fff',
                          color: isSelected ? '#1565c0' : '#333',
                          borderRadius: '4px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {mag < 0.01 ? (
                          <span style={{ fontSize: '14px' }}>⚪</span>
                        ) : (
                          <svg width="20" height="20" style={{ transform: `rotate(${-deg}deg)` }}>
                            <line x1="3" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <polygon points="14,10 11,8 11,12" fill="currentColor" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 速度大小滑块 */}
          <div style={{ marginBottom: '8px' }}>
            <div className="row" style={{ marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', width: '50px' }}>大小:</span>
              <input
                type="range"
                min="0"
                max="3000"
                step="10"
                value={speedMagnitude}
                onChange={(e) => setSpeedMagnitude(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span className="hint" style={{ width: '80px', textAlign: 'right' }}>{speedMagnitude.toFixed(0)} px/s</span>
            </div>
          </div>

          {/* 可视化箭头 + 实际速度矢量显示 */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                position: 'relative',
                border: '1px solid #ddd',
                borderRadius: '6px',
                background: '#fff',
                flexShrink: 0,
              }}
            >
              {/* 中心点 */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: '4px',
                  height: '4px',
                  marginLeft: '-2px',
                  marginTop: '-2px',
                  background: '#666',
                  borderRadius: '50%',
                }}
              />
              {/* 速度箭头 */}
              {velMag > 0 && (
                <svg
                  width="60"
                  height="60"
                  style={{ position: 'absolute', left: 0, top: 0 }}
                >
                  <line
                    x1="30"
                    y1="30"
                    x2={30 + Math.cos((velAngleDeg * Math.PI) / 180) * 25 * arrowLen}
                    y2={30 + Math.sin((velAngleDeg * Math.PI) / 180) * 25 * arrowLen}
                    stroke="#f44336"
                    strokeWidth="2"
                    markerEnd="url(#arrowhead)"
                  />
                  <defs>
                    <marker
                      id="arrowhead"
                      markerWidth="6"
                      markerHeight="6"
                      refX="3"
                      refY="3"
                      orient="auto"
                    >
                      <polygon points="0 0, 6 3, 0 6" fill="#f44336" />
                    </marker>
                  </defs>
                </svg>
              )}
              {/* 速度大小显示 */}
              <div
                style={{
                  position: 'absolute',
                  bottom: '-16px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: '9px',
                  color: '#666',
                  whiteSpace: 'nowrap',
                }}
              >
                {velMag.toFixed(0)} px/s
              </div>
            </div>

            <div style={{ flex: 1, fontSize: '10px', color: '#666' }}>
              <div>实际速度:</div>
              <div>X: {velX.toFixed(1)} px/s</div>
              <div>Y: {velY.toFixed(1)} px/s</div>
              <div style={{ fontSize: '9px', color: '#999', marginTop: '4px' }}>
                Y 正值向下（屏幕坐标系）
              </div>
            </div>
          </div>
        </div>

        {/* 全局力（原重力）：摇杆 + 幅度滑块 */}
        <div className="control-group" style={{ marginBottom: '12px', padding: '8px', background: '#fafafa', borderRadius: '6px', border: '1px solid #e0e0e0' }}>
          <label style={{ marginBottom: '6px' }}>🌍 全局力（方向 + 大小）</label>
          <div className="row" style={{ gap: '12px', alignItems: 'center' }}>
            {/* 摇杆 */}
            <canvas
              ref={joystickCanvasRef}
              width={100}
              height={100}
              style={{
                border: '1px solid #ccc',
                borderRadius: '50%',
                cursor: 'pointer',
                background: '#f5f5f5',
                flexShrink: 0,
              }}
              onMouseDown={handleJoystickDown}
              onMouseMove={handleJoystickMove}
              onMouseUp={handleJoystickUp}
              onMouseLeave={handleJoystickLeave}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {/* 幅度滑块 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                  <span>强度 (px/s²)</span>
                  <span>{gravityMag.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="0.5"
                  value={gravityMag}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setGravityMag(val);
                    onConfigChange({
                      gravity: { x: localDir.x * val, y: localDir.y * val },
                    });
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              {/* 矢量显示 + 手动输入（上下两行） */}
              <div style={{ fontSize: '10px', color: '#666', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ width: '14px' }}>X:</span>
                  <input
                    type="number"
                    step={0.5}
                    value={Number(config.gravity.x.toFixed(1))}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      onConfigChange({ gravity: { x: val, y: config.gravity.y } });
                    }}
                    style={{ width: '46px', fontSize: '10px', padding: '2px 4px', fontFamily: 'monospace' }}
                  />
                  <span style={{ fontSize: '9px', color: '#999' }}>px/s²</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ width: '14px' }}>Y:</span>
                  <input
                    type="number"
                    step={0.5}
                    value={Number(config.gravity.y.toFixed(1))}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      onConfigChange({ gravity: { x: config.gravity.x, y: val } });
                    }}
                    style={{ width: '46px', fontSize: '10px', padding: '2px 4px', fontFamily: 'monospace' }}
                  />
                  <span style={{ fontSize: '9px', color: '#999' }}>px/s²</span>
                </div>
              </div>
            </div>
          </div>
          <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
            拖动摇杆设定方向，滑块调节全局力大小（替换原有重力）
          </span>
        </div>

        {/* 状态提示 */}
        <div
          style={{
            fontSize: '10px',
            color: '#666',
            marginTop: '8px',
            padding: '6px',
            background: '#f5f5f5',
            borderRadius: '4px',
          }}
        >
          <div>🎮 <b>按下画布</b>出现摇杆，<b>拖动</b>设定方向</div>
          {continuousMode ? (
            <div style={{ color: '#1976d2', marginTop: '2px' }}>
              ⚡ 持续模式：按下<b>新增源</b>，拖动摇杆实时改方向（共 {sources.length} 个活跃源）
            </div>
          ) : (
            <div style={{ color: '#ff9800', marginTop: '2px' }}>
              💥 单次模式：<b>按住</b>持续注入（速度 ×{BOOST_MULTIPLIER}），拖动摇杆实时改方向
            </div>
          )}
          <div style={{ marginTop: '2px' }}>
            💧 模式: <b>{currentMode.label}</b>
          </div>
          <div>
            📏 半径: {injectRadius.toFixed(3)} | 💪 强度: {injectStrength.toFixed(1)}x
          </div>
        </div>

        {/* 持续注入源列表（队列独立存在，与持续模式开关、暂停状态均无关） */}
        {sources.length > 0 && (
          <div
            style={{
              marginTop: '8px',
              borderTop: '1px solid #eee',
              paddingTop: '8px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: '#333',
                }}
              >
                持续注入源 ({sources.length})
                {continuousPaused && (
                  <span style={{ color: '#ff9800', fontWeight: 'normal' }}>（已暂停）</span>
                )}
              </span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {sources.length > 0 && (
                  <>
                    <button
                      onClick={onTogglePaused}
                      style={{
                        fontSize: '10px',
                        background: continuousPaused ? '#4caf50' : '#ff9800',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '2px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      {continuousPaused ? '▶ 恢复' : '⏸ 暂停'}
                    </button>
                    <button
                      onClick={onClearAllSources}
                      style={{
                        fontSize: '10px',
                        background: '#f44336',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '2px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      清空所有
                    </button>
                  </>
                )}
              </div>
            </div>
            {/* 源列表（可滚动） */}
            <div
              style={{
                maxHeight: '150px',
                overflowY: 'auto',
                border: '1px solid #e0e0e0',
                borderRadius: '4px',
                background: '#fff',
              }}
            >
              {sources.length === 0 ? (
                <div
                  style={{
                    fontSize: '10px',
                    color: '#999',
                    padding: '8px',
                    textAlign: 'center',
                  }}
                >
                  暂无活跃源，点击画布添加
                </div>
              ) : (
                sources.map((src) => {
                  const speed = Math.hypot(src.velocity.x, src.velocity.y);
                  // 根据颜色获取预览色
                  const [h, s, l] = src.color;
                  const rgbPreview = hslToRgb(h, s, l);
                  const previewColor = `rgb(${Math.round(rgbPreview.r * 255)}, ${Math.round(rgbPreview.g * 255)}, ${Math.round(rgbPreview.b * 255)})`;
                  const isExpanded = expandedSourceId === src.id;
                  const wave = src.wave ?? { enabled: false, amplitude: 0.3, frequency: 1.0 };
                  return (
                    <div
                      key={src.id}
                      style={{
                        borderBottom: '1px solid #f0f0f0',
                      }}
                    >
                      <div
                        onClick={() => onHighlightSource(src.id)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '10px',
                          padding: '4px 6px',
                          gap: '6px',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#e3f2fd'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                        title={`点击高亮画布上的此源 | 位置: (${src.position.x.toFixed(2)}, ${src.position.y.toFixed(2)})\n半径: ${src.radius.toFixed(2)}\n速率: ${src.rate.toFixed(2)}\n速度: ${speed.toFixed(0)} px/s`}
                      >
                        {/* 颜色预览点 + 源信息 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: previewColor, border: '1px solid #ccc', flexShrink: 0 }} />
                          <span style={{ color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            #{src.id} ({src.position.x.toFixed(2)}, {src.position.y.toFixed(2)}) r={src.radius.toFixed(2)} v={speed.toFixed(0)}
                            {wave.enabled && <span style={{ color: '#7e57c2', fontWeight: 'bold' }}> 〰</span>}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }}>
                          {/* 展开/折叠波形设置按钮 */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedSourceId(isExpanded ? null : src.id); }}
                            style={{ background: 'none', border: 'none', color: isExpanded ? '#7e57c2' : '#999', cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }}
                            title={isExpanded ? '收起波形设置' : '展开波形设置'}
                          >
                            {isExpanded ? '▼' : '⚙'}
                          </button>
                          {/* 删除按钮 */}
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveSource(src.id); }}
                            style={{ background: 'none', border: 'none', color: '#f44336', cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }}
                            title="删除此源"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      {/* ★ 波形控制面板（展开时显示） */}
                      {isExpanded && (
                        <div style={{ padding: '6px 8px 8px 20px', background: '#fafafa', fontSize: '10px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <input
                              type="checkbox"
                              checked={wave.enabled}
                              onChange={(e) => onUpdateSourceWave(src.id, { ...wave, enabled: e.target.checked })}
                            />
                            <span style={{ fontWeight: 'bold', color: '#7e57c2' }}>〰 波形摆动（sin）</span>
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                            <label style={{ width: '50px', color: '#666' }}>幅度</label>
                            <input
                              type="range" min={0} max={3.14} step={0.01}
                              value={wave.amplitude}
                              onChange={(e) => onUpdateSourceWave(src.id, { ...wave, amplitude: parseFloat(e.target.value) })}
                              style={{ flex: 1 }}
                            />
                            <span style={{ width: '40px', textAlign: 'right', color: '#999' }}>{wave.amplitude.toFixed(2)} rad</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <label style={{ width: '50px', color: '#666' }}>频率</label>
                            <input
                              type="range" min={0.1} max={5} step={0.1}
                              value={wave.frequency}
                              onChange={(e) => onUpdateSourceWave(src.id, { ...wave, frequency: parseFloat(e.target.value) })}
                              style={{ flex: 1 }}
                            />
                            <span style={{ width: '40px', textAlign: 'right', color: '#999' }}>{wave.frequency.toFixed(1)} Hz</span>
                          </div>
                        </div>
                      )}

                      {/* ★ 路径点控制面板（展开时显示） */}
                      {isExpanded && (
                        <div style={{ padding: '6px 8px 8px 20px', background: '#f5f0ff', fontSize: '10px', borderTop: '1px dashed #d1c4e9' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 'bold', color: '#5e35b1' }}>📍 路径巡游</span>
                            <span style={{ color: '#999' }}>
                              {src.waypoints && src.waypoints.length > 0 ? `${src.waypoints.length} 个航点` : '未设置'}
                            </span>
                          </div>
                          {/* 录制/停止录制按钮 */}
                          <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                            {recordingWaypointSourceId === src.id ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); onStopWaypointRecording(); }}
                                style={{ flex: 1, padding: '4px', borderRadius: '3px', border: '1px solid #f44336', background: '#ffebee', color: '#c62828', cursor: 'pointer', fontSize: '10px' }}
                              >
                                ⏹ 停止录制（点击画布添加点）
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); onStartWaypointRecording(src.id); }}
                                style={{ flex: 1, padding: '4px', borderRadius: '3px', border: '1px solid #7e57c2', background: '#ede7f6', color: '#4527a0', cursor: 'pointer', fontSize: '10px' }}
                              >
                                🔴 录制路径
                              </button>
                            )}
                            {src.waypoints && src.waypoints.length > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onClearWaypoints(src.id); }}
                                style={{ padding: '4px 8px', borderRadius: '3px', border: '1px solid #999', background: 'transparent', color: '#666', cursor: 'pointer', fontSize: '10px' }}
                              >
                                清空
                              </button>
                            )}
                          </div>
                          {/* 模式选择 */}
                          {src.waypoints && src.waypoints.length >= 2 && (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                <label style={{ width: '50px', color: '#666' }}>模式</label>
                                <select
                                  value={src.waypointMode || 'forward'}
                                  onChange={(e) => onUpdateWaypointMode(src.id, e.target.value as WaypointMode)}
                                  style={{ flex: 1, fontSize: '10px', padding: '2px', borderRadius: '3px', border: '1px solid #ccc' }}
                                >
                                  <option value="forward">正序循环 →→→</option>
                                  <option value="backward">逆序循环 ←←←</option>
                                  <option value="pingpong">往返 ↔↔↔</option>
                                </select>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <label style={{ width: '50px', color: '#666' }}>速度</label>
                                <input
                                  type="range" min={0.1} max={5} step={0.1}
                                  value={src.waypointSpeed ?? 1.0}
                                  onChange={(e) => onUpdateWaypointSpeed(src.id, parseFloat(e.target.value))}
                                  style={{ flex: 1 }}
                                />
                                <span style={{ width: '50px', textAlign: 'right', color: '#999' }}>{(src.waypointSpeed ?? 1.0).toFixed(1)} /s</span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
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
  // ★ 导出流体库配置 JSON（物理配方，供轻量化无头流体库加载）
  onExportConfig: () => void;
  // ★ 速度场亮度基准值（uMaxVel）：值越小，低速区域越亮
  velViewMax: number;
  setVelViewMax: (v: number) => void;
  // ★ 墙体绘制相关 props
  wallBrushMode: 'brush' | 'eraser';
  setWallBrushMode: (m: 'brush' | 'eraser') => void;
  wallBrushRadius: number;
  setWallBrushRadius: (r: number) => void;
  onClearObstacles: () => void;
  // ★ 持续注入源 UI 可见性开关
  showInjectionUI: boolean;
  setShowInjectionUI: (v: boolean) => void;
}> = (props) => {
  const {
    config,
    viewMode,
    onConfigChange,
    onViewChange,
    onReset,
    onExportConfig,
    velViewMax,
    setVelViewMax,
    wallBrushMode,
    setWallBrushMode,
    wallBrushRadius,
    setWallBrushRadius,
    onClearObstacles,
    showInjectionUI,
    setShowInjectionUI,
  } = props;
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

        {/* 速度场数据类型 */}
        <div className="control-group">
          <label>速度场精度</label>
          <div className="row" style={{ gap: '6px' }}>
            <button
              type="button"
              onClick={() => onConfigChange({ velocityDataType: 'float' })}
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: '11px',
                background: config.velocityDataType === 'float' ? '#2196f3' : '#f5f5f5',
                color: config.velocityDataType === 'float' ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: config.velocityDataType === 'float' ? 'bold' : 'normal',
              }}
              title="32位单精度浮点：高精度，显存翻倍，readPixels 直接读出"
            >
              32位 Float
            </button>
            <button
              type="button"
              onClick={() => onConfigChange({ velocityDataType: 'half-float' })}
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: '11px',
                background: config.velocityDataType === 'half-float' ? '#ff9800' : '#f5f5f5',
                color: config.velocityDataType === 'half-float' ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: config.velocityDataType === 'half-float' ? 'bold' : 'normal',
              }}
              title="16位半精度浮点：显存减半，readPixels 用 Uint16Array + halfToFloat 解码"
            >
              16位 Half
            </button>
          </div>
          <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
            {config.velocityDataType === 'float'
              ? '32位浮点：高精度，每像素 8 字节（RG×4B）'
              : '16位半精度：显存减半，每像素 4 字节（RG×2B），精度略低'}
          </span>
        </div>

        {/* 速度限幅 */}
        <div className="control-group">
          <label>速度限幅 (px/s)</label>
          <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
            <input
              type="number"
              min={0}
              max={100000}
              step={500}
              value={config.maxVelocity ?? 5000}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onConfigChange({ maxVelocity: isNaN(v) ? 0 : Math.max(0, v) });
              }}
              style={{ flex: 1, minWidth: '70px' }}
              title="每帧对速度场做全局限幅，防止速度爆炸。0 = 禁用限幅"
            />
            <button
              type="button"
              onClick={() => onConfigChange({ maxVelocity: 0 })}
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                background: config.maxVelocity === 0 ? '#f44336' : '#f5f5f5',
                color: config.maxVelocity === 0 ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title="禁用限幅（不推荐，可能导致速度爆炸）"
            >
              禁用
            </button>
            <button
              type="button"
              onClick={() => onConfigChange({ maxVelocity: 5000 })}
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                background: config.maxVelocity === 5000 ? '#4caf50' : '#f5f5f5',
                color: config.maxVelocity === 5000 ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title="恢复默认 5000 px/s"
            >
              默认
            </button>
          </div>
          <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
            {config.maxVelocity === 0
              ? '⚠️ 限幅已禁用，速度可能爆炸'
              : `上限 ${(config.maxVelocity ?? 5000).toLocaleString()} px/s（0=禁用）`}
          </span>
        </div>

        {/* 全局速度缩放（无方向阻尼/加速） */}
        <div className="control-group">
          <label>⚖️ 全局速度缩放（无方向）</label>
          <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
            <input
              type="range"
              min={0}
              max={2}
              step={0.001}
              value={config.velocityScale ?? 1}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onConfigChange({ velocityScale: v });
              }}
              style={{ flex: 1 }}
              title="每帧对整个速度场乘以此系数。1=无影响，<1阻尼减速，>1加速"
            />
            <input
              type="number"
              min={0}
              max={10}
              step={0.01}
              value={Number((config.velocityScale ?? 1).toFixed(3))}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onConfigChange({ velocityScale: isNaN(v) ? 1 : Math.max(0, v) });
              }}
              style={{ width: '60px', fontSize: '10px', padding: '2px 4px' }}
              title="直接输入缩放系数"
            />
            <button
              type="button"
              onClick={() => onConfigChange({ velocityScale: 1 })}
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                background: (config.velocityScale ?? 1) === 1 ? '#4caf50' : '#f5f5f5',
                color: (config.velocityScale ?? 1) === 1 ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title="恢复默认 1.0（无影响）"
            >
              1.0
            </button>
          </div>
          <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
            {(() => {
              const s = config.velocityScale ?? 1;
              if (s === 1) return '无影响（默认）';
              if (s < 1) return `阻尼减速 ×${s.toFixed(3)}（每帧速度衰减 ${(100 * (1 - s)).toFixed(1)}%）`;
              return `加速 ×${s.toFixed(3)}（每帧速度增加 ${(100 * (s - 1)).toFixed(1)}%）`;
            })()}
          </span>
        </div>

        {/* ★ MCSDA 平流模式切换：向量模式（旧）/ 标量浓度模式（新） */}
        <div className="control-group">
          <label>平流模式</label>
          <div className="row" style={{ gap: '6px' }}>
            <button
              type="button"
              onClick={() => onConfigChange({ advectionMode: 'vector' })}
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: '11px',
                background: config.advectionMode !== 'scalar' ? '#673ab7' : '#f5f5f5',
                color: config.advectionMode !== 'scalar' ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: config.advectionMode !== 'scalar' ? 'bold' : 'normal',
              }}
              title="向量模式：4 通道颜色场（HSLA）参与平流，残差动态流动（旧模式）"
            >
              🔀 向量模式
            </button>
            <button
              type="button"
              onClick={() => onConfigChange({ advectionMode: 'scalar' })}
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: '11px',
                background: config.advectionMode === 'scalar' ? '#009688' : '#f5f5f5',
                color: config.advectionMode === 'scalar' ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: config.advectionMode === 'scalar' ? 'bold' : 'normal',
              }}
              title="标量浓度模式：1 通道 density 平流，残差静态化，合成时用 density×通道系数调制（MCSDA）"
            >
              🧪 标量浓度
            </button>
          </div>
          <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
            {config.advectionMode === 'scalar'
              ? '标量模式：density 平流驱动视觉流动，残差按浓度×系数调制。用摇杆注入 density'
              : '向量模式：HSLA 4 通道平流，残差随速度场流动（默认）'}
          </span>
        </div>

        {/* ★ MCSDA 标量模式参数（仅 advectionMode='scalar' 时显示） */}
        {config.advectionMode === 'scalar' && (
          <>
            <div className="control-group">
              <label>H 强度 (-0.2~0.2)</label>
              <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
                <input
                  type="range" min={-0.2} max={0.2} step={0.0001}
                  value={config.scalarConfig?.hMultiplier ?? 0.1}
                  onChange={(e) => onConfigChange({
                    scalarConfig: { ...config.scalarConfig!, hMultiplier: parseFloat(e.target.value) }
                  })}
                  style={{ flex: 1 }}
                  title="色相系数：负值产生补色，0=无残差，1=原样，2=2倍增强"
                />
                <span className="hint" style={{ width: '46px', textAlign: 'right' }}>
                  {(config.scalarConfig?.hMultiplier ?? 0.1).toFixed(4)}
                </span>
              </div>
            </div>
            <div className="control-group">
              <label>S 强度 (-0.2~0.2)</label>
              <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
                <input
                  type="range" min={-0.2} max={0.2} step={0.0001}
                  value={config.scalarConfig?.sMultiplier ?? 0.1}
                  onChange={(e) => onConfigChange({
                    scalarConfig: { ...config.scalarConfig!, sMultiplier: parseFloat(e.target.value) }
                  })}
                  style={{ flex: 1 }}
                />
                <span className="hint" style={{ width: '46px', textAlign: 'right' }}>
                  {(config.scalarConfig?.sMultiplier ?? 0.1).toFixed(4)}
                </span>
              </div>
            </div>
            <div className="control-group">
              <label>L 强度 (-0.2~0.2)</label>
              <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
                <input
                  type="range" min={-0.2} max={0.2} step={0.0001}
                  value={config.scalarConfig?.lMultiplier ?? 0.1}
                  onChange={(e) => onConfigChange({
                    scalarConfig: { ...config.scalarConfig!, lMultiplier: parseFloat(e.target.value) }
                  })}
                  style={{ flex: 1 }}
                />
                <span className="hint" style={{ width: '46px', textAlign: 'right' }}>
                  {(config.scalarConfig?.lMultiplier ?? 0.1).toFixed(4)}
                </span>
              </div>
            </div>
            <div className="control-group">
              <label>A 强度 (-0.2~0.2)</label>
              <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
                <input
                  type="range" min={-0.2} max={0.2} step={0.0001}
                  value={config.scalarConfig?.aMultiplier ?? 0.1}
                  onChange={(e) => onConfigChange({
                    scalarConfig: { ...config.scalarConfig!, aMultiplier: parseFloat(e.target.value) }
                  })}
                  style={{ flex: 1 }}
                />
                <span className="hint" style={{ width: '46px', textAlign: 'right' }}>
                  {(config.scalarConfig?.aMultiplier ?? 0.1).toFixed(4)}
                </span>
              </div>
            </div>
            <div className="control-group">
              <label>基准浓度 baseline (0.001~1.0)</label>
              <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
                <input
                  type="range" min={0.001} max={1} step={0.0001}
                  value={config.scalarConfig?.baselineDensity ?? 1.0}
                  onChange={(e) => onConfigChange({
                    scalarConfig: { ...config.scalarConfig!, baselineDensity: parseFloat(e.target.value) }
                  })}
                  style={{ flex: 1 }}
                  title="基准浓度：factor=density/baseline。低于基准削弱，高于基准增强"
                />
                <span className="hint" style={{ width: '56px', textAlign: 'right' }}>
                  {(config.scalarConfig?.baselineDensity ?? 1.0).toFixed(4)}
                </span>
              </div>
              <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
                factor = density / baseline：低于基准→削弱，高于基准→增强
              </span>
            </div>
            <div className="control-group">
              <label>衰减速率 decay (0~0.99)</label>
              <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
                <input
                  type="range" min={0} max={0.99} step={0.0001}
                  value={config.scalarConfig?.decayRate ?? 0}
                  onChange={(e) => onConfigChange({
                    scalarConfig: { ...config.scalarConfig!, decayRate: parseFloat(e.target.value) }
                  })}
                  style={{ flex: 1 }}
                  title="每帧 density *= (1-decayRate)。0=无衰减，0.1=每帧损失10%"
                />
                <span className="hint" style={{ width: '56px', textAlign: 'right' }}>
                  {(config.scalarConfig?.decayRate ?? 0).toFixed(4)}
                </span>
              </div>
              <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
                每帧 density × (1-decayRate)：0=无衰减，0.1=每帧损失10%
              </span>
            </div>

            {/* ★ 合成模式切换：add(基础色+增量) / sub(基础色-增量) */}
            <div className="control-group">
              <label>混合模式</label>
              <div className="row" style={{ gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => onConfigChange({ combineMode: 'add' })}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: '11px',
                    background: config.combineMode !== 'sub' ? '#4caf50' : '#f5f5f5',
                    color: config.combineMode !== 'sub' ? '#fff' : '#333',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  ➕ 叠加
                </button>
                <button
                  type="button"
                  onClick={() => onConfigChange({ combineMode: 'sub' })}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: '11px',
                    background: config.combineMode === 'sub' ? '#f44336' : '#f5f5f5',
                    color: config.combineMode === 'sub' ? '#fff' : '#333',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  ➖ 减去
                </button>
              </div>
              <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
                {config.combineMode === 'sub'
                  ? '减去：base + delta - (density/baseline × mul)'
                  : '叠加：base + delta + (density/baseline × mul)'}
              </span>
            </div>
          </>
        )}

        {/* 通道选择 */}
        <div className="control-group">
          <label>平流通道（勾选=跟随速度流动）</label>
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
          {!config.channels.a && (
            <div style={{ fontSize: '10px', color: '#e65100', marginTop: '4px', padding: '4px 6px', background: '#fff3e0', borderRadius: '4px', border: '1px solid #ffb74d' }}>
              ⚠️ 透明度(A)未参与平流：流动的颜料无法携带不透明度，会变透明消失。建议保持 A 开启。
            </div>
          )}
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
            <button
              className={viewMode === 'density' ? 'active' : ''}
              onClick={() => onViewChange('density')}
              title="浓缩场（density 标量浓度灰度显示，仅标量模式有意义）"
            >
              🧪 浓缩
            </button>
            <button
              className={viewMode === 'obstacle' ? 'active' : ''}
              onClick={() => {
                onViewChange('obstacle');
                // 切换到墙体模式时自动启用障碍物
                if (!config.enableObstacles) {
                  onConfigChange({ enableObstacles: true });
                }
              }}
              title="墙体（绘制障碍物，阻挡流体流动）"
            >
              🧱 墙体
            </button>
            <button
              className={viewMode === 'levelset' ? 'active' : ''}
              onClick={() => onViewChange('levelset')}
              title="Level Set φ 场（红=内部/蓝=外部/白=零等值线，调试 SDF）"
            >
              🌀 φ场
            </button>
          </div>
        </div>

        {/* ★ 注入源 UI 可见性开关：控制画布上持续注入源的蓝色圆圈+红色箭头是否显示 */}
        <div className="control-group">
          <label>画布叠加 UI</label>
          <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
            <button
              className={showInjectionUI ? 'active' : ''}
              onClick={() => setShowInjectionUI(!showInjectionUI)}
              style={{ flex: 1, padding: '6px 10px', borderRadius: '4px', border: '1px solid #555', background: showInjectionUI ? '#1a3a5c' : 'transparent', color: '#fff', cursor: 'pointer' }}
              title="切换持续注入源可视化（蓝色圆圈+红色箭头）的显示"
            >
              {showInjectionUI ? '👁️ 显示注入源 UI' : '🙈 隐藏注入源 UI'}
            </button>
          </div>
        </div>

        {/* ★ 速度场亮度基准值滑块：仅在速度视图下显示。
            值越小，低速区域越亮（1 = 1 px/s 即满亮度，极灵敏）。 */}
        {viewMode === 'velocity' && (
          <div className="control-group">
            <label>速度场亮度基准 (px/s)</label>
            <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
              <input
                type="range"
                min={1}
                max={1000}
                step={1}
                value={velViewMax}
                onChange={(e) => setVelViewMax(parseInt(e.target.value))}
                style={{ flex: 1 }}
                title="值越小，低速区域越亮。1 = 1px/s 即满亮度"
              />
              <span className="hint" style={{ width: '60px', textAlign: 'right' }}>{velViewMax} px/s</span>
            </div>
            <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
              控制速度可视化的灵敏度：值越小，低速区域越亮（1=极灵敏，1000=正常）
            </span>
          </div>
        )}

        {/* ★ 墙体绘制工具栏（仅在 obstacle 视口下显示） */}
        {viewMode === 'obstacle' && (
          <div className="control-group" style={{ borderTop: '1px solid #333', paddingTop: '8px' }}>
            <label>🧱 墙体绘制</label>
            <div className="row" style={{ gap: '6px' }}>
              <button
                className={wallBrushMode === 'brush' ? 'active' : ''}
                onClick={() => setWallBrushMode('brush')}
                style={{ flex: 1, padding: '6px 10px', borderRadius: '4px', border: '1px solid #555', background: wallBrushMode === 'brush' ? '#1a3a5c' : 'transparent', color: '#fff', cursor: 'pointer' }}
              >
                🖌️ 画笔
              </button>
              <button
                className={wallBrushMode === 'eraser' ? 'active' : ''}
                onClick={() => setWallBrushMode('eraser')}
                style={{ flex: 1, padding: '6px 10px', borderRadius: '4px', border: '1px solid #555', background: wallBrushMode === 'eraser' ? '#3a1a1a' : 'transparent', color: '#fff', cursor: 'pointer' }}
              >
                🧽 橡皮
              </button>
            </div>
            <div className="row" style={{ gap: '6px', alignItems: 'center', marginTop: '6px' }}>
              <label style={{ fontSize: '11px' }}>笔刷大小</label>
              <input
                type="range"
                min={0.005}
                max={0.15}
                step={0.005}
                value={wallBrushRadius}
                onChange={(e) => setWallBrushRadius(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span className="hint" style={{ width: '50px', textAlign: 'right' }}>
                {Math.round(wallBrushRadius * 100)}%
              </span>
            </div>
            <div className="row" style={{ marginTop: '6px' }}>
              <button
                onClick={() => { onClearObstacles(); }}
                style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #555', background: 'transparent', color: '#fff', cursor: 'pointer' }}
              >
                🗑️ 清空墙体
              </button>
            </div>
            <span className="hint" style={{ fontSize: '9px', color: '#888', marginTop: '4px', display: 'block' }}>
              拖拽鼠标绘制墙体，墙体将阻挡流体流动
            </span>
          </div>
        )}

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

        {/* ★ 导出流体库配置 JSON（物理配方，供轻量化无头流体库加载） */}
        <div className="control-group">
          <button
            onClick={onExportConfig}
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
            title="导出物理配方 JSON（核心开关/平流模式/全局力场/Level Set/持续注入源），供轻量化无头流体库加载"
          >
            📤 导出流体配置 JSON
          </button>
          <span className="hint" style={{ fontSize: '9px', color: '#888' }}>
            仅导出物理配方（不含场数据），供轻量化库加载
          </span>
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
        <label className="toggle-switch" title="Level Set：φ 场平流 + 周期性重初始化 + 表面张力">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
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
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null); // ★ 持续注入点可视化叠加层
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null); // 唯一的渲染器：计算 + 显示
  const [rendererState, setRendererState] = useState<THREE.WebGLRenderer | null>(null); // 用于传递给 useFluidEditor
  const displayRafRef = useRef<number>();
  /** 缓存的底图纹理 + 上一次的 activeLayerId，避免每帧重建 */
  const baseTexRef = useRef<THREE.DataTexture | null>(null);
  const baseLayerIdRef = useRef<string | null>(null);
  /** 独立 FTX 导入的 baseHslData 备份（effect 重建后恢复纹理用） */
  const ftxBaseDataRef = useRef<{ data: Float32Array; width: number; height: number } | null>(null);
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

  // ★ 速度场可视化亮度基准值（uMaxVel）：值越小，低速区域越亮。
  //   用户可通过滑块手动调整，最小 1 表示 1 px/s 也能满亮度显示。
  const [velViewMax, setVelViewMax] = useState(200);
  const velViewMaxRef = useRef(velViewMax);
  velViewMaxRef.current = velViewMax;

  // ★ 持续注入源 UI 可见性开关（蓝色圆圈 + 红色箭头），默认显示
  const [showInjectionUI, setShowInjectionUI] = useState(true);
  const showInjectionUIRef = useRef(showInjectionUI);
  showInjectionUIRef.current = showInjectionUI;

  // ★ 注入源高亮：点击列表项时在画布上脉冲高亮对应源（不受 showInjectionUI 影响）
  const highlightedSourceIdRef = useRef<number | null>(null);
  const highlightExpireRef = useRef<number>(0);
  const handleHighlightSource = useCallback((id: number) => {
    highlightedSourceIdRef.current = id;
    highlightExpireRef.current = performance.now() + 2500; // 高亮 2.5 秒
  }, []);

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

  /**
   * 合成公式（与合成着色器一致）
   * ★ scalar 模式：final = base + delta ± (density/baseline × mul)
   *   - delta 直接叠加（不被 density 调制），density×mul 作为独立偏移项
   *   - density/baseline/mul 提供时启用 scalar 公式，否则退化为 base + delta（vector）
   * ★ 通道开关：关闭的通道直接输出残差原值（绕过 base+delta），与 GPU uChannels 一致
   */
  const computeCompositeHsl = (
    baseHsl: { h: number; s: number; l: number },
    residual: { r: number; g: number; b: number },
    rangeH: number,
    rangeSL: number,
    mode: 'add' | 'sub' = 'add',
    scalar?: { density: number; baseline: number; hMul: number; sMul: number; lMul: number },
    channels?: { r: boolean; g: boolean; b: boolean },
  ): { h: number; s: number; l: number } => {
    const dH = (residual.r * 2.0 - 1.0) * rangeH;
    const dS = (residual.g * 2.0 - 1.0) * rangeSL;
    const dL = (residual.b * 2.0 - 1.0) * rangeSL;
    // sign: add=+1, sub=-1（与合成着色器一致）
    const sign = mode === 'sub' ? -1 : 1;
    // ★ delta 直接加；scalar 模式下 density×mul 作为独立项 ±
    const factor = scalar ? scalar.density / Math.max(scalar.baseline, 0.001) : 0;
    const hExtra = scalar ? sign * factor * scalar.hMul : 0;
    const sExtra = scalar ? sign * factor * scalar.sMul : 0;
    const lExtra = scalar ? sign * factor * scalar.lMul : 0;
    // 正常公式
    let normalH = baseHsl.h + dH + hExtra;
    normalH = normalH - Math.floor(normalH); // fract
    const normalS = Math.max(0, Math.min(1, baseHsl.s + dS + sExtra));
    const normalL = Math.max(0, Math.min(1, baseHsl.l + dL + lExtra));
    // ★ 关闭的通道直接输出残差原值（与 GPU mix(residual, normal, uChannels) 一致）
    const finalH = channels && !channels.r ? residual.r : normalH;
    const finalS = channels && !channels.g ? residual.g : normalS;
    const finalL = channels && !channels.b ? residual.b : normalL;
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
    // 速度（纹理坐标系：Y向上为正，从 solver 直接读出）
    velX: number; velY: number; velMag: number; velDirDeg: number;
    // 速度（用户坐标系：Y向下为正，UI可见方向）
    userVelX: number; userVelY: number; userVelDirDeg: number;
    // 方向文字描述（8方向）
    dirLabel: string;
  } | null>(null);

  // 鼠标注入模式状态
  const [injectMode, setInjectMode] = useState<InjectMode>('water');
  const [injectRadius, setInjectRadius] = useState(0.1);
  const [injectStrength, setInjectStrength] = useState(1.0);

  // ★ 墙体绘制模式状态（仅在 obstacle 视口下生效）
  const [wallBrushMode, setWallBrushMode] = useState<'brush' | 'eraser'>('brush');
  const [wallBrushRadius, setWallBrushRadius] = useState(0.03); // 归一化半径（相对于画布）
  const wallBrushRadiusRef = useRef<number>(wallBrushRadius);
  wallBrushRadiusRef.current = wallBrushRadius;
  const wallBrushModeRef = useRef<'brush' | 'eraser'>(wallBrushMode);
  wallBrushModeRef.current = wallBrushMode;

  // 持续注入模式状态
  const [continuousMode, setContinuousMode] = useState(false);
  // ★ 手动暂停/恢复持续注入（独立控制，不影响持续模式开关和源队列）
  const [continuousPaused, setContinuousPaused] = useState(false);
  // ★ 方向（归一化矢量），默认向下 (0, 1) —— 屏幕坐标系 Y 向下为正
  //   仅用于面板显示和摇杆初始方向；注入时实时方向读 joystickDirRef
  const [directionX, setDirectionX] = useState(0);
  const [directionY, setDirectionY] = useState(1);
  // ★ 速度大小（标量，px/s）
  const [speedMagnitude, setSpeedMagnitude] = useState(200);

  // ★ 画布浮层摇杆状态（用 ref：rAF 实时读取，避免高频 setState 卡顿）
  //   按下画布 → 激活摇杆 → 拖动实时改方向 → 松开停用
  const joystickActiveRef = useRef(false);
  // 摇杆原点（按下位置，CSS 像素，相对 canvas 左上）
  const joystickOriginRef = useRef<{ cssX: number; cssY: number }>({ cssX: 0, cssY: 0 });
  // 实时方向（归一化矢量，屏幕坐标系 Y 向下为正）
  const joystickDirRef = useRef<{ x: number; y: number }>({ x: 0, y: 1 });
  // 持续模式按住期间新增的源 ID（拖动时实时更新该源方向）
  const joystickSourceIdRef = useRef<number | null>(null);
  // 摇杆最大有效半径（CSS 像素）：超出按方向归一化，不限制拖动距离
  const JOYSTICK_RADIUS = 60;

  // ★ 收藏方向列表（用户可保存当前方向便于复用）
  const [savedDirections, setSavedDirections] = useState<Array<{ x: number; y: number; label: string }>>([]);

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
  } = useFluidEditor(rendererState, {
    resolution: { w: 256, h: 256 },
    channels: { r: true, g: true, b: true, a: true },
    enableAdvection: true,
    enablePressure: false,
    enableLevelSet: false,
    gravity: { x: 0, y: 5 }, // 二维矢量，默认向下 5 px/s²（屏幕坐标系）
    velocityDataType: 'float', // 速度场数据类型：'float'(32位) 或 'half-float'(16位)
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

  // ★ MCSDA 模式相关 ref：渲染循环依赖这些值实时更新合成着色器 uniform，
  //   但 useEffect 不会因 config.advectionMode/scalarConfig 变化而重建场景，
  //   所以用 ref 在循环内读取最新值（必须在 config 声明之后）。
  const advectionModeRef = useRef(config.advectionMode ?? 'vector');
  advectionModeRef.current = config.advectionMode ?? 'vector';
  const scalarConfigRef = useRef(config.scalarConfig);
  scalarConfigRef.current = config.scalarConfig;

  // ★ 持续注入源列表（多源模式，从 FluidEditor 获取快照）
  const [continuousSources, setContinuousSources] = useState<ContinuousSourceSnapshot[]>([]);

  // ★ 刷新持续注入源列表（增删后调用，同步 UI 状态）
  const refreshSources = useCallback(() => {
    if (!editor) {
      setContinuousSources([]);
      return;
    }
    setContinuousSources(editor.getContinuousSources());
  }, [editor]);

  // ★ 构建注入配置（从当前 UI 状态）
  // 实际速度矢量 = 方向（归一化） × 速度大小（标量）

  const buildInjectionConfig = useCallback((pos: { x: number; y: number }) => {
    let color: [number, number, number, number] = [0.0, 0.8, 1.0, 1.0];
    let rate = 0.6 * injectStrength;

    if (injectMode === 'water') {
      color = [0.0, 0.8, 1.0, 1.0];
      rate = 0.6 * injectStrength;
    } else if (injectMode === 'color') {
      color = [1.0, 0.2, 0.2, 1.0];
      rate = 0.5;
    } else if (injectMode === 'velocity') {
      color = [0, 0, 0, 0];
      rate = 0;
    }

    // ★ 持续注入与单次注入速度大小一致（均使用 BOOST_MULTIPLIER 倍率）
    //   两者唯一的差别是注入时机：单次=按住期间每帧注入，持续=持久源每帧注入
    const finalSpeedMagnitude = speedMagnitude * BOOST_MULTIPLIER;

    // ★ 方向：摇杆激活时用实时方向（拖动实时变），否则用面板方向（收藏/上次记忆）
    const dir = joystickActiveRef.current
      ? joystickDirRef.current
      : { x: directionX, y: directionY };

    // ★ 速度矢量 = 方向 × 最终大小
    const velX = dir.x * finalSpeedMagnitude;
    const velY = dir.y * finalSpeedMagnitude;

    // ★ MCSDA 标量模式：摇杆同时注入 density 浓度（被速度推动流动）。
    //   density 浓度固定为 1.0（满浓度），让注入点立即产生满浓度源，
    //   后续由衰减/平流自然消散。vector 模式不带 density 字段（兼容）。
    const isScalar = config.advectionMode === 'scalar';
    const densityValue = isScalar ? 1.0 : undefined;

    return {
      enabled: true,
      position: pos,
      radius: injectRadius,
      rate,
      velocity: { x: velX, y: velY },
      color,
      ...(densityValue !== undefined ? { density: densityValue } : {}),
    };
  }, [injectMode, injectRadius, injectStrength, directionX, directionY, speedMagnitude, continuousMode, config.advectionMode]);

  // ★ 鼠标按住状态：单次模式下长按 = 临时持续注入（松开即停）
  const pointerDownRef = useRef(false);
  const pointerPosRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  // ★ 供 rAF 循环读取的最新 UI 状态（避免闭包捕获旧值）
  const injectModeRef = useRef(injectMode);
  injectModeRef.current = injectMode;
  const continuousModeRef = useRef(continuousMode);
  continuousModeRef.current = continuousMode;
  const continuousPausedRef = useRef(continuousPaused);
  continuousPausedRef.current = continuousPaused;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const buildInjectionConfigRef = useRef(buildInjectionConfig);
  buildInjectionConfigRef.current = buildInjectionConfig;

  // ★ 鼠标按下：激活摇杆 + 触发注入
  //   - 单次模式：按住期间持续注入（rAF 每帧读摇杆方向），松开停止
  //   - 持续模式：立即新增源，拖动实时更新源方向，松开固定
  //   - 印章模式：不走摇杆，由 onClick 处理
  //   - 墙体模式：直接在 obstacleGrid 上绘制墙体
  const handlePointerDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current;
    if (!canvas || !editor) return;

    // ★ 路径录制模式：拦截所有鼠标按下，不激活摇杆（航点通过 onClick 添加）
    if (recordingWaypointSourceIdRef.current !== null) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;
    const pos = { x: normX, y: normY };

    // ★ 墙体绘制模式：直接在障碍物纹理上绘制
    if (viewModeRef.current === 'obstacle') {
      editor.enableObstaclesMode();
      const value = wallBrushModeRef.current === 'brush' ? 255 : 0;
      // 最小半径 2 像素（防止隧道效应），半径以归一化坐标传递
      const minRadius = 2 / Math.max(config.resolution.w, config.resolution.h);
      const effectiveRadius = Math.max(wallBrushRadiusRef.current, minRadius);
      editor.updateObstacle(pos, effectiveRadius, value as 0 | 255);
      pointerPosRef.current = pos;
      pointerDownRef.current = true;
      return;
    }

    if (injectMode === 'stamp') return; // 印章模式走 onClick

    // ★ 激活摇杆：原点 = 按下位置（CSS 像素），初始方向 = 当前面板方向
    joystickActiveRef.current = true;
    joystickOriginRef.current = { cssX: e.clientX - rect.left, cssY: e.clientY - rect.top };
    joystickDirRef.current = { x: directionX, y: directionY };
    // 注入位置 = 按下点（持续模式供拖动时 updateContinuousInjection 用，单次模式供 rAF 用）
    pointerPosRef.current = pos;

    if (continuousMode) {
      // 持续模式：立即新增源（方向 = 摇杆当前方向），记录 ID 供拖动时更新
      const injectConfig = buildInjectionConfig(pos);
      const id = editor.addContinuousInjection(injectConfig);
      joystickSourceIdRef.current = id;
      refreshSources();
    } else {
      // 单次模式：按住期间持续注入（位置固定 = 按下点，方向由摇杆实时控制）
      pointerDownRef.current = true;
    }
  }, [editor, continuousMode, injectMode, directionX, directionY, buildInjectionConfig, refreshSources]);

  // ★ 鼠标松开：停用摇杆，保存最终方向到面板（自动记忆）
  const handlePointerUp = useCallback(() => {
    if (joystickActiveRef.current) {
      const finalDir = joystickDirRef.current;
      setDirectionX(finalDir.x);
      setDirectionY(finalDir.y);
      joystickActiveRef.current = false;
      joystickSourceIdRef.current = null;
      if (continuousModeRef.current) refreshSources();
    }
    pointerDownRef.current = false;
  }, [refreshSources]);

  // ★ 鼠标移动：摇杆激活时计算方向 + 持续模式实时更新源 + 墙体模式绘制
  const handlePointerMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    // ★ 墙体绘制模式：鼠标移动时持续绘制墙体
    if (viewModeRef.current === 'obstacle' && pointerDownRef.current && editor) {
      const normX = cssX / rect.width;
      const normY = cssY / rect.height;
      const pos = { x: normX, y: normY };
      pointerPosRef.current = pos;
      const value = wallBrushModeRef.current === 'brush' ? 255 : 0;
      const minRadius = 2 / Math.max(config.resolution.w, config.resolution.h);
      const effectiveRadius = Math.max(wallBrushRadiusRef.current, minRadius);
      editor.updateObstacle(pos, effectiveRadius, value as 0 | 255);
      return;
    }

    if (!joystickActiveRef.current) return;

    // 计算摇杆偏移并归一化为方向矢量
    const dx = cssX - joystickOriginRef.current.cssX;
    const dy = cssY - joystickOriginRef.current.cssY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 5) {
      // 死区：方向归零（无方向注入，仅颜色/重力）
      joystickDirRef.current = { x: 0, y: 0 };
    } else {
      joystickDirRef.current = { x: dx / dist, y: dy / dist };
    }

    // 持续模式：实时更新源方向（位置不变）
    if (continuousModeRef.current && joystickSourceIdRef.current !== null && editor) {
      const injectConfig = buildInjectionConfig(pointerPosRef.current);
      editor.updateContinuousInjection(joystickSourceIdRef.current, injectConfig);
    }
  }, [editor, buildInjectionConfig]);

  // ★ 鼠标离开画布：停用摇杆 + 停止注入（与松开一致）
  const handlePointerLeave = useCallback(() => {
    if (joystickActiveRef.current) {
      const finalDir = joystickDirRef.current;
      setDirectionX(finalDir.x);
      setDirectionY(finalDir.y);
      joystickActiveRef.current = false;
      joystickSourceIdRef.current = null;
      if (continuousModeRef.current) refreshSources();
    }
    pointerDownRef.current = false;
  }, [refreshSources]);

  // ★ 删除单个持续注入源
  const handleRemoveSource = useCallback((id: number) => {
    if (!editor) return;
    editor.removeContinuousInjection(id);
    // ★ 如果删除的正是正在录制路径的源，自动退出录制模式（否则会卡住所有注入操作）
    if (recordingWaypointSourceIdRef.current === id) {
      setRecordingWaypointSourceId(null);
    }
    refreshSources();
  }, [editor, refreshSources]);

  // ★ 更新源的波形参数（不改变位置/速度/颜色等基础属性）
  const handleUpdateSourceWave = useCallback((id: number, wave: WaveConfig) => {
    if (!editor) return;
    const sources = editor.getContinuousSources();
    const src = sources.find(s => s.id === id);
    if (!src) return;
    // 保留原有所有配置（含 density），仅更新 wave 字段
    editor.updateContinuousInjection(id, {
      ...src.config,
      wave,
    });
    refreshSources();
  }, [editor, refreshSources]);

  // ★ ========== 路径点（Waypoint）控制 ==========
  const [recordingWaypointSourceId, setRecordingWaypointSourceId] = useState<number | null>(null);
  const recordingWaypointSourceIdRef = useRef<number | null>(null);
  recordingWaypointSourceIdRef.current = recordingWaypointSourceId;

  // 开始录制：进入路径录制模式，后续画布点击将添加航点
  const handleStartWaypointRecording = useCallback((id: number) => {
    setRecordingWaypointSourceId(id);
  }, []);

  // 停止录制
  const handleStopWaypointRecording = useCallback(() => {
    setRecordingWaypointSourceId(null);
  }, []);

  // 画布点击添加航点（由 onClick 调用）
  const handleAddWaypoint = useCallback((point: { x: number; y: number }) => {
    const id = recordingWaypointSourceIdRef.current;
    if (id === null || !editor) return;
    const sources = editor.getContinuousSources();
    const src = sources.find(s => s.id === id);
    if (!src) return;
    const currentWps = src.waypoints ? [...src.waypoints] : [];
    currentWps.push({ x: point.x, y: point.y });
    // 保留原有所有配置（含 density），仅更新 waypoints 相关字段
    editor.updateContinuousInjection(id, {
      ...src.config,
      waypoints: currentWps,
      waypointMode: src.waypointMode || 'forward',
      waypointSpeed: src.waypointSpeed ?? 1.0,
    });
    refreshSources();
  }, [editor, refreshSources]);

  // 清空航点
  const handleClearWaypoints = useCallback((id: number) => {
    if (!editor) return;
    const sources = editor.getContinuousSources();
    const src = sources.find(s => s.id === id);
    if (!src) return;
    // 保留原有所有配置（含 density），清空 waypoints 相关字段
    editor.updateContinuousInjection(id, {
      ...src.config,
      waypoints: undefined,
      waypointMode: undefined,
      waypointSpeed: undefined,
    });
    refreshSources();
  }, [editor, refreshSources]);

  // 更新路径模式
  const handleUpdateWaypointMode = useCallback((id: number, mode: WaypointMode) => {
    if (!editor) return;
    const sources = editor.getContinuousSources();
    const src = sources.find(s => s.id === id);
    if (!src) return;
    // 保留原有所有配置（含 density），仅更新 waypointMode
    editor.updateContinuousInjection(id, {
      ...src.config,
      waypointMode: mode,
      waypointSpeed: src.waypointSpeed ?? 1.0,
    });
    refreshSources();
  }, [editor, refreshSources]);

  // 更新路径速度
  const handleUpdateWaypointSpeed = useCallback((id: number, speed: number) => {
    if (!editor) return;
    const sources = editor.getContinuousSources();
    const src = sources.find(s => s.id === id);
    if (!src) return;
    // 保留原有所有配置（含 density），仅更新 waypointSpeed
    editor.updateContinuousInjection(id, {
      ...src.config,
      waypointSpeed: speed,
    });
    refreshSources();
  }, [editor, refreshSources]);

  // ★ 清空所有持续注入源
  const handleClearAllSources = useCallback(() => {
    if (!editor) return;
    editor.clearContinuousInjections();
    // ★ 清空所有源时也退出路径录制模式
    setRecordingWaypointSourceId(null);
    refreshSources();
  }, [editor, refreshSources]);

  // ★ 暂停/恢复持续注入：仅由手动暂停状态驱动，不影响源队列
  useEffect(() => {
    if (editor) {
      editor.setContinuousInjectionEnabled(!continuousPaused);
    }
  }, [continuousPaused, editor]);

  // ★ 切换暂停/恢复状态
  const handleTogglePaused = useCallback(() => {
    setContinuousPaused((p) => {
      const next = !p;
      if (editor) {
        editor.setContinuousInjectionEnabled(!next);
      }
      return next;
    });
  }, [editor]);

  // ★ 方向 → 标签（8方向文字 + 角度），用于收藏列表显示
  const dirToLabel = (x: number, y: number): string => {
    const mag = Math.sqrt(x * x + y * y);
    if (mag < 0.01) return '⚪ 无方向';
    const deg = (((Math.atan2(y, x) * 180 / Math.PI) % 360) + 360) % 360;
    const dirs = ['→ 右', '↘ 右下', '↓ 下', '↙ 左下', '← 左', '↖ 左上', '↑ 上', '↗ 右上'];
    const idx = Math.round(deg / 45) % 8;
    return `${dirs[idx]} ${deg.toFixed(0)}°`;
  };

  // ★ 保存当前方向到收藏列表
  const handleSaveDirection = useCallback(() => {
    const label = dirToLabel(directionX, directionY);
    setSavedDirections((prev) => [...prev, { x: directionX, y: directionY, label }]);
  }, [directionX, directionY]);

  // ★ 复用收藏方向：设为当前方向 + 同步摇杆方向 ref
  const handleApplyDirection = useCallback((dir: { x: number; y: number }) => {
    setDirectionX(dir.x);
    setDirectionY(dir.y);
    joystickDirRef.current = { x: dir.x, y: dir.y };
  }, []);

  // ★ 清空墙体 handler
  const clearObstaclesHandler = () => {
    if (editor) {
      editor.clearObstacles();
    }
  };

  // ★ 当 editor 实例变化时（如重建），刷新源列表（旧源已不存在，将得到空列表）
  useEffect(() => {
    refreshSources();
  }, [editor, refreshSources]);

  // ==================== 显示循环（计算 + 显示共用一个渲染器） ====================
  useEffect(() => {
    if (!rendererReady || !editor) return;

    // ===== 暴露 editor 到 window 供控制台调试 =====
    (window as any).fluidEditor = editor;

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
        // ★ uMaxVel 控制速度可视化的归一化上限（亮度基准值）。
        //   值越小，低速区域越亮。可通过 UI 滑块手动调整（velViewMax）。
        //   初始值 200：20 px/s → 10% 线性 → pow(0.35) → 45% 亮度
        //   设为 1 时：1 px/s 即满亮度（极灵敏）
        uMaxVel: { value: velViewMaxRef.current },
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
          // ★ 使用更激进的 pow 曲线提升低速区域可见度：
          //   pow(x, 0.35) 让极小值也能变成中等亮度
          //   0.033(20px/600)→0.41  0.1(20px/200)→0.45  0.25(50px/200)→0.63
          float linearLen = min(len / uMaxVel, 1.0);
          float normalizedLen = pow(linearLen, 0.35);

          // ★ 速度可视化（HSV 色相映射，适配大速度范围）：
          //   方向 → 色相（H），速度大小 → 亮度（V）
          //   角度 0°(→) = 红, 90°(↑) = 绿, 180°(←) = 青, 270°(↓) = 蓝
          float angle = atan(vel.y, vel.x);           // [-π, π]
          float hue = (angle / 6.28318530718) + 0.5;  // [0, 1]
          vec3 hsv = vec3(hue, 0.85, normalizedLen);
          // HSV → RGB 转换
          vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
          vec3 p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
          vec3 color = hsv.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsv.y);

          // ★ 整体亮度增强（用户要求即使 20px 也要有亮色）：
          //   1. 颜色乘以 1.3 倍亮度增益
          //   2. 低速区域基础亮度提升到 0.2（保证可见）
          color *= normalizedLen * 1.3;
          color += (1.0 - normalizedLen) * 0.2;
          // 限幅防止过曝
          color = clamp(color, 0.0, 1.0);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    velQuad.material = velMat;
    velScene.add(velQuad);

    // ★ density 场场景（MCSDA 浓缩视口）：灰度显示 density 标量浓度
    //   density.r ∈ [0,1] → 灰度，并叠加基准浓度参考线（红色横线）
    const densityScene = new THREE.Scene();
    const densityQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const densityMat = new THREE.ShaderMaterial({
      uniforms: {
        uDensity: { value: editor.getDensityTexture() },
        uBaseline: { value: scalarConfigRef.current?.baselineDensity ?? 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = vec2(uv.x, 1.0 - uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDensity;
        uniform float uBaseline;
        varying vec2 vUv;

        void main() {
          float d = texture2D(uDensity, vUv).r;
          // 灰度显示 density，高于 baseline 用青色高亮（增强区域），低于则普通灰度
          vec3 color = vec3(d);
          if (d > uBaseline) {
            // 增强：青色调
            color = mix(vec3(d), vec3(0.2, 0.9, 0.9), 0.4);
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    densityQuad.material = densityMat;
    densityScene.add(densityQuad);

    // ★ 障碍物场景：显示墙体掩码纹理
    //   白色=墙体（R>0.5），黑色=流体区域
    //   叠加半透明蓝色调便于观察
    const obstacleScene = new THREE.Scene();
    const obstacleQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const obstacleMat = new THREE.ShaderMaterial({
      uniforms: {
        uObstacle: { value: editor.getObstacleTexture() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = vec2(uv.x, 1.0 - uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uObstacle;
        varying vec2 vUv;

        void main() {
          float wall = texture2D(uObstacle, vUv).r;
          vec3 bgColor = vec3(0.08, 0.08, 0.12);
          vec3 wallColor = vec3(0.7, 0.85, 1.0);
          // 抗锯齿：对墙体边界做 smoothstep 平滑（阈值 0.5，过渡带 0.02）
          float wallSmooth = smoothstep(0.48, 0.52, wall);
          vec3 color = mix(bgColor, wallColor, wallSmooth);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    obstacleQuad.material = obstacleMat;
    obstacleScene.add(obstacleQuad);

    // ★ Level Set φ 场场景：signed distance 可视化
    //   φ < 0 → 内部（红），φ > 0 → 外部（蓝），|φ|≈0 → 零等值线（白）
    //   窄带（|φ| < narrowBandWidth）渐变高亮，用于调试 SDF 是否正确跟踪流体边界
    const levelsetScene = new THREE.Scene();
    const levelsetQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const levelsetMat = new THREE.ShaderMaterial({
      uniforms: {
        uPhi: { value: editor.getLevelSetTexture() },
        uBandWidth: { value: config.levelSetConfig?.narrowBandWidth ?? 5 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = vec2(uv.x, 1.0 - uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPhi;
        uniform float uBandWidth;
        varying vec2 vUv;

        void main() {
          float phi = texture2D(uPhi, vUv).r;
          // φ < 0 内部（红），φ > 0 外部（蓝）
          vec3 insideColor = vec3(0.85, 0.25, 0.25);
          vec3 outsideColor = vec3(0.15, 0.35, 0.85);
          vec3 color = phi < 0.0 ? insideColor : outsideColor;
          // 窄带高亮（|φ| < bandWidth）：渐变到亮色，观察 SDF 窄带范围
          float band = 1.0 - smoothstep(0.0, max(uBandWidth, 0.001), abs(phi));
          color = mix(color, vec3(0.9, 0.95, 1.0), band * 0.4);
          // 零等值线（|φ| < 1px）：白色高亮，即流体边界
          float contour = 1.0 - smoothstep(0.0, 1.0, abs(phi));
          color = mix(color, vec3(1.0), contour * 0.85);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    levelsetQuad.material = levelsetMat;
    levelsetScene.add(levelsetQuad);

    // 合成场景：底图（baseTexture）+ 平流残差（fluid residual）实时混合
    // ★ MCSDA：scalar 模式下残差增量按 density×通道系数 调制后叠加到基础色（uScalarMode=1），
    //   合成 = base + (delta × factor × mul)；vector 模式直接 base + delta（uScalarMode=0）
    const compositeScene = new THREE.Scene();
    const compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        uBaseTexture: { value: null as THREE.Texture | null },
        uResidual: { value: editor.getColorTexture() },
        uResidualRangeH: { value: residualRangeHRef.current },
        uResidualRangeSL: { value: residualRangeSLRef.current },
        // ★ MCSDA scalar 模式 uniforms
        uDensity: { value: editor.getDensityTexture() },            // density 场
        uChannelMul: { value: new THREE.Vector4(1, 1, 1, 1) },      // H/S/L/A 通道系数
        uBaseline: { value: 1.0 },                                  // 基准浓度
        uScalarMode: { value: 0 },                                  // 0=vector, 1=scalar
        uCombineMode: { value: 0 },                                 // 0=add(基础色+增量), 1=sub(基础色-增量)
        uChannels: { value: new THREE.Vector4(1, 1, 1, 1) },        // H/S/L/A 通道开关：1=正常公式, 0=直接输出残差
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
        uniform sampler2D uDensity;      // MCSDA density 场（R 通道，0~1）
        uniform vec4 uChannelMul;        // H/S/L/A 通道系数（-2~2）
        uniform float uBaseline;         // 基准浓度
        uniform int uScalarMode;         // 0=vector（残差直接加），1=scalar（残差×density×mul）
        uniform int uCombineMode;        // 0=add(基础色+增量), 1=sub(基础色-增量)，仅scalar生效
        uniform vec4 uChannels;          // H/S/L/A 通道开关：1=正常公式, 0=直接输出残差值
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

          float finalH, finalS, finalL, finalA;

          if (uScalarMode == 1) {
            // ★ MCSDA scalar 模式：合成 = 基础色 + 残差增量 ± (密度/基准浓度 × 通道系数)
            //   残差增量直接叠加到基础色（与矢量模式相同的解码方式，不被 density 调制）。
            //   density 作为独立项驱动额外偏移：factor = density / baseline
            //     - density < baseline → factor<1，偏移项小（削弱）
            //     - density > baseline → factor>1，偏移项大（增强）
            //     - density = 0 → factor=0，无额外偏移（只显示 base + delta）
            //   combineMode: add=base+delta+factor×mul, sub=base+delta-factor×mul
            //   mul 为各通道系数，控制 density 偏移的方向和强度
            float density = texture2D(uDensity, vUv).r;
            float factor = density / max(uBaseline, 0.001);
            float sign = (uCombineMode == 0) ? 1.0 : -1.0;
            // ★ 残差增量直接加（不乘 factor），density×mul 作为独立项 ±
            finalH = fract(baseHSLA.r + dH + sign * factor * uChannelMul.x);
            finalS = clamp(baseHSLA.g + dS + sign * factor * uChannelMul.y, 0.0, 1.0);
            finalL = clamp(baseHSLA.b + dL + sign * factor * uChannelMul.z, 0.0, 1.0);
            float dA = (residual.a * 2.0 - 1.0) * uResidualRangeSL;
            finalA = clamp(baseHSLA.a + dA + sign * factor * uChannelMul.w, 0.0, 1.0);
          } else {
            // ★ vector 模式（原逻辑）：HSL 直接加法（色相需要 fract 包裹）
            finalH = fract(baseHSLA.r + dH);
            finalS = clamp(baseHSLA.g + dS, 0.0, 1.0);
            finalL = clamp(baseHSLA.b + dL, 0.0, 1.0);
            finalA = baseHSLA.a;
          }

          // ★ 通道开关：关闭的通道直接输出残差值（绕过 base+delta 计算）
          //   uChannels.x=0 → finalH = residual.r（残差原值，不含基础色）
          //   uChannels.x=1 → finalH = 正常公式（base + delta ± factor×mul）
          //   mix(a, b, 0)=a, mix(a, b, 1)=b，无分支，GPU 友好
          finalH = mix(residual.r, finalH, uChannels.x);
          finalS = mix(residual.g, finalS, uChannels.y);
          finalL = mix(residual.b, finalL, uChannels.z);
          finalA = mix(residual.a, finalA, uChannels.w);

          // 只在最后一步转 RGB 用于显示
          vec3 finalRGB = hsl_to_rgb(vec3(finalH, finalS, finalL));
          gl_FragColor = vec4(finalRGB, finalA);
        }
      `,
      transparent: true,
    });
    compositeQuad.material = compositeMat;
    compositeScene.add(compositeQuad);

    // 底图纹理更新函数（同步读取 Store，缓存避免每帧重建）
    const updateBaseTexture = () => {
      // ★ 独立 FTX 导入模式：保留手动上传的纹理，不读 store
      if (baseLayerIdRef.current === '__ftx_import__') {
        if (baseTexRef.current) return;  // 纹理还在，直接用
        // 纹理被 effect 重建清掉了，从备份恢复
        const backup = ftxBaseDataRef.current;
        if (backup) {
          const tex = new THREE.DataTexture(
            backup.data, backup.width, backup.height,
            THREE.RGBAFormat, THREE.FloatType,
          );
          tex.needsUpdate = true;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.flipY = false;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.colorSpace = THREE.LinearSRGBColorSpace;
          baseTexRef.current = tex;
        }
        return;
      }

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
    };

    let frameCount = 0;

    // ★ 持续注入点可视化绘制函数
    const drawContinuousSourcesOverlay = () => {
      const overlay = overlayCanvasRef.current;
      const display = displayCanvasRef.current;
      if (!overlay || !display) return;

      // 同步 overlay 尺寸到 display 的实际渲染尺寸（CSS 像素）
      const rect = display.getBoundingClientRect();
      const cssW = rect.width;
      const cssH = rect.height;
      if (overlay.width !== Math.round(cssW) || overlay.height !== Math.round(cssH)) {
        overlay.width = Math.round(cssW);
        overlay.height = Math.round(cssH);
        overlay.style.width = `${cssW}px`;
        overlay.style.height = `${cssH}px`;
      }

      const ctx = overlay.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);

      // 读取持续注入源快照
      const sources = editor.getContinuousSources();
      if (sources.length === 0) return;

      for (const src of sources) {
        if (!src.enabled) continue;
        // 归一化位置 → overlay 像素（Y 向下为正，与画布一致）
        const cx = src.position.x * overlay.width;
        const cy = src.position.y * overlay.height;
        const r = src.radius * Math.min(overlay.width, overlay.height);

        // 1. 绘制半径圆圈（半透明填充 + 描边）
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(41, 182, 246, 0.15)';
        ctx.fill();
        ctx.strokeStyle = '#29b6f6';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 2. 绘制中心点
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#1976d2';
        ctx.fill();

        // 3. 绘制速度箭头
        // 注意：adaptInjectionConfig 已改为直接透传速度（不再 Y 取反），
        // 所以 src.velocity 就是用户视角速度（Y 向下为正），直接使用即可
        const userVelX = src.velocity.x;
        const userVelY = src.velocity.y;
        const velMag = Math.sqrt(userVelX * userVelX + userVelY * userVelY);
        if (velMag > 0.1) {
          // 箭头长度：速度大小映射到像素（最大 60px）
          const arrowLen = Math.min(velMag / 4, 60);
          const dirX = userVelX / velMag;
          const dirY = userVelY / velMag;
          const endX = cx + dirX * arrowLen;
          const endY = cy + dirY * arrowLen;

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(endX, endY);
          ctx.strokeStyle = '#f44336';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // 箭头头部
          const angle = Math.atan2(dirY, dirX);
          const headLen = 8;
          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(
            endX - headLen * Math.cos(angle - Math.PI / 6),
            endY - headLen * Math.sin(angle - Math.PI / 6),
          );
          ctx.moveTo(endX, endY);
          ctx.lineTo(
            endX - headLen * Math.cos(angle + Math.PI / 6),
            endY - headLen * Math.sin(angle + Math.PI / 6),
          );
          ctx.strokeStyle = '#f44336';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // 4. 绘制源 ID 标签
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeStyle = '#1976d2';
        ctx.lineWidth = 3;
        ctx.font = 'bold 11px monospace';
        const label = `#${src.id}`;
        const labelX = cx + 8;
        const labelY = cy - 8;
        ctx.strokeText(label, labelX, labelY);
        ctx.fillText(label, labelX, labelY);

        // 5. ★ 路径点可视化：绘制航点连线 + 编号点
        const wps = src.waypoints;
        if (wps && wps.length > 0) {
          const mode = src.waypointMode || 'forward';
          // 绘制连线（虚线）
          ctx.beginPath();
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = 'rgba(255, 235, 59, 0.7)';
          ctx.lineWidth = 1.5;
          for (let i = 0; i < wps.length; i++) {
            const wx = wps[i].x * overlay.width;
            const wy = wps[i].y * overlay.height;
            if (i === 0) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
          }
          // 正序/逆序模式闭合路径
          if (mode === 'forward' || mode === 'backward') {
            ctx.lineTo(wps[0].x * overlay.width, wps[0].y * overlay.height);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // 绘制航点（编号圆点）
          for (let i = 0; i < wps.length; i++) {
            const wx = wps[i].x * overlay.width;
            const wy = wps[i].y * overlay.height;
            ctx.beginPath();
            ctx.arc(wx, wy, 5, 0, Math.PI * 2);
            ctx.fillStyle = i === 0 ? '#4caf50' : '#ffeb3b';
            ctx.fill();
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // 编号
            ctx.fillStyle = '#333';
            ctx.font = 'bold 9px monospace';
            ctx.fillText(`${i + 1}`, wx - 3, wy + 3);
          }
        }
      }
    };

    // ★ 摇杆可视化：在 overlay canvas 上绘制手柄摇杆（按下画布时显示）
    //   底圈 + 死区 + 十字参考 + 方向箭头 + 手柄圆 + 角度文字
    const drawJoystick = () => {
      if (!joystickActiveRef.current) return;
      const overlay = overlayCanvasRef.current;
      const display = displayCanvasRef.current;
      if (!overlay || !display) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;

      const cx = joystickOriginRef.current.cssX;
      const cy = joystickOriginRef.current.cssY;
      const R = JOYSTICK_RADIUS;
      const dir = joystickDirRef.current;
      const dirMag = Math.sqrt(dir.x * dir.x + dir.y * dir.y);

      // 1. 外圈底圈（半透明填充 + 描边）
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(41, 182, 246, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(41, 182, 246, 0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 2. 死区参考圈（半径 5px，死区内方向归零）
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 3. 十字参考线
      ctx.beginPath();
      ctx.moveTo(cx - R, cy);
      ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R);
      ctx.lineTo(cx, cy + R);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 4. 中心点
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#1976d2';
      ctx.fill();

      // 5. 方向箭头 + 手柄（方向非零时）
      if (dirMag > 0.001) {
        const handleX = cx + dir.x * R;
        const handleY = cy + dir.y * R;

        // 方向线（中心 → 手柄）
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(handleX, handleY);
        ctx.strokeStyle = '#f44336';
        ctx.lineWidth = 3;
        ctx.stroke();

        // 箭头头部
        const angle = Math.atan2(dir.y, dir.x);
        const headLen = 10;
        ctx.beginPath();
        ctx.moveTo(handleX, handleY);
        ctx.lineTo(
          handleX - headLen * Math.cos(angle - Math.PI / 6),
          handleY - headLen * Math.sin(angle - Math.PI / 6),
        );
        ctx.moveTo(handleX, handleY);
        ctx.lineTo(
          handleX - headLen * Math.cos(angle + Math.PI / 6),
          handleY - headLen * Math.sin(angle + Math.PI / 6),
        );
        ctx.strokeStyle = '#f44336';
        ctx.lineWidth = 3;
        ctx.stroke();

        // 手柄圆（实心）
        ctx.beginPath();
        ctx.arc(handleX, handleY, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#f44336';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 方向角度 + 矢量文字
        const deg = (Math.atan2(dir.y, dir.x) * 180 / Math.PI + 360) % 360;
        const label = `${deg.toFixed(0)}°  (${dir.x.toFixed(2)}, ${dir.y.toFixed(2)})`;
        const labelX = cx + R + 8;
        const labelY = cy - R - 4;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = '#1976d2';
        ctx.lineWidth = 3;
        ctx.font = 'bold 12px monospace';
        ctx.strokeText(label, labelX, labelY);
        ctx.fillText(label, labelX, labelY);
      } else {
        // 死区：手柄在中心，显示无方向
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#9e9e9e';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        const label = '⚪ 无方向（死区）';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = '#9e9e9e';
        ctx.lineWidth = 3;
        ctx.font = 'bold 12px monospace';
        ctx.strokeText(label, cx + R + 8, cy - R - 4);
        ctx.fillText(label, cx + R + 8, cy - R - 4);
      }
    };

    // ★ 墙体笔刷光标绘制（在 obstacle 视口下显示鼠标位置的笔刷预览圈）
    const drawWallBrushCursor = () => {
      if (viewModeRef.current !== 'obstacle') return;
      const overlay = overlayCanvasRef.current;
      const display = displayCanvasRef.current;
      if (!overlay || !display) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;

      const rect = display.getBoundingClientRect();
      // 使用 pointerPosRef 中的位置（归一化坐标）
      const pos = pointerPosRef.current;
      const cssX = pos.x * rect.width;
      const cssY = pos.y * rect.height;
      const minRadius = 2 / Math.max(config.resolution.w, config.resolution.h);
      const effectiveRadius = Math.max(wallBrushRadiusRef.current, minRadius);
      const cssRadius = effectiveRadius * Math.max(rect.width, rect.height);

      // 绘制笔刷预览圈
      ctx.beginPath();
      ctx.arc(cssX, cssY, cssRadius, 0, Math.PI * 2);
      if (wallBrushModeRef.current === 'brush') {
        ctx.fillStyle = 'rgba(100, 180, 255, 0.15)';
        ctx.strokeStyle = 'rgba(100, 180, 255, 0.8)';
      } else {
        ctx.fillStyle = 'rgba(255, 150, 150, 0.15)';
        ctx.strokeStyle = 'rgba(255, 150, 150, 0.8)';
      }
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      // 中心点
      ctx.beginPath();
      ctx.arc(cssX, cssY, 2, 0, Math.PI * 2);
      ctx.fillStyle = wallBrushModeRef.current === 'brush' ? '#64b4ff' : '#ff9696';
      ctx.fill();
    };

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
      // ★ 同步速度场亮度基准值（每帧从 ref 读取，确保滑块改动实时生效）
      velMat.uniforms.uMaxVel.value = velViewMaxRef.current;
      // ★ density 场纹理与基准浓度同步（浓缩视口用）
      densityMat.uniforms.uDensity.value = editor.getDensityTexture();
      densityMat.uniforms.uBaseline.value = scalarConfigRef.current?.baselineDensity ?? 1.0;

      // ★ MCSDA：同步合成着色器的 scalar 模式 uniforms（每帧从 ref 读取，滑块实时生效）
      const _sc = scalarConfigRef.current;
      const _isScalar = advectionModeRef.current === 'scalar';
      compositeMat.uniforms.uDensity.value = editor.getDensityTexture();
      (compositeMat.uniforms.uChannelMul.value as THREE.Vector4).set(
        _sc?.hMultiplier ?? 1,
        _sc?.sMultiplier ?? 1,
        _sc?.lMultiplier ?? 1,
        _sc?.aMultiplier ?? 1,
      );
      compositeMat.uniforms.uBaseline.value = _sc?.baselineDensity ?? 1.0;
      compositeMat.uniforms.uScalarMode.value = _isScalar ? 1 : 0;
      compositeMat.uniforms.uCombineMode.value = (config.combineMode ?? 'add') === 'sub' ? 1 : 0;
      compositeMat.uniforms.uChannels.value.set(
        config.channels.r ? 1 : 0,
        config.channels.g ? 1 : 0,
        config.channels.b ? 1 : 0,
        config.channels.a ? 1 : 0,
      );

      // 合成模式：更新底图纹理和残差范围
      if (viewMode === 'composite') {
        updateBaseTexture();
        compositeMat.uniforms.uBaseTexture.value = baseTexRef.current;
        compositeMat.uniforms.uResidual.value = editor.getColorTexture();
        compositeMat.uniforms.uResidualRangeH.value = residualRangeHRef.current;
        compositeMat.uniforms.uResidualRangeSL.value = residualRangeSLRef.current;
        if ((window as any).__dbgFTX === undefined) {
          (window as any).__dbgFTX = 1;
          console.log('[FTX复合] baseTex:', baseTexRef.current, '残差纹理尺寸:', (editor.getColorTexture() as any)?.image?.width ?? '?');
        }
      }

      // ★ 障碍物模式：每帧同步障碍物纹理（启用后 obstacleTarget 会被懒创建）
      if (viewMode === 'obstacle') {
        obstacleMat.uniforms.uObstacle.value = editor.getObstacleTexture();
      }

      // ★ Level Set 模式：每帧同步 φ 场纹理（phiGrid.read 会 swap）和窄带宽度
      if (viewMode === 'levelset') {
        levelsetMat.uniforms.uPhi.value = editor.getLevelSetTexture();
        levelsetMat.uniforms.uBandWidth.value = config.levelSetConfig?.narrowBandWidth ?? 5;
      }

      // 根据视图模式选择渲染场景
      let targetScene: THREE.Scene;
      if (viewMode === 'color') targetScene = colorScene;
      else if (viewMode === 'velocity') targetScene = velScene;
      else if (viewMode === 'density') targetScene = densityScene;
      else if (viewMode === 'obstacle') targetScene = obstacleScene;
      else if (viewMode === 'levelset') targetScene = levelsetScene;
      else targetScene = compositeScene;
      renderer.render(targetScene, camera);

      // ★ 单次模式鼠标长按：每帧临时持续注入（按住期间注入，松开即停）
      if (
        pointerDownRef.current &&
        !continuousModeRef.current &&
        injectModeRef.current !== 'stamp' &&
        !continuousPausedRef.current &&
        viewModeRef.current !== 'obstacle'
      ) {
        const injectConfig = buildInjectionConfigRef.current(pointerPosRef.current);
        editor.queueInjection(injectConfig);
      }

      // ★ 墙体绘制模式：每帧在当前位置持续涂抹（用于 rAF 循环保持连续绘制）
      if (
        pointerDownRef.current &&
        viewModeRef.current === 'obstacle'
      ) {
        const value = wallBrushModeRef.current === 'brush' ? 255 : 0;
        const minRadius = 2 / Math.max(config.resolution.w, config.resolution.h);
        const effectiveRadius = Math.max(wallBrushRadiusRef.current, minRadius);
        editor.updateObstacle(pointerPosRef.current, effectiveRadius, value as 0 | 255);
      }

      // ★ 持续注入点可视化：在 overlay canvas 上绘制注入源位置、半径、速度箭头
      //   受 showInjectionUI 开关控制（用户可隐藏以免遮挡画布）
      //   路径录制模式下强制显示（用户需要看到已添加的航点）
      if (showInjectionUIRef.current || recordingWaypointSourceIdRef.current !== null) {
        drawContinuousSourcesOverlay();
      } else {
        // 隐藏时清空 overlay，避免残留旧绘制
        const overlay = overlayCanvasRef.current;
        if (overlay) {
          const ctx = overlay.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
        }
      }

      // ★ 注入源高亮：点击列表项后在画布上脉冲高亮对应源（不受 showInjectionUI 影响）
      const now = performance.now();
      const hlId = highlightedSourceIdRef.current;
      if (hlId !== null && now < highlightExpireRef.current) {
        const overlay = overlayCanvasRef.current;
        const display = displayCanvasRef.current;
        if (overlay && display) {
          const rect = display.getBoundingClientRect();
          const cssW = rect.width;
          const cssH = rect.height;
          if (overlay.width !== Math.round(cssW) || overlay.height !== Math.round(cssH)) {
            overlay.width = Math.round(cssW);
            overlay.height = Math.round(cssH);
            overlay.style.width = `${cssW}px`;
            overlay.style.height = `${cssH}px`;
          }
          const ctx = overlay.getContext('2d');
          if (ctx) {
            const sources = editor.getContinuousSources();
            const src = sources.find(s => s.id === hlId);
            if (src) {
              const cx = src.position.x * overlay.width;
              const cy = src.position.y * overlay.height;
              const r = src.radius * Math.min(overlay.width, overlay.height);
              // 脉冲动画：剩余时间占比 → 透明度+缩放
              const remain = (highlightExpireRef.current - now) / 2500; // 1→0
              const pulse = 0.5 + 0.5 * Math.sin(now * 0.012); // 0~1 脉冲
              const alpha = remain * (0.4 + 0.4 * pulse);
              const expandR = r * (1.3 + 0.3 * pulse);
              // 外圈脉冲环
              ctx.beginPath();
              ctx.arc(cx, cy, expandR, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(255, 235, 59, ${alpha})`; // 黄色脉冲
              ctx.lineWidth = 3 + 2 * pulse;
              ctx.stroke();
              // 内圈高亮
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(255, 235, 59, ${alpha * 0.3})`;
              ctx.fill();
              ctx.strokeStyle = `rgba(255, 152, 0, ${alpha})`; // 橙色描边
              ctx.lineWidth = 2.5;
              ctx.stroke();
              // ID 标签
              ctx.fillStyle = `rgba(255, 235, 59, ${alpha})`;
              ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.7})`;
              ctx.lineWidth = 3;
              ctx.font = 'bold 16px monospace';
              const label = `#${src.id}`;
              ctx.strokeText(label, cx + 12, cy - 12);
              ctx.fillText(label, cx + 12, cy - 12);
            }
          }
        }
      } else if (hlId !== null) {
        // 高亮过期，清除
        highlightedSourceIdRef.current = null;
      }
      // ★ 摇杆可视化：按下画布时在 overlay canvas 上绘制手柄摇杆
      drawJoystick();
      // ★ 墙体笔刷光标：在 obstacle 视口下显示笔刷位置和大小预览
      drawWallBrushCursor();

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
      densityMat.dispose();
      densityQuad.geometry.dispose();
      compositeMat.dispose();
      compositeQuad.geometry.dispose();
      baseTexRef.current?.dispose();
      baseTexRef.current = null;
      // ★ 独立 FTX 导入：保留 baseLayerIdRef 标记，让 updateBaseTexture 从备份恢复
      if (baseLayerIdRef.current !== '__ftx_import__') {
        baseLayerIdRef.current = null;
      }
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

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        // 计算该像素所属的自适应分块索引（使用局部坐标，正确）
        const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
        // 判断该块的量化范围
        const range = getRangeForBlock(blockFlags, blockIdx);

        if (range === 0.25) {
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
        }
      }
    }

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

  // ★ FTX 自主文件导入状态
  const ftxFileInputRef = useRef<HTMLInputElement | null>(null);
  const [ftxFrames, setFtxFrames] = useState<any[]>([]);
  const [selectedFtxIndex, setSelectedFtxIndex] = useState(-1);

  const handleFtxFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let buffer = await file.arrayBuffer();
      const raw = new Uint8Array(buffer);
      const isGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
      if (isGzip) {
        const blob = new Blob([raw]);
        const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
        buffer = await new Response(stream).arrayBuffer();
      }
      const { unpackMultiFrameFromBinary } = await import('../../utils/binaryCompression');
      const { palette: ftxPalette, frames: ftxRawFrames } = unpackMultiFrameFromBinary(buffer);
      if (ftxRawFrames.length === 0) { alert('FTX 文件不含任何帧'); return; }
      const mappedFrames = ftxRawFrames.map((f: any, i: number) => ({ ...f, _palette: ftxPalette }));
      setFtxFrames(mappedFrames);
      setSelectedFtxIndex(-1);
      // ★ 自动加载第一帧（窗口变大 + 显示内容）
      if (mappedFrames.length > 0) {
        loadFtxFrame(mappedFrames[0], 0);
      }
    } catch (err) {
      console.error('[FluidEditor] FTX导入失败:', err);
      alert('导入失败: ' + (err as Error).message);
    }
    e.target.value = '';
  };

  /** 加载指定 FTX 帧到流体编辑器 */
  const loadFtxFrame = (frame: any, index: number) => {
    setSelectedFtxIndex(index);
    if (!editor) return;
    const palette = frame._palette as { h: number; s: number; l: number; id: number }[];
    const regionIdTex = frame.regionIdTex as Uint8Array;
    const deltaPacked = frame.deltaPacked as Uint16Array;
    const bbox = frame.bbox as { x: number; y: number; w: number; h: number };
    const blockFlags = frame.blockFlags as bigint;
    const sourceResolution = frame.width as number;
    const { baseHslData, baseTexture: newBase, residualTexture: newResidual } = buildFluidTexturesFromRawFrame(
      { rawRegionIdTex: regionIdTex, rawDeltaPacked: deltaPacked, rawBbox: bbox, rawBlockFlags: blockFlags, sourceResolution },
      palette,
    );
    const texSize = sourceResolution || 512;
    if (config.resolution.w !== texSize || config.resolution.h !== texSize) {
      updateConfig({ resolution: { w: texSize, h: texSize } });
    }
    stashedResidualRef.current = new ImageData(new Uint8ClampedArray(newResidual.data), newResidual.width, newResidual.height);
    stashedResidualWRef.current = newResidual.width;
    stashedResidualHRef.current = newResidual.height;
    stashedBaseHslRef.current = new Float32Array(baseHslData.data);
    stashedBaseRef.current = new ImageData(new Uint8ClampedArray(newBase.data), newBase.width, newBase.height);
    stashedBaseWRef.current = newBase.width;
    stashedBaseHRef.current = newBase.height;

    // ★ 上传 baseHslData 到 GPU（合成视图依赖）
    baseTexRef.current?.dispose();
    const baseTex = new THREE.DataTexture(
      baseHslData.data, baseHslData.width, baseHslData.height,
      THREE.RGBAFormat, THREE.FloatType,
    );
    baseTex.needsUpdate = true;
    baseTex.minFilter = THREE.LinearFilter;
    baseTex.magFilter = THREE.LinearFilter;
    baseTex.flipY = false;
    baseTex.wrapS = THREE.ClampToEdgeWrapping;
    baseTex.wrapT = THREE.ClampToEdgeWrapping;
    baseTex.colorSpace = THREE.LinearSRGBColorSpace;
    baseTexRef.current = baseTex;
    baseLayerIdRef.current = '__ftx_import__';
    // ★ 备份数据（effect 因 viewMode 变化重建后会清空纹理，用它恢复）
    ftxBaseDataRef.current = {
      data: new Float32Array(baseHslData.data),
      width: baseHslData.width,
      height: baseHslData.height,
    };
    console.log('[FTX导入] baseHslData 尺寸:', baseHslData.width, 'x', baseHslData.height,
      '非零像素:', Array.from(baseHslData.data).filter((v, i) => i % 4 === 3 && v > 0).length);
    editor.initFields();
    updateConfig({
      injection: { ...config.injection, enabled: false },
      gravity: { x: 0, y: 0 },
      enableAdvection: false,
      colorBoundaryMode: 'clamp',
    });
    const adjustedResidual = adjustResidualForUniformRange(newResidual, bbox, blockFlags);
    editor.initializeColorFromImageData(adjustedResidual);
    setTimeout(() => { updateConfig({ enableAdvection: true }); }, 100);
    setView('composite');
  };
  return (
    <div className="fluid-editor-ui">
      {/* 左侧面板 */}
      <div className="fluid-sidebar">
        {/* 操作模块（置顶 - 鼠标注入） */}
        <OperationsPanel
          config={config}
          onConfigChange={updateConfig}
          injectMode={injectMode}
          setInjectMode={setInjectMode}
          injectRadius={injectRadius}
          setInjectRadius={setInjectRadius}
          injectStrength={injectStrength}
          setInjectStrength={setInjectStrength}
          continuousMode={continuousMode}
          setContinuousMode={setContinuousMode}
          directionX={directionX}
          directionY={directionY}
          speedMagnitude={speedMagnitude}
          setSpeedMagnitude={setSpeedMagnitude}
          savedDirections={savedDirections}
          onSaveDirection={handleSaveDirection}
          onApplyDirection={handleApplyDirection}
          sources={continuousSources}
          onRemoveSource={handleRemoveSource}
          onClearAllSources={handleClearAllSources}
          onHighlightSource={handleHighlightSource}
          onUpdateSourceWave={handleUpdateSourceWave}
          recordingWaypointSourceId={recordingWaypointSourceId}
          onStartWaypointRecording={handleStartWaypointRecording}
          onStopWaypointRecording={handleStopWaypointRecording}
          onClearWaypoints={handleClearWaypoints}
          onUpdateWaypointMode={handleUpdateWaypointMode}
          onUpdateWaypointSpeed={handleUpdateWaypointSpeed}
          continuousPaused={continuousPaused}
          onTogglePaused={handleTogglePaused}
        />

        {/* FTX 帧数据加载 */}
        <div className="fluid-panel">
          <div className="panel-header">
            <span>📥 FTX 帧导入</span>
          </div>
          <div className="panel-body">
            <input ref={ftxFileInputRef} type="file" accept=".ftx3.gz,.ftx3,.ftx" style={{ display: 'none' }} onChange={handleFtxFileImport} />
            <button
              onClick={() => ftxFileInputRef.current?.click()}
              style={{
                width: '100%', padding: '8px',
                background: '#52c41a', color: '#fff', border: 'none',
                borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
              }}
            >
              📦 导入 FTX 文件
            </button>
            <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
              手动选择 .ftx3.gz 文件，独立解析帧数据（不影响主画布）
            </div>
            {ftxFrames.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '11px', color: '#ccc', marginBottom: '4px' }}>帧选择（共 {ftxFrames.length} 帧）</div>
                <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #333', borderRadius: '4px' }}>
                  {ftxFrames.map((f, i) => (
                    <div key={i} onClick={() => { loadFtxFrame(f, i); }}
                      style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer', background: i === selectedFtxIndex ? '#2c6ecb' : 'transparent', color: i === selectedFtxIndex ? '#fff' : '#ddd', borderBottom: '1px solid #222' }}>
                      {i + 1}. {f.name || `帧 ${i + 1}`}{i === selectedFtxIndex ? ' ●' : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 通用设置 */}
        <GeneralPanel
          config={config}
          viewMode={viewMode}
          onConfigChange={updateConfig}
          onViewChange={setView}
          onReset={reset}
          velViewMax={velViewMax}
          setVelViewMax={setVelViewMax}
          wallBrushMode={wallBrushMode}
          setWallBrushMode={setWallBrushMode}
          wallBrushRadius={wallBrushRadius}
          setWallBrushRadius={setWallBrushRadius}
          onClearObstacles={clearObstaclesHandler}
          showInjectionUI={showInjectionUI}
          setShowInjectionUI={setShowInjectionUI}
          onExportConfig={() => {
            // ★ 导出流体库物理配方 JSON（五大块），供轻量化无头流体库加载
            //   仅含物理参数 + 持续注入源列表，不含速度场/颜色场数据
            const cfg = config;
            const sources = continuousSources;
            const recipe = {
              // A. 核心开关
              coreSwitches: {
                enableAdvection: cfg.enableAdvection,
                enablePressure: cfg.enablePressure,
                pressureIterations: cfg.pressureIterations,
                pressureOmega: cfg.pressureOmega,
                pressureBoundaryMode: cfg.pressureBoundaryMode,
                enableWarmStart: cfg.enableWarmStart,
              },
              // B. 平流模式与合成逻辑
              advectionAndComposite: {
                advectionMode: cfg.advectionMode,
                combineMode: cfg.combineMode,
                // 通道掩码：物理 RGBA → 逻辑 HSLA（R=H, G=S, B=L, A=Alpha）
                channels: { h: cfg.channels.r, s: cfg.channels.g, l: cfg.channels.b, a: cfg.channels.a },
                scalarConfig: cfg.scalarConfig,
              },
              // C. 全局环境力场
              globalForce: {
                gravity: cfg.gravity,
                velocityScale: cfg.velocityScale ?? 1,
                maxVelocity: cfg.maxVelocity ?? 5000,
                colorBoundaryMode: cfg.colorBoundaryMode ?? 'clamp',
              },
              // D. Level Set
              levelSet: {
                enableLevelSet: cfg.enableLevelSet,
              },
              // E. 持续注入源列表
              continuousSources: sources.map(s => ({
                enabled: s.enabled,
                position: s.position,
                radius: s.radius,
                rate: s.rate,
                velocity: s.velocity,
                color: s.color,
                density: s.density,  // ★ 标量模式核心参数：浓度值
                wave: s.wave,
                waypoints: s.waypoints,
                waypointMode: s.waypointMode,
                waypointSpeed: s.waypointSpeed,
              })),
              // 网格分辨率（轻量化库建场需要）
              resolution: cfg.resolution,
            } as any;

            // ★ 新增：墙纹理导出（位图压缩，1 bit / 像素）
            if (editor) {
              const obstacleBitmap = editor.getObstacleBitmap();
              if (obstacleBitmap) {
                recipe.obstacle = {
                  width: obstacleBitmap.width,
                  height: obstacleBitmap.height,
                  data: uint8ToBase64(obstacleBitmap.data), // Base64 编码的位图
                };
              } else {
                recipe.obstacle = null; // 未启用墙体
              }
            }

            const json = JSON.stringify(recipe, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fluid-config-${Date.now()}.json`;
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
          onReinitChange={(val) => {
            setLevelsetParams(p => ({ ...p, reinitInterval: val }));
            updateConfig({ levelSetConfig: { ...config.levelSetConfig, reinitInterval: val } as NonNullable<typeof config.levelSetConfig> });
          }}
          onBandWidthChange={(val) => {
            setLevelsetParams(p => ({ ...p, narrowBandWidth: val }));
            updateConfig({ levelSetConfig: { ...config.levelSetConfig, narrowBandWidth: val } as NonNullable<typeof config.levelSetConfig> });
          }}
          onTensionChange={(val) => {
            setLevelsetParams(p => ({ ...p, surfaceTension: val }));
            updateConfig({ levelSetConfig: { ...config.levelSetConfig, surfaceTension: val } as NonNullable<typeof config.levelSetConfig> });
          }}
        />
      </div>

      {/* 视口 */}
      <div className="fluid-viewport">
        {/* ★ 路径录制浮动按钮：录制激活时显示，一键停止 */}
        {recordingWaypointSourceId !== null && (
          <button
            onClick={() => setRecordingWaypointSourceId(null)}
            style={{
              position: 'absolute',
              top: '8px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 100,
              padding: '8px 20px',
              borderRadius: '20px',
              border: '2px solid #f44336',
              background: 'rgba(244, 67, 54, 0.9)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              animation: 'pulse-rec 1.5s ease-in-out infinite',
            }}
            title="停止录制路径"
          >
            ⏹ 停止录制 (源 #{recordingWaypointSourceId}) — 已添加航点
          </button>
        )}
        <div className="canvas-wrapper">
        <canvas
          ref={displayCanvasRef}
          onMouseDown={handlePointerDown}
          onMouseUp={handlePointerUp}
          onMouseMove={handlePointerMove}
          onMouseLeave={handlePointerLeave}
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

            // 计算归一化坐标 (0~1, Y 向下)
            const normX = cssX / rect.width;
            const normY = cssY / rect.height;

            // ★ 路径录制模式：优先拦截，点击画布添加航点
            if (recordingWaypointSourceIdRef.current !== null) {
              handleAddWaypoint({ x: normX, y: normY });
              return;
            }

            // ★ 根据注入模式执行注入
            if (injectMode === 'stamp') {
              // ====== 残差印章模式：从FTX原始残差纹理采样噪点块注入 ======
              const srcResidual = stashedResidualRef.current;
              if (!srcResidual) {
                console.warn('[残差印章] 请先加载FTX帧数据（导入多帧底图）');
                return;
              }

              const { w, h } = config.resolution;
              const srcWidth = stashedResidualWRef.current;
              const srcHeight = stashedResidualHRef.current;

              // 1. 创建掩码Canvas (分辨率与流体网格一致)
              const maskCanvas = document.createElement('canvas');
              maskCanvas.width = w;
              maskCanvas.height = h;
              const maskCtx = maskCanvas.getContext('2d')!;
              maskCtx.fillStyle = 'black';
              maskCtx.fillRect(0, 0, w, h);

              // 2. 创建颜色Canvas (同样分辨率)
              const colorCanvas = document.createElement('canvas');
              colorCanvas.width = w;
              colorCanvas.height = h;
              const colorCtx = colorCanvas.getContext('2d')!;
              colorCtx.clearRect(0, 0, w, h);

              // 3. 生成随机块状区域
              const numRects = 15 + Math.floor(Math.random() * 25); // 15~40块
              const radiusPx = injectRadius * Math.min(w, h);
              const centerPxX = normX * w;
              const centerPxY = normY * h; // 所有坐标系 Y 方向一致（Y向下），无需翻转

              for (let i = 0; i < numRects; i++) {
                const rw = (0.1 + Math.random() * 0.3) * radiusPx * 2;
                const rh = (0.1 + Math.random() * 0.3) * radiusPx * 2;
                const rx = centerPxX + (Math.random() - 0.5) * radiusPx * 2 - rw / 2;
                const ry = centerPxY + (Math.random() - 0.5) * radiusPx * 2 - rh / 2;
                // 裁剪到画布内
                const cx = Math.max(0, Math.min(w, rx));
                const cy = Math.max(0, Math.min(h, ry));
                const cw = Math.min(w - cx, rw);
                const ch = Math.min(h - cy, rh);
                if (cw < 1 || ch < 1) continue;
                // 在掩码上绘制白色矩形
                maskCtx.fillStyle = 'white';
                maskCtx.fillRect(cx, cy, cw, ch);
              }

              // 4. 扫描掩码，填充颜色Canvas
              const maskData = maskCtx.getImageData(0, 0, w, h);
              const colorData = colorCtx.getImageData(0, 0, w, h);
              const srcData = srcResidual.data;

              // 随机扰动范围 (量化值 0~255)
              const noiseRange = 8; // ±8

              for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                  const idx = (y * w + x) * 4;
                  if (maskData.data[idx] === 0) continue; // 不在掩码内

                  // 映射到原残差纹理坐标
                  const srcX = Math.floor((x / w) * srcWidth);
                  const srcY = Math.floor((y / h) * srcHeight);
                  const srcIdx = (srcY * srcWidth + srcX) * 4;
                  // 读取 R, G, B (量化残差)
                  let r = srcData[srcIdx];
                  let g = srcData[srcIdx + 1];
                  let b = srcData[srcIdx + 2];
                  // 加上随机扰动
                  r = Math.max(0, Math.min(255, r + (Math.random() - 0.5) * noiseRange * 2));
                  g = Math.max(0, Math.min(255, g + (Math.random() - 0.5) * noiseRange * 2));
                  b = Math.max(0, Math.min(255, b + (Math.random() - 0.5) * noiseRange * 2));
                  // 写入颜色Canvas
                  colorData.data[idx] = r;
                  colorData.data[idx + 1] = g;
                  colorData.data[idx + 2] = b;
                  colorData.data[idx + 3] = 255; // 完全不透明
                }
              }
              colorCtx.putImageData(colorData, 0, 0);

              // 5. 创建 THREE.DataTexture
              const colorTex = new THREE.DataTexture(
                new Uint8Array(colorData.data.buffer, colorData.data.byteOffset, colorData.data.byteLength),
                w, h,
                THREE.RGBAFormat,
                THREE.UnsignedByteType
              );
              colorTex.needsUpdate = true;
              colorTex.flipY = false;

              const maskTex = new THREE.DataTexture(
                new Uint8Array(maskData.data.buffer, maskData.data.byteOffset, maskData.data.byteLength),
                w, h,
                THREE.RGBAFormat,
                THREE.UnsignedByteType
              );
              maskTex.needsUpdate = true;
              maskTex.flipY = false;

              // 6. 注入（使用 injectStrength 作为混合率）
              const rate = Math.min(1.0, Math.max(0.0, injectStrength));
              editor.injectColorTexture(colorTex, maskTex, rate);

              // 清理临时纹理
              colorTex.dispose();
              maskTex.dispose();

              console.log(`[残差印章] 注入完成: ${numRects}块, 半径=${injectRadius.toFixed(2)}, 强度=${rate.toFixed(2)}`);
              // 清理临时 canvas
              colorCanvas.remove();
              maskCanvas.remove();
              return; // 结束本次点击，不执行后续持续注入逻辑
            }

            // ★ 持续/单次注入已在 onMouseDown（摇杆按下）中处理：
            //   - 持续模式：按下即新增源，拖动实时改方向
            //   - 单次模式：按住期间持续注入，松开停止
            // 此处 onClick 仅执行采样逻辑（显示像素比较器）

            // 像素坐标用于采样
            const texX = pixX;
            const texY = pixY;

            // 1. 采样模拟器颜色场（残差）
            const simSample = editor.samplePixel(texX, texY);
            const simResidual = { h: simSample.residualH, s: simSample.residualS, l: simSample.residualL };
            const velMag = Math.sqrt(simSample.velX * simSample.velX + simSample.velY * simSample.velY);

            // ★ 速度方向计算（弧度→角度，0°=右，逆时针为正，Math.atan2(y,x)）
            // 纹理坐标系：Y 向上为正
            const velDirDeg = velMag > 0.01
              ? (Math.atan2(simSample.velY, simSample.velX) * 180 / Math.PI)
              : 0;

            // ★ 用户坐标系：UI 显示的坐标系，Y 向下为正（翻转 Y 分量）
            const userVelX = simSample.velX;
            const userVelY = -simSample.velY; // Y 取反
            const userVelDirDeg = velMag > 0.01
              ? (Math.atan2(userVelY, userVelX) * 180 / Math.PI)
              : 0;

            // ★ 8 方向文字标签（基于用户坐标系，UI 方向一致）
            const getDirLabel = (deg: number, mag: number): string => {
              if (mag < 0.01) return '静止';
              // 归一化到 [0, 360)
              let d = ((deg % 360) + 360) % 360;
              if (d < 22.5 || d >= 337.5) return '→ 右';
              if (d < 67.5) return '↘ 右下';
              if (d < 112.5) return '↓ 下';
              if (d < 157.5) return '↙ 左下';
              if (d < 202.5) return '← 左';
              if (d < 247.5) return '↖ 左上';
              if (d < 292.5) return '↑ 上';
              return '↗ 右上';
            };
            const dirLabel = getDirLabel(userVelDirDeg, velMag);

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
              // ★ scalar 模式：读取 density 像素，构建 scalar 参数
              const _sc = config.scalarConfig;
              const _scalar = advectionModeRef.current === 'scalar' && _sc ? {
                density: (() => {
                  const dbuf = new Uint8Array(4);
                  editor.readDensityPixel(texX, texY, dbuf);
                  return dbuf[0] / 255;
                })(),
                baseline: _sc.baselineDensity ?? 1.0,
                hMul: _sc.hMultiplier ?? 0.1,
                sMul: _sc.sMultiplier ?? 0.1,
                lMul: _sc.lMultiplier ?? 0.1,
              } : undefined;
              // 层级2：模拟器残差 + 基础色（按当前 combineMode + scalar 公式计算）
              simComposite = computeCompositeHsl(
                baseColor,
                { r: simResidual.h, g: simResidual.s, b: simResidual.l },
                residualRangeHRef.current,
                residualRangeSLRef.current,
                config.combineMode ?? 'add',
                _scalar,
                config.channels,
              );
              // 层级2：原始残差 + 基础色（原始残差是未调整的，需同样应用 blockFlags 调整）
              origComposite = computeCompositeHsl(
                baseColor,
                { r: origResidual.h, g: origResidual.s, b: origResidual.l },
                residualRangeHRef.current,
                residualRangeSLRef.current,
                config.combineMode ?? 'add',
                _scalar,
                config.channels,
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
              velDirDeg,
              userVelX,
              userVelY,
              userVelDirDeg,
              dirLabel,
            });

          }}
          style={{ cursor: 'crosshair' }}
        />
        {/* ★ 持续注入点可视化叠加层（不阻挡点击） */}
        <canvas
          ref={overlayCanvasRef}
          className="overlay-canvas"
        />
        </div>
        <div className="viewport-info">
          <span>{config.resolution.w}×{config.resolution.h}</span>
          <span>{viewMode === 'color' ? '颜色场' : viewMode === 'velocity' ? '速度场' : viewMode === 'density' ? '浓缩场' : viewMode === 'obstacle' ? '墙体' : viewMode === 'levelset' ? 'φ场' : '合成场'}</span>
          <span>{config.enableAdvection ? '平流: ON' : '平流: OFF'}</span>
          {config.advectionMode === 'scalar' && <span style={{ color: '#009688' }}>MCSDA</span>}
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

            {/* ========== 速度专场：方向 + 大小 + 双坐标系 ========== */}
            <div style={{
              marginTop: '10px',
              borderTop: '2px solid #ff9800',
              paddingTop: '8px',
            }}>
              <div style={{
                fontWeight: 'bold',
                fontSize: '11px',
                color: '#e65100',
                marginBottom: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <span>🌪️ 速度场采样（像素 ({sampleInfo.px}, {sampleInfo.py})）</span>
                {/* 方向标签 */}
                <span style={{
                  fontSize: '10px',
                  background: sampleInfo.velMag < 0.01 ? '#e0e0e0' : '#fff3e0',
                  color: sampleInfo.velMag < 0.01 ? '#9e9e9e' : '#e65100',
                  padding: '1px 6px',
                  borderRadius: '3px',
                  fontWeight: 'bold',
                  border: '1px solid #ffcc80',
                }}>
                  {sampleInfo.dirLabel}
                </span>
              </div>

              {/* 可视化箭头 + 速率大数字 */}
              <div style={{
                display: 'flex',
                gap: '10px',
                marginBottom: '8px',
                alignItems: 'center',
              }}>
                {/* ★ 方向罗盘（SVG 箭头可视化） */}
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, #fff8e1 0%, #ffe0b2 100%)',
                  border: '2px solid #ff9800',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  position: 'relative',
                  boxShadow: '0 2px 6px rgba(255,152,0,0.25)',
                }}>
                  {/* 罗盘刻度参考：十字线 */}
                  <div style={{
                    position: 'absolute',
                    width: '50%', height: '1px',
                    background: 'rgba(255,152,0,0.3)',
                    left: '25%', top: '50%',
                  }} />
                  <div style={{
                    position: 'absolute',
                    width: '1px', height: '50%',
                    background: 'rgba(255,152,0,0.3)',
                    left: '50%', top: '25%',
                  }} />
                  {/* 动态箭头（基于用户坐标系方向） */}
                  {sampleInfo.velMag > 0.01 ? (
                    <svg
                      width="52"
                      height="52"
                      viewBox="-26 -26 52 52"
                      style={{
                        transform: `rotate(${-(sampleInfo.userVelDirDeg)}deg)`,
                        // 注意：SVG 默认 0° = 右（+X），我们希望 UI 0°=右，顺时针旋转角度
                        // Math.atan2(y,x) 得到的角度是"从+x轴逆时针到向量的角度"
                        // CSS rotate() 是"顺时针正"，所以取反 = 用户看到的屏幕方向
                      }}
                    >
                      {/* 箭头线：长度随速率归一化 */}
                      {(() => {
                        // 最大参考速度 3000 px/s 时箭头拉满到 22 半径
                        const arrowLen = Math.min(22, Math.max(4, 22 * Math.sqrt(sampleInfo.velMag / 3000)));
                        return (
                          <>
                            {/* 箭身 */}
                            <line
                              x1="0" y1="0"
                              x2={arrowLen} y2="0"
                              stroke="#e65100"
                              strokeWidth="3"
                              strokeLinecap="round"
                            />
                            {/* 箭头头部三角 */}
                            <polygon
                              points={`${arrowLen},0 ${arrowLen - 6},-4 ${arrowLen - 6},4`}
                              fill="#e65100"
                            />
                          </>
                        );
                      })()}
                    </svg>
                  ) : (
                    <span style={{ fontSize: '16px', color: '#9e9e9e' }}>●</span>
                  )}
                </div>

                {/* 速率数值（大字） */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '22px',
                    fontWeight: 'bold',
                    color: sampleInfo.velMag > 1000 ? '#d32f2f' : sampleInfo.velMag > 200 ? '#f57c00' : '#e65100',
                    fontFamily: 'monospace',
                    lineHeight: 1,
                    marginBottom: '2px',
                  }}>
                    {sampleInfo.velMag < 0.01 ? '0.00' : sampleInfo.velMag.toFixed(1)}
                    <span style={{ fontSize: '11px', color: '#888', fontWeight: 'normal', marginLeft: '3px' }}>
                      px/s
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>
                    速率等级：
                    <span style={{
                      fontWeight: 'bold',
                      color: sampleInfo.velMag < 0.01 ? '#9e9e9e' :
                             sampleInfo.velMag < 50 ? '#4caf50' :
                             sampleInfo.velMag < 250 ? '#2196f3' :
                             sampleInfo.velMag < 1000 ? '#ff9800' : '#f44336',
                    }}>
                      {sampleInfo.velMag < 0.01 ? '静止' :
                       sampleInfo.velMag < 50 ? '极慢' :
                       sampleInfo.velMag < 250 ? '慢速' :
                       sampleInfo.velMag < 1000 ? '中速' :
                       sampleInfo.velMag < 2500 ? '高速' : '超速'}
                    </span>
                  </div>
                  {/* 重力影响评估 */}
                  {sampleInfo.velMag > 0.01 && (
                    <div style={{ fontSize: '10px', color: '#666' }}>
                      停止距离：约 <b style={{ color: '#1976d2' }}>{(sampleInfo.velMag * sampleInfo.velMag / 500).toFixed(0)}</b> 像素
                      {/* 物理估算：v² = 2as → s = v²/(2a), a = g = 250 */}
                    </div>
                  )}
                </div>
              </div>

              {/* 双坐标系详细数据 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px',
                fontSize: '10px',
              }}>
                {/* 用户坐标系（屏幕坐标系） */}
                <div style={{
                  padding: '5px 7px',
                  background: '#fff3e0',
                  border: '1px solid #ffcc80',
                  borderRadius: '4px',
                }}>
                  <div style={{ fontWeight: 'bold', color: '#e65100', marginBottom: '2px' }}>
                    👁️ 用户坐标 (Y↓)
                  </div>
                  <div style={{ fontFamily: 'monospace', color: '#333' }}>
                    Vx: {sampleInfo.userVelX.toFixed(2)} px/s
                  </div>
                  <div style={{ fontFamily: 'monospace', color: '#333' }}>
                    Vy: {sampleInfo.userVelY.toFixed(2)} px/s
                  </div>
                  <div style={{ fontFamily: 'monospace', color: '#555' }}>
                    θ: {sampleInfo.userVelDirDeg.toFixed(1)}°
                  </div>
                </div>
                {/* 纹理坐标系（求解器内部） */}
                <div style={{
                  padding: '5px 7px',
                  background: '#e3f2fd',
                  border: '1px solid #90caf9',
                  borderRadius: '4px',
                }}>
                  <div style={{ fontWeight: 'bold', color: '#1565c0', marginBottom: '2px' }}>
                    ⚙️ 纹理坐标 (Y↑)
                  </div>
                  <div style={{ fontFamily: 'monospace', color: '#333' }}>
                    Vx: {sampleInfo.velX.toFixed(2)} px/s
                  </div>
                  <div style={{ fontFamily: 'monospace', color: '#333' }}>
                    Vy: {sampleInfo.velY.toFixed(2)} px/s
                  </div>
                  <div style={{ fontFamily: 'monospace', color: '#555' }}>
                    θ: {sampleInfo.velDirDeg.toFixed(1)}°
                  </div>
                </div>
              </div>

              {/* 速度矢量分解可视化（小条） */}
              <div style={{
                marginTop: '6px',
                padding: '4px 6px',
                background: '#f5f5f5',
                borderRadius: '3px',
                fontSize: '9px',
                color: '#666',
              }}>
                <span>矢量：</span>
                <span style={{ fontFamily: 'monospace', color: '#e65100' }}>
                  {sampleInfo.userVelX >= 0 ? '→' : '←'} {Math.abs(sampleInfo.userVelX).toFixed(1)}
                </span>
                <span style={{ margin: '0 4px', color: '#bbb' }}>|</span>
                <span style={{ fontFamily: 'monospace', color: '#e65100' }}>
                  {sampleInfo.userVelY >= 0 ? '↓' : '↑'} {Math.abs(sampleInfo.userVelY).toFixed(1)}
                </span>
                <span style={{ margin: '0 4px', color: '#bbb' }}>|</span>
                <span style={{ fontFamily: 'monospace' }}>
                  ‖v‖ = {sampleInfo.velMag.toFixed(1)} px/s
                </span>
              </div>
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

        /* 路径录制按钮脉冲动画 */
        @keyframes pulse-rec {
          0%, 100% { opacity: 1; box-shadow: 0 2px 8px rgba(244,67,54,0.4); }
          50% { opacity: 0.85; box-shadow: 0 2px 16px rgba(244,67,54,0.8); }
        }

        /* canvas 包裹层：让 overlay 能绝对定位覆盖 display canvas */
        .canvas-wrapper {
          position: relative;
          display: inline-block;
          line-height: 0;
        }

        .fluid-viewport canvas {
          image-rendering: pixelated;
          max-width: 100%;
          max-height: 100%;
          border: 2px solid #ccc;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        /* overlay 叠加层：覆盖在 display canvas 上，不阻挡鼠标事件 */
        .fluid-viewport canvas.overlay-canvas {
          position: absolute;
          top: 0;
          left: 0;
          pointer-events: none;
          border: none;
          box-shadow: none;
          image-rendering: auto;
          max-width: none;
          max-height: none;
          z-index: 5;
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
