import { useMemo, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { InjectionConfig } from '../fluid/FluidSolver';
import { defaultFluidConfig } from '../fluid/FluidSolver';

// ============================================================
// FluidPanel —— 侧边栏流体控制面板
// ============================================================
//
// 设计要点：
//   - 流体配置/运行时强绑定到 frameDataMap[activeLayerId]（与 MainCanvas 一致）。
//   - 「启用流体」：若当前图层无 fluidConfig，则用 defaultFluidConfig 初始化。
//   - 流体直接作用在区域实体帧纹理的「残差」上：平流残差，base 静态，
//     composite = base + 平流(残差)，由 MainCanvas 把 compositeTexture 喂给
//     绑定区域 COLOR mesh 的 uColorTex（复用模板缓冲裁剪）。
//   - 播放/暂停/速度/重置 通过 store actions 驱动；MainCanvas animate 循环读取。
//
// 仅当图层已绑定区域（boundRegionId != null）时才显示完整控制，否则提示先绑定。

const SECTION: React.CSSProperties = {
  padding: '10px',
  borderTop: '1px solid #333',
  fontSize: '13px',
};
const LABEL: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', margin: '6px 0 2px', color: '#bbb' };
const BTN: React.CSSProperties = {
  padding: '6px 10px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
};
const RANGE: React.CSSProperties = { width: '100%' };

function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  return (
    <div>
      <div style={LABEL}>
        <span>{label}</span>
        <span style={{ color: '#e94560' }}>{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input type="range" style={RANGE} min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

export function FluidPanel() {
  const {
    activeLayerId,
    frameDataMap,
    updateFluidConfig,
    toggleFluidPlaying,
    setFluidSpeed,
    resetFluid,
    addFluidSource,
    removeFluidSource,
    updateFluidSource,
    importFluidConfig,
    exportFluidConfig,
  } = useAppStore();
  const frameData = activeLayerId ? frameDataMap[activeLayerId] : undefined;

  const cfg = frameData?.fluidConfig;
  const rt = frameData?.fluidRuntime;
  const bound = frameData?.boundRegionId != null;

  const enabled = !!cfg;
  const isPlaying = rt?.isPlaying ?? false;
  const speed = rt?.speed ?? 1;

  const sources = useMemo<InjectionConfig[]>(() => cfg?.continuousSources ?? [], [cfg]);

  // 隐藏文件输入（导入配置）
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!activeLayerId) return null;

  // 导入流体配置 JSON（fluid-player.html 格式）—— 配置流体的主要手段
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeLayerId) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        const ok = importFluidConfig(activeLayerId, json);
        if (ok) {
          console.log(`[FluidPanel] 已导入流体配置: ${file.name}`);
        } else {
          alert('导入失败：当前图层无帧数据');
        }
      } catch (err) {
        alert('配置 JSON 解析失败: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    // 清空 value 允许重复导入同一文件
    e.target.value = '';
  };

  // 导出当前流体配置为 JSON 文件（fluid-player.html 可读）
  const handleExport = () => {
    if (!activeLayerId) return;
    const json = exportFluidConfig(activeLayerId);
    if (!json) {
      alert('当前图层无流体配置可导出');
      return;
    }
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fluid-config-${activeLayerId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleEnable = () => {
    if (!activeLayerId) return;
    if (enabled) {
      // 关闭：彻底移除 fluidConfig/fluidRuntime（解算器会被 useFluidSolver 释放）
      const s = useAppStore.getState();
      const fd = s.frameDataMap[activeLayerId];
      if (!fd) return;
      const rest: any = { ...fd };
      delete rest.fluidConfig;
      delete rest.fluidRuntime;
      useAppStore.setState({ frameDataMap: { ...s.frameDataMap, [activeLayerId]: rest } } as any);
    } else {
      updateFluidConfig(activeLayerId, { ...defaultFluidConfig, continuousSources: [] });
    }
  };

  return (
    <div style={SECTION}>
      <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
        onChange={handleImportFile} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <strong style={{ color: '#e94560' }}>流体特效（残差平流）</strong>
        <button
          style={{ ...BTN, background: enabled ? '#e94560' : '#333', color: enabled ? '#fff' : '#aaa' }}
          onClick={toggleEnable}
          disabled={!bound}
          title={bound ? '' : '请先绑定区域实体到帧纹理'}
        >
          {enabled ? '已启用' : '启用'}
        </button>
      </div>

      {/* ★ 导入/导出流体配置（主要手段）：导入即启用并重置；导出可在 fluid-player.html 互换 */}
      {bound && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <button style={{ ...BTN, flex: 1, background: '#6c5ce7', color: '#fff' }}
            onClick={() => fileInputRef.current?.click()}
            title="导入 fluid-player.html 格式的流体配置 JSON">
            📥 导入配置
          </button>
          <button style={{ ...BTN, flex: 1, background: '#2d3436', color: '#eee' }}
            onClick={handleExport}
            disabled={!enabled}
            title={enabled ? '' : '先启用或导入配置'}>
            📤 导出
          </button>
        </div>
      )}

      {!bound && (
        <p style={{ fontSize: '12px', color: '#888' }}>
          当前图层未绑定区域实体到帧纹理。先在画布上绑定区域后再启用流体。
        </p>
      )}
      {enabled && bound && (
        <>
          {/* 播放控制 */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <button style={{ ...BTN, flex: 1, background: isPlaying ? '#52c41a' : '#1890ff', color: '#fff' }}
              onClick={() => toggleFluidPlaying(activeLayerId!)}>
              {isPlaying ? '⏸ 暂停' : '▶ 播放'}
            </button>
            <button style={{ ...BTN, flex: 1, background: '#444', color: '#fff' }}
              onClick={() => resetFluid(activeLayerId!)}>
              ↺ 重置
            </button>
          </div>
          <Slider label="播放速度" value={speed} min={0.1} max={4} step={0.1}
            onChange={v => setFluidSpeed(activeLayerId!, v)} fmt={v => `${v.toFixed(1)}×`} />

          {/* 模式（只读，由导入配置决定） */}
          <div style={LABEL}>
            <span>平流模式</span>
            <span style={{ color: '#e94560', fontWeight: 'bold' }}>
              {cfg!.advectionMode === 'vector' ? '向量(残差)' : '标量(浓度)'}
            </span>
          </div>
          <p style={{ fontSize: '11px', color: '#777', marginTop: '4px' }}>
            向量模式：直接平流残差 HSLA。标量模式：残差静止，浓度场流动调制。
          </p>

          {/* 重力 */}
          <Slider label="重力 X (px/s²)" value={cfg!.gravity.x} min={-500} max={500} step={10}
            onChange={v => updateFluidConfig(activeLayerId!, { gravity: { ...cfg!.gravity, x: v } })} fmt={v => v.toFixed(0)} />
          <Slider label="重力 Y (px/s²)" value={cfg!.gravity.y} min={-500} max={500} step={10}
            onChange={v => updateFluidConfig(activeLayerId!, { gravity: { ...cfg!.gravity, y: v } })} fmt={v => v.toFixed(0)} />

          {/* 压力 / 速度 */}
          <Slider label="压力迭代" value={cfg!.pressureIterations} min={0} max={60} step={1}
            onChange={v => updateFluidConfig(activeLayerId!, { pressureIterations: Math.round(v) })} fmt={v => v.toFixed(0)} />
          <Slider label="SOR omega" value={cfg!.pressureOmega} min={1} max={2} step={0.05}
            onChange={v => updateFluidConfig(activeLayerId!, { pressureOmega: v })} />
          <Slider label="速度缩放" value={cfg!.velocityScale} min={0.1} max={3} step={0.05}
            onChange={v => updateFluidConfig(activeLayerId!, { velocityScale: v })} />
          <Slider label="最大速度" value={cfg!.maxVelocity} min={100} max={10000} step={100}
            onChange={v => updateFluidConfig(activeLayerId!, { maxVelocity: v })} fmt={v => v.toFixed(0)} />

          {/* 注入源 */}
          <div style={LABEL}><span>持续注入源（{sources.length}）</span>
            <button style={{ ...BTN, background: '#333', color: '#fff', padding: '2px 8px', fontSize: '12px' }}
              onClick={() => addFluidSource(activeLayerId!, {
                enabled: true,
                position: { x: 0.5, y: 0.5 },
                radius: 0.08,
                velocity: { x: 0, y: 120 },
                color: [0.0, 0.8, 0.5, 1.0],
                density: 0.8,
                rate: 1.0,
              })}>+ 添加</button>
          </div>
          {sources.map((src, i) => (
            <div key={i} style={{ background: '#1a1a2e', borderRadius: '4px', padding: '6px', margin: '4px 0', border: '1px solid #333' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#aaa' }}>源 #{i}</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button style={{ ...BTN, background: src.enabled ? '#52c41a' : '#444', color: '#fff', padding: '2px 6px', fontSize: '11px' }}
                    onClick={() => updateFluidSource(activeLayerId!, i, { enabled: !src.enabled })}>
                    {src.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button style={{ ...BTN, background: '#666', color: '#fff', padding: '2px 6px', fontSize: '11px' }}
                    onClick={() => removeFluidSource(activeLayerId!, i)}>✕</button>
                </div>
              </div>
              {src.enabled && (
                <>
                  <Slider label="位置 X" value={src.position.x} min={0} max={1} step={0.01}
                    onChange={v => updateFluidSource(activeLayerId!, i, { position: { ...src.position, x: v } })} />
                  <Slider label="位置 Y" value={src.position.y} min={0} max={1} step={0.01}
                    onChange={v => updateFluidSource(activeLayerId!, i, { position: { ...src.position, y: v } })} />
                  <Slider label="半径" value={src.radius} min={0.01} max={0.4} step={0.01}
                    onChange={v => updateFluidSource(activeLayerId!, i, { radius: v })} />
                  <Slider label="速度 X" value={src.velocity.x} min={-500} max={500} step={10}
                    onChange={v => updateFluidSource(activeLayerId!, i, { velocity: { ...src.velocity, x: v } })} fmt={v => v.toFixed(0)} />
                  <Slider label="速度 Y" value={src.velocity.y} min={-500} max={500} step={10}
                    onChange={v => updateFluidSource(activeLayerId!, i, { velocity: { ...src.velocity, y: v } })} fmt={v => v.toFixed(0)} />
                  {cfg!.advectionMode === 'scalar' && (
                    <Slider label="浓度" value={src.density ?? 0.5} min={0} max={1} step={0.05}
                      onChange={v => updateFluidSource(activeLayerId!, i, { density: v })} />
                  )}
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
