import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  server: { port: 5174, open: false },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1000 },
});
