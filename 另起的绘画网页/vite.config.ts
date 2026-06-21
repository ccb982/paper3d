import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@fluid': path.resolve(__dirname, '../src/lib/fluid-simulator'),
    },
  },
})
