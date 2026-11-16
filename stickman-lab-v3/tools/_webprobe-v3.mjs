import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./_webprobe-live.mjs', import.meta.url), 'utf8');
const patched = src.replace('t: tm ? Number(tm[1]) : null,', 't: tm ? Number(tm[1]) : null, v3: g.__V3_AR,');
const out = new URL('./_webprobe-v3.tmp.mjs', import.meta.url);
const fs = await import('node:fs');
fs.writeFileSync(out, patched);
await import(out.href);
