// ============================================================
// GatherIcons.ts —— 采集物图标（FTX → 背包 UI 画布）
// ============================================================
// 把 public/textures/道具图标.ftx3.gz 解包为 4 张画布（草药/花/木/浆果），
// 以 id → 画布 映射返回；与六区兄弟同款：全模块共享一份 Promise（只解包一次）。
// 合成数学复用 BasicMaterialsIcons.compositeFrameToCanvas（与游戏内 shader 同源）。
// ============================================================

import { FtxAsset } from '../../vendor/player/FtxAsset';
import { compositeFrameToCanvas } from './BasicMaterialsIcons';
import { GATHER_ICONS } from '../../config/gatherIcons';

/** 素材统一放 public/（运行时 URL） */
const GATHER_ICONS_URL = '/textures/道具图标.ftx3.gz';

let sharedPromise: Promise<Map<string, HTMLCanvasElement>> | null = null;

/** 采集物 4 张图标（id → 画布）；全模块共享，只解包一次 */
export function loadGatherIcons(): Promise<Map<string, HTMLCanvasElement>> {
  if (sharedPromise) return sharedPromise;
  sharedPromise = (async () => {
    const asset = await FtxAsset.load(GATHER_ICONS_URL);
    const map = new Map<string, HTMLCanvasElement>();
    for (const entry of GATHER_ICONS) {
      map.set(entry.id, compositeFrameToCanvas(asset, entry.frame));
    }
    return map;
  })();
  // 失败后允许下次重试
  sharedPromise.catch(() => { sharedPromise = null; });
  return sharedPromise;
}
