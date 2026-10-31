// ============================================================
// components/BackButton.ts —— 统一「返回」按钮（FTX 纹理版）
// ============================================================
// 素材：/ui/返回按钮.ftx3.gz（与抽卡页左上角同一张）
// 用途：所有「关闭 / 返回上一级」语义的 DOM 面板统一用它，
//       替代此前的「✕ 关闭」文字按钮。
//
// 关键设计：
//   · 纹理为 FTX（base HSL + 残差），CPU 合成一次 → dataURL，
//     模块级缓存（同一张纹理在任意多面板里复用，只解码一次）。
//   · 尺寸由**高度**驱动，宽度按纹理真实比例推导 → 不会拉伸。
//   · 悬停/按下用 CSS filter / transform，不额外占用素材。
//   · 素材缺失时降级为文字按钮（绝不留下一个看不见的空白按钮）。
// ============================================================

import { FtxAsset } from '../../vendor/player/FtxAsset';
import { compositeFrameToCanvas } from '../shared/ftxFrameToCanvas';

const BACK_ASSET_URL = '/ui/返回按钮.ftx3.gz';
/** 兜底宽高比（实测 252×88）；纹理就绪后以真实尺寸为准 */
const FALLBACK_RATIO = 252 / 88;

interface BackTexture {
  dataUrl: string;
  ratio: number;
}

let _texPromise: Promise<BackTexture | null> | null = null;

/** 载入并合成返回按钮纹理（模块级单例；失败返回 null） */
function loadBackTexture(): Promise<BackTexture | null> {
  if (!_texPromise) {
    _texPromise = FtxAsset.load(BACK_ASSET_URL)
      .then((asset) => {
        const size = asset.getFrameSize(0);
        const canvas = compositeFrameToCanvas(asset, 0);
        return {
          dataUrl: canvas.toDataURL(),
          ratio: size ? size.width / size.height : canvas.width / canvas.height,
        };
      })
      .catch((err) => {
        console.warn('[BackButton] 返回按钮素材加载失败，降级为文字按钮:', err);
        return null;
      });
  }
  return _texPromise;
}

export interface BackButtonOptions {
  /** 点击行为（一般是关闭当前面板） */
  onClick: () => void;
  /** 纹理高度（px）；宽度按纹理比例自动推导。默认 35 */
  height?: number;
  /** 额外内联样式（如定位） */
  style?: string;
}

/**
 * 创建统一的返回按钮。
 * ★ 同步返回元素；纹理异步就绪后贴上背景图（未就绪期间是透明占位，
 *   不会造成布局跳动 —— 宽高在创建时已按兜底比例定死）。
 */
export function createBackButton(opts: BackButtonOptions): HTMLButtonElement {
  const height = opts.height ?? 35;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = '返回';
  btn.setAttribute('aria-label', '返回');
  btn.style.cssText = [
    'flex:none', 'display:block', 'box-sizing:border-box',
    'padding:0', 'margin:0', 'border:0',
    'background-color:transparent', 'background-repeat:no-repeat',
    'background-position:center', 'background-size:100% 100%',
    'cursor:pointer', 'outline:none', 'user-select:none',
    '-webkit-tap-highlight-color:transparent',
    `height:${height}px`,
    `width:${Math.round(height * FALLBACK_RATIO)}px`,
    'transition:filter .12s ease,transform .08s ease',
    opts.style ?? '',
  ].join(';');

  // 悬停/按下反馈（无第二张素材）
  btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.3)'; });
  btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });
  btn.addEventListener('pointerdown', () => { btn.style.transform = 'scale(0.94)'; });
  btn.addEventListener('pointerup', () => { btn.style.transform = ''; });
  btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
  btn.addEventListener('click', () => opts.onClick());

  void loadBackTexture().then((tex) => {
    if (!tex) {
      // 降级：文字按钮（沿用旧「关闭」的观感，保证一定可见可点）
      btn.textContent = '← 返回';
      btn.style.cssText += ';width:auto;padding:6px 14px;font-size:13px;'
        + 'color:#8af;background:rgba(20,20,40,0.6);border:1px solid #4466aa;border-radius:6px;';
      return;
    }
    btn.style.backgroundImage = `url("${tex.dataUrl}")`;
    btn.style.width = `${Math.round(height * tex.ratio)}px`;
  });

  return btn;
}
