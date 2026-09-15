// ============================================================
// mapIcons —— 地图图标绘制（小地图 / 大地图共用同一套形状）
// ============================================================
// 四种元件（纯 canvas 绘制、无状态，调用方每帧直接调；同屏 ≤ 十几处，开销可忽略）：
//   drawPlayerArrow       角色：白箭头 + 深色描边
//   drawShipIcon          舰船：脉冲光环 + 双层菱形舰体 + 舰桥亮点（要"很显眼"）
//   drawMarkerIcon        标记点：橙黄菱形 + 深色描边
//   drawOffscreenIndicator 目标出窗/出屏 → 贴到矩形边框上的方位三角（+ 距离数字）
//
// ★ 不用 ctx.shadowBlur 做发光：canvas 阴影是 per-draw 的高开销路径
//   （小地图每帧重画标记层）。改用"外圈半透明大图形 + 内圈实心"两层叠加，
//   视觉等价、成本恒定。
// ============================================================

/** 舰船色（两图 + 场景提示统一取自这里，防配色漂移） */
export const SHIP_COLOR = '#66e0ff';

/**
 * ★ 标记点色板（玩家在大地图上自选；每个标记记住自己的颜色）。
 * 约束（用户 2026-09-15 定调）：**不用蓝色**（舰船独占青蓝）、**不用灰白**（玩家箭头/UI 保留）。
 * 同时避开敌人红 `#ff4444` 与 NPC 黄 `#ffd75e` 的主色相，避免图例打架。
 * 顺序 = 色板从左到右 = 默认取第 0 个。
 */
export const MARKER_PALETTE = [
  '#ffb347', // 橙（默认）
  '#ffe066', // 亮黄
  '#7ee081', // 绿
  '#ff5fa2', // 品红
  '#c07bff', // 紫
  '#ff7043', // 朱橘
] as const;

/** 默认标记色（= 色板第一个；MapMarkers 不指定颜色时用它） */
export const MARKER_COLOR = MARKER_PALETTE[0];

/** #rrggbb → rgba(r,g,b,a)（带缓存；不每帧拼字符串）。模块内私有，不对外暴露 */
const rgbaCache = new Map<string, [number, number, number]>();
function withAlpha(hex: string, a: number): string {
  let rgb = rgbaCache.get(hex);
  if (!rgb) {
    rgb = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    rgbaCache.set(hex, rgb);
  }
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

/** 角色：白箭头 + 深色描边（rot = canvas 弧度；0 = 指向上方） */
export function drawPlayerArrow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, rot: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(-size * 0.72, size * 0.78);
  ctx.lineTo(0, size * 0.34);
  ctx.lineTo(size * 0.72, size * 0.78);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#0a1420';
  ctx.stroke();
  ctx.restore();
}

/** 舰船：脉冲光环 + 双层菱形舰体 + 舰桥亮点。r ≈ 4.5（小地图）/ 6（大地图） */
export function drawShipIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number, pulse: number,
): void {
  // ① 呼吸光环（描边不填充，不遮底图）
  ctx.beginPath();
  ctx.arc(x, y, r * (1.45 + 0.5 * pulse), 0, Math.PI * 2);
  ctx.strokeStyle = withAlpha(SHIP_COLOR, 0.30 + 0.45 * pulse);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // ② 菱形舰体（深色底盘让它在任何地表色上都跳出来）
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  const outer = r * 1.18;
  ctx.fillStyle = 'rgba(6,20,28,0.92)';
  ctx.fillRect(-outer, -outer, outer * 2, outer * 2);
  ctx.fillStyle = SHIP_COLOR;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
  // ③ 舰桥亮点
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, r * 0.36), 0, Math.PI * 2);
  ctx.fillStyle = '#eaffff';
  ctx.fill();
}

/** 标记点：菱形 + 深色描边（color = 该标记自选色） */
export function drawMarkerIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number, color: string = MARKER_COLOR, pulse = 0,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(30,18,4,0.92)';
  ctx.fillRect(-r - 1.2, -r - 1.2, (r + 1.2) * 2, (r + 1.2) * 2);
  ctx.fillStyle = withAlpha(color, 0.75 + 0.25 * pulse);
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

/**
 * 目标出窗 / 出屏：把方位指示贴到矩形边框上。
 * dxPx/dzPx = 目标相对【矩形中心】的像素位移（与 halfW/halfH 同量纲）；
 * 目标还在框内 → 直接返回（调用方可无脑调）。
 * dist = 世界距离（米，只用于显示数字，走 player→target 的真实距离）。
 */
export function drawOffscreenIndicator(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  dxPx: number, dzPx: number,
  halfW: number, halfH: number,
  color: string, pulse: number, dist: number,
): void {
  if (dxPx === 0 && dzPx === 0) return;
  if (Math.abs(dxPx) <= halfW && Math.abs(dzPx) <= halfH) return; // 框内
  const t = Math.min(halfW / Math.max(1e-3, Math.abs(dxPx)), halfH / Math.max(1e-3, Math.abs(dzPx)));
  const ax = cx + dxPx * t;
  const ay = cy + dzPx * t;
  const ang = Math.atan2(dzPx, dxPx);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  // 光晕层（半透明大三角）
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-6.5, 7);
  ctx.lineTo(-6.5, -7);
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, 0.22 + 0.28 * pulse);
  ctx.fill();
  // 实心三角
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-4.5, 4.8);
  ctx.lineTo(-4.5, -4.8);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(6,14,20,0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  // 距离数字（沿"指向中心"的反方向内缩 ~13px，压在底图上 → 描黑边保证可读）
  const n = Math.hypot(dxPx, dzPx);
  const inward = Math.max(0, t - 13 / Math.max(1e-3, n));
  const tx = cx + dxPx * inward;
  const ty = cy + dzPx * inward;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = `${Math.round(dist)}`;
  ctx.strokeStyle = 'rgba(4,8,12,0.9)';
  ctx.lineWidth = 3;
  ctx.strokeText(label, tx, ty);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, tx, ty);
}
