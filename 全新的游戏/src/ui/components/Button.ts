// ============================================================
// Button.ts —— 共享 UI 组件：统一按钮样式
// ============================================================

export type ButtonStyle = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const STYLE_MAP: Record<ButtonStyle, string> = {
  primary: 'background:#4488ff;color:#fff;border:none;',
  secondary: 'background:#4466aa;color:#fff;border:none;',
  danger: 'background:#cc4444;color:#fff;border:none;',
  ghost: 'background:transparent;color:#8af;border:1px solid #4466aa;',
};

const SIZE_MAP: Record<ButtonSize, string> = {
  sm: 'padding:4px 12px;font-size:12px;',
  md: 'padding:8px 16px;font-size:14px;',
  lg: 'padding:10px 24px;font-size:16px;',
};

export function createButton(options: {
  label: string;
  style?: ButtonStyle;
  size?: ButtonSize;
  onClick?: () => void;
  fullWidth?: boolean;
}): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = options.label;
  const styleType = options.style ?? 'primary';
  const sizeType = options.size ?? 'md';
  btn.style.cssText = [
    STYLE_MAP[styleType],
    SIZE_MAP[sizeType],
    'border-radius:6px',
    'cursor:pointer',
    'font-weight:bold',
    'transition:opacity 0.2s',
    options.fullWidth ? 'width:100%' : '',
  ].filter(Boolean).join(';');

  btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });

  if (options.onClick) {
    btn.addEventListener('click', options.onClick);
  }
  return btn;
}