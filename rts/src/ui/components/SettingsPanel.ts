// ============================================================
// components/SettingsPanel.ts —— 设置面板（左上角白齿轮入口）
// ============================================================
// 入口：基地左上角白色齿轮（仅基地模式显示；世界模式自带 UI 不需设置 → 隐藏）
// 内容：① 性能面板开关（FPS/绘制/各阶段耗时 HUD）
//       ② 删除存档（二次确认 → SaveSystem.clear() + reload）
//
// 关键设计：
//   · 齿轮 z-index 必须**高于遮罩**，否则面板打开后齿轮被遮罩盖住点不到。
//   · 标题栏用项目统一返回按钮 createBackButton()（与背包/加工台/抽卡页同一套 UI）。
//   · 面板打开时在 capture 阶段吃掉按键（ESC 关闭 + 其余不下传），
//     防止角色在面板背后被 WASD 带着走。
//   · 删档为二次确认（3s 内再点），不弹原生 confirm（webview/小程序体验差）。
// ============================================================

import { createButton } from './Button';
import { createBackButton } from './BackButton';
import { SaveSystem } from '../../core/SaveSystem';
import { clearWorldStates } from '../../core/WorldStateCache';
import { Minimap } from '../../services/ui/Minimap';

/** 白色齿轮图标（Material settings，单 path 双子路径 → 自带中心圆孔）
 *  ★ 尺寸走 100%（由按钮 padding 决定），改按钮大小不用动图标 */
const GEAR_SVG =
  '<svg width="100%" height="100%" viewBox="0 0 24 24" aria-hidden="true" style="display:block">'
  + '<path fill="#fff" d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58'
  + 'c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94'
  + 'L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29'
  + 'L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12'
  + 's0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96'
  + 'c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54'
  + 'c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61'
  + 'L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>';

/** ★ 齿轮尺寸（改图标大小只改这两个常量；SVG 走 100% 自适应） */
const GEAR_SIZE = 76;
const GEAR_PAD = 16;

export interface SettingsUi {
  /** 显隐（仅基地模式提供设置入口；世界模式隐藏） */
  setVisible(v: boolean): void;
  /** 面板开合（控制台 toggleSettings() 用） */
  toggle(): void;
}

export interface SettingsDeps {
  isHudVisible: () => boolean;
  setHudVisible: (v: boolean) => void;
  /** ★ 当前存档主种子（无存档 = null；设置面板显示/复制用） */
  getSeed: () => number | null;
}

