// ============================================================
// EffectShapePanel —— 程序化击中特效形状（多图层模板边界绑定）
// ============================================================
// 独立解耦：只【读取】主绘画 store 的图层与区域实体。
// ★ 每个图层 = 一个特效形状：直接用该图层区域实体的【模板边界】
//   （regionEntities[layerId][0].boundary 外环）作为形状轮廓，
//   不需要额外提取区域。
// ★ 多图层管理：所有图层同时参与变形，每层独立种子随机
//   （shapeSeed(globalSeed, layerIdx)），播放时叠加。
// 配置（填充/扭曲/旋转/外扩/残差）按图层 id 保存，刷新时保留。

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { generateVariant, randomSeed, shapeSeed, tickVariant, variantDuration } from './variantGenerator';
import type { EffectShapeDef, EffectShapeParams } from './types';

const DEFAULT_PARAMS: EffectShapeParams = {
  distortion: { amplitude: 0.03, frequency: 8, randomRange: 0.6 },
  rotation: { min: 0, max: Math.PI * 2 },
  expand: { xMin: 1.3, xMax: 2.5, yMin: 1.3, yMax: 2.5, duration: 0.5, easing: 'easeOut' },
  spinWhileExpand: true,
  spinSpeed: 2,
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

const LABEL: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: '12px', color: '#aaa', marginTop: '8px',
};

const BTN: React.CSSProperties = {
  padding: '4px 10px', borderRadius: '4px', border: 'none', cursor: 'pointer',
  fontSize: '12px', background: '#6c5ce7', color: '#fff',
};

