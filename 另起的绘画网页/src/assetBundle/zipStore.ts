// ============================================================
// ZIP 容器打包（STORE 模式，不压缩）
// 素材包内所有数据段在写入前已自行压缩（ftx3.gz）或为明文 JSON，
// 故 ZIP 仅作容器，不二次压缩，保持打包/解包极轻量。
// 纯 TypeScript，无 React / 引擎依赖，可独立拷走复用。
// ============================================================

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

// ---------------- FNV-1a 32 位轻量哈希（校验用，非加密） ----------------

export function fnv1a32(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------- CRC32 ----------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------- STORE ZIP 打包 ----------------

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;
const DOS_DATE_1980_01_01 = 0x21;

/**
 * 将多个条目打包为 STORE 模式的 ZIP（无目录条目，纯文件）。
 * 顺序按传入 entries 顺序写入。
 */
export function packZip(entries: ZipEntry[]): Uint8Array {
  interface LocalRef {
    name: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
  }

  const locals: LocalRef[] = [];
  let dataOffset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.path);
    const crc = crc32(entry.data);
    locals.push({ name, data: entry.data, crc, offset: dataOffset });
    dataOffset += LOCAL_HEADER_SIZE + name.length + entry.data.length;
  }

  // 中央目录
  const centralStart = dataOffset;
  let centralSize = 0;
  const centralChunks: Uint8Array[] = [];
  for (const l of locals) {
    const cd = new Uint8Array(CENTRAL_HEADER_SIZE + l.name.length);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true);   // 中央目录签名
    dv.setUint16(4, 20, true);           // version made by
    dv.setUint16(6, 20, true);           // version needed
    dv.setUint16(8, 0, true);            // flags
    dv.setUint16(10, 0, true);           // method = store
    dv.setUint16(12, 0, true);           // mod time
    dv.setUint16(14, DOS_DATE_1980_01_01, true);
    dv.setUint32(16, l.crc, true);
    dv.setUint32(20, l.data.length, true); // comp size
    dv.setUint32(24, l.data.length, true); // uncomp size
    dv.setUint16(28, l.name.length, true);
    dv.setUint16(30, 0, true);           // extra len
    dv.setUint16(32, 0, true);           // comment len
    dv.setUint16(34, 0, true);           // disk start
    dv.setUint16(36, 0, true);           // internal attrs
    dv.setUint32(38, 0, true);           // external attrs
    dv.setUint32(42, l.offset, true);    // local header offset
    cd.set(l.name, CENTRAL_HEADER_SIZE);
    centralChunks.push(cd);
    centralSize += cd.length;
  }

  // 汇总写入
  const total = centralStart + centralSize + EOCD_SIZE;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const l of locals) {
    const lh = new Uint8Array(LOCAL_HEADER_SIZE);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);   // local file header 签名
    dv.setUint16(4, 20, true);           // version needed
    dv.setUint16(6, 0, true);            // flags
    dv.setUint16(8, 0, true);            // method = store
    dv.setUint16(10, 0, true);           // mod time
    dv.setUint16(12, DOS_DATE_1980_01_01, true);
    dv.setUint32(14, l.crc, true);
    dv.setUint32(18, l.data.length, true); // comp size
    dv.setUint32(22, l.data.length, true); // uncomp size
    dv.setUint16(26, l.name.length, true);
    dv.setUint16(28, 0, true);           // extra len
    out.set(lh, pos); pos += LOCAL_HEADER_SIZE;
    out.set(l.name, pos); pos += l.name.length;
    out.set(l.data, pos); pos += l.data.length;
  }
  for (const c of centralChunks) {
    out.set(c, pos); pos += c.length;
  }

  const eocd = new Uint8Array(EOCD_SIZE);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);    // EOCD 签名
  edv.setUint16(4, 0, true);             // disk number
  edv.setUint16(6, 0, true);             // central dir start disk
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, centralStart, true);
  edv.setUint16(20, 0, true);            // comment len
  out.set(eocd, pos);

  return out;
}
