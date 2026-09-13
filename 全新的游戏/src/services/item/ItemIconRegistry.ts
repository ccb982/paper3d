// ============================================================
// ItemIconRegistry —— 物品图标服务（物品 ID → 可视图标纹理）
// ============================================================
// 职责：根据 itemId 返回 THREE.Texture（优先从 ftx 加载，无则
// 用 SolidBulletAsset 生成色块兜底）。
// 与 ItemManager 配合，是配置层 → 表现层的桥梁。
// ============================================================

import { ItemManager } from '../../systems/inventory/ItemManager';
import { loadSixBrotherIcons, compositeFrameToCanvas } from './BasicMaterialsIcons';
import { getDroneIconAnimator, DroneIconAnimator } from './DroneIcon';
import { getFluidIconAnimator } from './FluidIconAnimator';
import { getDynamicIconAnimator } from './DynamicIconAnimator';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import type { Asset } from '../../vendor/player';

/** ★ 运行时注册的资产图标源（itemId → scene.zip/FTX 资产；取指定帧合成静态图标）。
 *  如「祖宗」：唯一图标出口 = 这里注册，背包/加工台/友军列表自动共享。 */
const assetIconSources = new Map<string, Asset | FtxAsset>();

/** ★ 注册资产图标源（boot 加载完素材后调用；重复注册覆盖） */
export function registerAssetIconSource(itemId: string, asset: Asset | FtxAsset): void {
  assetIconSources.set(itemId, asset);
}

/** ★ 动态离屏图标源（itemId → 素材 + 帧号）：统一走 DynamicIconAnimator
 *  （VAT 区域实体 + 流体 + 循环播放）；如常规子弹图标。 */
const dynamicIconSources = new Map<string, { asset: Asset | FtxAsset; frameIndex: number }>();

/** ★ 注册动态离屏图标（boot 后调用；多帧素材自动按帧渲染） */
export function registerDynamicIcon(itemId: string, asset: Asset | FtxAsset, frameIndex = 0): void {
  dynamicIconSources.set(itemId, { asset, frameIndex });
}

export interface ItemIconConfig {
  /** 色调 0-1 */
  h: number;
  /** 饱和度 0-1 */
  s: number;
  /** 明度 0-1 */
  l: number;
}

/** ★ 直绘 FTX 图标源（itemId → .ftx3 URL；解包后第 0 帧合成，ID→画布失效则回退色块） */
const FTX_ICON_SOURCES: Record<string, string> = {
  shu_jie_xx: '/fx/黍姐的XX.ftx3.gz',
  yuandeng: '/fx/圆凳.ftx3.gz',
  // 遗物（抽卡/遗物查看与背包同一条"服务 + 播放"管线的回退）：
  black_crown: '/fx/魔王的黑冠.ftx3.gz',
  gravel_love: '/fx/砾小姐的爱.ftx3.gz',
  zuzong_launcher: '/fx/祖宗发射器.ftx3.gz',
};

export class ItemIconRegistry {
  private cache = new Map<string, HTMLCanvasElement>();
  private sixBrothers: Map<string, HTMLCanvasElement> | null = null;
  /** 无人机动态图标动画器（播放器路径：离屏 VAT 渲染） */
  private droneAnimator: DroneIconAnimator | null = null;
  /** ★ 直绘 FTX 图标源（解包完的 FtxAsset；getIcon 按需取帧渲染） */
  private ftxAssets = new Map<string, FtxAsset>();
  /** (id:frame) → 渲染画布缓存 */
  private ftxFrameCache = new Map<string, HTMLCanvasElement>();
  /** ★ FTX 素材未加载完成时创建的占位 img（加载完成后自动替换 src，避免"开面板早=永远色块"） */
  private pendingFtxImgs = new Map<string, { img: HTMLImageElement; frameIndex: number }[]>();

  constructor(private itemManager: ItemManager) {
    // 异步预载六区兄弟图标（六种基础材料），失败则回退色块
    loadSixBrotherIcons()
      .then((map) => { this.sixBrothers = map; })
      .catch((err) => console.warn('[ItemIconRegistry] 六区兄弟图标载入失败，回退色块:', err));
    // 异步预载直绘 FTX 图标（当前：黍姐的XX 防具 / 遗物），按需取帧
    for (const [id, url] of Object.entries(FTX_ICON_SOURCES)) {
      FtxAsset.load(encodeURI(url))
        .then((asset) => {
          this.ftxAssets.set(id, asset);
          this.cache.delete(id);
          // ★ 升级早先创建的占位图标（背包面板可能在素材加载完成前就已渲染）
          const pending = this.pendingFtxImgs.get(id);
          if (pending) {
            for (const p of pending) {
              try { p.img.src = this.getIcon(id, p.frameIndex).toDataURL(); } catch { /* 保持占位 */ }
            }
            this.pendingFtxImgs.delete(id);
          }
        })
        .catch((err) => console.warn(`[ItemIconRegistry] ${id} FTX 图标载入失败，回退色块:`, err));
    }
  }

