// ============================================================
// _bundle.mjs —— 「TS → esbuild 打包 → node 直跑」启动器（v2 版）
// ============================================================
// 与 v1 同一套做法（原因见 v1 的注释）：
//   1. 产物必须落在项目目录内（bundle 要用 createRequire 定位 rapier 的 .wasm）
//   2. rapier 包内 `import "./rapier_wasm3d_bg.wasm"` 要 stub 掉
//   3. 入口必须先导入 rapier 模块，再用真实 wasm 实例覆盖占位
import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export async function buildAndRun(entryTs, argList = []) {
  const outDir = join(root, '.tmp');
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, basename(entryTs).replace(/\.ts$/, '.bundle.mjs'));

  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    console.error('[run] 找不到 esbuild —— 确认 node_modules junction 可用。');
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
  globalThis.__PROBE_ARGS = argList;
  await import(pathToFileURL(outfile).href);
}
