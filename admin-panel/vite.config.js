import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths + HashRouter: works at the root of a Vercel domain and in any sub-folder, no rewrites needed.
// Local dev: `npm run dev` proxies /api and /locales to the bot backend on :8080 (python -m app).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080', '/tonconnect-manifest.json': 'http://localhost:8080' } },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          ui: ['framer-motion', 'lucide-react'],
        },
      },
    },
  },
});
