// ============================================================
// UIConstants.ts —— 高频 UI 样式常量
// 将散落的 style.cssText 字符串抽离为 CSS 类 + 辅助函数，
// 提升可维护性，方便后续"换皮"。
// ============================================================

/** 基础 CSS 类名（通过 className 追加） */
export const CSS = {
  /** 全屏遮罩弹窗层 */
  overlay: 'ui-overlay',
  /** 底部居中交互提示 */
  interactPrompt: 'ui-interact-prompt',
  /** 浮动文字（拾取/伤害数值） */
  floatingText: 'ui-floating-text',
  /** 深色面板 */
  panel: 'ui-panel',
  /** 背包标签栏 */
  tabBar: 'ui-tab-bar',
  /** 标签按钮 */
  tabButton: 'ui-tab-btn',
  /** 标签按钮激活态 */
  tabButtonActive: 'ui-tab-btn-active',
  /** 物品格子 */
  slot: 'ui-slot',
  /** 物品图标 */
  slotIcon: 'ui-slot-icon',
  /** 数量角标 */
  slotCount: 'ui-slot-count',
  /** 物品详情面板 */
  detailPanel: 'ui-detail-panel',
  /** 面板标题 */
  panelTitle: 'ui-panel-title',
  /** 面板文本行 */
  panelText: 'ui-panel-text',
  /** 面板描述 */
  panelDesc: 'ui-panel-desc',
} as const;

/** 动态样式辅助 —— 生成仅含 className + 动态属性的 style.cssText */
export function dynamicStyle(className: string, overrides: Record<string, string> = {}): string {
  const dyn = Object.entries(overrides)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `${className};${dyn}`;
}