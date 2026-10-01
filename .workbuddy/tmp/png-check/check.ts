import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { decodePng } from '../../../另起的绘画网页/scripts/lib/png';

const D = process.argv[2];
const src = join(D, 'src');
const out: Record<string, unknown> = {};
for (const n of readdirSync(src).sort()) {
  try {
    const img = decodePng(readFileSync(join(src, n)));
    const buf = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
    out[n] = { w: img.width, h: img.height, sha: createHash('sha256').update(buf).digest('hex') };
  } catch (e) {
    out[n] = { error: (e as Error).message };
  }
}
writeFileSync(join(D, 'mine.json'), JSON.stringify(out, null, 1));
console.log('解码', Object.keys(out).length, '个');
