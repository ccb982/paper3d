import * as zlib from 'zlib';
import { readFileSync } from 'fs';

const url = 'public/ui/加工台背景ui.ftx3.gz';
const raw = readFileSync(url);
const buf = zlib.gunzipSync(raw);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let off = 0;
const read16 = () => { const v = view.getUint16(off, true); off += 2; return v; };
const read32 = () => { const v = view.getUint32(off, true); off += 4; return v; };
const readStr = () => { const len = read16(); let s=''; for(let i=0;i<len;i++) s += String.fromCharCode(read16()); return s; };
const magic = read32().toString(16);
const version = read16();
const frameCount = read16();
const paletteSize = read16();
const palette = [];
for(let i=0;i<paletteSize;i++){ palette.push({ r: read16()/65535, g: read16()/65535, b: read16()/65535 }); }
console.log({magic, version, frameCount, paletteSize});
for(let f=0; f<frameCount; f++){
  const name = readStr();
  const height = read16();
  const width = read16();
  const bboxX = read16();
  const bboxY = read16();
  const bboxW = read16();
  const bboxH = read16();
  const flags = read16();
  const regionCount = read16();
  console.log(f, JSON.stringify(name), {height, width, bbox: {x:bboxX,y:bboxY,w:bboxW,h:bboxH}, flags: flags.toString(16), regionCount});
  for(let r=0;r<regionCount;r++){
    const ridText = readStr();
    const hasPoints = read16();
    const n = read16();
    const pts = [];
    for(let p=0;p<n;p++){ const px = read16(); const py = read16(); pts.push([px,py]); }
    const diffW = read16();
    const diffH = read16();
    const diffFmt = read16();
    if (diffFmt === 3) { off += diffW*diffH*4; }
    else { off += diffW*diffH; }
  }
}
console.log('end offset', off, 'buf len', buf.length);
