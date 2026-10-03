// ============================================================
// _bundle.mjs —— 通用的「TS → esbuild 打包 → node 直跑」启动器
// ============================================================
// 为什么需要它：src/core 用的是浏览器约定的无扩展名相对导入，node 直接跑不了；
// 而 @dimforge/rapier3d 这个包既没有 main/exports 也没标 type:module，
// node 原生 import 会把它当 CJS 解析并失败。esbuild 打包是唯一省事且确定的路径。
//
// ★ 三个必须踩准的点：
//   1. 产物必须落在项目目录内 —— bundle 里要用 createRequire(import.meta.url)
//      去定位 rapier 的 .wasm，放到系统临时目录会向上找不到 node_modules
//      （本项目 node_modules 是指向本体项目的目录 junction）。
//   2. rapier 包内 rapier_wasm3d.js 会 import 那个 .wasm；esbuild 不认 .wasm 加载器，
//      而那份 wasm 我们本来就用自己的实例覆盖，所以 stub 掉（顺带省 1.4MB）。
//   3. 入口必须「先把 rapier 相关模块导入完，再注入真实 wasm 实例」——反过来会被
//      占位对象盖掉。这条是约定，写在各入口文件里。

import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export async function buildAndRun(entryTs) {
  const outDir = join(root, '.tmp');
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, basename(entryTs).replace(/\.ts$/, '.bundle.mjs'));

  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    console.error('[run] 找不到 esbuild —— 确认 node_modules 可用（本项目用的是指向「全新的游戏」的 junction）。');
    process.exit(1);
  }

  await esbuild.build({
    entryPoints: [join(here, entryTs)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: 'warning',
    sourcemap: false,
    // ★ 可选外部依赖：`PROBE_EXTERNAL=jsdom npm run uipanel`
    //   产物落在 `.tmp/`，node 从那里向上找 `.tmp/node_modules` ⇒ 能解析到。
    //   （本项目 node_modules 是指向别的项目的 junction，不能往里塞东西。）
    external: (process.env.PROBE_EXTERNAL ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    plugins: [
      {
        name: 'rapier-wasm-stub',
        setup(build) {
          build.onResolve({ filter: /rapier_wasm3d_bg\.wasm$/ }, (args) => ({
            path: args.path,
            namespace: 'rapier-wasm-stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'rapier-wasm-stub' }, () => ({
            contents: 'export default {};',
            loader: 'js',
          }));
        },
      },
    ],
  });

  if (!existsSync(outfile)) throw new Error(`[run] 打包产物缺失: ${outfile}`);
  await import(pathToFileURL(outfile).href);
}
