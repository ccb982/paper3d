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
    // ★ three / rapier 不进主包（index.html importmap 运行时从 CDN 下载）
    rollupOptions: {
      external: ['three', '@dimforge/rapier3d'],
    },
  },
});
