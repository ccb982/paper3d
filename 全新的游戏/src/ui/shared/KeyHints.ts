// ============================================================
// ui/shared/KeyHints —— 快捷键说明条（主页面/舰船/世界 HUD 共用；用户定 2026-09-30）
// ============================================================
// 只做显示（固定左下角小字）；点击不绑定行为（行为键保持单一来源）。
// ============================================================

export function mountKeyHints(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = 'key-hints';
  el.style.cssText =
    'position:fixed;left:10px;bottom:8px;z-index:25;pointer-events:none;'
    + 'background:rgba(10,14,20,.55);border:1px solid rgba(80,110,150,.35);border-radius:8px;'
    + 'padding:6px 10px;color:#cfe0f5;font:11.5px/1.7 system-ui,Segoe UI,sans-serif;'
    + 'max-width:520px;user-select:none';
  el.innerHTML = [
    '<b>快捷键</b>',
    'WASD 移动 ｜ 空格 跳跃 ｜ 左键 攻击 ｜ F 交互/停靠',
    '滚轮 切武器 ｜ Ctrl+滚轮 缩放视角 ｜ Tab 背包 ｜ Q 世界地图',
  ].join('<br>');
  document.body.appendChild(el);
  return el;
}
