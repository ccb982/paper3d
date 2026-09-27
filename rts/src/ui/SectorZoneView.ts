// ============================================================
// ui/SectorZoneView —— 防区调试视图（用户定 2026-09-27）
// ============================================================
// · **默认绘制标准测试位置（真实舰位）的 8 扇区防区**——真形点集（4m 格）不是示意；
// · **鼠标悬停**：显示世界坐标 + 该点判定链（高/地块/硬通行/舰船高地排除/带内 → 所属扇区）；
// · **单击地图**：把该点设为"虚拟舰位"→ 用**同一个 SectorBuilder 逻辑**重算防区（修判断用）；
// · 右键 / R = 复位到真实舰位；S = 取标准测试位 (-17,-267)；Z = 开关。
// 纪律：只读地形/表；独立 SectorBuilder 实例，**不写任何游戏状态**。
// ============================================================

import { SectorBuilder, SECTOR_COUNT, SECTOR_CELL } from '../systems/swarm/tactics/SectorBuilder';

export interface SectorZoneDeps {
  surfaceAt: (x: number, z: number) => number;
  tileAt: (x: number, z: number) => { genRole?: string };
  blockedAt: (x: number, z: number) => boolean;
  ship: () => { x: number; z: number };
  band: () => { rLo: number; rHi: number };
  mainSectors: () => readonly number[];
}

/** 标准测试位（与标准 URL `?seed=4242&x=-17&z=-267` 一致） */
export const STANDARD_POS = { x: -17, z: -267 };

