// ============================================================
// 主绘画页面素材包导出（场景级资产容器）
// 职责边界：包 = 资产容器，只装载/组织资产，不含播放/层级语义。
// 结构：
//   manifest.json              清单 + 轻量校验（fnv1a32）
//   textures/frames.ftx3.gz    packMultiFrameToBinary + gzip（纹理帧）
//   per_frame_data/frame_N.json  区域实体（serialize + fixedVertices）+ 物理场（整体 fluidConfig）
// 导出规则：图层按 displayId 排序；有纹理(rawRegionIdTex)、区域实体或物理场
// (fluidConfig) 之一即导出，三样全空才跳过。
// ============================================================

import { packMultiFrameToBinary, type FrameExportData } from '../utils/multiFrameExport';
import { compressToGzip } from '../utils/binaryCompression';
import { packZip, fnv1a32, type ZipEntry } from './zipStore';
import type { Layer, FrameData, RegionAnnotation, Point } from '../types';
import type { SharedBaseColor } from '../stores/useAppStore';
import type { RegionEntity } from '../core/RegionEntity';

export interface AssetBundleSourceState {
  layers: Layer[];
  frameDataMap: Record<string, FrameData>;
  regionEntities: Record<string, RegionEntity[]>;
  regionAnnotations: RegionAnnotation[];
  sharedBaseColors: SharedBaseColor[];
}

export interface AssetBundleExportOptions {
  /** 帧间预测（默认 true） */
  enablePrediction?: boolean;
}

/** 独立导出的纯粹区域注释（无匹配区域实体），单独存放于 annotations.json */
export interface PureAnnotationExport {
  id: string;
  layerId: string;
  layerName: string;
  displayId: number;
  text: string;
  color: string;
  regionId: string | number;
  polygon: Point[][];
  maskEffect: RegionAnnotation['maskEffect'] | null;
}

export interface AssetBundleExportResult {
  bytes: Uint8Array;
  /** 导出图层总数（含纯物理/纯实体层） */
  frameCount: number;
  /** 纹理帧数（进入 ftx3 的帧） */
  textureFrameCount: number;
  paletteCount: number;
  /** 独立导出的纯粹区域注释数（annotations.json） */
  annotationCount: number;
  /** 三样全空被跳过的图层名 */
  skippedLayers: string[];
}

interface FrameEntry {
  layer: Layer;
  fd: FrameData | undefined;
  entities: RegionEntity[];
  hasTexture: boolean;
  hasEntity: boolean;
  hasPhysics: boolean;
  textureIndex: number;
}

