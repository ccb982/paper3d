/** 把 main.ts 的网页默认 env 装进 process.env（探针用；只读 main.ts） */
import fs from 'node:fs';
const mainSrc = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const defStart = mainSrc.indexOf('const __DEFAULTS');
const defEnd = mainSrc.indexOf('\n};', defStart);
const block = mainSrc.slice(defStart, defEnd);
for (const m of block.matchAll(/^\s*([A-Z0-9_]+):\s*'([^']*)',/gm)) {
  if (process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
}
export {};
