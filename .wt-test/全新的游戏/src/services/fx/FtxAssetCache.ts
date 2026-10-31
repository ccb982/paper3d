// ============================================================
// FtxAssetCache.ts —— FTX 资产按 URL 缓存加载
// ============================================================
// 对话立绘 / NPC 贴片等共享同一份资产（FtxAsset.load 本身不做缓存，
// 重复调用会重复 fetch + 解包）；失败自动清缓存以便重试。
// ============================================================

import { FtxAsset } from '../../vendor/player/FtxAsset';

const cache = new Map<string, Promise<FtxAsset>>();

/** 按 URL 缓存加载 FTX 资产（同 URL 只加载一次） */
export function loadFtxCached(url: string): Promise<FtxAsset> {
  let p = cache.get(url);
  if (!p) {
    p = FtxAsset.load(encodeURI(url));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