export async function exportMainCanvasAssetBundle(
  source: AssetBundleSourceState,
  options: AssetBundleExportOptions = {},
): Promise<AssetBundleExportResult> {
  const { layers, frameDataMap, regionEntities, regionAnnotations, sharedBaseColors } = source;
  const enablePrediction = options.enablePrediction ?? true;

  // 1. 收集导出图层（跳过背景层 displayId 0，按 displayId 排序）
  const drawLayers = layers
    .filter((l) => l.displayId > 0)
    .sort((a, b) => a.displayId - b.displayId);

  const entries: FrameEntry[] = [];
  const skippedLayers: string[] = [];
  const usedColorIds = new Set<number>();
  // 独立导出的纯粹区域注释（无匹配实体，单独存放）
  const exportedAnnotations: PureAnnotationExport[] = [];

  for (const layer of drawLayers) {
    const fd = frameDataMap[layer.id];
    const entities = regionEntities[layer.id] || [];
    const hasTexture = !!fd?.rawRegionIdTex;
    const hasEntity = entities.length > 0;
    const hasPhysics = !!fd?.fluidConfig;

    // 收集纯粹区域注释：同层区域注释中，没有匹配到区域实体（regionId 不命中实体 id）的独立注释
    const entityIds = new Set(entities.map((e) => e.id));
    for (const anno of regionAnnotations) {
      if (anno.layerId !== layer.id) continue;
      if (entityIds.has(Number(anno.regionId))) continue;
      exportedAnnotations.push({
        id: anno.id,
        layerId: layer.id,
        layerName: layer.name,
        displayId: layer.displayId,
        text: anno.text,
        color: anno.color,
        regionId: anno.regionId,
        polygon: anno.polygon,
        maskEffect: anno.maskEffect ?? null,
      });
    }

    if (!hasTexture && !hasEntity && !hasPhysics) {
      skippedLayers.push(layer.name);
      continue;
    }

    if (hasTexture && fd?.rawRegionIdTex) {
      const raw = fd.rawRegionIdTex;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== 0) usedColorIds.add(raw[i]);
      }
    }

    entries.push({ layer, fd, entities, hasTexture, hasEntity, hasPhysics, textureIndex: -1 });
  }

  if (entries.length === 0 && exportedAnnotations.length === 0) {
    throw new Error('没有可导出的内容：需要纹理、区域实体、物理场（fluidConfig）或区域注释至少其一');
  }

  // 2. 导出调色板 = 共享调色板 ∩ 被使用颜色，重映射全局 ID → 1..N
  const exportedPalette = sharedBaseColors.filter((c) => usedColorIds.has(c.id));
  if (exportedPalette.length > 255) {
    console.warn(`[素材包] 导出调色板 ${exportedPalette.length} 色，超过 regionIdTex 上限 255，存在溢出风险`);
  }

  const idToIndex = new Map<number, number>();
  exportedPalette.forEach((c, idx) => idToIndex.set(c.id, idx));

  // 3. 构建纹理帧（仅 hasTexture 图层，按 displayId 序）
  const exportFrames: FrameExportData[] = [];
  let textureIndex = 0;
  for (const e of entries) {
    if (!e.hasTexture) continue;
    const fd = e.fd!;
    const raw = fd.rawRegionIdTex!;
    const newRegionIdTex = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const globalId = raw[i];
      newRegionIdTex[i] = globalId === 0 ? 0 : (idToIndex.get(globalId) ?? 0) + 1;
    }
    const size = fd.sourceResolution || 512;
    e.textureIndex = textureIndex++;
    exportFrames.push({
      name: e.layer.name || '未命名',
      width: size,
      height: size,
      bbox: fd.rawBbox || { x: 0, y: 0, w: size, h: size },
      regionIdTex: newRegionIdTex,
      deltaPacked: fd.rawDeltaPacked || new Uint16Array(0),
      blockFlags: BigInt(fd.rawBlockFlags ?? 0),
    });
  }

  // 4. 纹理帧打包 + gzip
  const ftxBytes = packMultiFrameToBinary(exportedPalette, exportFrames, enablePrediction);
  const gzBlob = await compressToGzip(ftxBytes);
  const gzBytes = new Uint8Array(await gzBlob.arrayBuffer());

  // 5. 逐帧资产 JSON
  const encoder = new TextEncoder();
  const frameJsonFiles: { path: string; name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const perFrame = {
      name: e.layer.name || '未命名',
      layerId: e.layer.id,
      displayId: e.layer.displayId,
      hasTexture: e.hasTexture,
      textureIndex: e.hasTexture ? e.textureIndex : -1,
      boundRegionId: e.fd?.boundRegionId ?? null,
      regionEntities: e.entities.map((en) => ({
        ...en.serialize(),
        fixedVertices: Array.from(en.fixedVertices).sort((a, b) => a - b),
      })),
      physics: e.fd?.fluidConfig ?? null,
    };

    // ===== ★ 调试输出：导出后显示物理注入源情况 =====
    if (e.hasPhysics && perFrame.physics) {
      const cfg = perFrame.physics;
      const srcList = cfg.continuousSources ?? [];
      const texSize = e.fd?.sourceResolution || 512;
      const bbox = e.fd?.rawBbox;
      console.group(`[素材包] frame_${i} "${perFrame.name}" 物理注入源情况`);
      console.log(`  advectionMode=${cfg.advectionMode} resolution=${cfg.resolution?.w}×${cfg.resolution?.h}`);
      console.log(`  帧纹理源尺寸=${texSize}  rawBbox=${bbox ? `(${bbox.x},${bbox.y}) ${bbox.w}×${bbox.h}` : '无'}`);
      console.log(`  注入源数量: ${srcList.length}`);
      for (let si = 0; si < srcList.length; si++) {
        const s = srcList[si];
        const pos = s.position || { x: 0.5, y: 0.5 };
        console.log(`  源#${si}: enabled=${s.enabled} pos=(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)})` +
          ` radius=${s.radius} vel=(${s.velocity?.x ?? 0},${s.velocity?.y ?? 0})` +
          ` color=${s.color ? `[${s.color.map(c => c.toFixed(2)).join(',')}]` : '无'}` +
          ` density=${s.density ?? '-'} rate=${s.rate ?? '-'}` +
          ` wave=${s.wave?.enabled ? 'ON' : 'OFF'} waypoints=${s.waypoints?.length ?? 0}`);
        // 映射到帧纹理全局像素（bbox 局部 → 全帧像素）
        const bboxPx = bbox ? {
          x: bbox.x + pos.x * bbox.w,
          y: bbox.y + pos.y * bbox.h,
        } : { x: pos.x * texSize, y: pos.y * texSize };
        // 转换到区域实体使用的 world 坐标（Y 向上，0~1）
        const world = { x: bboxPx.x / texSize, y: 1 - bboxPx.y / texSize };
        console.log(`      ↳ 帧像素≈(${bboxPx.x.toFixed(1)}, ${bboxPx.y.toFixed(1)})` +
          `  world(Y-up)=(${world.x.toFixed(3)}, ${world.y.toFixed(3)})`);
      }
      console.log(`  区域实体 bbox（world Y-up，供对照注入源是否落在区域内）:`);
      for (const en of e.entities) {
        const wb = en.worldBbox;
        if (wb) {
          console.log(`    区域#${en.id}: worldBbox=(${wb.x.toFixed(3)}, ${wb.y.toFixed(3)}) ${wb.w.toFixed(3)}×${wb.h.toFixed(3)}`);
        }
      }
      console.log(`  坐标约定提示：注入源 position 为 bbox 局部归一化、Y 向下为正（0=顶部）；区域 worldBbox 为 Y 向上（0=底部）。两者对照需 Y 翻转。`);
      console.groupEnd();
    }
    const data = encoder.encode(JSON.stringify(perFrame));
    frameJsonFiles.push({ path: `per_frame_data/frame_${i}.json`, name: perFrame.name, data });
  }

  // 6. 独立区域注释（annotations.json，纯粹注释，不进 per_frame_data）
  let annotationBytes: Uint8Array | null = null;
  if (exportedAnnotations.length > 0) {
    const annotationsJson = {
      version: 1,
      total: exportedAnnotations.length,
      annotations: exportedAnnotations,
    };
    annotationBytes = encoder.encode(JSON.stringify(annotationsJson, null, 2));
  }

  // 7. manifest（清单 + 轻量校验）
  const ftxHash = fnv1a32(gzBytes);
  const hashes: Record<string, string> = { 'textures/frames.ftx3.gz': ftxHash };
  for (const f of frameJsonFiles) {
    hashes[f.path] = fnv1a32(f.data);
  }
  if (annotationBytes) {
    hashes['annotations.json'] = fnv1a32(annotationBytes);
  }

  const manifest = {
    version: 1,
    exportType: 'mainCanvasPackage',
    generatedAt: new Date().toISOString(),
    totalFrames: entries.length,
    textureFrameCount: exportFrames.length,
    textureFile: 'textures/frames.ftx3.gz',
    ftxByteLength: gzBytes.length,
    ftxUncompressedByteLength: ftxBytes.length,
    predictionEnabled: enablePrediction,
    frameOrder: entries.map((_, i) => `frame_${i}`),
    paletteCount: exportedPalette.length,
    annotationCount: exportedAnnotations.length,
    annotationFile: annotationBytes ? 'annotations.json' : null,
    hashes,
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2));

  // 8. 打包 ZIP（STORE）
  const zipEntries: ZipEntry[] = [
    { path: 'manifest.json', data: manifestBytes },
    { path: 'textures/frames.ftx3.gz', data: gzBytes },
    ...frameJsonFiles.map((f) => ({ path: f.path, data: f.data })),
  ];
  if (annotationBytes) {
    zipEntries.push({ path: 'annotations.json', data: annotationBytes });
  }
  const bytes = packZip(zipEntries);

  return {
    bytes,
    frameCount: entries.length,
    textureFrameCount: exportFrames.length,
    paletteCount: exportedPalette.length,
    annotationCount: exportedAnnotations.length,
    skippedLayers,
  };
}
