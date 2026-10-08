import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// ★ 与 v1 相同的两条硬约束（别删）：
//   1. `vite-plugin-wasm` + `vite-plugin-top-level-await` 是**必需**的 ——
//      @dimforge/rapier3d 包内第一行就是裸的 `import * as wasm from "./rapier_wasm3d_bg.wasm"`，
//      不装插件 Vite 直接崩在 import-analysis。
//   2. `cacheDir: '.vite'` 是**必需**的 —— 本项目的 node_modules 是指向
//      stickman-lab(v1) 的目录 junction，默认缓存位置会与 v1 共用并互相清空。
export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  cacheDir: '.vite',
  server: {
    port: 5274,
    open: false,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
});
