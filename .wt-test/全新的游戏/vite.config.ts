import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1000,
    // three / rapier 常规打包进产物（2026-08-23 曾试过 CDN 运行时加载，
    // 本机 preview 存在未定位的 404，暂回退打包方案；微信端本就必须打包）
  },
});
