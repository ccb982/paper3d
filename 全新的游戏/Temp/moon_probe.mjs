// Temp/moon_probe.ts
import { readFileSync } from "node:fs";

// src/vendor/player/core/bundle.ts
var CENTRAL_HEADER_SIG = 33639248;
var EOCD_SIG = 101010256;
function readZip(buffer) {
  const view = new DataView(buffer);
  const files2 = /* @__PURE__ */ new Map();
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
    files2.set(path, data);
    cdPos += 46 + nameLen + extraLen + commentLen;
  }
  return files2;
}

// Temp/moon_probe.ts
var buf = readFileSync("public/characters/\u5927\u732B\u54E5\u7684\u6708\u4EAE.scene.zip");
var ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
var files = readZip(ab);
console.log("files:", [...files.keys()]);
for (let i = 0; i < 3; i++) {
  const key = `per_frame_data/frame_${i}.json`;
  const raw = files.get(key);
  if (!raw) continue;
  const j = JSON.parse(new TextDecoder().decode(raw));
  console.log(`== frame_${i} keys:`, Object.keys(j).filter((k) => !["regionEntities"].includes(k)));
  const ents = j.regionEntities ?? [];
  console.log("   regionEntities:", ents.length);
  for (const e of ents) {
    console.log("   boundary pts:", e.boundary?.[0]?.length, "fixed:", JSON.stringify(e.fixedVertices));
  }
}
var m = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
console.log("manifest:", JSON.stringify(m));
