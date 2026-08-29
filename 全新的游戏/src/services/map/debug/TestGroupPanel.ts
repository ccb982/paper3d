// ============================================================
// TestGroupPanel —— 测试地图组内容面板（调试专用 DOM 覆盖层）
// ============================================================
// 显示当前测试组的全部成员，按【地块类型】分组（平地/装饰性平地/高台/
// 装饰性高台/水/坑洞），并统计实际生成 chunk(0,0) 里每种地块的块数
// ——素材填充时一眼看清"组里有什么、实际出了多少"。
// 纯 DOM + pointer-events:none，不碰 three/游戏状态；页面级生命周期。
// ============================================================

import { groupByKey } from '../TileGroups';
import { generateChunk } from '../ChunkGenerator';
import { tileById, tileByKey, tileTypeName, TILE_TYPE_ORDER } from '../Tiles';
import { TILE_TYPE_COLORS } from './TileLabels';

/** RasterMap 默认 seed（与其构造默认一致）→ 统计数字 = 玩家实际所见 chunk(0,0) */
const DEFAULT_SEED = 12345;

let el: HTMLDivElement | null = null;

/** 显示/刷新面板；groupKey 缺省时取实际生成 chunk 的生效组 */
export function showTestGroupPanel(groupKey?: string): void {
  const key = groupKey ?? generateChunk(DEFAULT_SEED, 0, 0).groupKey;
  const group = groupByKey(key);
  if (!group) return;

  // 实际 chunk 的块数直方图（与玩家所见同 seed 同坐标 → 数字即所见）
  const chunk = generateChunk(DEFAULT_SEED, 0, 0);
  const counts = new Map<string, number>();
  for (const id of chunk.blockTypes) {
    const td = tileById(id);
    counts.set(td.key, (counts.get(td.key) ?? 0) + 1);
  }

  // 成员按类型分组
  const byType = new Map<string, Array<{ label: string; key: string; id: number; count: number; inGroup: boolean }>>();
  // ① 组声明成员（不论是否被本 chunk 抽中都列出）
  for (const memberKey of Object.keys(group.members)) {
    const td = tileByKey(memberKey);
    if (!td) continue;
    const type = tileTypeName(td);
    const list = byType.get(type) ?? (byType.set(type, []), byType.get(type)!);
    list.push({ label: td.label, key: td.key, id: td.id, count: counts.get(td.key) ?? 0, inGroup: true });
  }
  // ② 本 chunk 实际出现但不属于组声明的（回退链产出，标注 ⚠）
  for (const [k, count] of counts) {
    if (k in group.members) continue;
    const td = tileByKey(k);
    if (!td) continue;
    const type = tileTypeName(td);
    const list = byType.get(type) ?? (byType.set(type, []), byType.get(type)!);
    list.push({ label: td.label, key: td.key, id: td.id, count, inGroup: false });
  }

  const rows: string[] = [];
  rows.push(`<div style="font-weight:700;color:#fff;margin-bottom:4px">测试组 <span style="color:#7fd4ff">${group.key}</span> · ${group.label}</div>`);
  for (const type of TILE_TYPE_ORDER) {
    const list = byType.get(type);
    if (!list || list.length === 0) continue;
    const color = TILE_TYPE_COLORS[type] ?? '#ccc';
    rows.push(`<div style="margin-top:5px;color:${color};font-weight:700">■ ${type}</div>`);
    for (const it of list) {
      const warn = it.inGroup ? '' : ' <span style="color:#e0a">⚠回退</span>';
      rows.push(
        `<div style="padding-left:14px;display:flex;justify-content:space-between;gap:8px">`
        + `<span>${it.label} <span style="color:#888">${it.key}·${it.id}</span>${warn}</span>`
        + `<span style="color:#ffe08a">×${it.count}</span></div>`,
      );
    }
  }

  if (!el) {
    el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '999',
      font: '12px/1.55 Consolas, "Microsoft YaHei", monospace',
      background: 'rgba(10,12,16,0.8)', border: '1px solid rgba(255,255,255,0.25)',
      borderRadius: '10px', padding: '10px 12px', color: '#ddd',
      pointerEvents: 'none', minWidth: '190px', maxWidth: '250px',
      textShadow: '0 1px 2px rgba(0,0,0,0.8)',
    } as CSSStyleDeclaration);
    document.body.appendChild(el);
  }
  el.innerHTML = rows.join('');
}

export function disposeTestGroupPanel(): void {
  el?.remove();
  el = null;
}
