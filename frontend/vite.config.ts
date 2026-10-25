import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 演示录制等场景可用 VITE_API_TARGET 指向独立后端实例
const backend = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': { target: backend, changeOrigin: true },
      '/datasets': { target: backend, changeOrigin: true },
      '/lineage': { target: backend, changeOrigin: true },
      '/fields': { target: backend, changeOrigin: true },
      '/edges': { target: backend, changeOrigin: true },
      '/annotations': { target: backend, changeOrigin: true },
      '/changes': { target: backend, changeOrigin: true },
      '/version-tags': { target: backend, changeOrigin: true },
      '/users': { target: backend, changeOrigin: true },
      '/ai': { target: backend, changeOrigin: true },
      '/files': { target: backend, changeOrigin: true },
      '/import': { target: backend, changeOrigin: true },
    },
  },
});
