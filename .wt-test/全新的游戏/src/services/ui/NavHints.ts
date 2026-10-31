// ============================================================
// NavHints —— 场景方位提示（右下角小 UI：方向箭头 + 名称 + 距离）
// ============================================================
// 与地图同源、同配色：舰船 / 玩家标记点（**标记行用自己的自选色**，
// 箭头与文字都染上该色 → 一眼对得上地图上是哪一个）。角色离舰船很远才提示（迟滞防抖），
// 标记点走到跟前（< MARKER_NEAR_M）视为已到达 → 收起。
//
// 性能：① 行节点池化复用，绝不每帧建/删 DOM；
//      ② 文本/颜色变化才写 style（transform 每帧写，GPU 合成不触发布局）；
//      ③ 无目标时整块 display:none（不参与合成）。
//
// 方位角推导（与 Minimap 的朝向约定一致：forward = (sin yaw, cos yaw)）：
//   ahead  = dx·sin yaw + dz·cos yaw      （正 = 前方）
//   right  = -dx·cos yaw + dz·sin yaw     （正 = 右侧）
//   CSS 里 ▲ 字形 0rad 指屏幕上方 → 旋转 θ 后指向 (sin θ, -cos θ)
//   ∴ θ = atan2(right, ahead)   → 目标在正前 = 0，正右 = +π/2
// ============================================================

import { SHIP_COLOR } from './mapIcons';
import type { MapMarkers } from './MapMarkers';

/** 舰船提示迟滞阈值（米）：> SHOW 显示，< HIDE 隐藏（中间保持原状态，防边界抖） */
const SHIP_SHOW_M = 30;
const SHIP_HIDE_M = 24;
/** 标记点：走进这个距离内即视为"已到达"，收起提示 */
const MARKER_NEAR_M = 6;
/** 行数上限：1 舰船 + 最多 8 个标记行。
 *  ★ 与 MapMarkers.MAX 无关（那边已放宽到"不限制"）——HUD 不能让行数无限长，
 *    超出按放置顺序取前 8 个（地图上仍能看到全部）。 */
const MAX_ROWS = 1 + 8;

interface Row {
  el: HTMLDivElement;
  arrow: HTMLSpanElement;
  text: HTMLSpanElement;
}

export class NavHints {
  private root: HTMLDivElement | null = null;
  private rows: Row[] = [];
  /** 上一帧实际显示的行数（只隐藏"本轮多出来的"，不做全量遍历） */
  private activeRows = 0;
  /** 舰船行当前是否展开（迟滞状态） */
  private shipShown = false;
  /** 显隐门控（舰内隐藏：与地图一起收起） */
  private enabled = true;
  private yaw = 0;

  /** ★ 显隐（舰内房间隐藏；与 setMinimapVisible 同源调用） */
  setVisible(v: boolean): void {
    this.enabled = v;
    if (!v) {
      if (this.root) this.root.style.display = 'none';
      this.activeRows = 0;
      this.shipShown = false;
    }
  }

  /**
   * 每帧更新。**零分配**：ship 传实体位置的稳定对象；
   * markers 传 MapMarkers 本体（内部直接遍历 items）。
   */
  update(
    px: number, pz: number, yaw: number,
    ship: { x: number; z: number } | null,
    markers: MapMarkers | null,
  ): void {
    if (!this.enabled) return;
    this.yaw = yaw;
    let n = 0;

    // ---- 舰船行（迟滞：很远才提示，走近了收起） ----
    if (ship) {
      const dx = ship.x - px;
      const dz = ship.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > SHIP_SHOW_M) this.shipShown = true;
      else if (d < SHIP_HIDE_M) this.shipShown = false;
      if (this.shipShown) n = this.writeRow(n, dx, dz, d, '舰船', SHIP_COLOR, false);
    } else {
      this.shipShown = false;
    }

    // ---- 标记行（到达即收起；颜色 = 该标记自选色，与地图同色） ----
    if (markers) {
      const items = markers.items;
      for (let i = 0; i < items.length && n < MAX_ROWS; i++) {
        const m = items[i];
        const dx = m.x - px;
        const dz = m.z - pz;
        const d = Math.hypot(dx, dz);
        if (d < MARKER_NEAR_M) continue;
        n = this.writeRow(n, dx, dz, d, m.label, m.color, true);
      }
    }

    // 隐藏本轮多出来的行 + 整块显隐（只在状态变化时写 style）
    for (let i = n; i < this.activeRows; i++) this.rows[i].el.style.display = 'none';
    if (n !== this.activeRows && this.root) {
      this.root.style.display = n > 0 ? 'flex' : 'none';
    }
    this.activeRows = n;
  }

  /** 写第 i 行（不存在则建），返回 i+1。
   *  colorText = true 时文字也用目标色（标记点：一眼对上地图上的颜色）；
   *  舰船行走中性浅色（青字在暗底上可读性不如亮色箭头，保持现状）。 */
  private writeRow(
    i: number, dx: number, dz: number, dist: number,
    label: string, color: string, colorText: boolean,
  ): number {
    const row = this.ensureRow(i);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const rot = Math.atan2(-dx * cos + dz * sin, dx * sin + dz * cos);
    row.arrow.style.transform = `rotate(${rot.toFixed(3)}rad)`;
    if (row.arrow.style.color !== color) row.arrow.style.color = color;
    const txt = `${label} ${Math.round(dist)}m`;
    if (row.text.textContent !== txt) row.text.textContent = txt;
    const tc = colorText ? color : '#e8f2fa';
    if (row.text.style.color !== tc) row.text.style.color = tc;
    if (row.el.style.display !== 'flex') row.el.style.display = 'flex';
    return i + 1;
  }

  private ensureRoot(): HTMLDivElement {
    if (this.root) return this.root;
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'right:14px', 'bottom:14px', 'z-index:999',
      'display:none', 'flex-direction:column', 'align-items:flex-end', 'gap:4px',
      'pointer-events:none', 'font:13px/1.2 "Microsoft YaHei",sans-serif',
      'color:#e8f2fa', 'text-shadow:0 1px 3px #000,0 0 6px rgba(0,0,0,0.7)',
    ].join(';');
    document.body.appendChild(root);
    this.root = root;
    return root;
  }

  private ensureRow(i: number): Row {
    let row = this.rows[i];
    if (row) return row;
    const root = this.ensureRoot();
    const el = document.createElement('div');
    el.style.cssText = 'display:none;align-items:center;gap:5px;';
    const arrow = document.createElement('span');
    arrow.textContent = '▲';
    arrow.style.cssText = 'display:inline-block;font-size:12px;line-height:1;';
    const text = document.createElement('span');
    text.style.cssText = 'letter-spacing:0.5px;';
    el.append(arrow, text);
    root.appendChild(el);
    row = { el, arrow, text };
    this.rows[i] = row;
    return row;
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.rows = [];
    this.activeRows = 0;
  }
}
