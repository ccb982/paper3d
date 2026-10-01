import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// ★ 两个插件是**必需**的，别删（2026-10-01 实测踩坑）：
//   @dimforge/rapier3d/rapier_wasm3d.js 第 1 行就是裸的
//     import * as wasm from "./rapier_wasm3d_bg.wasm";
//   不装 vite-plugin-wasm 时，Vite 直接崩在 import-analysis：
//     Failed to resolve import "@dimforge/rapier3d/rapier_wasm3d_bg.wasm" ...
//   我一开始把本体注释里"插件对 node_modules 内 .wasm ESM 导入不转译
//   （dev 可用、build 静默失效）"错读成了"不要装插件"。
//   本体的真实做法是**两层叠加**：
//     第 1 层 vite-plugin-wasm —— 让裸 .wasm 导入能被解析（否则 dev 就崩）；
//     第 2 层 src/core/rapierWasm.ts 自己 fetch ?url + 按导入表 instantiate +
//           __wbg_set_wasm 覆盖 —— 这才是保证 build 后仍然正确的那一层。
//   验证方式：dev 能开 + `npm run build` 后 preview 能跑，两者都要过。
export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  // ★ 必须指定 cacheDir（2026-10-01 实测）：
  //   本项目的 node_modules 是指向「全新的游戏」的目录 junction，Vite 的依赖预打包
  //   缓存的默认位置 node_modules/.vite/deps 实际就是**本体游戏的缓存**。
  //   两个 dev server 会互相清空对方的 deps 缓存（实测触发过
  //   "Re-optimizing dependencies because vite config has changed"，并且清理动作
  //   被环境的批量删除护栏拦下、直接把 dev server 启崩）。
  //   指到自己项目内即可彻底隔离。
  cacheDir: '.vite',
  server: {
    port: 5273,
    open: false,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
});
