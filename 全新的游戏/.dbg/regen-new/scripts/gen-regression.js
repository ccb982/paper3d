"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================
// gen-regression —— 地形生成回归基线工具（改造前后对照）
// ============================================================
// 用法：
//   采集基线：  node gen-regression.js > baseline.json
//   改造后对比：node gen-regression.js baseline.json   （exit 1 = 回归失败）
//
// 不变量（必须逐位一致）：walkable[] / heights[]
// 允许变化（白名单，逐块校验）：
//   blockTypes[] 仅允许 平地→装饰平面(0→10/11/12) 与 高台→高台变体(1→13/14/15)
//   其余任何 id 变化（包括液体/坑洞位）均为回归失败
// ============================================================
const ChunkGenerator_1 = require("../src/services/map/ChunkGenerator");
function fnv1a32(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
const rows = [];
for (let seed = 1; seed <= 6; seed++) {
    for (let cx = -4; cx <= 4; cx++) {
        for (let cz = -4; cz <= 4; cz++) {
            const c = (0, ChunkGenerator_1.generateChunk)(seed, cx, cz);
            rows.push({
                seed, cx, cz,
                hw: fnv1a32(new Uint8Array(c.walkable.buffer.slice(0))),
                hh: fnv1a32(new Uint8Array(c.heights.buffer.slice(0))),
                blockTypes: [...c.blockTypes],
            });
        }
    }
}
const baselinePath = process.argv[2];
if (!baselinePath) {
    for (const r of rows)
        console.log(JSON.stringify(r));
    console.error(`[gen-regression] 已采集 ${rows.length} 个 chunk 基线`);
}
else {
    // 对比模式：逐块白名单校验
    const fs = require('fs');
    const old = new Map();
    for (const line of fs.readFileSync(baselinePath, 'utf8').split('\n')) {
        const s = line.trim();
        if (!s || !s.startsWith('{'))
            continue;
        const r = JSON.parse(s);
        old.set(`${r.seed}:${r.cx}:${r.cz}`, r);
    }
    let fail = 0;
    const ALLOWED = {
        0: [0, 10, 11, 12], // 平地 → 平地/装饰平面
        1: [1, 13, 14, 15], // 高台 → 高台/装饰高台
    };
    for (const r of rows) {
        const o = old.get(`${r.seed}:${r.cx}:${r.cz}`);
        if (!o) {
            console.error(`缺失基线 ${r.seed}:${r.cx}:${r.cz}`);
            fail++;
            continue;
        }
        if (o.hw !== r.hw) {
            console.error(`walkable 漂移 ${r.seed}:${r.cx}:${r.cz} ${o.hw}→${r.hw}`);
            fail++;
        }
        if (o.hh !== r.hh) {
            console.error(`heights 漂移 ${r.seed}:${r.cx}:${r.cz} ${o.hh}→${r.hh}`);
            fail++;
        }
        for (let i = 0; i < 225; i++) {
            const a = o.blockTypes[i], b = r.blockTypes[i];
            if (a === b)
                continue;
            const allowed = ALLOWED[a]?.includes(b);
            if (!allowed) {
                console.error(`blockTypes 越权变化 ${r.seed}:${r.cx}:${r.cz} 块#${i} ${a}→${b}`);
                fail++;
            }
        }
    }
    if (fail === 0) {
        console.error(`[gen-regression] ✅ ${rows.length} chunk 全部通过：walkable/heights 逐位一致，blockTypes 变化全部在白名单内`);
    }
    else {
        console.error(`[gen-regression] ❌ ${fail} 处回归失败`);
        process.exit(1);
    }
}
