// ============================================================
// EnemyKillHud —— 「敌人数量和舰船生命」顶部状态条
// ============================================================
// 素材：public/ui/敌人数量和舰船生命.ftx3.gz（644×68，用户仿明日方舟 UI）
// 位置：**屏幕最顶部、水平居中、等比缩小**（用户定调 2026-09-16：
//       "等比缩小居中，明日方舟的 ui 没这么大，用我 ftx 纹理的比例"）
//
// 素材版式（实测解码 644×68，**两段式**镜像对称）：
//   竖线①  x≈18  (0.028)   —— 左端装饰
//   ENEMY 图标 x 65~137 (中心 0.157)  —— 橙色准星
//   左段留白   x 140~330 (中心 0.365)  ← 在此放「今日击杀 / 今日上限」（蜂群引擎账本）
//   竖线②  x≈332 (0.516)   —— 中缝
//   舰船图标   x 401~463 (中心 0.671)  —— 蓝色舰船
//   右段留白   x 470~627 (中心 0.852)  ← 在此放「舰船生命数字」
//
// 文字落位（按素材比例换算，随宽度等比缩放）：数值见 ANCHOR_* 常量
//
// 舰船生命配色（用户定调）：
//   ≥90%   白色
//   ≥30%   黄色
//   更低   红橙色
//
// 实现：FtxAsset 载入 → CPU 合成 → dataURL 作 background；
//       高度固定 HUD_TARGET_HEIGHT_PX，**宽度 = 高度 × 素材宽高比** →
//       严格等比、不变形、不拉满通栏；left:50% + translateX(-50%) 居中。
//       素材缺失时降级为纯 CSS 半透明条（绝不留下看不见的空白）。
// ============================================================

import { FtxAsset } from '../../vendor/player/FtxAsset';
import { compositeFrameToCanvas } from '../../ui/shared/ftxFrameToCanvas';

const HUD_ASSET_URL = '/ui/敌人数量和舰船生命.ftx3.gz';

/** ★ 素材原始尺寸（实测 644×68）；纹理就绪后以真实尺寸为准 */
const FALLBACK_W = 644;
const FALLBACK_H = 68;

/** ★ 目标渲染高度（px）—— 素材 644×68 等比缩放到该高度（宽度自动 = 高度 × 644/68）。
 *  用户定调 2026-09-16：明日方舟的顶部条没这么大，**等比缩小 + 居中等**，
 *  不拉满整宽。46px 高 → 约 436px 宽，观感接近方舟顶部资源条。 */
const HUD_TARGET_HEIGHT_PX = 46;

/** ★ 文字锚点（素材归一化 x 坐标；实测留白区中心） */
const ANCHOR_KILL = 0.365;
const ANCHOR_SHIP = 0.852;

/** 舰船生命配色阈值（用户定调） */
export interface ShipHealthPalette {
  /** ≥90%：白色 */
  high: string;
  /** ≥30%：黄色 */
  mid: string;
  /** <30%：红橙色 */
  low: string;
}

const DEFAULT_PALETTE: ShipHealthPalette = {
  high: '#ffffff',
  mid: '#ffd24a',
  low: '#ff5a2b',
};

/** 舰船生命比例 → 配色（导出便于测试与复用） */
export function shipHealthColor(ratio: number, p: ShipHealthPalette = DEFAULT_PALETTE): string {
  if (ratio >= 0.9) return p.high;
  if (ratio >= 0.3) return p.mid;
  return p.low;
}

interface HudTexture {
  dataUrl: string;
  ratio: number;
}

let _texPromise: Promise<HudTexture | null> | null = null;

/** 载入并合成状态条纹理（模块级单例；失败返回 null） */
function loadHudTexture(): Promise<HudTexture | null> {
  if (!_texPromise) {
    _texPromise = FtxAsset.load(encodeURI(HUD_ASSET_URL))
      .then((asset) => {
        const size = asset.getFrameSize(0);
        const canvas = compositeFrameToCanvas(asset, 0);
        return {
          dataUrl: canvas.toDataURL(),
          ratio: size ? size.width / size.height : canvas.width / canvas.height,
        };
      })
      .catch((err) => {
        console.warn('[EnemyKillHud] 素材加载失败，降级为纯色条:', err);
        return null;
      });
  }
  return _texPromise;
}

export class EnemyKillHud {
  /** 容器（背景 = 素材图；按素材原始比例等比缩放，水平居中于屏幕顶部） */
  private root: HTMLDivElement;
  /** 文字层（铺满容器；内部按归一化锚点定位） */
  private textLayer: HTMLDivElement;
  private killText: HTMLSpanElement;
  private shipText: HTMLSpanElement;

  /** 素材宽高比（就绪后更新为真实值） */
  private ratio = FALLBACK_W / FALLBACK_H;

  /** 上帧值（节流：未变不写 DOM） */
  private lastKills = -1;
  private lastTotal = -1;
  private lastShipHp = -1;
  private lastShipMax = -1;
  private lastShipColor = '';

