"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/vendor/player/core/bundle.ts
var bundle_exports = {};
__export(bundle_exports, {
  fnv1a32: () => fnv1a32,
  loadBundle: () => loadBundle,
  readZip: () => readZip
});
function fnv1a32(bytes) {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function readZip(buffer) {
  const view = new DataView(buffer);
  const files = /* @__PURE__ */ new Map();
  let eocdOffset = buffer.byteLength - 22;
  while (eocdOffset >= 0) {
    if (view.getUint32(eocdOffset, true) === EOCD_SIG) break;
    eocdOffset--;
  }
  if (eocdOffset < 0) throw new Error("\u65E0\u6548\u7684 ZIP \u6587\u4EF6\uFF1A\u627E\u4E0D\u5230 EOCD");
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  let cdPos = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cdPos, true) !== CENTRAL_HEADER_SIG) {
      throw new Error(`ZIP \u4E2D\u592E\u76EE\u5F55\u635F\u574F\uFF0C\u4F4D\u7F6E ${cdPos}`);
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
async function decompressGzip(data) {
  const isGzipped = data.length >= 2 && data[0] === 31 && data[1] === 139;
  if (!isGzipped) return data;
  const blob = new Blob([data]);
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  const result = await new Response(stream).blob();
  const buf = await result.arrayBuffer();
  return new Uint8Array(buf);
}
async function loadBundle(input, verifyHashes) {
  const buffer = input instanceof Uint8Array ? input.buffer : input;
  const files = readZip(buffer);
  const manifestRaw = files.get("manifest.json");
  if (!manifestRaw) throw new Error("\u7D20\u6750\u5305\u7F3A\u5C11 manifest.json");
  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
  const ftxRaw = files.get(manifest.textureFile);
  if (!ftxRaw) throw new Error(`\u7D20\u6750\u5305\u7F3A\u5C11\u7EB9\u7406\u6587\u4EF6: ${manifest.textureFile}`);
  const ftxBinary = await decompressGzip(ftxRaw);
  if (verifyHashes && manifest.hashes) {
    const actual = fnv1a32(ftxRaw);
    if (actual !== manifest.hashes[manifest.textureFile]) {
      throw new Error(`\u7EB9\u7406\u6587\u4EF6\u54C8\u5E0C\u6821\u9A8C\u5931\u8D25: \u671F\u671B ${manifest.hashes[manifest.textureFile]}, \u5F97\u5230 ${actual}`);
    }
  }
  const frames = [];
  for (let i = 0; i < manifest.totalFrames; i++) {
    const framePath = `per_frame_data/frame_${i}.json`;
    const frameRaw = files.get(framePath);
    if (!frameRaw) throw new Error(`\u7F3A\u5C11\u5E27\u6570\u636E: ${framePath}`);
    if (verifyHashes && manifest.hashes?.[framePath]) {
      const actual = fnv1a32(frameRaw);
      if (actual !== manifest.hashes[framePath]) {
        throw new Error(`\u5E27\u6570\u636E\u54C8\u5E0C\u6821\u9A8C\u5931\u8D25: ${framePath}`);
      }
    }
    frames.push(JSON.parse(new TextDecoder().decode(frameRaw)));
  }
  let annotations = null;
  if (manifest.annotationFile) {
    const annRaw = files.get(manifest.annotationFile);
    if (annRaw) {
      annotations = JSON.parse(new TextDecoder().decode(annRaw));
    }
  }
  return { manifest, ftxBinary, frames, annotations };
}
var CENTRAL_HEADER_SIG, EOCD_SIG;
var init_bundle = __esm({
  "src/vendor/player/core/bundle.ts"() {
    "use strict";
    CENTRAL_HEADER_SIG = 33639248;
    EOCD_SIG = 101010256;
  }
});

// test_mp_entry.ts
var fs = require("fs");
var { loadBundle: loadBundle2 } = (init_bundle(), __toCommonJS(bundle_exports));
(async () => {
  const raw = fs.readFileSync("public/fx/bullets/\u7EF4\u4EC0\u6234\u5C14\u5B50\u5F39.scene.zip");
  const res = await loadBundle2(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), false);
  for (const fd of res.frames) {
    console.log("frame:", fd.name, "textureIndex:", fd.textureIndex);
    console.log("  regionEntities:", fd.regionEntities?.length ?? 0);
    for (const ent of fd.regionEntities ?? []) {
      console.log(
        "  entity id:",
        ent.id,
        "boundary rings:",
        ent.boundary?.length,
        "maskEffect:",
        JSON.stringify(ent.maskEffect ?? null).slice(0, 300)
      );
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