export function createSettingsUI(deps: SettingsDeps): SettingsUi {
  let open = false;

  // ---- 左上角白齿轮按钮 ----
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.title = '设置';
  gear.setAttribute('aria-label', '设置');
  gear.innerHTML = GEAR_SVG;
  gear.style.cssText =
    // ★ z-index 必须高于遮罩(1201)：面板打开后齿轮仍在最上层，点它即返回/收起
    `position:fixed;top:8px;left:8px;z-index:1202;width:${GEAR_SIZE}px;height:${GEAR_SIZE}px;box-sizing:border-box;`
    + `display:flex;align-items:center;justify-content:center;padding:${GEAR_PAD}px;`
    + 'border:none;border-radius:20px;background:rgba(0,0,0,0.45);'
    + 'cursor:pointer;opacity:0.72;pointer-events:auto;'
    + 'transition:opacity .18s,background .18s,transform .18s';
  gear.addEventListener('mouseenter', () => {
    gear.style.opacity = '1';
    gear.style.transform = 'rotate(40deg)';
  });
  gear.addEventListener('mouseleave', () => {
    gear.style.transform = 'none';
    if (!open) gear.style.opacity = '0.72';
  });

  // ---- 遮罩 + 卡片 ----
  const mask = document.createElement('div');
  mask.style.cssText =
    'position:fixed;inset:0;z-index:1201;display:none;align-items:center;justify-content:center;'
    + 'background:rgba(0,0,0,0.5);pointer-events:auto';
  const card = document.createElement('div');
  card.style.cssText =
    'width:352px;max-width:88vw;background:rgba(12,22,36,0.97);border:1px solid #2a4a72;'
    + 'border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.65);'
    + 'color:#eaf6ff;font:14px "Microsoft YaHei",sans-serif;overflow:hidden';

  // ★ 标题栏：统一「返回」按钮（左上角；与背包/加工台/抽卡页同一套 UI）
  const head = document.createElement('div');
  head.style.cssText =
    'display:flex;align-items:center;gap:10px;'
    + 'padding:10px 14px;background:rgba(30,60,100,0.35);border-bottom:1px solid #2a4a72';
  const headTitle = document.createElement('div');
  headTitle.textContent = '设置';
  headTitle.style.cssText = 'font-size:16px;font-weight:bold;letter-spacing:3px;color:#cfe6ff';
  const backBtn = createBackButton({ onClick: () => setOpen(false), height: 30 });
  head.append(backBtn, headTitle);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column';

  /** 一行设置：左侧标题+说明，返回右侧控件插槽 */
  function mkRow(title: string, desc: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:14px;'
      + 'padding:13px 14px;border-bottom:1px solid rgba(42,74,114,0.45)';
    const left = document.createElement('div');
    left.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-width:0';
    const t = document.createElement('div');
    t.textContent = title;
    t.style.cssText = 'font-size:14px;font-weight:bold;color:#eaf6ff';
    const d = document.createElement('div');
    d.textContent = desc;
    d.style.cssText = 'font-size:12px;color:#8fb0cd;line-height:1.55';
    left.append(t, d);
    const right = document.createElement('div');
    right.style.cssText = 'flex:none';
    row.append(left, right);
    body.appendChild(row);
    return right;
  }

  // ---- 行 1：性能面板 ----
  const perfSlot = mkRow('性能面板', '显示 FPS / 绘制调用 / 各阶段耗时。关闭时不累加、不写 DOM，零开销。');
  const perfBtn = createButton({
    label: '开启', style: 'secondary', size: 'sm',
    onClick: () => { deps.setHudVisible(!deps.isHudVisible()); syncPerf(); },
  });
  perfSlot.appendChild(perfBtn);
  function syncPerf(): void {
    const on = deps.isHudVisible();
    perfBtn.textContent = on ? '关闭' : '开启';
    perfBtn.style.background = on ? '#4488ff' : '#4466aa';
  }

  // ---- 行 2：地图种子（显示 + 复制；2026-09-19） ----
  const seedSlot = mkRow('地图种子', '同一存档同一天地图固定（主种子 × 天数）；换天/换局换图。可复制分享。');
  const seedWrap = document.createElement('div');
  seedWrap.style.cssText = 'display:flex;align-items:center;gap:8px';
  const seedVal = document.createElement('div');
  seedVal.style.cssText =
    'font:13px Consolas,monospace;color:#cfe6ff;background:rgba(0,0,0,0.35);'
    + 'border:1px solid #2a4a72;border-radius:6px;padding:4px 8px;max-width:120px;'
    + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  const seedCopy = createButton({
    label: '复制', style: 'secondary', size: 'sm',
    onClick: () => {
      const v = seedVal.textContent ?? '';
      const done = () => { seedCopy.textContent = '已复制'; setTimeout(() => { seedCopy.textContent = '复制'; }, 1000); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(v).then(done).catch(() => done());
      else done();
    },
  });
  seedWrap.append(seedVal, seedCopy);
  seedSlot.appendChild(seedWrap);
  function syncSeed(): void {
    const v = deps.getSeed();
    seedVal.textContent = v === null ? '—' : String(v);
  }

  // ---- 行 3：新局种子（删档重开时使用；留空 = 随机） ----
  const newSeedSlot = mkRow('新局种子', '删除存档并重开时使用；留空 = 随机。输入指定种子可复现地图。');
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedInput.placeholder = '留空 = 随机';
  seedInput.style.cssText =
    'width:120px;box-sizing:border-box;font:13px Consolas,monospace;text-align:center;'
    + 'color:#eaf6ff;background:rgba(0,0,0,0.35);border:1px solid #2a4a72;border-radius:6px;'
    + 'padding:5px 6px;outline:none';
  seedInput.addEventListener('keydown', (e) => e.stopPropagation()); // 输入不被全局按键拦截
  newSeedSlot.appendChild(seedInput);

  // ---- 行 4：删档（二次确认；重开时带上"新局种子"） ----
  const delSlot = mkRow('删除存档', '清空本地存档并重新开局：进度、道具、遗物全部丢失，不可恢复。');
  let armed = false;
  let armTimer = 0;
  const delBtn = createButton({
    label: '删除存档', style: 'danger', size: 'sm',
    onClick: () => {
      if (!armed) {
        armed = true;
        delBtn.textContent = '确认删除？';
        delBtn.style.background = '#ff2f2f';
        armTimer = window.setTimeout(() => resetArm(), 3000);
        return;
      }
      window.clearTimeout(armTimer);
      // ★ 新局种子（可留空）：暂存到 localStorage，boot 建新档时读取（用完即删）
      try {
        const raw = seedInput.value.trim();
        if (/^\d+$/.test(raw)) localStorage.setItem('arknights_rogue_next_seed', raw);
        else localStorage.removeItem('arknights_rogue_next_seed');
      } catch { /* 忽略 */ }
      SaveSystem.clear();
      clearWorldStates();        // ★ 世界状态缓存一并清空（2026-09-19）
      Minimap.clearPersistMask(); // ★ 页内探索缓存（仅删档清）
      console.warn('[设置] 手动删档：存档与世界缓存已清除，重载后将创建新档');
      location.reload();
    },
  });
  function resetArm(): void {
    armed = false;
    delBtn.textContent = '删除存档';
    delBtn.style.background = '#cc4444';
  }
  delSlot.appendChild(delBtn);

  card.append(head, body);
  mask.appendChild(card);
  document.body.append(gear, mask);

  function setOpen(v: boolean): void {
    open = v;
    mask.style.display = v ? 'flex' : 'none';
    gear.style.opacity = v ? '1' : '0.72';
    gear.style.background = v ? 'rgba(20,80,200,0.7)' : 'rgba(0,0,0,0.45)';
    gear.style.transform = 'none';
    gear.title = v ? '关闭设置' : '设置';
    if (v) { syncPerf(); syncSeed(); resetArm(); }
  }

  gear.addEventListener('click', () => setOpen(!open)); // 开 / 关（返回）都是它
  mask.addEventListener('click', (e) => { if (e.target === mask) setOpen(false); }); // 点卡片外空白也收起
  // capture 阶段拦截：面板打开时吃掉按键（ESC 关闭 + 其余不下传，防角色乱走）
  window.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') setOpen(false);
    e.stopPropagation();
  }, true);

  syncPerf();
  return {
    setVisible: (v: boolean) => {
      gear.style.display = v ? 'flex' : 'none';
      if (!v && open) setOpen(false); // 离开基地时顺手收面板
    },
    toggle: () => setOpen(!open),
  };
}