  /** 获取物品图标画布（六区兄弟来自 FTX 纹理，其余为色块兜底）。frameIndex 用于多帧纹理（如砾小姐的爱按拥有数换帧）。 */
  getIcon(itemId: string, frameIndex = 0): HTMLCanvasElement {
    if (itemId === 'kaltsit_drone') {
      // ★ 动态图标：播放器路径驱动翅膀抖动；每次调用注册独立画布
      this.droneAnimator ??= getDroneIconAnimator();
      return this.droneAnimator.register(this.itemManager);
    }
    // ★ 运行时注册的资产图标（如祖宗 scene.zip）：取帧合成静态配色图
    const assetIcon = assetIconSources.get(itemId);
    if (assetIcon) {
      const akey = itemId + ':' + frameIndex;
      let canvas = this.ftxFrameCache.get(akey);
      if (!canvas) {
        try {
          canvas = compositeFrameToCanvas(assetIcon as unknown as FtxAsset, frameIndex);
          this.ftxFrameCache.set(akey, canvas);
        } catch (e) {
          console.warn(`[ItemIconRegistry] ${itemId} 资产图标合成失败，回退色块:`, e);
          canvas = this.makeFallbackCanvas(itemId);
        }
      }
      return canvas;
    }
    if (this.sixBrothers?.has(itemId)) return this.sixBrothers.get(itemId)!;
    // ★ 直绘 FTX 图标（尚未载入完成 → 走色块兜底，载入后即真实纹理）
    const asset = this.ftxAssets.get(itemId);
    if (asset) {
      const key = itemId + ':' + frameIndex;
      let canvas = this.ftxFrameCache.get(key);
      if (!canvas) {
        try {
          canvas = compositeFrameToCanvas(asset, frameIndex);
          this.ftxFrameCache.set(key, canvas);
        } catch (e) {
          console.warn(`[ItemIconRegistry] ${itemId} 帧 ${frameIndex} 渲染失败，回退色块:`, e);
          canvas = this.makeFallbackCanvas(itemId);
        }
      }
      return canvas;
    }
    if (this.cache.has(itemId)) return this.cache.get(itemId)!;
    const canvas = this.makeFallbackCanvas(itemId);
    this.cache.set(itemId, canvas);
    return canvas;
  }

  /** ★ 统一图标出口：返回可直接挂载的独立显示元素（背包/加工台同一条绘制路径）。
   *  静态（六兄弟/色块兜底）→ 独立 <img>(dataURL)，与背包一致；
   *  动态（无人机）→ 活动画布（register 每次建新画布，翅膀动画播放）。 */
  createIconElement(itemId: string, frameIndex = 0): HTMLCanvasElement | HTMLImageElement {
    if (itemId === 'kaltsit_drone') return this.getIcon(itemId, frameIndex);
    // ★ 资产流体图标（如祖宗）：活体画布直接返回（保持流体求解动画）
    const assetSrc = assetIconSources.get(itemId);
    if (assetSrc) {
      const live = getFluidIconAnimator().register(assetSrc, frameIndex);
      if (live) return live;
    }
    // ★ 动态离屏图标（如常规子弹）：VAT + 流体通用生产线（循环播放）
    const dyn = dynamicIconSources.get(itemId);
    if (dyn) {
      const live = getDynamicIconAnimator().register(dyn.asset, dyn.frameIndex);
      if (live) return live;
    }
    // ★ FTX 图标素材未加载完成：先给色块占位，加载完成后自动替换 src
    if (FTX_ICON_SOURCES[itemId] && !this.ftxAssets.has(itemId)) {
      const img = document.createElement('img');
      img.src = this.makeFallbackCanvas(itemId).toDataURL();
      img.style.objectFit = 'contain';
      let list = this.pendingFtxImgs.get(itemId);
      if (!list) { list = []; this.pendingFtxImgs.set(itemId, list); }
      list.push({ img, frameIndex });
      return img;
    }
    const src = this.getIcon(itemId, frameIndex);
    const img = document.createElement('img');
    img.src = src.toDataURL();
    img.style.objectFit = 'contain';
    return img;
  }

  /** 色块兜底图标（装弹器/药水等无专用纹理物品） */
  private makeFallbackCanvas(itemId: string): HTMLCanvasElement {
    const arch = this.itemManager.getArchetype(itemId);
    const color = arch?.color || { h: 0.55, s: 0.8, l: 0.6 };
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const fill = `hsl(${color.h * 360}, ${color.s * 100}%, ${color.l * 100}%)`;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(32, 32, 27, 0, Math.PI * 2);
    ctx.stroke();
    return canvas;
  }
}