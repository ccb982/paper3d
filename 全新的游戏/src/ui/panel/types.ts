// ============================================================
// panel/types.ts —— 面板系统公共类型
// ============================================================

/**
 * 面板渲染结果：可直接给 DOM 元素，或给出“标题栏动作”配置。
 * PanelManager 会用 render() 拿到内容，若面板声明了 title/actions，
 * 由管理器统一渲染标题栏（含关闭按钮）——这样每个面板不再各自
 * 手写“右上角关闭按钮”，统一管辖。
 */
export interface PanelRenderOptions {
  root: HTMLElement;
  close: () => void;
}

/** 面板唯一 id */
export type PanelId = string;

/** 面板标题栏动作（右上角） */
export interface PanelAction {
  id: string;
  label?: string;
  icon?: string;
  onClick: () => void;
}

/** 非模态悬浮小部件（对话气泡、悬浮文字、提示等） */
export interface WidgetHandle {
  readonly el: HTMLElement;
  close(): void;
}