export function mountSectorZoneView(deps: SectorZoneDeps, open = true): { toggle(): void; destroy(): void } {
  const SIZE = 720;
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;right:12px;top:12px;z-index:10050;display:${open ? 'block' : 'none'};`
    + 'background:rgba(8,12,18,.92);border:1px solid #2c3a4c;border-radius:8px;padding:6px;'
    + 'font:12px/1.4 Consolas,monospace;color:#cfe3ff;user-select:none';
  const head = document.createElement('div');
  head.style.cssText = 'padding:2px 4px 6px;display:flex;gap:8px;align-items:center';
  head.innerHTML = '<b style="color:#ffcf9a">防区调试</b><span id="szv-pos"></span><span style="margin-left:auto;color:#7f93ad">Z 开关 · 单击=虚拟舰位 · R 复位 · S 标准位</span>';
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  canvas.style.cssText = 'display:block;border-radius:6px;cursor:crosshair;width:520px;height:520px';
  const info = document.createElement('div');
  info.style.cssText = 'padding:6px 4px 2px;min-height:34px;white-space:pre';
  wrap.append(head, canvas, info);
  document.body.append(wrap);

  // ★ 头部拖拽：选点阶段可把面板挪开，不挡选点地图（用户定 2026-09-27）
  head.style.cursor = 'move';
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).tagName === 'B' || (e.target as HTMLElement).tagName === 'SPAN') {
      const r = wrap.getBoundingClientRect();
      const offX = e.clientX - r.left, offY = e.clientY - r.top;
      const move = (ev: PointerEvent): void => {
        wrap.style.left = `${ev.clientX - offX}px`;
        wrap.style.top = `${ev.clientY - offY}px`;
        wrap.style.right = 'auto';
      };
      const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
  });

  const g = canvas.getContext('2d')!;
  const sectors = new SectorBuilder();
  /** 虚拟舰位（默认 = 真实舰位；修判断时点地图换） */
  let center = { ...deps.ship() };
  let centerSource: 'ship' | 'std' | 'click' = 'ship';
  let shipY: number | null = null;
  let dirty = true;
  let hover: { x: number; z: number } | null = null;
  let lastBuild = 0;

  const viewR = (): number => {
    const b = deps.band();
    return Math.max(160, b.rHi + 40);
  };
  const scale = (): number => SIZE / (2 * viewR());
  const toScreen = (x: number, z: number): [number, number] => {
    const s = scale();
    return [(x - center.x) * s + SIZE / 2, (z - center.z) * s + SIZE / 2];
  };
  const toWorld = (px: number, py: number): { x: number; z: number } => {
    const s = scale();
    return { x: center.x + (px - SIZE / 2) / s, z: center.z + (py - SIZE / 2) / s };
  };
  const surface = (x: number, z: number): number => {
    const h = deps.surfaceAt(x, z);
    return Number.isFinite(h) ? h : -Infinity;
  };
  const secOf = (x: number, z: number): number => {
    let a = Math.atan2(z - center.z, x - center.x);
    if (a < 0) a += Math.PI * 2;
    return Math.floor((a / (Math.PI * 2)) * SECTOR_COUNT) % SECTOR_COUNT;
  };

  const rebuild = (): void => {
    const b = deps.band();
    shipY = Number.isFinite(surface(center.x, center.z)) ? surface(center.x, center.z) : null;
    sectors.buildAll(center.x, center.z, shipY, b.rLo, b.rHi, surface, deps.blockedAt);
    dirty = false;
  };

  const drawTerrain = (): void => {
    const s = scale();
    const cell = Math.max(2, Math.round(SECTOR_CELL * s));
    const R = viewR();
    const t0 = performance.now();
    for (let dz = -R; dz <= R; dz += SECTOR_CELL) {
      for (let dx = -R; dx <= R; dx += SECTOR_CELL) {
        const h = surface(center.x + dx, center.z + dz);
        if (!Number.isFinite(h) || h === -Infinity) continue;
        const role = deps.tileAt(center.x + dx, center.z + dz).genRole;
        const [px, py] = toScreen(center.x + dx, center.z + dz);
        let color: string;
        if (role === 'liquid') color = '#1b3a5c';
        else if (role === 'pit') color = '#241a2e';
        else {
          const k = Math.max(0, Math.min(1, (h + 4) / 14));
          const v = Math.round(28 + k * 60);
          color = `rgb(${v},${v + 6},${v + 2})`;
        }
        g.fillStyle = color;
        g.fillRect(px - cell / 2, py - cell / 2, cell, cell);
      }
    }
    return void t0;
  };

  const drawZones = (): void => {
    const s = scale();
    const cell = Math.max(3, SECTOR_CELL * s);
    const mains = new Set(deps.mainSectors());
    // 边界射线
    g.strokeStyle = 'rgba(140,170,210,.5)';
    g.lineWidth = 1;
    for (let i = 0; i < SECTOR_COUNT; i++) {
      const a = (i / SECTOR_COUNT) * Math.PI * 2;
      const [cx0, cy0] = toScreen(center.x, center.z);
      const [cx1, cy1] = toScreen(center.x + Math.cos(a) * viewR(), center.z + Math.sin(a) * viewR());
      g.beginPath(); g.moveTo(cx0, cy0); g.lineTo(cx1, cy1); g.stroke();
    }
    for (const s0 of sectors.sectors) {
      const hue = (s0.idx * 45 + 10) % 360;
      const isMain = mains.has(s0.idx);
      g.fillStyle = `hsla(${hue},85%,${isMain ? 62 : 48}%,${isMain ? 0.75 : 0.34})`;
      for (const p of s0.points) {
        const [px, py] = toScreen(p.x, p.z);
        g.fillRect(px - cell / 2, py - cell / 2, cell, cell);
      }
      // ★ 高地（优先占领）金色描边（用户定 2026-09-27）
      g.strokeStyle = 'rgba(255,214,106,.95)';
      g.lineWidth = 2;
      for (const p of s0.points) {
        if (p.high !== true) continue;
        const [px, py] = toScreen(p.x, p.z);
        g.strokeRect(px - cell / 2, py - cell / 2, cell, cell);
      }
      // 标签（点集质心处）
      if (s0.points.length) {
        let ax = 0, az = 0;
        for (const p of s0.points) { ax += p.x; az += p.z; }
        const [lx, ly] = toScreen(ax / s0.points.length, az / s0.points.length);
        g.font = 'bold 13px Consolas,monospace';
        g.fillStyle = '#fff';
        g.strokeStyle = 'rgba(0,0,0,.85)';
        g.lineWidth = 3;
        const txt = `区${s0.idx}${isMain ? '★' : ''} n=${s0.points.length} ${s0.dMin | 0}~${s0.dMax | 0}m`;
        g.strokeText(txt, lx - 52, ly);
        g.fillText(txt, lx - 52, ly);
      }
    }
    // 真实舰位（若与虚拟位不同）
    const ship = deps.ship();
    if (Math.hypot(ship.x - center.x, ship.z - center.z) > 0.5) {
      const [sx, sy] = toScreen(ship.x, ship.z);
      g.strokeStyle = '#ffd76a'; g.lineWidth = 2;
      g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffd76a'; g.fillText('舰(真)', sx + 9, sy + 4);
    }
    // 虚拟位十字
    const [mx, my] = toScreen(center.x, center.z);
    g.strokeStyle = '#ff6b6b'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(mx - 9, my); g.lineTo(mx + 9, my);
    g.moveTo(mx, my - 9); g.lineTo(mx, my + 9);
    g.stroke();
  };

  const explain = (x: number, z: number): string => {
    const b = deps.band();
    const d = Math.hypot(x - center.x, z - center.z);
    const h = surface(x, z);
    const role = deps.tileAt(x, z).genRole ?? '-';
    const blocked = deps.blockedAt(x, z);
    const inHi = shipY !== null && Number.isFinite(h)
      ? sectors.shipHighland.contains(center.x, center.z, shipY, x, z, surface) : false;
    const inBand = d >= b.rLo && d <= b.rHi;
    const sec = secOf(x, z);
    const pt = sectors.sectors[sec]?.points.some((p) => Math.hypot(p.x - x, p.z - z) <= SECTOR_CELL * 0.75);
    const why: string[] = [];
    if (!Number.isFinite(h)) why.push('无地表');
    if (blocked) why.push('硬通行排除(坑/水/墙)');
    if (inHi) why.push('与主角相连高原（连通）排除');
    if (!inBand) why.push(`带外(d=${d.toFixed(1)} 带[${b.rLo | 0},${b.rHi | 0}])`);
    return `(${x.toFixed(1)}, ${z.toFixed(1)}) h=${Number.isFinite(h) ? h.toFixed(1) : '—'} 地块=${role} 距=${d.toFixed(1)}m 区${sec}`
      + `\n${pt ? '✔ 属防区点集' : '✘ 不属防区点集'}${pt && sectors.sectors[sec]?.points.some((p) => p.high && Math.hypot(p.x - x, p.z - z) <= SECTOR_CELL * 0.75) ? '(高地)' : ''}${why.length ? ' ← ' + why.join(' / ') : ''}`;
  };

  const render = (): void => {
    const now = performance.now();
    // ★ 默认跟随真实舰位（选点阶段=标准位；世界开始=出生点）；用户点过地图则保持点选位
    if (centerSource !== 'click') {
      const s = deps.ship();
      if (Math.abs(s.x - center.x) > 0.01 || Math.abs(s.z - center.z) > 0.01) { center = { x: s.x, z: s.z }; dirty = true; }
    }
    if (dirty && now - lastBuild > 250) { lastBuild = now; rebuild(); }
    if (!dirty && rebuildNeeded()) { dirty = true; }
    g.clearRect(0, 0, SIZE, SIZE);
    drawTerrain();
    drawZones();
    head.querySelector('#szv-pos')!.textContent = `中心(${center.x | 0},${center.z | 0}) 源=${centerSource} 舰Y=${shipY?.toFixed(1) ?? '—'}`;
    if (hover) info.textContent = explain(hover.x, hover.z);
    else info.textContent = '把鼠标移到地图上：显示坐标 + 该点为何在/不在防区';
    requestAnimationFrame(render);
  };
  let lastBand = '';
  const rebuildNeeded = (): boolean => {
    const b = deps.band();
    const tag = `${center.x | 0},${center.z | 0},${b.rLo | 0},${b.rHi | 0}`;
    if (tag !== lastBand) { lastBand = tag; return true; }
    return false;
  };

  const setCenter = (x: number, z: number, src: 'ship' | 'std' | 'click'): void => {
    center = { x, z };
    centerSource = src;
    dirty = true;
  };

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    hover = toWorld((e.clientX - r.left) * (SIZE / r.width), (e.clientY - r.top) * (SIZE / r.height));
  });
  canvas.addEventListener('mouseleave', () => { hover = null; });
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const w = toWorld((e.clientX - r.left) * (SIZE / r.width), (e.clientY - r.top) * (SIZE / r.height));
    setCenter(w.x, w.z, 'click');
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const s = deps.ship();
    setCenter(s.x, s.z, 'ship');
  });
  const onKey = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === 'z') { wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none'; }
    else if (k === 'r') { const s = deps.ship(); setCenter(s.x, s.z, 'ship'); }
    else if (k === 's') { setCenter(STANDARD_POS.x, STANDARD_POS.z, 'std'); }
  };
  window.addEventListener('keydown', onKey);

  requestAnimationFrame(render);
  return {
    toggle: () => { wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none'; },
    destroy: () => { window.removeEventListener('keydown', onKey); wrap.remove(); },
  };
}
