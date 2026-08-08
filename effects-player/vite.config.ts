import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'EffectsPlayer',
      formats: ['es', 'umd'],
      fileName: (format) => `effects-player.${format === 'es' ? 'es' : 'umd'}.js`,
    },
    rollupOptions: {
      external: ['three'],
      output: {
        globals: {
          three: 'THREE',
        },
      },
    },
  },
});
