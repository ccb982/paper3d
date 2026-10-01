// ============================================================
// atlas-pack 启动器
//
// 为什么需要它：源码是 TS 且用了无扩展名的相对导入（浏览器打包约定），
// node 不能直接跑。这里用项目自带的 esbuild 现场打包再执行，
// 让「一条命令」就能跑：node scripts/atlas-pack.mjs --in ... --out ...
// ============================================================

import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

const GAME_FTX = resolve(projectRoot, '../全新的游戏/src/vendor/player/core/ftx.ts');
if (!existsSync(GAME_FTX)) {
  process.stderr.write(
    `找不到游戏端解码器：${GAME_FTX}\n`
    + `往返验证依赖它。若只想打包，可加 --no-verify 并手动注释 import（本脚本默认会用到它）。\n`,
  );
  process.exit(1);
}

let esbuild;
try {
  esbuild = await import('esbuild');
} catch (e) {
  process.stderr.write(
    `找不到 esbuild（${(e && e.message) || e}）。请在 另起的绘画网页 目录下先 npm install（vite 自带 esbuild）。\n`,
  );
  process.exit(1);
}

const outfile = join(mkdtempSync(join(tmpdir(), 'atlas-pack-')), 'atlas-pack.bundle.mjs');

await esbuild.build({
  entryPoints: [join(here, 'atlas-pack.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'error',
});

const mod = await import(pathToFileURL(outfile).href);
const code = await mod.main(process.argv.slice(2));
process.exit(code);
