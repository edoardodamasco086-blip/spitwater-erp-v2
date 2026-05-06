import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,          // Allows access from other machines on LAN (http://YOUR-IP:5173)
    // Proxy all /api requests to the Express backend
    // This means React calls /api/auth/login (no CORS issues in dev)
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: '../server/public',  // Production build goes into Express's public folder
    emptyOutDir: true,
  }
});
