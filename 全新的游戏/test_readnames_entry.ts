// 读取主角动画包的帧名（gzip → decodeMultiFrame → FrameResolver）
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { decodeMultiFrame } = require('./src/vendor/player/core/ftx');
const { FrameResolver } = require('./src/vendor/player/core/frameResolver');

const file = process.argv[2] || 'src/assets/characters/protagonist/维维美.ftx3.gz';
const full = path.join(process.cwd(), file);
if (!fs.existsSync(full)) {
  console.error('文件不存在:', full);
  process.exit(1);
}
const raw = fs.readFileSync(full);
console.log(`文件: ${path.basename(full)} (${(raw.length / 1024).toFixed(1)}KB)`);

// gzip 检测（魔数 1f 8b）
let bin = raw;
if (raw[0] === 0x1f && raw[1] === 0x8b) {
  bin = zlib.gunzipSync(raw);
  console.log(`gzip 解压 → ${(bin.length / 1024).toFixed(1)}KB`);
}

const magic = bin.readUInt32BE(0).toString(16);
console.log(`魔数: 0x${magic}${magic === '46545833' ? ' (FTX3 ✓)' : ' (非 FTX3)'}`);

const decoded = decodeMultiFrame(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
console.log(`解码: ${decoded.frames.length} 帧, palette ${decoded.palette.length} 色`);

const resolver = new FrameResolver(decoded.frames.map((f) => f.name));
console.log('\n=== 帧名清单 ===');
for (const e of resolver.list()) {
  const f = decoded.frames[e.index];
  console.log(`  [${e.index}] "${e.name}"  bbox=(${f.bbox.x},${f.bbox.y},${f.bbox.w}x${f.bbox.h})`);
}