export function EffectShapePanel() {
  const layers = useAppStore(s => s.layers);
  const regionEntities = useAppStore(s => s.regionEntities);
  const imageState = useAppStore(s => s.imageState);
  const canvasWidth = useAppStore(s => s.canvasWidth);
  const canvasHeight = useAppStore(s => s.canvasHeight);
  const activeLayerId = useAppStore(s => s.activeLayerId);
  const refreshRegionCache = useAppStore(s => s.refreshRegionCache);
  const [configs, setConfigs] = useState<Record<string, EffectShapeDef>>({});
  const [playing, setPlaying] = useState(false);
  const [seed, setSeed] = useState(() => randomSeed());
  const [showPanel, setShowPanel] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const residualCanvasCache = useRef<Map<string, HTMLCanvasElement>>(new Map());

  /** ★ 刷新：对当前图层跑完整区域管线（BFS Worker → 区域缓存 + 区域实体 + 色块），
   *   只调用 refreshRegionEntities 会从 stale 缓存重建并把旧实体清空 */
  const refresh = async () => {
    if (activeLayerId) {
      await refreshRegionCache(activeLayerId, { clearPaintData: false });
    }
    setRefreshTick(t => t + 1);
  };

  /** ★ 图层 → 特效形状（自动绑定图层区域实体的模板边界，无需提取） */
  const layerShapes = useMemo(() => {
    return layers
      .filter(l => l.id !== imageState.imageLayerId)
      .map(l => {
        const entities = regionEntities[l.id] ?? [];
        const outer = entities[0]?.boundary?.[0];
        if (!outer || outer.length < 3) return null;
        return {
          layerId: l.id,
          name: l.name,
          outline: outer.map(p => ({ x: p.x, y: p.y })),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [layers, regionEntities, imageState.imageLayerId, refreshTick]);

  /** 每层配置（存在且轮廓匹配则保留；partial 配置合并进默认值，绝不崩溃） */
  const defOf = (layerId: string, outline: { x: number; y: number }[]): EffectShapeDef => {
    const prev = configs[layerId];
    const base: Partial<EffectShapeDef> = prev && prev.outline && prev.outline.length === outline.length ? prev : {};
    return {
      id: 0,
      name: '',
      outline,
      fill: base.fill ?? { h: 0.55, s: 0.8, l: 0.6, a: 1 },
      residualTex: base.residualTex,
      visible: base.visible ?? true,
      params: base.params ?? JSON.parse(JSON.stringify(DEFAULT_PARAMS)),
    };
  };

  /** 所有写入都存完整 def（含当前轮廓），避免 partial 被 defOf 丢弃 */
  const updateDef = (layerId: string, outline: { x: number; y: number }[], patch: Partial<EffectShapeDef>) => {
    setConfigs(m => ({ ...m, [layerId]: { ...defOf(layerId, outline), ...patch } }));
  };
  const patchShape = (layerId: string, outline: { x: number; y: number }[], patch: Partial<EffectShapeDef>) => {
    updateDef(layerId, outline, patch);
  };
  const patchParams = (layerId: string, outline: { x: number; y: number }[], patch: Partial<EffectShapeParams>) => {
    updateDef(layerId, outline, { params: { ...defOf(layerId, outline).params, ...patch } });
  };
  const patchNested = (layerId: string, outline: { x: number; y: number }[], key: 'distortion' | 'rotation' | 'expand', patch: Record<string, number>) => {
    const def = defOf(layerId, outline);
    updateDef(layerId, outline, { params: { ...def.params, [key]: { ...def.params[key], ...patch } } });
  };

  /** ★ 取色模式：点击画布采样该像素的背景色（null = 未激活） */
  const [pickMode, setPickMode] = useState<{ layerId: string; outline: { x: number; y: number }[] } | null>(null);

  /** 采样背景图在【画布像素】位置的颜色 → 填充色 */
  const sampleBackgroundAt = (layerId: string, outline: { x: number; y: number }[], px: number, py: number) => {
    const img = imageState.originalImage;
    if (!img || !imageState.imageSrc) {
      alert('未加载背景图，无法取背景色');
      return;
    }
    let ox: number, oy: number, dw: number, dh: number;
    if (imageState.selectionRect) {
      const sel = imageState.selectionRect;
      const fitScale = Math.min(canvasWidth / sel.width, canvasHeight / sel.height) * (imageState.scale ?? 1);
      dw = sel.width * fitScale;
      dh = sel.height * fitScale;
      ox = (canvasWidth - dw) / 2 + (imageState.offsetX ?? 0);
      oy = (canvasHeight - dh) / 2 + (imageState.offsetY ?? 0);
      const sx = dw === 0 ? 0 : (px - ox) / dw;
      const sy = dh === 0 ? 0 : (py - oy) / dh;
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      c.getContext('2d')!.drawImage(img, sel.x + sx * sel.width, sel.y + sy * sel.height, 1, 1, 0, 0, 1, 1);
      applySampledColor(layerId, outline, c.getContext('2d')!.getImageData(0, 0, 1, 1).data);
    } else {
      const fitScale = Math.min(canvasWidth / img.width, canvasHeight / img.height) * (imageState.scale ?? 1);
      dw = img.width * fitScale;
      dh = img.height * fitScale;
      ox = (canvasWidth - dw) / 2 + (imageState.offsetX ?? 0);
      oy = (canvasHeight - dh) / 2 + (imageState.offsetY ?? 0);
      const ix = (px - ox) / dw * img.width;
      const iy = (py - oy) / dh * img.height;
      if (ix < 0 || ix >= img.width || iy < 0 || iy >= img.height) return;
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      c.getContext('2d')!.drawImage(img, ix, iy, 1, 1, 0, 0, 1, 1);
      applySampledColor(layerId, outline, c.getContext('2d')!.getImageData(0, 0, 1, 1).data);
    }
  };

  /** ★ 取背景色（质心方式保留：点击按钮默认取区域质心，交互友好则用取色模式） */
  const pickBackgroundColor = (layerId: string, outline: { x: number; y: number }[]) => {
    let cx = 0, cy = 0;
    for (const p of outline) { cx += p.x; cy += p.y; }
    cx /= outline.length; cy /= outline.length;
    sampleBackgroundAt(layerId, outline, cx * canvasWidth, (1 - cy) * canvasHeight);
  };

  // ★ 取色模式：激活时监听画布点击，采样点击像素的背景色
  useEffect(() => {
    if (!pickMode) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const canvas = target.closest('canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) return;
      sampleBackgroundAt(pickMode.layerId, pickMode.outline, px, py);
      setPickMode(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [pickMode]);

  const applySampledColor = (layerId: string, outline: { x: number; y: number }[], d: Uint8ClampedArray) => {
    if (d[3] === 0) return;
    const { h, s, l } = rgbToHsl(d[0], d[1], d[2]);
    patchShape(layerId, outline, { fill: { h, s, l, a: d[3] / 255 } });
  };

  const playOnce = () => {
    setSeed(randomSeed());
    setPlaying(true);
  };

  // ★ 预览动画：所有图层同时变形（每层独立种子），叠加播放
  useEffect(() => {
    if (!playing || layerShapes.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const W = canvas.width, H = canvas.height;
    const defs = layerShapes.map((s, i) => defOf(s.layerId, s.outline));
    const variants = defs.map((d, i) => generateVariant(d, shapeSeed(seed, i)));
    const total = Math.max(...defs.map(variantDuration));
    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        if (!(def.visible ?? true)) continue;
        const v = variants[i];
        const pose = tickVariant(v, t, def);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of v.vertices) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
        const span = Math.max(1e-6, Math.max(maxX - minX, maxY - minY));
        const pad = 40;
        const s = (Math.min(W, H) - pad * 2) / span;
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(pose.angle);
        ctx.scale(pose.scaleX, pose.scaleY);
        ctx.translate(-cx * s, -cy * s);
        ctx.beginPath();
        v.vertices.forEach((p, j) => {
          const px = p.x * s, py = p.y * s;
          if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        const [r, g, b] = hslToRgb(def.fill.h, def.fill.s, def.fill.l);
        ctx.fillStyle = `rgba(${r},${g},${b},${def.fill.a})`;
        ctx.fill();
        if (def.residualTex) {
          let rc = residualCanvasCache.current.get(layerShapes[i].layerId);
          if (!rc) {
            rc = document.createElement('canvas');
            rc.width = def.residualTex.width; rc.height = def.residualTex.height;
            rc.getContext('2d')!.putImageData(def.residualTex, 0, 0);
            residualCanvasCache.current.set(layerShapes[i].layerId, rc);
          }
          ctx.save();
          ctx.clip();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(rc, 0, 0, W, H);
          ctx.restore();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
      if (t < total) raf = requestAnimationFrame(draw);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, layerShapes, configs, seed]);

  return (
    <div style={{ padding: '10px', borderTop: '1px solid #333' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ color: '#a29bfe' }}>✦ 击中特效形状</strong>
        <button style={{ ...BTN, background: '#444' }} onClick={() => setShowPanel(!showPanel)}>
          {showPanel ? '收起' : '展开'}
        </button>
      </div>
      <p style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
        每个图层 = 一个特效形状（模板边界自动绑定）；多图层同时变形、叠加播放
      </p>
      {showPanel && (
        <>
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
            <button style={{ ...BTN, flex: 1 }} onClick={refresh}>🔄 刷新图层</button>
            <button style={{ ...BTN, flex: 1, background: playing ? '#e17055' : '#52c41a' }} onClick={playOnce}>
              {playing ? '播放中…' : '▶ 随机预览'}
            </button>
          </div>

          <canvas ref={canvasRef} width={260} height={180}
            style={{ width: '100%', background: '#12121f', borderRadius: '4px', marginTop: '8px', border: '1px solid #333' }} />

          {layerShapes.length === 0 && (
            <p style={{ fontSize: '11px', color: '#777', marginTop: '6px' }}>
              暂无带区域实体的图层（共 {layers.length} 图层）。
              在图层中画好形状后点「🔄 刷新图层」——会跑完整区域管线
              （BFS Worker → 区域缓存 + 区域实体 + 区域色块）。
            </p>
          )}

          {layerShapes.map((s, i) => {
            const def = defOf(s.layerId, s.outline);
            const [fr, fg, fb] = hslToRgb(def.fill.h, def.fill.s, def.fill.l);
            return (
              <div key={s.layerId} style={{ background: '#1a1a2e', borderRadius: '4px', padding: '8px', margin: '8px 0', border: '1px solid #333', fontSize: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#ddd' }}>图层 {i + 1} · {s.name}</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button style={{ ...BTN, background: pickMode?.layerId === s.layerId ? '#e17055' : '#00b894', color: '#fff', padding: '2px 8px', fontSize: '11px' }}
                      onClick={() => setPickMode(pickMode?.layerId === s.layerId ? null : { layerId: s.layerId, outline: s.outline })}
                      title="进入取色模式：点击主画布任意位置，采样该像素的背景色作为填充">
                      {pickMode?.layerId === s.layerId ? '🎯 点击画布取色…' : '🎯 取背景色'}
                    </button>
                    <button style={{ ...BTN, background: `rgb(${fr},${fg},${fb})`, color: (def.fill.l > 0.6 ? '#111' : '#fff'), padding: '2px 8px', fontSize: '11px', border: def.fill.a < 1 ? '2px solid #fff' : 'none' }}
                      onClick={() => patchShape(s.layerId, s.outline, { fill: { ...def.fill, a: def.fill.a < 1 ? 1 : def.fill.a } })}
                      title="给区域内部填充纯色（当前 H/S/L；不透明度滑杆控制浓度）">
                      🎨 填充
                    </button>
                    <button style={{ ...BTN, background: (def.visible ?? true) ? '#52c41a' : '#333', color: '#fff', padding: '2px 8px', fontSize: '11px' }}
                      onClick={() => patchShape(s.layerId, s.outline, { visible: !(def.visible ?? true) })}>
                      {(def.visible ?? true) ? '显示' : '隐藏'}
                    </button>
                  </div>
                </div>

                <div style={{ ...LABEL, marginTop: '6px' }}><span>填充 H</span>
                  <input type="range" min={0} max={1} step={0.01} value={def.fill.h} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchShape(s.layerId, s.outline, { fill: { ...def.fill, h: parseFloat(e.target.value) } })} /></div>
                <div style={{ ...LABEL }}><span>填充 S</span>
                  <input type="range" min={0} max={1} step={0.01} value={def.fill.s} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchShape(s.layerId, s.outline, { fill: { ...def.fill, s: parseFloat(e.target.value) } })} /></div>
                <div style={{ ...LABEL }}><span>填充 L</span>
                  <input type="range" min={0} max={1} step={0.01} value={def.fill.l} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchShape(s.layerId, s.outline, { fill: { ...def.fill, l: parseFloat(e.target.value) } })} /></div>
                <div style={{ ...LABEL }}><span>不透明度</span>
                  <input type="range" min={0} max={1} step={0.01} value={def.fill.a} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchShape(s.layerId, s.outline, { fill: { ...def.fill, a: parseFloat(e.target.value) } })} /></div>

                <div style={{ ...LABEL, borderTop: '1px dashed #444', paddingTop: '4px' }}><span style={{ color: '#a29bfe' }}>NV 扭曲</span></div>
                <div style={{ ...LABEL }}><span>振幅</span>
                  <input type="range" min={0} max={0.1} step={0.001} value={def.params.distortion.amplitude} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'distortion', { amplitude: parseFloat(e.target.value) })} /></div>
                <div style={{ ...LABEL }}><span>频率</span>
                  <input type="range" min={1} max={30} step={0.5} value={def.params.distortion.frequency} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'distortion', { frequency: parseFloat(e.target.value) })} /></div>
                <div style={{ ...LABEL }}><span>随机幅度</span>
                  <input type="range" min={0} max={1} step={0.05} value={def.params.distortion.randomRange} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'distortion', { randomRange: parseFloat(e.target.value) })} /></div>

                <div style={{ ...LABEL, borderTop: '1px dashed #444', paddingTop: '4px' }}><span style={{ color: '#a29bfe' }}>初始旋转(弧度)</span></div>
                <div style={{ ...LABEL }}><span>最小</span>
                  <input type="range" min={-Math.PI} max={Math.PI} step={0.1} value={def.params.rotation.min} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'rotation', { min: parseFloat(e.target.value) })} /></div>
                <div style={{ ...LABEL }}><span>最大</span>
                  <input type="range" min={-Math.PI} max={Math.PI} step={0.1} value={def.params.rotation.max} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'rotation', { max: parseFloat(e.target.value) })} /></div>

                <div style={{ ...LABEL, borderTop: '1px dashed #444', paddingTop: '4px' }}><span style={{ color: '#a29bfe' }}>外扩倍率</span></div>
                <div style={{ ...LABEL }}><span>X 最小</span>
                  <input type="range" min={1} max={4} step={0.1} value={def.params.expand.xMin} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'expand', { xMin: parseFloat(e.target.value) })} /></div>
                <div style={{ ...LABEL }}><span>X 最大</span>
                  <input type="range" min={1} max={4} step={0.1} value={def.params.expand.xMax} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'expand', { xMax: parseFloat(e.target.value) })} /></div>
                <div style={{ ...LABEL }}><span>Y 最小</span>
                  <input type="range" min={1} max={4} step={0.1} value={def.params.expand.yMin} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'expand', { yMin: parseFloat(e.target.value) })} /></div>
                <div style={{ ...LABEL }}><span>Y 最大</span>
                  <input type="range" min={1} max={4} step={0.1} value={def.params.expand.yMax} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'expand', { yMax: parseFloat(e.target.value) })} /></div>
                <div style={{ ...LABEL }}><span>时长</span>
                  <input type="range" min={0.1} max={2} step={0.05} value={def.params.expand.duration} style={{ flex: 1, margin: '0 6px' }}
                    onChange={e => patchNested(s.layerId, s.outline, 'expand', { duration: parseFloat(e.target.value) })} /></div>

                <div style={{ ...LABEL }}>
                  <span>外扩继续旋转</span>
                  <button style={{ ...BTN, background: def.params.spinWhileExpand ? '#e17055' : '#333', padding: '2px 8px', fontSize: '11px' }}
                    onClick={() => patchParams(s.layerId, s.outline, { spinWhileExpand: !def.params.spinWhileExpand })}>
                    {def.params.spinWhileExpand ? 'ON' : 'OFF'}
                  </button>
                </div>
                {def.params.spinWhileExpand && (
                  <div style={{ ...LABEL }}><span>转速</span>
                    <input type="range" min={0} max={6} step={0.1} value={def.params.spinSpeed} style={{ flex: 1, margin: '0 6px' }}
                      onChange={e => patchParams(s.layerId, s.outline, { spinSpeed: parseFloat(e.target.value) })} /></div>
                )}

                <div style={{ ...LABEL }}>
                  <span style={{ color: '#55efc4' }}>残差纹理层</span>
                  <button style={{ ...BTN, background: def.residualTex ? '#55efc4' : '#333', color: def.residualTex ? '#122' : '#aaa', padding: '2px 8px', fontSize: '11px' }}
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = () => {
                        const f = input.files?.[0];
                        if (!f) return;
                        const img = new Image();
                        img.onload = () => {
                          const c = document.createElement('canvas');
                          c.width = img.width; c.height = img.height;
                          c.getContext('2d')!.drawImage(img, 0, 0);
                          patchShape(s.layerId, s.outline, { residualTex: c.getContext('2d')!.getImageData(0, 0, c.width, c.height) });
                        };
                        img.src = URL.createObjectURL(f);
                      };
                      input.click();
                    }}>
                    {def.residualTex ? '有' : '无'}
                  </button>
                </div>
                {def.residualTex && (
                  <button style={{ ...BTN, background: '#c0392b', padding: '2px 8px', fontSize: '11px', marginTop: '4px' }}
                    onClick={() => patchShape(s.layerId, s.outline, { residualTex: undefined })}>清除残差层</button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
