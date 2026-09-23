// ============================================================
// gatherIcons.ts —— 采集物图标配置（id ↔ 道具图标.ftx3.gz 帧序）
// ============================================================
// 与 sixBrothers 同款：此处是唯一的「id ↔ 帧序」映射表，
// 供 GatherIcons 加载器与（背包/加工台）图标系统复用。
// ============================================================

export interface GatherIconEntry {
  id: string;
  name: string;
  /** 道具图标.ftx3.gz 中的帧索引 */
  frame: number;
}

/** 采集后入包的物品图标（帧序 = 解包确认：0 草药 / 1 花 / 2 木 / 3 浆果） */
export const GATHER_ICONS: GatherIconEntry[] = [
  { id: 'herb', name: '草药', frame: 0 },
  { id: 'flower', name: '花', frame: 1 },
  { id: 'wood', name: '木料', frame: 2 },
  { id: 'berry', name: '浆果', frame: 3 },
];

export const GATHER_ICON_IDS = GATHER_ICONS.map((g) => g.id);
