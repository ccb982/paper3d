"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 旧版生成器基线采集（独立于 src，随 .dbg 工作区使用）
const ChunkGenerator_1 = require("./ChunkGenerator");
function fnv1a32(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
for (let seed = 1; seed <= 6; seed++) {
    for (let cx = -4; cx <= 4; cx++) {
        for (let cz = -4; cz <= 4; cz++) {
            const c = (0, ChunkGenerator_1.generateChunk)(seed, cx, cz);
            console.log(JSON.stringify({
                seed, cx, cz,
                hw: fnv1a32(new Uint8Array(c.walkable.buffer.slice(0))),
                hh: fnv1a32(new Uint8Array(c.heights.buffer.slice(0))),
                blockTypes: [...c.blockTypes],
            }));
        }
    }
}