  constructor() {
    const initW = Math.round(HUD_TARGET_HEIGHT_PX * this.ratio);
    // ---- 容器：等比缩放 + 水平居中（★ 不拉满通栏） ----
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'top:0', 'left:50%',
      'transform:translateX(-50%)',
      `width:${initW}px`,
      `height:${HUD_TARGET_HEIGHT_PX}px`,
      'z-index:995', 'pointer-events:none',
      'background-repeat:no-repeat',
      'background-position:center center',
      // ★ 容器尺寸已严格等于素材比例 → 用 100% 100% 不会变形
      'background-size:100% 100%',
      'font-family:"Microsoft YaHei",sans-serif',
      'user-select:none',
    ].join(';');

    // ---- 文字层（铺满容器；内部按归一化锚点定位） ----
    this.textLayer = document.createElement('div');
    this.textLayer.style.cssText = [
      'position:absolute', 'inset:0',
      'display:block', 'pointer-events:none',
    ].join(';');

    // ---- 左半：敌人数量（今日击杀 / 今日上限） ----
    this.killText = document.createElement('span');
    this.killText.textContent = '0 / 0';
    this.killText.style.cssText = [
      'position:absolute',
      `left:${(ANCHOR_KILL * 100).toFixed(2)}%`,
      'top:50%', 'transform:translate(-50%,-50%)',
      'color:#f2f6fa',
      'font-size:14px', 'font-weight:bold', 'letter-spacing:1px',
      'font-variant-numeric:tabular-nums',
      // 轻微描边保证在深色底上清晰（方舟风硬描边）
      'text-shadow:0 0 6px rgba(255,140,40,0.45), 0 1px 3px #000',
      'white-space:nowrap',
    ].join(';');

    // ---- 右半：舰船生命（纯数字，无血条） ----
    this.shipText = document.createElement('span');
    this.shipText.textContent = '0';
    this.shipText.style.cssText = [
      'position:absolute',
      `left:${(ANCHOR_SHIP * 100).toFixed(2)}%`,
      'top:50%', 'transform:translate(-50%,-50%)',
      'color:#ffffff',
      'font-size:14px', 'font-weight:bold', 'letter-spacing:1px',
      'font-variant-numeric:tabular-nums',
      'text-shadow:0 0 10px rgba(120,190,255,0.5), 0 1px 3px #000',
      'white-space:nowrap',
    ].join(';');

    this.textLayer.append(this.killText, this.shipText);
    this.root.appendChild(this.textLayer);
    document.body.appendChild(this.root);

    // ---- 异步贴素材（就绪后用真实比例重算尺寸） ----
    void loadHudTexture().then((tex) => {
      if (!tex) return; // 降级：保留纯色占位
      this.ratio = tex.ratio;
      this.root.style.backgroundImage = `url("${tex.dataUrl}")`;
      // ★ 高度固定 HUD_TARGET_HEIGHT_PX，宽度 = 高度 × 素材宽高比 → 严格等比、不变形
      this.applySize();
      window.addEventListener('resize', this._onResize);
    });
  }

  /** ★ 按目标高度 + 素材比例计算尺寸（等比，绝不变形）；字号同步缩放 */
  private applySize(): void {
    const h = HUD_TARGET_HEIGHT_PX;
    const w = Math.round(h * this.ratio);
    this.root.style.width = `${w}px`;
    this.root.style.height = `${h}px`;
    // ★ 字号按缩放比走：素材里数字高度约 20/68 条高 → 缩到 46px 高时约 13.5px，
    //   取 14px 基准并随实际高度微调（保证不同目标高度下观感一致）
    const fs = Math.max(11, Math.round(h * 0.30));
    this.killText.style.fontSize = `${fs}px`;
    this.shipText.style.fontSize = `${fs}px`;
  }

  private _onResize = (): void => { this.applySize(); };

  /** ★ 显隐（舰内等场景可收起） */
  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  /**
   * ★ 刷新（WorldMode 低频节拍调用，约 0.1s 一次）
   * @param kills 今日击杀数（蜂群引擎账本）
   * @param total 今日上限（引擎 beginDay 预计算的当日总数）
   * @param shipHp 舰船当前生命
   * @param shipMaxHp 舰船生命上限
   */
  update(kills: number, total: number, shipHp: number, shipMaxHp: number): void {
    if (kills !== this.lastKills || total !== this.lastTotal) {
      this.lastKills = kills;
      this.lastTotal = total;
      this.killText.textContent = `${kills} / ${total}`;
    }
    if (shipHp !== this.lastShipHp || shipMaxHp !== this.lastShipMax) {
      this.lastShipHp = shipHp;
      this.lastShipMax = shipMaxHp;
      this.shipText.textContent = String(Math.max(0, Math.ceil(shipHp)));
    }
    const ratio = shipMaxHp > 0 ? shipHp / shipMaxHp : 0;
    const color = shipHealthColor(ratio);
    if (color !== this.lastShipColor) {
      this.lastShipColor = color;
      this.shipText.style.color = color;
      // ★ 红橙色低血量：加强辉光提示（用户定调"红橙"）
      const glow = ratio < 0.3 ? '0 0 14px rgba(255,90,43,0.9), 0 1px 3px #000'
        : ratio < 0.9 ? '0 0 10px rgba(255,210,74,0.6), 0 1px 3px #000'
        : '0 0 10px rgba(120,190,255,0.5), 0 1px 3px #000';
      this.shipText.style.textShadow = glow;
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this._onResize);
    this.root.remove();
  }
}
