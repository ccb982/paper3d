import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  // ★★ 独立缓存目录（2026-11-14）：默认是 `node_modules/.vite`，
  //   而 `架构重置` 下还有别的项目（stickman-lab 等）共用同一份依赖缓存。
  //   一旦同时跑两个 dev server（端口 5173 + 5174），新实例启动时会清空/重建缓存，
  //   正在运行的那一页**所有模块请求立即失效** ⇒ 控制台满屏
  //   `TypeError: Failed to fetch`（图标/按钮/抽卡覆盖层全挂，看起来像代码崩了）。
  //   设成项目内独立目录后，两个实例互不干扰。
  cacheDir: '.vite-game',
  plugins: [wasm(), topLevelAwait()],
  server: {
    port: 5173,
    open: true,
    // ★ 同一端口被占时直接失败，不要自动 +1 再起第二个实例（那正是缓存打架的源头）
    strictPort: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1000,
    // three / rapier 常规打包进产物（2026-08-23 曾试过 CDN 运行时加载，
    // 本机 preview 存在未定位的 404，暂回退打包方案；微信端本就必须打包）
  },
});
