// ============================================================
// ItemSlot.ts —— 共享 UI 组件：物品格渲染
// 舰船背包和世界拾取提示共用同一套视觉规范。
// ============================================================

export interface ItemSlotData {
  itemId: string;
  stackSize: number;
  row: number;
  col: number;
}

export function renderItemSlot(
  data: ItemSlotData,
  options?: {
    cellSize?: number;
    onClick?: () => void;
    highlight?: boolean;
  },
): HTMLElement {
  const cellSize = options?.cellSize ?? 48;
  const el = document.createElement('div');
  el.style.cssText = [
    `width:${cellSize}px`,
    `height:${cellSize}px`,
    'background:rgba(68,136,255,0.2)',
    'border:1px solid #4466aa',
    'border-radius:2px',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'font-size:10px',
    'color:#8af',
    'overflow:hidden',
    'cursor:pointer',
    'position:relative',
    options?.highlight ? 'box-shadow:0 0 6px rgba(68,136,255,0.6)' : '',
  ].filter(Boolean).join(';');
  el.title = `${data.itemId} (x${data.stackSize})`;

  const nameEl = document.createElement('span');
  nameEl.textContent = data.itemId.length > 6 ? data.itemId.slice(0, 6) : data.itemId;
  el.appendChild(nameEl);

  const countEl = document.createElement('span');
  countEl.style.cssText = 'font-size:9px;color:#6af;position:absolute;bottom:2px;right:4px;';
  countEl.textContent = `x${data.stackSize}`;
  el.appendChild(countEl);

  if (options?.onClick) {
    el.addEventListener('click', options.onClick);
  }
  return el;
}

/** 渲染空格子 */
export function renderEmptySlot(cellSize: number = 48): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    `width:${cellSize}px`,
    `height:${cellSize}px`,
    'background:rgba(255,255,255,0.03)',
    'border:1px solid #2a2a4a',
    'border-radius:2px',
  ].join(';');
  return el;
}