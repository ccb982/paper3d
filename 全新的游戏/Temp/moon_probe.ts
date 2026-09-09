import { readFileSync } from "node:fs";
import { readZip } from "../src/vendor/player/core/bundle";

const buf = readFileSync("public/characters/大猫哥的月亮.scene.zip");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const files = readZip(ab);
console.log("files:", [...files.keys()]);
for (let i = 0; i < 3; i++) {
  const key = `per_frame_data/frame_${i}.json`;
  const raw = files.get(key);
  if (!raw) continue;
  const j = JSON.parse(new TextDecoder().decode(raw));
  console.log(`== frame_${i} keys:`, Object.keys(j).filter(k => !['regionEntities'].includes(k)));
  const ents = j.regionEntities ?? [];
  console.log("   regionEntities:", ents.length);
  for (const e of ents) {
    console.log("   boundary pts:", e.boundary?.[0]?.length, "fixed:", JSON.stringify(e.fixedVertices));
  }
}
const m = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
console.log("manifest:", JSON.stringify(m));