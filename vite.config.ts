import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, 'src/lib'),
      '@entities': path.resolve(__dirname, 'src/entities'),
      '@core': path.resolve(__dirname, 'src/core')
    }
  }
})
