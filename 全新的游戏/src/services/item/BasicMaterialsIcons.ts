// ============================================================
// BasicMaterialsIcons.ts —— 六区兄弟图标（FTX → 背包 UI 画布）
// ============================================================
// 合成实现已收敛到 src/fx/tex/ftxComposite.ts（唯一真源）。
// 本文件保留 compositeFrameToCanvas 的导出名，让 4 个既有调用点
// （WorldMode 祖宗弹纹理 / GatherIcons / ItemIconRegistry / CoverRenderer）不用改。
// ★ 不要再在这里写合成数学。
// ============================================================

import { FtxAsset } from '../../vendor/player/FtxAsset';
import { SIX_BROTHERS } from '../../config/sixBrothers';
import { compositeFrameToCanvas } from '../../fx/tex/ftxComposite';

export { compositeFrameToCanvas };

// ★ 素材统一放 public/（运行时 URL）：public/textures/六区兄弟.ftx3.gz
const FIX_BROTHERS_URL = '/textures/六区兄弟.ftx3.gz';

let sharedPromise: Promise<Map<string, HTMLCanvasElement>> | null = null;

/** 六区兄弟 6 张图标（id → 画布）；全模块共享，只解包一次 */
export function loadSixBrotherIcons(): Promise<Map<string, HTMLCanvasElement>> {
  if (sharedPromise) return sharedPromise;
  sharedPromise = (async () => {
    const asset = await FtxAsset.load(FIX_BROTHERS_URL);
    const map = new Map<string, HTMLCanvasElement>();
    for (const mat of SIX_BROTHERS) {
      map.set(mat.id, compositeFrameToCanvas(asset, mat.frame));
    }
    return map;
  })();
  // 失败后允许下次重试
  sharedPromise.catch(() => { sharedPromise = null; });
  return sharedPromise;
}
