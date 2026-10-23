import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': { target: backend, changeOrigin: true },
      '/datasets': { target: backend, changeOrigin: true },
      '/lineage': { target: backend, changeOrigin: true },
      '/fields': { target: backend, changeOrigin: true },
      '/users': { target: backend, changeOrigin: true },
      '/files': { target: backend, changeOrigin: true },
      '/import': { target: backend, changeOrigin: true },
    },
  },
});
