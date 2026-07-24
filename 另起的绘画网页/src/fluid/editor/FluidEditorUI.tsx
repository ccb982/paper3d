import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFluidEditor } from './useFluidEditor';
import type { ViewMode } from './FluidEditor';

// ============================================================
// FluidEditorUI —— 2D 流体编辑器视口 + 控制面板
//
// 关键设计：显示使用 CPU 回读（readRenderTargetPixels）+
// Canvas 2D putImageData，而非跨 WebGL 上下文渲染。
// 因为 FluidEditor 内部的 WebGLRenderer 和显示用的
// WebGLRenderer 是不同上下文，纹理无法跨上下文共享。
// ============================================================

export const FluidEditorUI: React.FC = () => {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const displayRafRef = useRef<number>();

  const [rendererReady, setRendererReady] = useState(false);

  // ==================== 初始化隐藏渲染器（供 FluidEditor 内部 GPU Pass 使用） ====================
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
    gravity: -300,
  });

  // ==================== 显示循环（独立 rAF，用 CPU 像素绘制 Canvas 2D） ====================
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
        // 速度场可视化：将 RG 双通道映射为颜色（R→红，G→绿）
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          // R = velX（有符号 → 偏移），G = velY
          const vx = d[i];
          const vy = d[i + 1];
          // 将 0~255 映射为彩色（128=零速度）
          const mx = (vx - 128) * 2;  // -255..255
          const my = (vy - 128) * 2;
          d[i]     = Math.max(0, Math.min(255, 128 + mx));       // R: 正速度=红
          d[i + 1] = Math.max(0, Math.min(255, 128 + my));       // G: 正速度=绿
          d[i + 2] = 64;                                         // B: 底色
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

  // ==================== 事件处理 ====================

  const handleResolutionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const size = parseInt(e.target.value, 10);
    if (!isNaN(size) && size >= 16 && size <= 1024) {
      updateConfig({ resolution: { w: size, h: size } });
    }
  };

  const handleChannelToggle = (channel: 'r' | 'g' | 'b' | 'a') => {
    updateConfig({
      channels: { ...config.channels, [channel]: !config.channels[channel] },
    });
  };

  const handleModuleToggle = (module: 'advection' | 'pressure' | 'levelset') => {
    if (module === 'advection') {
      updateConfig({ enableAdvection: !config.enableAdvection });
    } else if (module === 'pressure') {
      updateConfig({ enablePressure: !config.enablePressure });
    } else if (module === 'levelset') {
      updateConfig({ enableLevelSet: !config.enableLevelSet });
    }
  };

  const channelLabel: Record<string, string> = {
    r: 'H 色相',
    g: 'S 饱和度',
    b: 'L 明度',
    a: 'A 透明度',
  };

  // ==================== 渲染 ====================

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      background: '#1a1a2e',
      color: '#e0e0e0',
    }}>
      {/* ======== 控制面板 ======== */}
      <div style={{
        padding: '8px 12px',
        background: '#16213e',
        borderBottom: '1px solid #0f3460',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '16px',
        alignItems: 'center',
        fontSize: '12px',
      }}>
        {/* 分辨率 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <label style={{ whiteSpace: 'nowrap' }}>分辨率:</label>
          <input
            type="number"
            min={16}
            max={1024}
            step={16}
            value={config.resolution.w}
            onChange={handleResolutionChange}
            style={{
              width: '52px',
              background: '#0f3460',
              color: '#e0e0e0',
              border: '1px solid #1a5276',
              borderRadius: '3px',
              padding: '2px 4px',
              fontSize: '12px',
            }}
          />
        </div>

        {/* 通道选择 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ whiteSpace: 'nowrap' }}>通道:</span>
          {(['r', 'g', 'b', 'a'] as const).map((ch) => (
            <label
              key={ch}
              title={channelLabel[ch]}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                cursor: 'pointer',
                padding: '2px 6px',
                background: config.channels[ch] ? '#1a5276' : '#0f3460',
                borderRadius: '3px',
              }}
            >
              <input
                type="checkbox"
                checked={config.channels[ch]}
                onChange={() => handleChannelToggle(ch)}
                style={{ margin: 0 }}
              />
              {ch.toUpperCase()}
            </label>
          ))}
        </div>

        {/* 模块开关 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ whiteSpace: 'nowrap' }}>模块:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={config.enableAdvection}
              onChange={() => handleModuleToggle('advection')}
              style={{ margin: 0 }}
            />
            平流
          </label>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '2px',
            color: '#666', cursor: 'not-allowed',
          }}>
            <input type="checkbox" checked={config.enablePressure} disabled style={{ margin: 0 }} />
            压力
          </label>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '2px',
            color: '#666', cursor: 'not-allowed',
          }}>
            <input type="checkbox" checked={config.enableLevelSet} disabled style={{ margin: 0 }} />
            Level Set
          </label>
        </div>

        {/* 重力 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <label style={{ whiteSpace: 'nowrap' }}>重力:</label>
          <input
            type="number"
            value={config.gravity}
            onChange={(e) => updateConfig({ gravity: parseFloat(e.target.value) || 0 })}
            style={{
              width: '52px',
              background: '#0f3460',
              color: '#e0e0e0',
              border: '1px solid #1a5276',
              borderRadius: '3px',
              padding: '2px 4px',
              fontSize: '12px',
            }}
          />
        </div>

        {/* 查看模式 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ whiteSpace: 'nowrap' }}>查看:</span>
          <select
            value={viewMode}
            onChange={(e) => setView(e.target.value as ViewMode)}
            style={{
              background: '#0f3460',
              color: '#e0e0e0',
              border: '1px solid #1a5276',
              borderRadius: '3px',
              padding: '2px 4px',
              fontSize: '12px',
            }}
          >
            <option value="color">颜色场</option>
            <option value="velocity">速度场</option>
          </select>
        </div>

        {/* 注入开关 */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          cursor: 'pointer', padding: '2px 8px',
          background: '#1a5276', borderRadius: '3px',
        }}>
          <input
            type="checkbox"
            checked={config.injection.enabled}
            onChange={(e) =>
              updateConfig({
                injection: { ...config.injection, enabled: e.target.checked },
              })
            }
            style={{ margin: 0 }}
          />
          注入源
        </label>
      </div>

      {/* ======== 视口 ======== */}
      <div style={{
        flex: 1,
        position: 'relative',
        background: '#0a0a15',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <canvas
          ref={displayCanvasRef}
          style={{
            imageRendering: 'pixelated',
            maxWidth: '100%',
            maxHeight: '100%',
            border: '2px solid #1a5276',
            boxShadow: '0 0 15px rgba(26, 82, 118, 0.3)',
          }}
        />
      </div>
    </div>
  );
};
