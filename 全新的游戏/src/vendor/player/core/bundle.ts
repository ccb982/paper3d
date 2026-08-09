import type { Manifest, PerFrameData, AnnotationsFile } from './types';

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

export function fnv1a32(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function crc32(bytes: Uint8Array): number {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export function readZip(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const view = new DataView(buffer);
  const files = new Map<string, Uint8Array>();

  let eocdOffset = buffer.byteLength - 22;
  while (eocdOffset >= 0) {
    if (view.getUint32(eocdOffset, true) === EOCD_SIG) break;
    eocdOffset--;
  }
  if (eocdOffset < 0) throw new Error('无效的 ZIP 文件：找不到 EOCD');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  let cdPos = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cdPos, true) !== CENTRAL_HEADER_SIG) {
      throw new Error(`ZIP 中央目录损坏，位置 ${cdPos}`);
    }
    const nameLen = view.getUint16(cdPos + 28, true);
    const extraLen = view.getUint16(cdPos + 30, true);
    const commentLen = view.getUint16(cdPos + 32, true);
    const localOffset = view.getUint32(cdPos + 42, true);

    const nameBytes = new Uint8Array(buffer, cdPos + 46, nameLen);
    const path = new TextDecoder().decode(nameBytes);

    const lhPos = localOffset;
    const lhNameLen = view.getUint16(lhPos + 26, true);
    const lhExtraLen = view.getUint16(lhPos + 28, true);
    const compSize = view.getUint32(lhPos + 18, true);

    const dataOffset = lhPos + 30 + lhNameLen + lhExtraLen;
    const data = new Uint8Array(buffer, dataOffset, compSize);

    files.set(path, data);

    cdPos += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  const isGzipped = data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
  if (!isGzipped) return data;

  const blob = new Blob([data]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const result = await new Response(stream).blob();
  const buf = await result.arrayBuffer();
  return new Uint8Array(buf);
}

export interface BundleLoadResult {
  manifest: Manifest;
  ftxBinary: Uint8Array;
  frames: PerFrameData[];
  annotations: AnnotationsFile | null;
}

export async function loadBundle(
  input: ArrayBuffer | Uint8Array,
  verifyHashes?: boolean,
): Promise<BundleLoadResult> {
  const buffer = input instanceof Uint8Array ? input.buffer : input;
  const files = readZip(buffer);

  const manifestRaw = files.get('manifest.json');
  if (!manifestRaw) throw new Error('素材包缺少 manifest.json');
  const manifest: Manifest = JSON.parse(new TextDecoder().decode(manifestRaw));

  const ftxRaw = files.get(manifest.textureFile);
  if (!ftxRaw) throw new Error(`素材包缺少纹理文件: ${manifest.textureFile}`);
  const ftxBinary = await decompressGzip(ftxRaw);

  if (verifyHashes && manifest.hashes) {
    const actual = fnv1a32(ftxRaw);
    if (actual !== manifest.hashes[manifest.textureFile]) {
      throw new Error(`纹理文件哈希校验失败: 期望 ${manifest.hashes[manifest.textureFile]}, 得到 ${actual}`);
    }
  }

  const frames: PerFrameData[] = [];
  for (let i = 0; i < manifest.totalFrames; i++) {
    const framePath = `per_frame_data/frame_${i}.json`;
    const frameRaw = files.get(framePath);
    if (!frameRaw) throw new Error(`缺少帧数据: ${framePath}`);

    if (verifyHashes && manifest.hashes?.[framePath]) {
      const actual = fnv1a32(frameRaw);
      if (actual !== manifest.hashes[framePath]) {
        throw new Error(`帧数据哈希校验失败: ${framePath}`);
      }
    }

    frames.push(JSON.parse(new TextDecoder().decode(frameRaw)));
  }

  let annotations: AnnotationsFile | null = null;
  if (manifest.annotationFile) {
    const annRaw = files.get(manifest.annotationFile);
    if (annRaw) {
      annotations = JSON.parse(new TextDecoder().decode(annRaw));
    }
  }

  return { manifest, ftxBinary, frames, annotations };
}
